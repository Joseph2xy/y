from collections.abc import Iterable
from typing import Any

import psycopg
from psycopg.rows import dict_row


def run_read_only_query(
    database_url: str,
    sql: str,
    *,
    statement_timeout_ms: int = 30_000,
    lock_timeout_ms: int = 5_000,
) -> Iterable[dict[str, Any]]:
    with psycopg.connect(database_url, row_factory=dict_row) as conn:
        with conn.transaction():
            conn.execute("SET TRANSACTION READ ONLY")
            conn.execute("SET LOCAL statement_timeout = %s", (statement_timeout_ms,))
            conn.execute("SET LOCAL lock_timeout = %s", (lock_timeout_ms,))
            with conn.execute(sql) as cursor:
                yield from cursor


def read_only_query_runner(
    database_url: str,
    *,
    statement_timeout_ms: int,
    lock_timeout_ms: int,
):
    def run(sql: str) -> Iterable[dict[str, Any]]:
        return run_read_only_query(
            database_url,
            sql,
            statement_timeout_ms=statement_timeout_ms,
            lock_timeout_ms=lock_timeout_ms,
        )

    return run
