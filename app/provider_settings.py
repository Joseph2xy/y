import json
import os
from pathlib import Path

from pydantic import ValidationError

from app.models import ModelConfig, ModelProviderSettings, ModelProviderSettingsResponse, ModelProviderSettingsUpdate


SETTINGS_DIR = Path("data/settings")
MODEL_PROVIDER_PATH = SETTINGS_DIR / "model_provider.json"
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"


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
        base_url=_effective_base_url(settings),
        temperature=settings.temperature,
        api_key_configured=bool(settings.api_key),
    )


def model_config_from_settings_or_env(
    environ: dict[str, str] = os.environ,
    path: Path = MODEL_PROVIDER_PATH,
) -> ModelConfig:
    settings = load_provider_settings(path)
    if settings.api_key:
        return ModelConfig(
            model=settings.model,
            api_key=settings.api_key,
            base_url=_effective_base_url(settings),
            temperature=settings.temperature,
        )

    model = environ.get("MODEL_NAME") or environ.get("LITELLM_MODEL")
    if not model:
        raise ProviderSettingsError(
            "Model provider is not configured. Add an OpenRouter API key in provider settings, "
            "or set MODEL_NAME and MODEL_API_KEY."
        )

    try:
        temperature = float(environ.get("MODEL_TEMPERATURE", "0"))
    except ValueError as exc:
        raise ProviderSettingsError(
            f"MODEL_TEMPERATURE must be a valid number, got {environ.get('MODEL_TEMPERATURE')!r}."
        ) from exc

    api_key = environ.get("MODEL_API_KEY") or environ.get("LITELLM_API_KEY")
    if not api_key:
        raise ProviderSettingsError(
            "Model provider is not configured. Add an OpenRouter API key in provider settings, "
            "or set MODEL_NAME and MODEL_API_KEY."
        )

    return ModelConfig(
        model=model,
        api_key=api_key,
        base_url=environ.get("MODEL_BASE_URL") or environ.get("LITELLM_API_BASE"),
        temperature=temperature,
    )


def _effective_base_url(settings: ModelProviderSettings) -> str | None:
    if settings.provider == "openrouter":
        return settings.base_url or OPENROUTER_BASE_URL
    return settings.base_url


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
