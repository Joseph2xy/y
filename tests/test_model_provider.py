import json
from types import SimpleNamespace

import pytest

from app.model_provider import LiteLLMModelProvider, ModelProviderError
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
    assert calls[0]["response_format"] == {"type": "json_object"}
    assert "Return JSON matching this schema" in calls[0]["messages"][-1]["content"]


def test_model_provider_calls_opencode_zen_without_litellm(monkeypatch) -> None:
    calls = []

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def read(self) -> bytes:
            return json.dumps(
                {
                    "choices": [
                        {
                            "message": {
                                "content": json.dumps(
                                    {
                                        "sql": "select email from customers limit 10",
                                        "notes": [],
                                    }
                                )
                            }
                        }
                    ]
                }
            ).encode("utf-8")

    def fake_urlopen(request, timeout):
        calls.append((request, timeout))
        return FakeResponse()

    monkeypatch.setattr("app.model_provider.urlopen", fake_urlopen)
    provider = LiteLLMModelProvider(
        ModelConfig(model="openai/nemotron-3-super-free", base_url="https://opencode.ai/zen/v1")
    )

    result = provider.generate_json(
        messages=[ModelMessage(role="user", content="Generate SQL.")],
        response_model=SQLProposal,
    )

    request, timeout = calls[0]
    body = json.loads(request.data.decode("utf-8"))
    assert result.sql == "select email from customers limit 10"
    assert request.full_url == "https://opencode.ai/zen/v1/chat/completions"
    assert request.headers["User-agent"] == "CSV Chat local app"
    assert "Authorization" not in request.headers
    assert timeout == 60
    assert body["model"] == "nemotron-3-super-free"
    assert body["response_format"] == {"type": "json_object"}


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
