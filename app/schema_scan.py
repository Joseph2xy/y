from collections import defaultdict
from typing import Any

import psycopg
from psycopg import sql
from psycopg.rows import dict_row

from app.models import ContextPolicy, SchemaColumn, SchemaContext, SchemaRelationship, SchemaTable


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

PRIMARY_KEY_SQL = """
select
  tc.table_schema,
  tc.table_name,
  kcu.column_name,
  kcu.ordinal_position
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu
  on kcu.constraint_schema = tc.constraint_schema
 and kcu.constraint_name = tc.constraint_name
 and kcu.table_schema = tc.table_schema
 and kcu.table_name = tc.table_name
where tc.constraint_type = 'PRIMARY KEY'
  and tc.table_schema not in ('pg_catalog', 'information_schema')
order by tc.table_schema, tc.table_name, kcu.ordinal_position
"""

FOREIGN_KEY_SQL = """
select
  source_schema.nspname as from_schema,
  source_table.relname as from_table,
  source_column.attname as from_column,
  target_schema.nspname as to_schema,
  target_table.relname as to_table,
  target_column.attname as to_column,
  source_key.ordinality as ordinal_position
from pg_constraint constraint_info
join pg_class source_table
  on source_table.oid = constraint_info.conrelid
join pg_namespace source_schema
  on source_schema.oid = source_table.relnamespace
join pg_class target_table
  on target_table.oid = constraint_info.confrelid
join pg_namespace target_schema
  on target_schema.oid = target_table.relnamespace
join unnest(constraint_info.conkey) with ordinality as source_key(attnum, ordinality)
  on true
join unnest(constraint_info.confkey) with ordinality as target_key(attnum, ordinality)
  on target_key.ordinality = source_key.ordinality
join pg_attribute source_column
  on source_column.attrelid = source_table.oid
 and source_column.attnum = source_key.attnum
join pg_attribute target_column
  on target_column.attrelid = target_table.oid
 and target_column.attnum = target_key.attnum
where constraint_info.contype = 'f'
  and source_schema.nspname not in ('pg_catalog', 'information_schema')
order by source_schema.nspname, source_table.relname, constraint_info.conname, source_key.ordinality
"""


def scan_postgres_schema(database_url: str, policy: ContextPolicy | None = None) -> SchemaContext:
    with psycopg.connect(database_url, row_factory=dict_row) as conn:
        rows = conn.execute(SCHEMA_SCAN_SQL).fetchall()
        primary_key_rows = conn.execute(PRIMARY_KEY_SQL).fetchall()
        foreign_key_rows = conn.execute(FOREIGN_KEY_SQL).fetchall()

        schema = build_schema_context(rows, primary_key_rows, foreign_key_rows, policy=policy)
        _attach_sample_values(conn, schema, policy or ContextPolicy())
        return schema


def build_schema_context(
    rows: list[dict[str, Any]],
    primary_key_rows: list[dict[str, Any]] | None = None,
    foreign_key_rows: list[dict[str, Any]] | None = None,
    policy: ContextPolicy | None = None,
) -> SchemaContext:
    policy = policy or ContextPolicy()
    grouped: dict[tuple[str, str, str], list[SchemaColumn]] = defaultdict(list)
    blocked_schemas = {_normalize(value) for value in policy.blocked_schemas}
    blocked_tables = {_normalize(value) for value in policy.blocked_tables}
    blocked_columns = {_normalize(value) for value in policy.blocked_columns}

    for row in rows:
        schema_name = row["table_schema"]
        table_name = row["table_name"]
        column_name = row["column_name"]
        if _is_blocked_table(schema_name, table_name, blocked_schemas, blocked_tables):
            continue
        if _is_blocked_column(schema_name, table_name, column_name, blocked_columns):
            continue

        key = (row["table_schema"], row["table_name"], row["table_type"])
        grouped[key].append(
            SchemaColumn(
                name=column_name,
                data_type=row["data_type"],
                is_nullable=row["is_nullable"] == "YES",
                ordinal_position=row["ordinal_position"],
                default=row["column_default"],
            )
        )

    primary_keys = _primary_keys_by_table(primary_key_rows or [], blocked_columns)
    tables = [
        SchemaTable(
            schema_name=schema_name,
            table_name=table_name,
            table_type=table_type,
            columns=columns,
            primary_key=primary_keys.get((schema_name, table_name), []),
        )
        for (schema_name, table_name, table_type), columns in grouped.items()
    ]

    table_keys = {(table.schema_name, table.table_name) for table in tables}
    relationships = _relationships(foreign_key_rows or [], table_keys, blocked_columns)
    return SchemaContext(tables=tables, relationships=relationships)


