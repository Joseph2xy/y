import json
from pathlib import Path

from pydantic import ValidationError

from app.models import ModelConfig, ModelProviderSettings, ModelProviderSettingsResponse, ModelProviderSettingsUpdate


SETTINGS_DIR = Path("data/settings")
MODEL_PROVIDER_PATH = SETTINGS_DIR / "model_provider.json"


class ProviderSettingsError(RuntimeError):
    pass


def default_provider_settings() -> ModelProviderSettings:
    return ModelProviderSettings()


def load_provider_settings(path: Path = MODEL_PROVIDER_PATH) -> ModelProviderSettings:
    if not path.exists():
        return default_provider_settings()

    try:
        return ModelProviderSettings.model_validate(json.loads(path.read_text(encoding="utf-8")))
    except (json.JSONDecodeError, ValidationError) as exc:
        raise ProviderSettingsError(f"Model provider settings are invalid: {exc}") from exc


def save_provider_settings(
    update: ModelProviderSettingsUpdate,
    path: Path = MODEL_PROVIDER_PATH,
) -> ModelProviderSettings:
    existing = load_provider_settings(path)
    api_key = _clean_optional(update.api_key)
    base_url = _clean_optional(update.base_url)
    preserved_api_key = existing.api_key if _can_preserve_api_key(existing, update.provider, base_url) else None
    settings = ModelProviderSettings(
        provider=update.provider,
        model=update.model.strip(),
        api_key=preserved_api_key if api_key is None else api_key,
        base_url=base_url,
        temperature=update.temperature,
    )
    if not settings.api_key:
        raise ProviderSettingsError("API key is required for the selected model provider.")

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(settings.model_dump(), indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return settings


def provider_settings_response(settings: ModelProviderSettings) -> ModelProviderSettingsResponse:
    return ModelProviderSettingsResponse(
        provider=settings.provider,
        model=settings.model,
        base_url=settings.base_url,
        temperature=settings.temperature,
        api_key_configured=bool(settings.api_key),
    )


def model_config_from_settings(path: Path = MODEL_PROVIDER_PATH) -> ModelConfig:
    settings = load_provider_settings(path)
    if settings.api_key:
        return ModelConfig(
            model=settings.model,
            api_key=settings.api_key,
            base_url=settings.base_url,
            temperature=settings.temperature,
        )

    raise ProviderSettingsError(
        "Model provider is not configured. Open Settings and add an OpenRouter, OpenAI, or custom provider API key."
    )


def _clean_optional(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    return cleaned or None


def _can_preserve_api_key(
    existing: ModelProviderSettings,
    provider: str,
    base_url: str | None,
) -> bool:
    return existing.provider == provider and existing.base_url == base_url
