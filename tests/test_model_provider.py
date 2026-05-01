import json
from types import SimpleNamespace

import pytest

from app.model_provider import LiteLLMModelProvider, ModelProviderError, model_config_from_env
from app.models import ModelConfig, ModelMessage, SQLProposal


def completion_response(content: str) -> SimpleNamespace:
    return SimpleNamespace(
        choices=[
            SimpleNamespace(
                message=SimpleNamespace(content=content),
            )
        ]
    )


def test_model_provider_parses_structured_json_response() -> None:
    calls = []

    def completion(**kwargs):
        calls.append(kwargs)
        return completion_response(
            json.dumps(
                {
                    "sql": "select email from customers limit 10",
                    "notes": ["Uses the approved CSV columns."],
                }
            )
        )

    provider = LiteLLMModelProvider(
        ModelConfig(model="openai/gpt-4.1-mini", api_key="test-key", base_url="https://example.test"),
        completion_fn=completion,
    )

    result = provider.generate_json(
        messages=[ModelMessage(role="user", content="Generate SQL.")],
        response_model=SQLProposal,
    )

    assert result.sql == "select email from customers limit 10"
    assert calls[0]["model"] == "openai/gpt-4.1-mini"
    assert calls[0]["api_key"] == "test-key"
    assert calls[0]["api_base"] == "https://example.test"
    assert "Return JSON matching this schema" in calls[0]["messages"][-1]["content"]


def test_model_provider_rejects_invalid_json() -> None:
    provider = LiteLLMModelProvider(
        ModelConfig(model="openai/gpt-4.1-mini"),
        completion_fn=lambda **kwargs: completion_response("not json"),
    )

    with pytest.raises(ModelProviderError, match="invalid JSON"):
        provider.generate_json(
            messages=[ModelMessage(role="user", content="Generate SQL.")],
            response_model=SQLProposal,
        )


def test_model_provider_rejects_schema_mismatch() -> None:
    provider = LiteLLMModelProvider(
        ModelConfig(model="openai/gpt-4.1-mini"),
        completion_fn=lambda **kwargs: completion_response(json.dumps({"notes": []})),
    )

    with pytest.raises(ModelProviderError, match="did not match schema"):
        provider.generate_json(
            messages=[ModelMessage(role="user", content="Generate SQL.")],
            response_model=SQLProposal,
        )


def test_model_config_from_env_rejects_invalid_temperature() -> None:
    with pytest.raises(ModelProviderError, match="MODEL_TEMPERATURE must be a valid number"):
        model_config_from_env({"MODEL_NAME": "openai/gpt-4.1-mini", "MODEL_TEMPERATURE": "warm"})
