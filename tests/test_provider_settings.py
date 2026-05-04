from tools.api_client import APIClient

from app.main import app
from app.models import ModelProviderSettingsUpdate
from app.provider_settings import (
    ProviderSettingsError,
    load_provider_settings,
    model_config_from_settings,
    provider_settings_response,
    save_provider_settings,
)


def test_default_provider_settings_are_openrouter(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)

    response = provider_settings_response(load_provider_settings())

    assert response.provider == "openrouter"
    assert response.model == "openrouter/openai/gpt-4o-mini"
    assert response.base_url is None
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


def test_model_config_uses_saved_provider_settings(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    save_provider_settings(
        ModelProviderSettingsUpdate(
            provider="openrouter",
            model="openrouter/openai/gpt-4o-mini",
            api_key="sk-or-test",
        )
    )

    config = model_config_from_settings()

    assert config.model == "openrouter/openai/gpt-4o-mini"
    assert config.api_key == "sk-or-test"
    assert config.base_url is None


def test_model_config_supports_openai_provider_without_base_url(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    save_provider_settings(
        ModelProviderSettingsUpdate(
            provider="openai",
            model="openai/gpt-4.1-mini",
            api_key="sk-test",
        )
    )

    config = model_config_from_settings()

    assert config.model == "openai/gpt-4.1-mini"
    assert config.api_key == "sk-test"
    assert config.base_url is None


def test_model_config_supports_opencode_without_api_key(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    settings = save_provider_settings(
        ModelProviderSettingsUpdate(
            provider="opencode",
            model="nemotron-3-super-free",
        )
    )

    config = model_config_from_settings()

    assert settings.api_key is None
    assert settings.base_url == "https://opencode.ai/zen/v1"
    assert config.model == "nemotron-3-super-free"
    assert config.api_key is None
    assert config.base_url == "https://opencode.ai/zen/v1"


def test_model_config_requires_saved_api_key(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)

    try:
        model_config_from_settings()
    except ProviderSettingsError as exc:
        assert "Open Settings" in str(exc)
    else:
        raise AssertionError("Expected missing saved API key to fail.")


def test_model_provider_settings_api_round_trip(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    client = APIClient(app)

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
