from __future__ import annotations

import argparse
import csv
import os
import sys
import tempfile
from pathlib import Path
from typing import Any, TypeVar

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import psycopg
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict, make_conninfo
from pydantic import BaseModel

import app.main as main
from app.main import app, get_model_provider
from app.models import ModelMessage
from tools.api_client import APIClient
from tools.mock_openai_server import INTENT_RESPONSE, SQL_RESPONSE


T = TypeVar("T", bound=BaseModel)


class DemoModelProvider:
    def generate_json(self, *, messages: list[ModelMessage], response_model: type[T]) -> T:
        if response_model.__name__ == "CSVIntentProposal":
            return response_model.model_validate(INTENT_RESPONSE)
        if response_model.__name__ == "SQLProposal":
            return response_model.model_validate(SQL_RESPONSE)
        raise RuntimeError(f"Unexpected response model: {response_model.__name__}")


def main_cli() -> None:
    args = parse_args()
    readonly_url = args.database_url or provision_demo_database(
        admin_url=args.admin_url,
        database=args.database,
        readonly_user=args.readonly_user,
        readonly_password=args.readonly_password,
    )

    with tempfile.TemporaryDirectory(prefix="csv-chat-smoke-") as temp_dir:
        cwd = Path.cwd()
        os.chdir(temp_dir)
        previous_database_url = os.environ.get("DATABASE_URL")
        os.environ["DATABASE_URL"] = readonly_url
        app.dependency_overrides[get_model_provider] = lambda: DemoModelProvider()
        try:
            run_api_flow()
        finally:
            app.dependency_overrides.clear()
            if previous_database_url is None:
                os.environ.pop("DATABASE_URL", None)
            else:
                os.environ["DATABASE_URL"] = previous_database_url
            os.chdir(cwd)

    print("Postgres smoke test passed.")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Provision a disposable Postgres demo DB and run the full CSV Chat API flow."
    )
    parser.add_argument(
        "--admin-url",
        default=os.environ.get("PG_ADMIN_DATABASE_URL", "postgresql://postgres@127.0.0.1:5432/postgres"),
        help="Postgres admin URL used to create and seed the disposable demo database.",
    )
    parser.add_argument(
        "--database-url",
        default=os.environ.get("CSV_CHAT_SMOKE_DATABASE_URL"),
        help="Use an already seeded demo database instead of provisioning one.",
    )
    parser.add_argument("--database", default="csv_chat_demo")
    parser.add_argument("--readonly-user", default="csv_chat_readonly")
    parser.add_argument("--readonly-password", default="readonly")
    return parser.parse_args()


def provision_demo_database(
    *,
    admin_url: str,
    database: str,
    readonly_user: str,
    readonly_password: str,
) -> str:
    with psycopg.connect(admin_url, autocommit=True) as conn:
        conn.execute(
            "select pg_terminate_backend(pid) from pg_stat_activity where datname = %s",
            (database,),
        )
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

    admin_demo_url = _url_for_database(admin_url, database)
    with psycopg.connect(admin_demo_url, autocommit=True) as conn:
        conn.execute(
            """
            create table accounts (
              id integer primary key,
              name text not null,
              plan text not null
            )
            """
        )
        conn.execute(
            """
            create table customers (
              id integer primary key,
              account_id integer not null references accounts(id),
              email text not null,
              full_name text not null,
              status text not null,
              created_at date not null
            )
            """
        )
        conn.execute(
            """
            insert into accounts (id, name, plan) values
              (1, 'Acme Co', 'Pro'),
              (2, 'Globex', 'Starter'),
              (3, 'Initech', 'Enterprise')
            """
        )
        conn.execute(
            """
            insert into customers (id, account_id, email, full_name, status, created_at) values
              (1, 1, 'ada@example.com', 'Ada Lovelace', 'active', date '2026-04-12'),
              (2, 1, 'grace@example.com', 'Grace Hopper', 'active', date '2026-03-09'),
              (3, 2, 'alan@example.com', 'Alan Turing', 'inactive', date '2026-02-01'),
              (4, 3, 'katherine@example.com', 'Katherine Johnson', 'active', date '2026-01-17'),
              (5, 2, 'margaret@example.com', 'Margaret Hamilton', 'active', date '2025-12-28')
            """
        )
        conn.execute(sql.SQL("grant usage on schema public to {}").format(sql.Identifier(readonly_user)))
        conn.execute(sql.SQL("grant select on all tables in schema public to {}").format(sql.Identifier(readonly_user)))

    return _url_for_database(admin_url, database, user=readonly_user, password=readonly_password)


def run_api_flow() -> None:
    client = APIClient(app)

    scan = _ok(client.post("/context/scan"))
    assert scan["table_count"] == 2
    assert scan["column_count"] == 9

    session = _ok(client.post("/sessions"))["session"]
    session_id = session["id"]

    _ok(
        client.post(
            f"/sessions/{session_id}/messages",
            json={"message": {"role": "user", "content": "Export active 2026 customers."}},
        )
    )

    proposal = _ok(client.post(f"/sessions/{session_id}/propose-intent"))
    assert proposal["intent"]["columns"][0]["name"] == "email"

    approved = _ok(
        client.post(
            f"/sessions/{session_id}/approve-intent",
            json={"intent": proposal["intent"]},
        )
    )
    assert approved["status"] == "generating_sql"

    prepared = _ok(client.post(f"/sessions/{session_id}/prepare-sql"))
    assert prepared["valid"] is True

    export = _ok(client.post(f"/sessions/{session_id}/export", json={"sql": prepared["sql"]}))
    assert export["row_count"] == 3
    assert export["columns"] == ["email", "full_name", "account_name", "plan", "created_at"]

    download = client.get(export["download_url"])
    assert download.status_code == 200, download.text
    rows = list(csv.DictReader(download.text.splitlines()))
    assert [row["email"] for row in rows] == [
        "ada@example.com",
        "grace@example.com",
        "katherine@example.com",
    ]


def _ok(response: Any) -> dict[str, Any]:
    assert response.status_code == 200, response.text
    return response.json()


def _url_for_database(
    url: str,
    database: str,
    *,
    user: str | None = None,
    password: str | None = None,
) -> str:
    values = conninfo_to_dict(url)
    values["dbname"] = database
    if user is not None:
        values["user"] = user
    if password is not None:
        values["password"] = password
        values.setdefault("host", "127.0.0.1")
    return make_conninfo(**values)


if __name__ == "__main__":
    main_cli()
