from collections.abc import Callable, Iterable
from dataclasses import replace
from pathlib import Path
from typing import Any
from uuid import uuid4

from app.csv_writer import count_csv_bytes, write_csv
from app.models import CSVIntent, ContextPolicy, ExportCreateResponse, SchemaContext
from app.sql_guard import sql_policy_from_context, validate_sql


EXPORT_DIR = Path("data/exports")


class ExportError(RuntimeError):
    pass


QueryRunner = Callable[[str], Iterable[dict[str, Any]]]


def create_export(
    *,
    intent: CSVIntent,
    sql: str,
    policy: ContextPolicy,
    schema: SchemaContext | None = None,
    query_runner: QueryRunner,
    export_dir: Path = EXPORT_DIR,
) -> ExportCreateResponse:
    expected_columns = [column.name for column in intent.columns]
    sql_policy = sql_policy_from_context(policy, schema)
    sql_policy = replace(sql_policy, max_limit=min(sql_policy.max_limit, intent.max_row_count))
    sql_result = validate_sql(sql, sql_policy, expected_columns=expected_columns, intent=intent)
    if not sql_result.valid:
        raise ExportError("SQL validation failed: " + "; ".join(sql_result.errors))

    max_rows = min(intent.max_row_count, policy.max_row_count)
    export_id = uuid4().hex
    export_path = export_dir / f"{export_id}.csv"

    try:
        rows = _limited_rows(query_runner(sql), expected_columns, max_rows)
        row_count = write_csv(export_path, expected_columns, rows)
        byte_count = count_csv_bytes(export_path)

        if byte_count > policy.max_export_bytes:
            export_path.unlink(missing_ok=True)
            raise ExportError(f"CSV exceeds the {policy.max_export_bytes} byte export limit.")
    except Exception:
        export_path.unlink(missing_ok=True)
        raise

    return ExportCreateResponse(
        export_id=export_id,
        row_count=row_count,
        byte_count=byte_count,
        columns=expected_columns,
        download_url=f"/exports/{export_id}/download",
    )


def export_path(export_id: str, export_dir: Path = EXPORT_DIR) -> Path:
    if not export_id or any(character in export_id for character in ("/", "\\", ".")):
        raise ExportError("Invalid export id.")
    return export_dir / f"{export_id}.csv"


def _limited_rows(
    rows: Iterable[dict[str, Any]],
    expected_columns: list[str],
    max_rows: int,
) -> Iterable[dict[str, Any]]:
    for index, row in enumerate(rows, start=1):
        if index > max_rows:
            raise ExportError(f"Query returned more than the {max_rows} row limit.")

        missing = [column for column in expected_columns if column not in row]
        if missing:
            raise ExportError("Query result is missing expected CSV columns: " + ", ".join(missing))

        yield row
