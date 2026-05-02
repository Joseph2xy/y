from __future__ import annotations

import argparse
import os
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import TypeVar

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pydantic import BaseModel

from app.context_store import ensure_context_files
from app.models import (
    CSVColumnIntent,
    CSVIntent,
    CSVIntentProposal,
    ChatMessage,
    ClarificationResponse,
    ContextPolicy,
    ModelMessage,
    SQLProposal,
    SQLRepairProposal,
    SchemaColumn,
    SchemaContext,
    SchemaRelationship,
    SchemaTable,
)
from app.session_model_service import ask_clarification, prepare_sql, propose_csv_intent
from app.session_store import add_message, approve_intent, create_session


T = TypeVar("T", bound=BaseModel)


@dataclass(frozen=True)
class Scenario:
    name: str
    request: str
    expected_behavior: str
    expected_terms: tuple[str, ...] = ()
    expected_columns: tuple[str, ...] = ()


PLAN_SCENARIOS = [
    Scenario(
        name="active-customers",
        request="Export active customers with email, current balance, and account status.",
        expected_behavior="plan",
        expected_terms=("active", "customer", "balance", "status"),
        expected_columns=("email", "current_balance", "account_status"),
    ),
    Scenario(
        name="customers-created-last-month",
        request="Give me a CSV of customers created last month with their email and signup date.",
        expected_behavior="plan",
        expected_terms=("previous calendar month", "customer", "email", "signup"),
        expected_columns=("email", "signup_date"),
    ),
    Scenario(
        name="accounts-with-customer-email",
        request="Export accounts with customer email, account status, and current balance.",
        expected_behavior="plan",
        expected_terms=("account", "customer", "email", "balance"),
        expected_columns=("customer_email", "account_status", "current_balance"),
    ),
    Scenario(
        name="orders-by-region",
        request="Export orders with customer email, order date, total amount, and region.",
        expected_behavior="plan",
        expected_terms=("order", "customer", "region", "amount"),
        expected_columns=("customer_email", "order_date", "total_amount", "region"),
    ),
    Scenario(
        name="average-monthly-spend",
        request="Give me average monthly spend per customer for 2025.",
        expected_behavior="plan",
        expected_terms=("average monthly spend", "2025", "customer"),
        expected_columns=("customer_email", "average_monthly_spend"),
    ),
    Scenario(
        name="revenue-by-region-last-quarter",
        request="Export total revenue by region for last quarter.",
        expected_behavior="plan",
        expected_terms=("total revenue", "region", "previous calendar quarter"),
        expected_columns=("region", "total_revenue"),
    ),
]


CLARIFICATION_SCENARIOS = [
    Scenario(
        name="vague-useful-stuff",
        request="Send me the useful customer stuff.",
        expected_behavior="clarify",
        expected_terms=("which customer fields",),
    ),
    Scenario(
        name="everything",
        request="Give me everything in the database.",
        expected_behavior="clarify",
        expected_terms=("narrow",),
    ),
    Scenario(
        name="gibberish",
        request="asdkj qwepoi zzz export thing",
        expected_behavior="clarify",
        expected_terms=("not clear enough",),
    ),
]


REJECTION_SCENARIOS = [
    Scenario(
        name="blocked-sensitive-fields",
        request="Export all private customer notes and passwords.",
        expected_behavior="clarify",
        expected_terms=("cannot include", "blocked"),
    ),
]


class ScenarioProvider:
    def __init__(self, scenario: Scenario, *, invalid_first_sql: bool = False) -> None:
        self.scenario = scenario
        self.invalid_first_sql = invalid_first_sql
        self.sql_calls = 0

    def generate_json(self, *, messages: list[ModelMessage], response_model: type[T]) -> T:
        if response_model is CSVIntentProposal:
            return response_model.model_validate(_intent_response(self.scenario))
        if response_model is ClarificationResponse:
            return response_model.model_validate(_clarification_response(self.scenario))
        if response_model is SQLProposal:
            self.sql_calls += 1
            sql = _sql_for_intent(self.scenario)
            if self.invalid_first_sql:
                sql = sql.rsplit(" limit ", maxsplit=1)[0]
            return response_model.model_validate({"sql": sql, "notes": ["Eval scenario SQL."]})
        if response_model is SQLRepairProposal:
            return response_model.model_validate(
                {"sql": _sql_for_intent(self.scenario), "changes": ["Added the required literal limit."]}
            )
        raise RuntimeError(f"Unexpected response model: {response_model.__name__}")


