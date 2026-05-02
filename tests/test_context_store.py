from app.context_store import ensure_context_files, load_context, update_context
from app.models import (
    ContextPolicy,
    ContextUpdate,
    SchemaColumn,
    SchemaContext,
    SchemaRelationship,
    SchemaTable,
)


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


def test_save_schema_generates_rich_context_when_default_is_unmodified(tmp_path) -> None:
    ensure_context_files(tmp_path)

    schema = SchemaContext(
        tables=[
            SchemaTable(
                schema_name="public",
                table_name="customers",
                table_type="BASE TABLE",
                primary_key=["id"],
                columns=[
                    SchemaColumn(
                        name="id",
                        data_type="integer",
                        is_nullable=False,
                        ordinal_position=1,
                    ),
                    SchemaColumn(
                        name="status",
                        data_type="text",
                        is_nullable=False,
                        ordinal_position=2,
                        sample_values=["active", "inactive"],
                    ),
                    SchemaColumn(
                        name="created_at",
                        data_type="timestamp with time zone",
                        is_nullable=False,
                        ordinal_position=3,
                    ),
                ],
            ),
            SchemaTable(
                schema_name="public",
                table_name="orders",
                table_type="BASE TABLE",
                columns=[
                    SchemaColumn(
                        name="customer_id",
                        data_type="integer",
                        is_nullable=False,
                        ordinal_position=1,
                    )
                ],
            ),
        ],
        relationships=[
            SchemaRelationship(
                from_schema="public",
                from_table="orders",
                from_columns=["customer_id"],
                to_schema="public",
                to_table="customers",
                to_columns=["id"],
            )
        ],
    )

    document = ensure_context_files(tmp_path, schema=schema)

    assert "### public.customers" in document.context
    assert "Primary key: id" in document.context
    assert "Common filters: status, created_at" in document.context
    assert "status: text; required; examples: active, inactive" in document.context
    assert "public.orders (customer_id) connects to public.customers (id)" in document.context


def test_generated_context_does_not_treat_many_sample_values_as_common_filter(tmp_path) -> None:
    schema = SchemaContext(
        tables=[
            SchemaTable(
                schema_name="public",
                table_name="events",
                table_type="BASE TABLE",
                columns=[
                    SchemaColumn(
                        name="description",
                        data_type="text",
                        is_nullable=False,
                        ordinal_position=1,
                        sample_values=["one", "two", "three", "four", "five", "six"],
                    )
                ],
            )
        ]
    )

    document = ensure_context_files(tmp_path, schema=schema)

    assert "Common filters: description" not in document.context


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
