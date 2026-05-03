import json
import os
from collections.abc import Callable
from typing import Any, TypeVar

os.environ.setdefault("LITELLM_LOCAL_MODEL_COST_MAP", "True")

import litellm
from pydantic import BaseModel, ValidationError

from app.models import ModelConfig, ModelMessage
from app.prompt_builder import response_format_for


class ModelProviderError(RuntimeError):
    pass


T = TypeVar("T", bound=BaseModel)

CompletionFn = Callable[..., Any]


class LiteLLMModelProvider:
    def __init__(
        self,
        config: ModelConfig,
        completion_fn: CompletionFn | None = None,
    ) -> None:
        self.config = config
        self._completion = completion_fn or litellm.completion

    def generate_json(
        self,
        *,
        messages: list[ModelMessage],
        response_model: type[T],
    ) -> T:
        request_messages = [
            message.model_dump()
            for message in messages
            + [ModelMessage(role="user", content=response_format_for(response_model))]
        ]
        kwargs: dict[str, Any] = {
            "model": self.config.model,
            "messages": request_messages,
            "temperature": self.config.temperature,
        }
        if _supports_json_mode(self.config.model):
            kwargs["response_format"] = {"type": "json_object"}
        if self.config.api_key:
            kwargs["api_key"] = self.config.api_key
        if self.config.base_url:
            kwargs["api_base"] = self.config.base_url

        try:
            response = self._completion(**kwargs)
            content = _extract_content(response)
            return response_model.model_validate(json.loads(content))
        except json.JSONDecodeError as exc:
            raise ModelProviderError(f"Model returned invalid JSON: {exc}") from exc
        except ValidationError as exc:
            raise ModelProviderError(f"Model response did not match schema: {exc}") from exc
        except Exception as exc:
            if isinstance(exc, ModelProviderError):
                raise
            raise ModelProviderError(f"Model call failed: {exc}") from exc


def _supports_json_mode(model: str) -> bool:
    try:
        supported_params = litellm.get_supported_openai_params(model=model) or []
    except Exception:
        return False
    return "response_format" in supported_params


def _extract_content(response: Any) -> str:
    try:
        content = response.choices[0].message.content
    except (AttributeError, IndexError, KeyError, TypeError) as exc:
        raise ModelProviderError("Model response did not include message content.") from exc

    if not isinstance(content, str) or not content.strip():
        raise ModelProviderError("Model response content was empty.")
    return content
