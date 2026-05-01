from app.models import ContextPolicy
from app.sql_guard import SQLPolicy, sql_policy_from_context, validate_sql


def test_allows_simple_select_with_limit() -> None:
    result = validate_sql("select id, email from customers limit 100")

    assert result.valid
    assert result.errors == []


def test_rejects_missing_limit() -> None:
    result = validate_sql("select id, email from customers")

    assert not result.valid
    assert "SQL must include a LIMIT." in result.errors


def test_rejects_multiple_statements() -> None:
    result = validate_sql("select id from customers limit 10; select id from orders limit 10")

    assert not result.valid
    assert result.errors == ["SQL must contain exactly one statement."]


def test_rejects_non_select_statement() -> None:
    result = validate_sql("delete from customers where id = 1")

    assert not result.valid
    assert "SQL must be a SELECT statement." in result.errors
    assert "SQL contains a write, DDL, or command expression." in result.errors


def test_rejects_blocked_table_and_column() -> None:
    policy = SQLPolicy(blocked_tables={"private_notes"}, blocked_columns={"customers.password_hash"})

    result = validate_sql(
        "select customers.password_hash from customers join private_notes on private_notes.customer_id = customers.id limit 10",
        policy,
    )

    assert not result.valid
    assert "SQL references blocked table 'private_notes'." in result.errors
    assert "SQL references blocked column 'customers.password_hash'." in result.errors


def test_rejects_oversized_limit() -> None:
    result = validate_sql("select id from customers limit 100001", SQLPolicy(max_limit=100_000))

    assert not result.valid
    assert "SQL LIMIT must be between 1 and 100000." in result.errors


def test_converts_context_policy_to_sql_policy() -> None:
    context_policy = ContextPolicy(
        blocked_schemas=["private"],
        blocked_tables=["audit_log"],
        blocked_columns=["customers.password_hash"],
        blocked_functions=["pg_sleep"],
        max_row_count=250,
    )

    policy = sql_policy_from_context(context_policy)

    assert policy.blocked_schemas == {"private"}
    assert policy.blocked_tables == {"audit_log"}
    assert policy.blocked_columns == {"customers.password_hash"}
    assert policy.blocked_functions == {"pg_sleep"}
    assert policy.max_limit == 250


def test_rejects_schema_qualified_blocked_column() -> None:
    policy = SQLPolicy(blocked_columns={"public.customers.password_hash"})

    result = validate_sql("select customers.password_hash from public.customers limit 10", policy)

    assert not result.valid
    assert "SQL references blocked column 'customers.password_hash'." in result.errors


def test_rejects_blocked_schema() -> None:
    policy = SQLPolicy(blocked_schemas={"private"})

    result = validate_sql("select id from private.customers limit 10", policy)

    assert not result.valid
    assert "SQL references blocked schema 'private'." in result.errors


def test_rejects_blocked_function() -> None:
    result = validate_sql("select pg_sleep(1) limit 10")

    assert not result.valid
    assert "SQL references blocked function 'pg_sleep'." in result.errors


def test_validates_output_columns_against_approved_intent() -> None:
    result = validate_sql(
        "select email, status from customers limit 10",
        expected_columns=["email", "created_at"],
    )

    assert not result.valid
    assert result.errors == [
        "SQL output columns must exactly match the approved CSV columns: email, created_at."
    ]


def test_rejects_star_when_output_columns_are_required() -> None:
    result = validate_sql("select * from customers limit 10", expected_columns=["email"])

    assert not result.valid
    assert result.errors == ["SQL must explicitly select the approved CSV columns; SELECT * is not allowed."]


def test_allows_aliases_that_match_approved_intent_columns() -> None:
    result = validate_sql(
        "select lower(email) as email from customers limit 10",
        expected_columns=["email"],
    )

    assert result.valid