def _primary_keys_by_table(
    rows: list[dict[str, Any]],
    blocked_columns: set[str],
) -> dict[tuple[str, str], list[str]]:
    primary_keys: dict[tuple[str, str], list[str]] = defaultdict(list)
    for row in rows:
        schema_name = row["table_schema"]
        table_name = row["table_name"]
        column_name = row["column_name"]
        if _is_blocked_column(schema_name, table_name, column_name, blocked_columns):
            continue
        primary_keys[(schema_name, table_name)].append(column_name)
    return primary_keys


def _relationships(
    rows: list[dict[str, Any]],
    table_keys: set[tuple[str, str]],
    blocked_columns: set[str],
) -> list[SchemaRelationship]:
    grouped: dict[tuple[str, str, str, str], dict[str, list[str]]] = defaultdict(
        lambda: {"from_columns": [], "to_columns": []}
    )
    for row in rows:
        from_key = (row["from_schema"], row["from_table"])
        to_key = (row["to_schema"], row["to_table"])
        if from_key not in table_keys or to_key not in table_keys:
            continue
        if _is_blocked_column(*from_key, row["from_column"], blocked_columns):
            continue
        if _is_blocked_column(*to_key, row["to_column"], blocked_columns):
            continue

        key = (*from_key, *to_key)
        grouped[key]["from_columns"].append(row["from_column"])
        grouped[key]["to_columns"].append(row["to_column"])

    return [
        SchemaRelationship(
            from_schema=from_schema,
            from_table=from_table,
            from_columns=columns["from_columns"],
            to_schema=to_schema,
            to_table=to_table,
            to_columns=columns["to_columns"],
        )
        for (from_schema, from_table, to_schema, to_table), columns in grouped.items()
    ]


def _attach_sample_values(
    conn: psycopg.Connection[Any],
    schema: SchemaContext,
    policy: ContextPolicy,
) -> None:
    blocked_columns = {_normalize(value) for value in policy.blocked_columns}
    for table in schema.tables:
        if table.table_type != "BASE TABLE":
            continue
        for column in table.columns:
            if not _should_sample_column(column):
                continue
            if _is_blocked_column(table.schema_name, table.table_name, column.name, blocked_columns):
                continue
            column.sample_values = _sample_values(conn, table.schema_name, table.table_name, column.name)


def _sample_values(conn: psycopg.Connection[Any], schema_name: str, table_name: str, column_name: str) -> list[str]:
    query = sql.SQL(
        """
        select {column}::text as value, count(*) as row_count
        from {schema}.{table}
        where {column} is not null
        group by {column}
        order by row_count desc, value asc
        limit 6
        """
    ).format(
        schema=sql.Identifier(schema_name),
        table=sql.Identifier(table_name),
        column=sql.Identifier(column_name),
    )
    try:
        rows = conn.execute(query).fetchall()
    except psycopg.Error:
        return []

    if len(rows) > 5:
        return []
    return [str(row["value"])[:80] for row in rows]


def _should_sample_column(column: SchemaColumn) -> bool:
    name = column.name.lower()
    if name.endswith("_id") or name == "id":
        return False
    if any(token in name for token in ("email", "password", "token", "secret", "note")):
        return False
    if name in {"status", "state", "type", "category", "region", "country"}:
        return True
    if name.endswith(("_status", "_type", "_category")):
        return True
    return column.data_type.lower() in {"boolean", "USER-DEFINED".lower()}


def _normalize(value: str | None) -> str:
    return (value or "").strip('"').lower()


def _is_blocked_table(
    schema_name: str,
    table_name: str,
    blocked_schemas: set[str],
    blocked_tables: set[str],
) -> bool:
    normalized_schema = _normalize(schema_name)
    normalized_table = _normalize(table_name)
    qualified = f"{normalized_schema}.{normalized_table}"
    return (
        normalized_schema in blocked_schemas
        or normalized_table in blocked_tables
        or qualified in blocked_tables
    )


def _is_blocked_column(
    schema_name: str,
    table_name: str,
    column_name: str,
    blocked_columns: set[str],
) -> bool:
    normalized_schema = _normalize(schema_name)
    normalized_table = _normalize(table_name)
    normalized_column = _normalize(column_name)
    return (
        normalized_column in blocked_columns
        or f"{normalized_table}.{normalized_column}" in blocked_columns
        or f"{normalized_schema}.{normalized_table}.{normalized_column}" in blocked_columns
    )
