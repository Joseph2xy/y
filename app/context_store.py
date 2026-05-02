import json
from pathlib import Path

from pydantic import ValidationError

from app.models import ContextDocument, ContextPolicy, ContextUpdate, SchemaContext, SchemaTable


CONTEXT_DIR = Path("data/context")
CONTEXT_PATH = CONTEXT_DIR / "context.md"
SCHEMA_PATH = CONTEXT_DIR / "schema.json"
POLICY_PATH = CONTEXT_DIR / "policy.json"
MAX_SAMPLE_FILTER_COUNT = 5


class ContextStoreError(RuntimeError):
    pass


def default_context_markdown(schema: SchemaContext | None = None) -> str:
    if schema is None or not schema.tables:
        return _empty_context_markdown()

    lines = [
        "# Database Context",
        "",
        "Edit this file to add business terms, synonyms, common filters, and fields that should not be exported.",
        "",
        "## Tables",
        "",
    ]

    for table in schema.tables:
        table_name = f"{table.schema_name}.{table.table_name}"
        lines.append(f"### {table_name}")
        lines.append("")
        lines.append(f"- Type: {table.table_type}")
        if table.primary_key:
            lines.append(f"- Primary key: {', '.join(table.primary_key)}")

        common_filters = _common_filter_columns(table)
        if common_filters:
            lines.append(f"- Common filters: {', '.join(common_filters)}")

        lines.append("- Columns:")
        for column in table.columns:
            details = [column.data_type]
            if not column.is_nullable:
                details.append("required")
            if column.sample_values:
                details.append("examples: " + ", ".join(column.sample_values))
            lines.append(f"  - {column.name}: {'; '.join(details)}")
        lines.append("")

    if schema.relationships:
        lines.extend(["## Relationship Hints", ""])
        for relationship in schema.relationships:
            from_name = f"{relationship.from_schema}.{relationship.from_table}"
            to_name = f"{relationship.to_schema}.{relationship.to_table}"
            lines.append(
                "- "
                f"{from_name} ({', '.join(relationship.from_columns)}) "
                f"connects to {to_name} ({', '.join(relationship.to_columns)})."
            )
        lines.append("")

    lines.extend(
        [
            "## Notes To Customize",
            "",
            "- Add business names for tables and fields users mention in normal language.",
            "- Add preferred joins when multiple paths are possible.",
            "- Add important filters such as active/current/deleted/test records.",
            "- Add fields that should not be exported to policy.json.",
        ]
    )
    return "\n".join(lines) + "\n"


def ensure_context_files(
    context_dir: Path = CONTEXT_DIR,
    schema: SchemaContext | None = None,
) -> ContextDocument:
    context_dir.mkdir(parents=True, exist_ok=True)
    context_path = context_dir / "context.md"
    schema_path = context_dir / "schema.json"
    policy_path = context_dir / "policy.json"

    if not context_path.exists():
        context_path.write_text(default_context_markdown(schema), encoding="utf-8")

    if not policy_path.exists():
        _write_json(policy_path, ContextPolicy().model_dump())

    if schema is not None:
        _write_json(schema_path, schema.model_dump())
        if _context_is_unmodified_default(context_path):
            context_path.write_text(default_context_markdown(schema), encoding="utf-8")
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


def _empty_context_markdown() -> str:
    return (
        "# Database Context\n\n"
        "Describe business terms, common joins, important filters, and fields that should not be exported.\n"
    )


def _context_is_unmodified_default(path: Path) -> bool:
    if not path.exists():
        return True
    return path.read_text(encoding="utf-8") == _empty_context_markdown()


def _common_filter_columns(table: SchemaTable) -> list[str]:
    names = []
    for column in table.columns:
        name = column.name.lower()
        if (
            name in {"status", "state", "type", "category", "region", "country"}
            or name.endswith(("_status", "_type", "_at", "_date"))
            or (column.sample_values and len(column.sample_values) <= MAX_SAMPLE_FILTER_COUNT)
        ):
            names.append(column.name)
    return names
