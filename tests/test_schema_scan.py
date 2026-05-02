from app.models import ContextPolicy
from app.schema_scan import build_schema_context


def test_build_schema_context_groups_columns_by_table() -> None:
    schema = build_schema_context(
        [
            {
                "table_schema": "public",
                "table_name": "customers",
                "table_type": "BASE TABLE",
                "column_name": "id",
                "data_type": "integer",
                "is_nullable": "NO",
                "ordinal_position": 1,
                "column_default": "nextval('customers_id_seq'::regclass)",
            },
            {
                "table_schema": "public",
                "table_name": "customers",
                "table_type": "BASE TABLE",
                "column_name": "email",
                "data_type": "text",
                "is_nullable": "YES",
                "ordinal_position": 2,
                "column_default": None,
            },
        ]
    )

    assert len(schema.tables) == 1
    table = schema.tables[0]
    assert table.schema_name == "public"
    assert table.table_name == "customers"
    assert [column.name for column in table.columns] == ["id", "email"]
    assert table.columns[0].is_nullable is False
    assert table.columns[1].is_nullable is True


def test_build_schema_context_includes_primary_keys_and_relationships() -> None:
    schema = build_schema_context(
        [
            {
                "table_schema": "public",
                "table_name": "customers",
                "table_type": "BASE TABLE",
                "column_name": "id",
                "data_type": "integer",
                "is_nullable": "NO",
                "ordinal_position": 1,
                "column_default": None,
            },
            {
                "table_schema": "public",
                "table_name": "orders",
                "table_type": "BASE TABLE",
                "column_name": "customer_id",
                "data_type": "integer",
                "is_nullable": "NO",
                "ordinal_position": 1,
                "column_default": None,
            },
        ],
        primary_key_rows=[
            {
                "table_schema": "public",
                "table_name": "customers",
                "column_name": "id",
                "ordinal_position": 1,
            }
        ],
        foreign_key_rows=[
            {
                "from_schema": "public",
                "from_table": "orders",
                "from_column": "customer_id",
                "to_schema": "public",
                "to_table": "customers",
                "to_column": "id",
                "ordinal_position": 1,
            }
        ],
    )

    customers = next(table for table in schema.tables if table.table_name == "customers")
    assert customers.primary_key == ["id"]
    assert len(schema.relationships) == 1
    relationship = schema.relationships[0]
    assert relationship.from_table == "orders"
    assert relationship.from_columns == ["customer_id"]
    assert relationship.to_table == "customers"
    assert relationship.to_columns == ["id"]


def test_build_schema_context_preserves_composite_relationship_column_order() -> None:
    schema = build_schema_context(
        [
            {
                "table_schema": "public",
                "table_name": "line_items",
                "table_type": "BASE TABLE",
                "column_name": "order_id",
                "data_type": "integer",
                "is_nullable": "NO",
                "ordinal_position": 1,
                "column_default": None,
            },
            {
                "table_schema": "public",
                "table_name": "line_items",
                "table_type": "BASE TABLE",
                "column_name": "order_region",
                "data_type": "text",
                "is_nullable": "NO",
                "ordinal_position": 2,
                "column_default": None,
            },
            {
                "table_schema": "public",
                "table_name": "orders",
                "table_type": "BASE TABLE",
                "column_name": "id",
                "data_type": "integer",
                "is_nullable": "NO",
                "ordinal_position": 1,
                "column_default": None,
            },
            {
                "table_schema": "public",
                "table_name": "orders",
                "table_type": "BASE TABLE",
                "column_name": "region",
                "data_type": "text",
                "is_nullable": "NO",
                "ordinal_position": 2,
                "column_default": None,
            },
        ],
        foreign_key_rows=[
            {
                "from_schema": "public",
                "from_table": "line_items",
                "from_column": "order_id",
                "to_schema": "public",
                "to_table": "orders",
                "to_column": "id",
                "ordinal_position": 1,
            },
            {
                "from_schema": "public",
                "from_table": "line_items",
                "from_column": "order_region",
                "to_schema": "public",
                "to_table": "orders",
                "to_column": "region",
                "ordinal_position": 2,
            },
        ],
    )

    relationship = schema.relationships[0]
    assert relationship.from_columns == ["order_id", "order_region"]
    assert relationship.to_columns == ["id", "region"]


def test_build_schema_context_respects_policy_blocks() -> None:
    schema = build_schema_context(
        [
            {
                "table_schema": "public",
                "table_name": "customers",
                "table_type": "BASE TABLE",
                "column_name": "email",
                "data_type": "text",
                "is_nullable": "NO",
                "ordinal_position": 1,
                "column_default": None,
            },
            {
                "table_schema": "public",
                "table_name": "customers",
                "table_type": "BASE TABLE",
                "column_name": "password_hash",
                "data_type": "text",
                "is_nullable": "NO",
                "ordinal_position": 2,
                "column_default": None,
            },
            {
                "table_schema": "private",
                "table_name": "audit_log",
                "table_type": "BASE TABLE",
                "column_name": "id",
                "data_type": "integer",
                "is_nullable": "NO",
                "ordinal_position": 1,
                "column_default": None,
            },
        ],
        policy=ContextPolicy(blocked_schemas=["private"], blocked_columns=["customers.password_hash"]),
    )

    assert [table.table_name for table in schema.tables] == ["customers"]
    assert [column.name for column in schema.tables[0].columns] == ["email"]
