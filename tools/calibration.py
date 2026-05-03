from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import psycopg
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict, make_conninfo

from tools.api_client import APIClient


@dataclass(frozen=True)
class Scenario:
    name: str
    request: str
    expected_column_groups: tuple[tuple[str, ...], ...]
    expect_clarification: bool = False


def run_scenario(client: APIClient, scenario: Scenario) -> None:
    session = ok(client.post("/sessions"))["session"]
    session_id = session["id"]
    ok(
        client.post(
            f"/sessions/{session_id}/messages",
            json={"message": {"role": "user", "content": scenario.request}},
        )
    )

    proposal = ok(client.post(f"/sessions/{session_id}/propose-intent"))
    intent = proposal.get("intent")
    questions = proposal.get("questions") or []

    print(f"\nScenario: {scenario.name}")
    print(f"Request: {scenario.request}")
    if intent is None:
        print("Result: clarification")
        print(f"Questions: {questions}")
        return

    columns = [column["name"] for column in intent["columns"]]
    print("Result: plan")
    print(f"Planned columns: {columns}")
    print(f"Filters: {intent.get('filters', [])}")

    if scenario.expect_clarification:
        print("Not approved: expected clarification, but model proposed a plan.")
        return

    missing = [group for group in scenario.expected_column_groups if not any(column in columns for column in group)]
    if missing:
        print(f"Not approved: expected column groups missing: {missing}")
        return

    ok(client.post(f"/sessions/{session_id}/approve-intent", json={"intent": intent}))
    prepared = ok(client.post(f"/sessions/{session_id}/prepare-sql"))
    print(f"SQL valid: {prepared['valid']}")
    print(f"Validation attempts: {len(prepared.get('attempts', []))}")
    if not prepared["valid"]:
        print(f"Validation errors: {prepared.get('errors', [])}")
        return

    export = ok(client.post(f"/sessions/{session_id}/export", json={"sql": prepared["sql"]}))
    print(f"Export: {export['row_count']} rows, columns {export['columns']}")

    final_session = ok(client.get(f"/sessions/{session_id}"))
    trace_steps = [trace["step"] for trace in final_session.get("debug_traces", [])]
    print(f"Trace steps: {trace_steps}")


def provision_database(
    *,
    admin_url: str,
    database: str,
    readonly_user: str,
    readonly_password: str,
    readonly_host: str,
    seed_schema: Callable[[psycopg.Connection[Any]], None],
) -> str:
    with psycopg.connect(admin_url, autocommit=True) as conn:
        conn.execute("select pg_terminate_backend(pid) from pg_stat_activity where datname = %s", (database,))
        conn.execute(sql.SQL("drop database if exists {}").format(sql.Identifier(database)))
        conn.execute(sql.SQL("drop role if exists {}").format(sql.Identifier(readonly_user)))
        conn.execute(
            sql.SQL("create role {} login password {}").format(
                sql.Identifier(readonly_user),
                sql.Literal(readonly_password),
            )
        )
        conn.execute(sql.SQL("create database {}").format(sql.Identifier(database)))
        conn.execute(
            sql.SQL("grant connect on database {} to {}").format(
                sql.Identifier(database),
                sql.Identifier(readonly_user),
            )
        )

    admin_database_url = url_for_database(admin_url, database)
    with psycopg.connect(admin_database_url, autocommit=True) as conn:
        seed_schema(conn)
        conn.execute(sql.SQL("grant usage on schema public to {}").format(sql.Identifier(readonly_user)))
        conn.execute(sql.SQL("grant select on all tables in schema public to {}").format(sql.Identifier(readonly_user)))

    return url_for_database(admin_url, database, user=readonly_user, password=readonly_password, host=readonly_host)


def ok(response: Any) -> dict[str, Any]:
    if response.status_code != 200:
        raise RuntimeError(f"{response.request.method} {response.request.url.path} failed: {response.status_code} {response.text}")
    return response.json()


def schema_has_column(scan: dict[str, Any], column_name: str) -> bool:
    for table in scan.get("schema", {}).get("tables", []):
        if any(column.get("name") == column_name for column in table.get("columns", [])):
            return True
    return False


def url_for_database(
    url: str,
    database: str,
    *,
    user: str | None = None,
    password: str | None = None,
    host: str | None = None,
) -> str:
    values = conninfo_to_dict(url)
    values["dbname"] = database
    if user is not None:
        values["user"] = user
    if password is not None:
        values["password"] = password
    if host is not None:
        values["host"] = host
    return make_conninfo(**values)
