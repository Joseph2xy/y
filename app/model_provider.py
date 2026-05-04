import json
import os
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
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
        if _is_opencode_zen(self.config.base_url):
            return self._generate_opencode_json(request_messages=request_messages, response_model=response_model)

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

    def _generate_opencode_json(
        self,
        *,
        request_messages: list[dict[str, Any]],
        response_model: type[T],
    ) -> T:
        base_url = (self.config.base_url or "").rstrip("/")
        body = json.dumps(
            {
                "model": self.config.model.removeprefix("openai/"),
                "messages": request_messages,
                "temperature": self.config.temperature,
                "response_format": {"type": "json_object"},
            }
        ).encode("utf-8")
        headers = {
            "accept": "application/json",
            "content-type": "application/json",
            "user-agent": "CSV Chat local app",
        }
        if self.config.api_key:
            headers["authorization"] = f"Bearer {self.config.api_key}"

        try:
            request = Request(f"{base_url}/chat/completions", data=body, headers=headers, method="POST")
            with urlopen(request, timeout=60) as response:
                payload = json.loads(response.read().decode("utf-8"))
            content = payload["choices"][0]["message"]["content"]
            return response_model.model_validate(json.loads(content))
        except json.JSONDecodeError as exc:
            raise ModelProviderError(f"Model returned invalid JSON: {exc}") from exc
        except (KeyError, IndexError, TypeError) as exc:
            raise ModelProviderError("Model response did not include message content.") from exc
        except ValidationError as exc:
            raise ModelProviderError(f"Model response did not match schema: {exc}") from exc
        except HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise ModelProviderError(f"Model call failed: HTTP {exc.code}: {detail}") from exc
        except URLError as exc:
            raise ModelProviderError(f"Model call failed: {exc}") from exc


def _supports_json_mode(model: str) -> bool:
    try:
        supported_params = litellm.get_supported_openai_params(model=model) or []
    except Exception:
        return False
    return "response_format" in supported_params


def _is_opencode_zen(base_url: str | None) -> bool:
    return (base_url or "").rstrip("/") == "https://opencode.ai/zen/v1"


def _extract_content(response: Any) -> str:
    try:
        content = response.choices[0].message.content
    except (AttributeError, IndexError, KeyError, TypeError) as exc:
        raise ModelProviderError("Model response did not include message content.") from exc

    if not isinstance(content, str) or not content.strip():
        raise ModelProviderError("Model response content was empty.")
    return content