def run_evals(*, include_repair: bool = True) -> list[str]:
    failures: list[str] = []
    with tempfile.TemporaryDirectory(prefix="csv-chat-eval-") as temp_dir:
        cwd = Path.cwd()
        os.chdir(temp_dir)
        try:
            ensure_context_files(schema=_eval_schema())
            _write_policy()

            for scenario in PLAN_SCENARIOS:
                try:
                    _run_plan_scenario(scenario)
                except AssertionError as exc:
                    failures.append(f"{scenario.name}: {exc}")

            for scenario in [*CLARIFICATION_SCENARIOS, *REJECTION_SCENARIOS]:
                try:
                    _run_clarification_scenario(scenario)
                except AssertionError as exc:
                    failures.append(f"{scenario.name}: {exc}")

            if include_repair:
                try:
                    _run_repair_scenario(PLAN_SCENARIOS[0])
                except AssertionError as exc:
                    failures.append(f"sql-repair: {exc}")
        finally:
            os.chdir(cwd)

    return failures


def _run_plan_scenario(scenario: Scenario) -> None:
    session = create_session()
    add_message(session.id, ChatMessage(role="user", content=scenario.request))
    proposal = propose_csv_intent(session_id=session.id, model_provider=ScenarioProvider(scenario))

    _assert_terms(
        scenario.name,
        " ".join(
            [
                proposal.intent.summary,
                proposal.intent.row_meaning,
                " ".join(proposal.intent.filters),
                " ".join(proposal.intent.derived_fields),
            ]
        ),
        scenario.expected_terms,
    )
    assert [column.name for column in proposal.intent.columns] == list(scenario.expected_columns)


def _run_clarification_scenario(scenario: Scenario) -> None:
    session = create_session()
    add_message(session.id, ChatMessage(role="user", content=scenario.request))
    response = ask_clarification(session_id=session.id, model_provider=ScenarioProvider(scenario))

    text = f"{response.message}\n{' '.join(response.questions)}"
    _assert_terms(scenario.name, text, scenario.expected_terms)


def _run_repair_scenario(scenario: Scenario) -> None:
    session = create_session()
    add_message(session.id, ChatMessage(role="user", content=scenario.request))
    proposal = propose_csv_intent(session_id=session.id, model_provider=ScenarioProvider(scenario))
    approve_intent(session.id, proposal.intent)

    response = prepare_sql(
        session_id=session.id,
        model_provider=ScenarioProvider(scenario, invalid_first_sql=True),
    )

    assert response.valid is True
    assert len(response.attempts) == 2
    assert response.attempts[0].errors == ["SQL must include a LIMIT."]
    assert response.attempts[1].valid is True


def _assert_terms(name: str, text: str, terms: tuple[str, ...]) -> None:
    normalized = text.lower()
    missing = [term for term in terms if term.lower() not in normalized]
    assert not missing, f"missing expected term(s) for {name}: {', '.join(missing)}"


def _intent_response(scenario: Scenario) -> dict[str, object]:
    if scenario.name == "active-customers":
        intent = _intent(
            "Active customer CSV with current balance and account status.",
            "One row per active customer.",
            scenario.expected_columns,
            ["Only active customers."],
        )
    elif scenario.name == "customers-created-last-month":
        intent = _intent(
            "Customers created during the previous calendar month with email and signup date.",
            "One row per customer created during the previous calendar month.",
            scenario.expected_columns,
            ["Use the previous calendar month.", "Include customer email and signup date."],
        )
    elif scenario.name == "accounts-with-customer-email":
        intent = _intent(
            "Accounts with customer email, current balance, and account status.",
            "One row per account joined to its customer.",
            scenario.expected_columns,
            [],
        )
    elif scenario.name == "orders-by-region":
        intent = _intent(
            "Orders with customer email, order date, total amount, and region.",
            "One row per order.",
            scenario.expected_columns,
            [],
        )
    elif scenario.name == "average-monthly-spend":
        intent = _intent(
            "Average monthly spend per customer for 2025.",
            "One row per customer with average monthly spend across 2025 orders.",
            scenario.expected_columns,
            ["Only orders from 2025."],
            derived_fields=["average monthly spend"],
        )
    elif scenario.name == "revenue-by-region-last-quarter":
        intent = _intent(
            "Total revenue by region for the previous calendar quarter.",
            "One row per region.",
            scenario.expected_columns,
            ["Use the previous calendar quarter."],
            derived_fields=["total revenue"],
        )
    else:
        raise RuntimeError(f"No intent fixture for {scenario.name}")
    return {"message": "Here is the CSV plan.", "intent": intent.model_dump()}


