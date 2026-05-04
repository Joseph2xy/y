from app.models import CSVColumnIntent, CSVIntent, ContextPolicy, SchemaContext, SchemaTable
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


def test_rejects_select_into() -> None:
    result = validate_sql("select id into temp exported_customers from customers limit 10")

    assert not result.valid
    assert "SQL contains a write, DDL, or command expression." in result.errors


def test_rejects_unparseable_sql() -> None:
    result = validate_sql("select from")

    assert not result.valid
    assert result.errors[0].startswith("SQL could not be parsed:")


def test_rejects_non_integer_limit_literal() -> None:
    for sql in ("select id from customers limit '10'", "select id from customers limit $1"):
        result = validate_sql(sql)

        assert not result.valid
        assert "SQL LIMIT must be an integer literal." in result.errors


def test_rejects_locking_select_clause() -> None:
    for clause in ("for update", "for share"):
        result = validate_sql(f"select id from customers limit 10 {clause}")

        assert not result.valid
        assert "SQL must not include row-locking clauses." in result.errors


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
        blocked_functions=["custom_blocked_function"],
        max_row_count=250,
    )

    policy = sql_policy_from_context(context_policy)

    assert policy.blocked_schemas == {"private"}
    assert policy.blocked_tables == {"audit_log"}
    assert policy.blocked_columns == {"customers.password_hash"}
    assert policy.blocked_functions == {"custom_blocked_function", "pg_sleep", "set_config"}
    assert policy.max_limit == 250


def test_converts_schema_context_to_known_tables() -> None:
    policy = sql_policy_from_context(
        ContextPolicy(),
        SchemaContext(
            tables=[
                SchemaTable(
                    schema_name="app",
                    table_name="people",
                    table_type="BASE TABLE",
                )
            ]
        ),
    )

    assert policy.known_tables == {"people", "app.people"}


def test_rejects_unknown_table_when_schema_context_is_available() -> None:
    policy = sql_policy_from_context(
        ContextPolicy(),
        SchemaContext(
            tables=[
                SchemaTable(
                    schema_name="app",
                    table_name="people",
                    table_type="BASE TABLE",
                )
            ]
        ),
    )

    result = validate_sql("select email from public.customers limit 10", policy)

    assert not result.valid
    assert "SQL references unknown table 'public.customers'." in result.errors


def test_rejects_wrong_schema_even_when_table_name_exists() -> None:
    policy = sql_policy_from_context(
        ContextPolicy(),
        SchemaContext(
            tables=[
                SchemaTable(
                    schema_name="app",
                    table_name="customers",
                    table_type="BASE TABLE",
                )
            ]
        ),
    )

    result = validate_sql("select email from public.customers limit 10", policy)

    assert not result.valid
    assert "SQL references unknown table 'public.customers'." in result.errors


def test_allows_known_table_when_schema_context_is_available() -> None:
    policy = sql_policy_from_context(
        ContextPolicy(),
        SchemaContext(
            tables=[
                SchemaTable(
                    schema_name="app",
                    table_name="people",
                    table_type="BASE TABLE",
                )
            ]
        ),
    )

    result = validate_sql("select email from app.people limit 10", policy)

    assert result.valid


def test_allows_cte_name_when_schema_context_is_available() -> None:
    policy = sql_policy_from_context(
        ContextPolicy(),
        SchemaContext(
            tables=[
                SchemaTable(
                    schema_name="app",
                    table_name="people",
                    table_type="BASE TABLE",
                )
            ]
        ),
    )

    result = validate_sql("with customers as (select email from app.people limit 10) select email from customers limit 10", policy)

    assert result.valid


def test_context_policy_cannot_unblock_default_blocked_functions() -> None:
    policy = sql_policy_from_context(ContextPolicy(blocked_functions=[]))

    result = validate_sql("select set_config('statement_timeout', '0', false) limit 1", policy)

    assert not result.valid
    assert "SQL references blocked function 'set_config'." in result.errors


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


def test_rejects_session_altering_function_by_default() -> None:
    result = validate_sql("select set_config('statement_timeout', '0', false) limit 1")

    assert not result.valid
    assert "SQL references blocked function 'set_config'." in result.errors


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


def test_validates_intent_source_hints_against_selected_columns() -> None:
    intent = CSVIntent(
        summary="Customer emails",
        row_meaning="One row per customer",
        columns=[
            CSVColumnIntent(
                name="email",
                description="Customer email",
                source_hint="customers.email",
            )
        ],
    )

    result = validate_sql(
        "select status as email from customers limit 10",
        expected_columns=["email"],
        intent=intent,
    )

    assert not result.valid
    assert result.errors == ["SQL must select from approved source hint 'customers.email'."]


def test_allows_intent_source_hints_selected_with_matching_alias() -> None:
    intent = CSVIntent(
        summary="Customer emails",
        row_meaning="One row per customer",
        columns=[
            CSVColumnIntent(
                name="email",
                description="Customer email",
                source_hint="customers.email",
            )
        ],
    )

    result = validate_sql(
        "select customers.email as email from customers limit 10",
        expected_columns=["email"],
        intent=intent,
    )

    assert result.valid


def test_allows_intent_source_hints_selected_through_table_aliases_and_aggregates() -> None:
    intent = CSVIntent(
        summary="Revenue by month and region",
        row_meaning="One row per month and region",
        columns=[
            CSVColumnIntent(
                name="Month",
                description="Invoice month",
                source_hint="invoices.issued_date",
            ),
            CSVColumnIntent(
                name="Account Region",
                description="Account region",
                source_hint="accounts.region",
            ),
            CSVColumnIntent(
                name="Invoice Revenue",
                description="Invoice revenue",
                source_hint="invoices.total_amount",
            ),
        ],
    )

    result = validate_sql(
        """
        select
          date_trunc('month', i.issued_date) as "Month",
          a.region as "Account Region",
          sum(i.total_amount) as "Invoice Revenue"
        from invoices i
        join accounts a on a.id = i.account_id
        group by 1, 2
        limit 100
        """,
        expected_columns=["Month", "Account Region", "Invoice Revenue"],
        intent=intent,
    )

    assert result.valid


def test_source_hint_validation_does_not_trust_alias_named_like_required_table() -> None:
    intent = CSVIntent(
        summary="Customer emails",
        row_meaning="One row per customer",
        columns=[
            CSVColumnIntent(
                name="email",
                description="Customer email",
                source_hint="customers.email",
            )
        ],
    )

    result = validate_sql(
        "select customers.email as email from accounts customers limit 10",
        expected_columns=["email"],
        intent=intent,
    )

    assert not result.valid
    assert result.errors == ["SQL must select from approved source hint 'customers.email'."]
