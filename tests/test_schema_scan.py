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
