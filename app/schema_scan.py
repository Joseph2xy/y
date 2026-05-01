from collections import defaultdict
from typing import Any

import psycopg
from psycopg.rows import dict_row

from app.models import SchemaColumn, SchemaContext, SchemaTable


SCHEMA_SCAN_SQL = """
select
  t.table_schema,
  t.table_name,
  t.table_type,
  c.column_name,
  c.data_type,
  c.is_nullable,
  c.ordinal_position,
  c.column_default
from information_schema.tables t
join information_schema.columns c
  on c.table_schema = t.table_schema
 and c.table_name = t.table_name
where t.table_schema not in ('pg_catalog', 'information_schema')
  and t.table_type in ('BASE TABLE', 'VIEW')
order by t.table_schema, t.table_name, c.ordinal_position
"""


def scan_postgres_schema(database_url: str) -> SchemaContext:
    with psycopg.connect(database_url, row_factory=dict_row) as conn:
        rows = conn.execute(SCHEMA_SCAN_SQL).fetchall()

    return build_schema_context(rows)


def build_schema_context(rows: list[dict[str, Any]]) -> SchemaContext:
    grouped: dict[tuple[str, str, str], list[SchemaColumn]] = defaultdict(list)

    for row in rows:
        key = (row["table_schema"], row["table_name"], row["table_type"])
        grouped[key].append(
            SchemaColumn(
                name=row["column_name"],
                data_type=row["data_type"],
                is_nullable=row["is_nullable"] == "YES",
                ordinal_position=row["ordinal_position"],
                default=row["column_default"],
            )
        )

    tables = [
        SchemaTable(
            schema_name=schema_name,
            table_name=table_name,
            table_type=table_type,
            columns=columns,
        )
        for (schema_name, table_name, table_type), columns in grouped.items()
    ]

    return SchemaContext(tables=tables)
