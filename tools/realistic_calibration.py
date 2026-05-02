from __future__ import annotations

import argparse
import os
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import psycopg
from fastapi.testclient import TestClient
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict, make_conninfo

from app.context_store import ensure_context_files
from app.main import app
from app.models import ContextPolicy


@dataclass(frozen=True)
class Scenario:
    name: str
    request: str
    expected_column_groups: tuple[tuple[str, ...], ...]
    expect_clarification: bool = False


SCENARIOS = [
    Scenario(
        name="q1-shipped-orders",
        request=(
            "Create a CSV of shipped orders from January 1 2026 through March 31 2026. "
            "Include customer email, order date, sales channel, shipping region, and total order amount."
        ),
        expected_column_groups=(
            ("customer_email",),
            ("order_date", "ordered_at"),
            ("sales_channel",),
            ("shipping_region",),
            ("total_order_amount", "order_total"),
        ),
    ),
    Scenario(
        name="march-revenue-by-category",
        request=(
            "Export total revenue by product category for orders placed from March 1 2026 through March 31 2026."
        ),
        expected_column_groups=(("category", "product_category"), ("total_revenue", "revenue")),
    ),
    Scenario(
        name="open-high-priority-tickets",
        request=(
            "Give me open high priority support tickets with customer email, customer region, "
            "ticket id, priority, status, and created date."
        ),
        expected_column_groups=(
            ("customer_email",),
            ("region", "customer_region"),
            ("ticket_id",),
            ("priority",),
            ("status", "ticket_status"),
            ("created_date", "ticket_created_date", "created_at"),
        ),
    ),
    Scenario(
        name="west-accessory-buyers",
        request=(
            "Export active West region customers who bought Accessories in 2026. "
            "Include customer email, full name, latest order date, and total accessory quantity."
        ),
        expected_column_groups=(
            ("customer_email", "email"),
            ("full_name",),
            ("latest_order_date",),
            ("total_accessory_quantity", "accessory_quantity"),
        ),
    ),
    Scenario(
        name="vague-sales-stuff",
        request="Send me the useful sales stuff.",
        expected_column_groups=(),
        expect_clarification=True,
    ),
]


def main() -> None:
    args = parse_args()
    readonly_url = provision_database(
        admin_url=args.admin_url,
        database=args.database,
        readonly_user=args.readonly_user,
        readonly_password=args.readonly_password,
        readonly_host=args.readonly_host,
    )

    previous_database_url = os.environ.get("DATABASE_URL")
    os.environ["DATABASE_URL"] = readonly_url
    with tempfile.TemporaryDirectory(prefix="csv-chat-realistic-calibration-") as temp_dir:
        cwd = Path.cwd()
        os.chdir(temp_dir)
        try:
            ensure_context_files()
            policy = ContextPolicy(blocked_columns=["support_tickets.private_notes"])
            client = TestClient(app)
            context = _ok(client.put("/context", json={"context": _business_context(), "policy": policy.model_dump()}))
            scan = _ok(client.post("/context/scan"))
            print(f"Setup: scanned {scan['table_count']} tables and {scan['column_count']} columns.")
            if _schema_has_column(scan, "private_notes"):
                print("Warning: blocked private_notes appeared in context output.")

            for scenario in SCENARIOS:
                run_scenario(client, scenario)
        finally:
            os.chdir(cwd)
            if previous_database_url is None:
                os.environ.pop("DATABASE_URL", None)
            else:
                os.environ["DATABASE_URL"] = previous_database_url


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run real-provider calibration against a realistic Postgres schema.")
    parser.add_argument(
        "--admin-url",
        default=os.environ.get("PG_ADMIN_DATABASE_URL", "postgresql:///postgres"),
        help="Postgres admin URL used to create and seed the calibration database.",
    )
    parser.add_argument("--database", default="csv_chat_retail_calibration")
    parser.add_argument("--readonly-user", default="csv_chat_retail_readonly")
    parser.add_argument("--readonly-password", default="readonly")
    parser.add_argument("--readonly-host", default="127.0.0.1")
    return parser.parse_args()


def run_scenario(client: TestClient, scenario: Scenario) -> None:
    session = _ok(client.post("/sessions"))["session"]
    session_id = session["id"]
    _ok(
        client.post(
            f"/sessions/{session_id}/messages",
            json={"message": {"role": "user", "content": scenario.request}},
        )
    )

    proposal = _ok(client.post(f"/sessions/{session_id}/propose-intent"))
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

    _ok(client.post(f"/sessions/{session_id}/approve-intent", json={"intent": intent}))
    prepared = _ok(client.post(f"/sessions/{session_id}/prepare-sql"))
    print(f"SQL valid: {prepared['valid']}")
    print(f"Validation attempts: {len(prepared.get('attempts', []))}")
    if not prepared["valid"]:
        print(f"Validation errors: {prepared.get('errors', [])}")
        return

    export = _ok(client.post(f"/sessions/{session_id}/export", json={"sql": prepared["sql"]}))
    print(f"Export: {export['row_count']} rows, columns {export['columns']}")

    final_session = _ok(client.get(f"/sessions/{session_id}"))
    trace_steps = [trace["step"] for trace in final_session.get("debug_traces", [])]
    print(f"Trace steps: {trace_steps}")


