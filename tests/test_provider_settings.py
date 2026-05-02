from fastapi.testclient import TestClient

from app.main import app
from app.models import ModelProviderSettingsUpdate
from app.provider_settings import (
    OPENROUTER_BASE_URL,
    ProviderSettingsError,
    load_provider_settings,
    model_config_from_settings_or_env,
    provider_settings_response,
    save_provider_settings,
)


def test_default_provider_settings_are_openrouter() -> None:
    response = provider_settings_response(load_provider_settings())

    assert response.provider == "openrouter"
    assert response.model == "openrouter/openai/gpt-4o-mini"
    assert response.base_url == OPENROUTER_BASE_URL
    assert response.api_key_configured is False


def test_save_provider_settings_keeps_api_key_out_of_response(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)

    settings = save_provider_settings(
        ModelProviderSettingsUpdate(
            provider="openrouter",
            model="openrouter/anthropic/claude-3.5-sonnet",
            api_key="sk-or-test",
        )
    )
    response = provider_settings_response(settings)

    assert settings.api_key == "sk-or-test"
    assert response.api_key_configured is True
    assert response.model == "openrouter/anthropic/claude-3.5-sonnet"
    assert response.model_dump().get("api_key") is None


def test_save_provider_settings_requires_new_key_when_provider_identity_changes(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    save_provider_settings(
        ModelProviderSettingsUpdate(
            provider="openrouter",
            model="openrouter/openai/gpt-4o-mini",
            api_key="sk-or-test",
        )
    )

    try:
        save_provider_settings(
            ModelProviderSettingsUpdate(
                provider="custom",
                model="openai/local-model",
                base_url="http://127.0.0.1:4010/v1",
            )
        )
    except ProviderSettingsError as exc:
        assert "API key is required" in str(exc)
    else:
        raise AssertionError("Expected provider change without a new key to fail.")


def test_model_config_prefers_saved_provider_settings(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    save_provider_settings(
        ModelProviderSettingsUpdate(
            provider="openrouter",
            model="openrouter/openai/gpt-4o-mini",
            api_key="sk-or-test",
        )
    )

    config = model_config_from_settings_or_env({"MODEL_NAME": "openai/ignored", "MODEL_API_KEY": "ignored"})

    assert config.model == "openrouter/openai/gpt-4o-mini"
    assert config.api_key == "sk-or-test"
    assert config.base_url == OPENROUTER_BASE_URL


def test_model_config_falls_back_to_env_when_settings_key_is_missing(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)

    config = model_config_from_settings_or_env(
        {
            "MODEL_NAME": "openrouter/openai/gpt-4o-mini",
            "MODEL_API_KEY": "env-key",
            "MODEL_BASE_URL": "https://openrouter.ai/api/v1",
        }
    )

    assert config.model == "openrouter/openai/gpt-4o-mini"
    assert config.api_key == "env-key"
    assert config.base_url == "https://openrouter.ai/api/v1"


def test_model_config_requires_env_api_key_when_falling_back_to_env(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)

    try:
        model_config_from_settings_or_env({"MODEL_NAME": "openrouter/openai/gpt-4o-mini"})
    except ProviderSettingsError as exc:
        assert "MODEL_API_KEY" in str(exc)
    else:
        raise AssertionError("Expected missing env API key to fail.")


def test_model_provider_settings_api_round_trip(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    client = TestClient(app)

    default_response = client.get("/settings/model-provider")
    assert default_response.status_code == 200
    assert default_response.json()["provider"] == "openrouter"
    assert default_response.json()["api_key_configured"] is False

    update_response = client.put(
        "/settings/model-provider",
        json={
            "provider": "openrouter",
            "model": "openrouter/openai/gpt-4o-mini",
            "api_key": "sk-or-test",
            "temperature": 0,
        },
    )

    assert update_response.status_code == 200
    body = update_response.json()
    assert body["api_key_configured"] is True
    assert "api_key" not in body

    get_response = client.get("/settings/model-provider")
    assert get_response.json()["api_key_configured"] is True