def _clarification_response(scenario: Scenario) -> dict[str, object]:
    if scenario.name == "blocked-sensitive-fields":
        message = "I cannot include blocked private notes or password fields. Which safe customer fields should the CSV include?"
        questions = ["Which non-sensitive customer fields should be included?"]
    elif scenario.name == "everything":
        message = "Please narrow the CSV to one kind of row and the fields you need."
        questions = ["What should one row represent?", "Which fields should be included?"]
    elif scenario.name == "gibberish":
        message = "That request is not clear enough to propose a CSV plan."
        questions = ["What CSV do you want to create?"]
    else:
        message = "Which customer fields should this CSV include?"
        questions = ["Which customer fields should this CSV include?"]
    return {"message": message, "questions": questions}


def _intent(
    summary: str,
    row_meaning: str,
    columns: tuple[str, ...],
    filters: list[str],
    *,
    derived_fields: list[str] | None = None,
) -> CSVIntent:
    return CSVIntent(
        summary=summary,
        row_meaning=row_meaning,
        columns=[
            CSVColumnIntent(name=column, description=column.replace("_", " "))
            for column in columns
        ],
        filters=filters,
        derived_fields=derived_fields or [],
        max_row_count=100,
    )


def _sql_for_intent(scenario: Scenario) -> str:
    selected = ", ".join(f"c.email as {column}" for column in scenario.expected_columns)
    return f"select {selected} from customers c limit 100"


def _eval_schema() -> SchemaContext:
    return SchemaContext(
        tables=[
            SchemaTable(
                schema_name="public",
                table_name="customers",
                table_type="BASE TABLE",
                primary_key=["id"],
                columns=[
                    _column("id", "integer"),
                    _column("account_id", "integer"),
                    _column("email", "text"),
                    _column("status", "text", samples=["active", "inactive"]),
                    _column("current_balance", "numeric"),
                    _column("signup_date", "date"),
                ],
            ),
            SchemaTable(
                schema_name="public",
                table_name="orders",
                table_type="BASE TABLE",
                primary_key=["id"],
                columns=[
                    _column("id", "integer"),
                    _column("customer_id", "integer"),
                    _column("order_date", "date"),
                    _column("total_amount", "numeric"),
                    _column("region", "text", samples=["north", "south"]),
                ],
            ),
            SchemaTable(
                schema_name="public",
                table_name="accounts",
                table_type="BASE TABLE",
                primary_key=["id"],
                columns=[
                    _column("id", "integer"),
                    _column("customer_id", "integer"),
                    _column("account_status", "text", samples=["active", "past_due"]),
                    _column("current_balance", "numeric"),
                ],
            ),
        ],
        relationships=[
            SchemaRelationship(
                from_schema="public",
                from_table="orders",
                from_columns=["customer_id"],
                to_schema="public",
                to_table="customers",
                to_columns=["id"],
            ),
            SchemaRelationship(
                from_schema="public",
                from_table="accounts",
                from_columns=["customer_id"],
                to_schema="public",
                to_table="customers",
                to_columns=["id"],
            ),
        ],
    )


def _column(name: str, data_type: str, *, samples: list[str] | None = None) -> SchemaColumn:
    return SchemaColumn(
        name=name,
        data_type=data_type,
        is_nullable=False,
        ordinal_position=1,
        sample_values=samples or [],
    )


def _write_policy() -> None:
    ensure_context_files()
    policy_path = Path("data/context/policy.json")
    policy_path.write_text(
        ContextPolicy(blocked_columns=["customers.password_hash", "customers.private_notes"]).model_dump_json(
            indent=2
        )
        + "\n",
        encoding="utf-8",
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run behavior-based CSV Chat model flow evals.")
    parser.add_argument("--skip-repair", action="store_true", help="Skip the SQL repair-loop scenario.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    failures = run_evals(include_repair=not args.skip_repair)
    if failures:
        print("Model eval failures:")
        for failure in failures:
            print(f"- {failure}")
        raise SystemExit(1)
    print("Model evals passed.")


if __name__ == "__main__":
    main()
