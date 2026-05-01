import json
from pathlib import Path

from pydantic import ValidationError

from app.models import ContextDocument, ContextPolicy, ContextUpdate, SchemaContext


CONTEXT_DIR = Path("data/context")
CONTEXT_PATH = CONTEXT_DIR / "context.md"
SCHEMA_PATH = CONTEXT_DIR / "schema.json"
POLICY_PATH = CONTEXT_DIR / "policy.json"


class ContextStoreError(RuntimeError):
    pass


def default_context_markdown() -> str:
    return (
        "# Database Context\n\n"
        "Describe business terms, common joins, important filters, and fields that should not be exported.\n"
    )


def ensure_context_files(
    context_dir: Path = CONTEXT_DIR,
    schema: SchemaContext | None = None,
) -> ContextDocument:
    context_dir.mkdir(parents=True, exist_ok=True)
    context_path = context_dir / "context.md"
    schema_path = context_dir / "schema.json"
    policy_path = context_dir / "policy.json"

    if not context_path.exists():
        context_path.write_text(default_context_markdown(), encoding="utf-8")

    if not policy_path.exists():
        _write_json(policy_path, ContextPolicy().model_dump())

    if schema is not None:
        _write_json(schema_path, schema.model_dump())
    elif not schema_path.exists():
        _write_json(schema_path, SchemaContext().model_dump())

    return load_context(context_dir)


def load_context(context_dir: Path = CONTEXT_DIR) -> ContextDocument:
    context_path = context_dir / "context.md"
    schema_path = context_dir / "schema.json"
    policy_path = context_dir / "policy.json"

    missing = [str(path) for path in (context_path, schema_path, policy_path) if not path.exists()]
    if missing:
        raise ContextStoreError(f"Missing context file(s): {', '.join(missing)}")

    try:
        return ContextDocument(
            context=context_path.read_text(encoding="utf-8"),
            schema_context=SchemaContext.model_validate(_read_json(schema_path)),
            policy=ContextPolicy.model_validate(_read_json(policy_path)),
        )
    except (json.JSONDecodeError, ValidationError) as exc:
        raise ContextStoreError(f"Context files are invalid: {exc}") from exc


def update_context(update: ContextUpdate, context_dir: Path = CONTEXT_DIR) -> ContextDocument:
    existing = ensure_context_files(context_dir)
    context_path = context_dir / "context.md"
    policy_path = context_dir / "policy.json"

    context_path.write_text(update.context, encoding="utf-8")
    _write_json(policy_path, update.policy.model_dump())

    return ContextDocument(context=update.context, schema_context=existing.schema_context, policy=update.policy)


def save_scanned_schema(schema: SchemaContext, context_dir: Path = CONTEXT_DIR) -> ContextDocument:
    return ensure_context_files(context_dir, schema=schema)


def _read_json(path: Path) -> object:
    return json.loads(path.read_text(encoding="utf-8"))


def _write_json(path: Path, data: object) -> None:
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")