def provision_database(
    *,
    admin_url: str,
    database: str,
    readonly_user: str,
    readonly_password: str,
    readonly_host: str,
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

    admin_database_url = _url_for_database(admin_url, database)
    with psycopg.connect(admin_database_url, autocommit=True) as conn:
        seed_schema(conn)
        conn.execute(sql.SQL("grant usage on schema public to {}").format(sql.Identifier(readonly_user)))
        conn.execute(sql.SQL("grant select on all tables in schema public to {}").format(sql.Identifier(readonly_user)))

    return _url_for_database(admin_url, database, user=readonly_user, password=readonly_password, host=readonly_host)


def seed_schema(conn: psycopg.Connection[Any]) -> None:
    conn.execute(
        """
        create table customers (
          id integer primary key,
          email text not null,
          full_name text not null,
          status text not null,
          region text not null,
          created_at date not null
        )
        """
    )
    conn.execute(
        """
        create table products (
          id integer primary key,
          sku text not null,
          name text not null,
          category text not null,
          active boolean not null
        )
        """
    )
    conn.execute(
        """
        create table orders (
          id integer primary key,
          customer_id integer not null references customers(id),
          order_number text not null,
          status text not null,
          ordered_at date not null,
          sales_channel text not null,
          shipping_region text not null
        )
        """
    )
    conn.execute(
        """
        create table order_items (
          id integer primary key,
          order_id integer not null references orders(id),
          product_id integer not null references products(id),
          quantity integer not null,
          unit_price numeric(10, 2) not null
        )
        """
    )
    conn.execute(
        """
        create table support_tickets (
          id integer primary key,
          customer_id integer not null references customers(id),
          priority text not null,
          status text not null,
          created_at date not null,
          resolved_at date,
          private_notes text
        )
        """
    )
    conn.execute(
        """
        insert into customers (id, email, full_name, status, region, created_at) values
          (1, 'ava@example.com', 'Ava Patel', 'active', 'West', date '2025-11-20'),
          (2, 'ben@example.com', 'Ben Ortiz', 'active', 'East', date '2025-12-02'),
          (3, 'chen@example.com', 'Chen Wu', 'inactive', 'West', date '2024-08-14'),
          (4, 'dina@example.com', 'Dina Shah', 'active', 'Central', date '2026-01-09'),
          (5, 'eli@example.com', 'Eli Moore', 'active', 'West', date '2026-02-11')
        """
    )
    conn.execute(
        """
        insert into products (id, sku, name, category, active) values
          (1, 'ACC-CASE', 'Travel Case', 'Accessories', true),
          (2, 'ACC-CABLE', 'USB Cable', 'Accessories', true),
          (3, 'HW-TAB', 'Field Tablet', 'Hardware', true),
          (4, 'SVC-SETUP', 'Setup Service', 'Services', true)
        """
    )
    conn.execute(
        """
        insert into orders (id, customer_id, order_number, status, ordered_at, sales_channel, shipping_region) values
          (1, 1, 'R1001', 'shipped', date '2026-01-15', 'online', 'West'),
          (2, 2, 'R1002', 'shipped', date '2026-03-03', 'partner', 'East'),
          (3, 1, 'R1003', 'cancelled', date '2026-03-12', 'online', 'West'),
          (4, 5, 'R1004', 'shipped', date '2026-04-02', 'online', 'West'),
          (5, 4, 'R1005', 'paid', date '2026-03-22', 'sales', 'Central'),
          (6, 5, 'R1006', 'shipped', date '2026-02-18', 'online', 'West')
        """
    )
    conn.execute(
        """
        insert into order_items (id, order_id, product_id, quantity, unit_price) values
          (1, 1, 1, 2, 19.50),
          (2, 1, 3, 1, 420.00),
          (3, 2, 4, 1, 199.00),
          (4, 2, 2, 4, 9.00),
          (5, 3, 1, 1, 19.50),
          (6, 4, 2, 3, 9.00),
          (7, 5, 3, 2, 410.00),
          (8, 6, 1, 1, 19.50),
          (9, 6, 2, 2, 9.00)
        """
    )
    conn.execute(
        """
        insert into support_tickets (id, customer_id, priority, status, created_at, resolved_at, private_notes) values
          (1, 1, 'high', 'open', date '2026-03-28', null, 'Do not export'),
          (2, 2, 'low', 'open', date '2026-03-20', null, 'Do not export'),
          (3, 5, 'high', 'open', date '2026-04-05', null, 'Do not export'),
          (4, 4, 'high', 'closed', date '2026-02-10', date '2026-02-11', 'Do not export')
        """
    )


def _business_context() -> str:
    return """# Database Context

Retail CSV calibration schema.

## Business Notes

- Customers are current buyers. Active customers have customers.status = active.
- Orders are customer purchases. Revenue is the sum of order_items.quantity * order_items.unit_price.
- Shipped orders have orders.status = shipped.
- Open support tickets have support_tickets.status = open.
- High priority support tickets have support_tickets.priority = high.
- Product category comes from products.category.
- Accessory purchases use products.category = Accessories.
- Customer region comes from customers.region. Shipping region comes from orders.shipping_region.
- Do not export private support ticket notes.
"""


def _ok(response: Any) -> dict[str, Any]:
    if response.status_code != 200:
        raise RuntimeError(f"{response.request.method} {response.request.url.path} failed: {response.status_code} {response.text}")
    return response.json()


def _schema_has_column(scan: dict[str, Any], column_name: str) -> bool:
    for table in scan.get("schema", {}).get("tables", []):
        if any(column.get("name") == column_name for column in table.get("columns", [])):
            return True
    return False


def _url_for_database(
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


if __name__ == "__main__":
    main()
