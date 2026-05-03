from __future__ import annotations

import argparse
import os
import sys
import tempfile
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import psycopg

from app.context_store import ensure_context_files
from app.main import app
from app.models import ContextPolicy
from tools.api_client import APIClient
from tools.calibration import Scenario, ok, provision_database, run_scenario, schema_has_column


SCENARIOS = [
    Scenario(
        name="unpaid-invoices-by-customer",
        request=(
            "Create a CSV of unpaid invoices with customer name, customer email, invoice number, "
            "invoice date, due date, invoice total, amount paid, and outstanding balance."
        ),
        expected_column_groups=(
            ("customer_name", "name"),
            ("customer_email", "email"),
            ("invoice_number",),
            ("invoice_date", "issued_date"),
            ("due_date",),
            ("invoice_total", "total_amount"),
            ("amount_paid", "paid_amount"),
            ("outstanding_balance", "balance_due"),
        ),
    ),
    Scenario(
        name="monthly-revenue-2026",
        request="Export recognized invoice revenue by month for 2026.",
        expected_column_groups=(("month", "invoice_month"), ("recognized_revenue", "total_revenue", "revenue")),
    ),
    Scenario(
        name="payments-in-march",
        request=(
            "Give me payments received from March 1 2026 through March 31 2026 with payment date, "
            "customer name, invoice number, payment method, and amount."
        ),
        expected_column_groups=(
            ("payment_date", "paid_at"),
            ("customer_name", "name"),
            ("invoice_number",),
            ("payment_method", "method"),
            ("amount", "payment_amount"),
        ),
    ),
    Scenario(
        name="overdue-invoices",
        request=(
            "Export overdue invoices as of April 15 2026 with customer name, billing email, invoice number, "
            "due date, days overdue, and outstanding balance."
        ),
        expected_column_groups=(
            ("customer_name", "name"),
            ("billing_email", "customer_email", "email"),
            ("invoice_number",),
            ("due_date",),
            ("days_overdue",),
            ("outstanding_balance", "balance_due"),
        ),
    ),
    Scenario(
        name="vague-finance-stuff",
        request="Send me the useful finance stuff.",
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
        seed_schema=seed_schema,
    )

    previous_database_url = os.environ.get("DATABASE_URL")
    os.environ["DATABASE_URL"] = readonly_url
    with tempfile.TemporaryDirectory(prefix="csv-chat-finance-calibration-") as temp_dir:
        cwd = Path.cwd()
        os.chdir(temp_dir)
        try:
            ensure_context_files()
            policy = ContextPolicy(blocked_columns=["customers.tax_id"])
            client = APIClient(app)
            ok(client.put("/context", json={"context": _business_context(), "policy": policy.model_dump()}))
            scan = ok(client.post("/context/scan"))
            print(f"Setup: scanned {scan['table_count']} tables and {scan['column_count']} columns.")
            if schema_has_column(scan, "tax_id"):
                print("Warning: blocked tax_id appeared in context output.")

            for scenario in SCENARIOS:
                try:
                    run_scenario(client, scenario)
                except Exception as exc:
                    print(f"\nScenario: {scenario.name}")
                    print(f"Request: {scenario.request}")
                    print(f"Result: error")
                    print(f"Error: {exc}")
        finally:
            os.chdir(cwd)
            if previous_database_url is None:
                os.environ.pop("DATABASE_URL", None)
            else:
                os.environ["DATABASE_URL"] = previous_database_url


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run real-provider calibration against a finance/invoicing schema.")
    parser.add_argument(
        "--admin-url",
        default=os.environ.get("PG_ADMIN_DATABASE_URL", "postgresql:///postgres"),
        help="Postgres admin URL used to create and seed the calibration database.",
    )
    parser.add_argument("--database", default="csv_chat_finance_calibration")
    parser.add_argument("--readonly-user", default="csv_chat_finance_readonly")
    parser.add_argument("--readonly-password", default="readonly")
    parser.add_argument("--readonly-host", default="127.0.0.1")
    return parser.parse_args()


def seed_schema(conn: psycopg.Connection[Any]) -> None:
    conn.execute(
        """
        create table customers (
          id integer primary key,
          customer_name text not null,
          billing_email text not null,
          status text not null,
          segment text not null,
          tax_id text
        )
        """
    )
    conn.execute(
        """
        create table invoices (
          id integer primary key,
          customer_id integer not null references customers(id),
          invoice_number text not null,
          status text not null,
          issued_date date not null,
          due_date date not null,
          currency text not null
        )
        """
    )
    conn.execute(
        """
        create table invoice_lines (
          id integer primary key,
          invoice_id integer not null references invoices(id),
          description text not null,
          revenue_type text not null,
          quantity integer not null,
          unit_price numeric(10, 2) not null
        )
        """
    )
    conn.execute(
        """
        create table payments (
          id integer primary key,
          invoice_id integer not null references invoices(id),
          paid_at date not null,
          payment_method text not null,
          amount numeric(10, 2) not null
        )
        """
    )
    conn.execute(
        """
        create table refunds (
          id integer primary key,
          payment_id integer not null references payments(id),
          refunded_at date not null,
          amount numeric(10, 2) not null,
          reason text not null
        )
        """
    )
    conn.execute(
        """
        insert into customers (id, customer_name, billing_email, status, segment, tax_id) values
          (1, 'Northwind Labs', 'billing@northwind.example', 'active', 'enterprise', 'TIN-001'),
          (2, 'Bluebird Studio', 'ap@bluebird.example', 'active', 'startup', 'TIN-002'),
          (3, 'Ridge Health', 'finance@ridge.example', 'active', 'midmarket', 'TIN-003'),
          (4, 'Old Town Books', 'owner@oldtown.example', 'inactive', 'small_business', 'TIN-004')
        """
    )
    conn.execute(
        """
        insert into invoices (id, customer_id, invoice_number, status, issued_date, due_date, currency) values
          (1, 1, 'INV-2026-001', 'paid', date '2026-01-10', date '2026-02-09', 'USD'),
          (2, 1, 'INV-2026-002', 'unpaid', date '2026-03-05', date '2026-04-04', 'USD'),
          (3, 2, 'INV-2026-003', 'partial', date '2026-03-12', date '2026-04-11', 'USD'),
          (4, 3, 'INV-2026-004', 'unpaid', date '2026-02-15', date '2026-03-17', 'USD'),
          (5, 4, 'INV-2025-099', 'paid', date '2025-12-20', date '2026-01-19', 'USD')
        """
    )
    conn.execute(
        """
        insert into invoice_lines (id, invoice_id, description, revenue_type, quantity, unit_price) values
          (1, 1, 'Platform subscription', 'subscription', 1, 1200.00),
          (2, 1, 'Implementation support', 'services', 4, 150.00),
          (3, 2, 'Platform subscription', 'subscription', 1, 1400.00),
          (4, 2, 'Extra seats', 'subscription', 10, 25.00),
          (5, 3, 'Design package', 'services', 1, 800.00),
          (6, 3, 'Monthly hosting', 'subscription', 1, 120.00),
          (7, 4, 'Compliance review', 'services', 6, 200.00),
          (8, 5, 'Legacy support', 'services', 2, 175.00)
        """
    )
    conn.execute(
        """
        insert into payments (id, invoice_id, paid_at, payment_method, amount) values
          (1, 1, date '2026-01-25', 'card', 1800.00),
          (2, 3, date '2026-03-20', 'ach', 500.00),
          (3, 5, date '2026-01-05', 'card', 350.00)
        """
    )
    conn.execute(
        """
        insert into refunds (id, payment_id, refunded_at, amount, reason) values
          (1, 3, date '2026-01-07', 50.00, 'Billing adjustment')
        """
    )


def _business_context() -> str:
    return """# Database Context

Finance and invoicing calibration schema.

## Business Notes

- Customers are billed organizations. Billing email is customers.billing_email.
- Invoices are customer bills. Unpaid invoices have invoices.status = unpaid. Partially paid invoices have invoices.status = partial.
- Invoice total is the sum of invoice_lines.quantity * invoice_lines.unit_price for an invoice.
- Amount paid is the sum of payments.amount for an invoice, minus related refunds when refunds are relevant.
- Outstanding balance is invoice total minus amount paid.
- Recognized invoice revenue is invoice line total by invoice issued date.
- Payments received are rows from payments, joined through invoices to customers.
- Overdue invoices are unpaid or partial invoices with invoices.due_date before the as-of date and outstanding balance greater than zero.
- Do not export customer tax IDs.
"""


if __name__ == "__main__":
    main()
