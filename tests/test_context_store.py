from app.context_store import ensure_context_files, load_context, update_context
from app.models import ContextPolicy, ContextUpdate, SchemaColumn, SchemaContext, SchemaTable


def test_ensure_context_files_creates_defaults(tmp_path) -> None:
    document = ensure_context_files(tmp_path)

    assert document.context.startswith("# Database Context")
    assert document.schema_context.tables == []
    assert document.policy.max_row_count == 100_000
    assert (tmp_path / "context.md").exists()
    assert (tmp_path / "schema.json").exists()
    assert (tmp_path / "policy.json").exists()


def test_save_schema_preserves_existing_context_and_policy(tmp_path) -> None:
    ensure_context_files(tmp_path)
    update_context(
        ContextUpdate(
            context="# Custom Context\n",
            policy=ContextPolicy(blocked_columns=["customers.password_hash"], max_row_count=500),
        ),
        tmp_path,
    )

    schema = SchemaContext(
        tables=[
            SchemaTable(
                schema_name="public",
                table_name="customers",
                table_type="BASE TABLE",
                columns=[
                    SchemaColumn(
                        name="email",
                        data_type="text",
                        is_nullable=False,
                        ordinal_position=1,
                    )
                ],
            )
        ]
    )
    document = ensure_context_files(tmp_path, schema=schema)

    assert document.context == "# Custom Context\n"
    assert document.policy.blocked_columns == ["customers.password_hash"]
    assert document.policy.max_row_count == 500
    assert document.schema_context.tables[0].table_name == "customers"


def test_update_context_preserves_schema(tmp_path) -> None:
    schema = SchemaContext(
        tables=[
            SchemaTable(
                schema_name="public",
                table_name="orders",
                table_type="BASE TABLE",
                columns=[],
            )
        ]
    )
    ensure_context_files(tmp_path, schema=schema)

    document = update_context(
        ContextUpdate(context="# Updated\n", policy=ContextPolicy(blocked_tables=["audit_log"])),
        tmp_path,
    )

    assert document.context == "# Updated\n"
    assert document.policy.blocked_tables == ["audit_log"]
    assert load_context(tmp_path).schema_context.tables[0].table_name == "orders"
