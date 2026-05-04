from dataclasses import dataclass, field

import sqlglot
from sqlglot import exp
from sqlglot.errors import ParseError

from app.models import CSVIntent, ContextPolicy, SchemaContext


DEFAULT_BLOCKED_FUNCTIONS = {
    "pg_sleep",
    "set_config",
}


@dataclass(frozen=True)
class SQLPolicy:
    blocked_schemas: set[str] = field(default_factory=set)
    blocked_tables: set[str] = field(default_factory=set)
    blocked_columns: set[str] = field(default_factory=set)
    blocked_functions: set[str] = field(default_factory=lambda: set(DEFAULT_BLOCKED_FUNCTIONS))
    known_tables: set[str] = field(default_factory=set)
    require_limit: bool = True
    max_limit: int = 100_000


class SQLValidationResult:
    def __init__(self, valid: bool, errors: list[str]) -> None:
        self.valid = valid
        self.errors = errors


def sql_policy_from_context(policy: ContextPolicy, schema: SchemaContext | None = None) -> SQLPolicy:
    return SQLPolicy(
        blocked_schemas=set(policy.blocked_schemas),
        blocked_tables=set(policy.blocked_tables),
        blocked_columns=set(policy.blocked_columns),
        blocked_functions=set(policy.blocked_functions) | DEFAULT_BLOCKED_FUNCTIONS,
        known_tables=_known_tables_from_schema(schema),
        max_limit=policy.max_row_count,
    )


def _known_tables_from_schema(schema: SchemaContext | None) -> set[str]:
    if schema is None:
        return set()

    known_tables: set[str] = set()
    for table in schema.tables:
        schema_name = _normalize_part(table.schema_name)
        table_name = _normalize_part(table.table_name)
        if table_name:
            known_tables.add(table_name)
        if schema_name and table_name:
            known_tables.add(f"{schema_name}.{table_name}")
    return known_tables


def validate_sql(
    sql: str,
    policy: SQLPolicy | None = None,
    expected_columns: list[str] | None = None,
    intent: CSVIntent | None = None,
) -> SQLValidationResult:
    policy = policy or SQLPolicy()
    errors: list[str] = []

    try:
        statements = sqlglot.parse(sql, read="postgres")
    except ParseError as exc:
        return SQLValidationResult(False, [f"SQL could not be parsed: {exc}"])

    statements = [statement for statement in statements if statement is not None]
    if len(statements) != 1:
        return SQLValidationResult(False, ["SQL must contain exactly one statement."])

    statement = statements[0]
    if not isinstance(statement, exp.Select):
        errors.append("SQL must be a SELECT statement.")

    _check_for_writes(statement, errors)
    _check_for_locking_reads(statement, errors)
    _check_limit(statement, policy, errors)
    _check_blocked_tables(statement, policy, errors)
    _check_known_tables(statement, policy, errors)
    _check_blocked_columns(statement, policy, errors)
    _check_blocked_functions(statement, policy, errors)
    if expected_columns is not None:
        _check_output_columns(statement, expected_columns, errors)
    if intent is not None:
        _check_intent_source_hints(statement, intent, errors)

    return SQLValidationResult(not errors, errors)


def _check_for_writes(statement: exp.Expression, errors: list[str]) -> None:
    unsafe_types = (
        exp.Alter,
        exp.Command,
        exp.Create,
        exp.Delete,
        exp.Drop,
        exp.Insert,
        exp.Into,
        exp.Merge,
        exp.Update,
    )
    if any(statement.find(unsafe_type) for unsafe_type in unsafe_types):
        errors.append("SQL contains a write, DDL, or command expression.")


def _check_for_locking_reads(statement: exp.Expression, errors: list[str]) -> None:
    if statement.find(exp.Lock):
        errors.append("SQL must not include row-locking clauses.")


def _check_limit(statement: exp.Expression, policy: SQLPolicy, errors: list[str]) -> None:
    if not policy.require_limit:
        return

    limit = statement.args.get("limit")
    if limit is None:
        errors.append("SQL must include a LIMIT.")
        return

    expression = limit.expression
    if not isinstance(expression, exp.Literal) or not expression.is_int:
        errors.append("SQL LIMIT must be an integer literal.")
        return

    value = int(expression.this)
    if value < 1 or value > policy.max_limit:
        errors.append(f"SQL LIMIT must be between 1 and {policy.max_limit}.")


def _normalize_part(value: str | None) -> str:
    return (value or "").strip('"').lower()


def _check_blocked_tables(statement: exp.Expression, policy: SQLPolicy, errors: list[str]) -> None:
    blocked_schemas = {_normalize_part(schema) for schema in policy.blocked_schemas}
    blocked_tables = {_normalize_part(table) for table in policy.blocked_tables}

    for table in statement.find_all(exp.Table):
        schema_name = _normalize_part(table.db)
        table_name = _normalize_part(table.name)
        qualified = f"{schema_name}.{table_name}" if schema_name else table_name

        if schema_name in blocked_schemas:
            errors.append(f"SQL references blocked schema '{schema_name}'.")
        if table_name in blocked_tables or qualified in blocked_tables:
            errors.append(f"SQL references blocked table '{qualified}'.")


def _check_known_tables(statement: exp.Expression, policy: SQLPolicy, errors: list[str]) -> None:
    if not policy.known_tables:
        return

    cte_names = {_normalize_part(cte.alias_or_name) for cte in statement.find_all(exp.CTE)}
    for table in statement.find_all(exp.Table):
        schema_name = _normalize_part(table.db)
        table_name = _normalize_part(table.name)
        qualified = f"{schema_name}.{table_name}" if schema_name else table_name

        if table_name in cte_names:
            continue
        if schema_name and qualified not in policy.known_tables:
            errors.append(f"SQL references unknown table '{qualified}'.")
        elif not schema_name and table_name not in policy.known_tables:
            errors.append(f"SQL references unknown table '{qualified}'.")


def _check_blocked_columns(statement: exp.Expression, policy: SQLPolicy, errors: list[str]) -> None:
    blocked_columns = {_normalize_part(column) for column in policy.blocked_columns}

    for column in statement.find_all(exp.Column):
        column_name = _normalize_part(column.name)
        table_name = _normalize_part(column.table)
        qualified = f"{table_name}.{column_name}" if table_name else column_name

        if (
            column_name in blocked_columns
            or qualified in blocked_columns
            or _column_matches_schema_qualified_block(column, blocked_columns)
        ):
            errors.append(f"SQL references blocked column '{qualified}'.")


def _check_blocked_functions(statement: exp.Expression, policy: SQLPolicy, errors: list[str]) -> None:
    blocked_functions = {_normalize_part(function) for function in policy.blocked_functions}

    for function in statement.find_all(exp.Func):
        function_name = _function_name(function)
        if function_name in blocked_functions:
            errors.append(f"SQL references blocked function '{function_name}'.")


def _check_output_columns(
    statement: exp.Expression,
    expected_columns: list[str],
    errors: list[str],
) -> None:
    if not isinstance(statement, exp.Select):
        return

    if any(isinstance(expression, exp.Star) or expression.find(exp.Star) for expression in statement.expressions):
        errors.append("SQL must explicitly select the approved CSV columns; SELECT * is not allowed.")
        return

    output_columns = [_normalize_part(expression.alias_or_name) for expression in statement.expressions]
    if any(not column for column in output_columns):
        errors.append("SQL selected fields must have explicit output names.")
        return

    normalized_expected_columns = [_normalize_part(column) for column in expected_columns]
    if output_columns != normalized_expected_columns:
        errors.append(
            "SQL output columns must exactly match the approved CSV columns: "
            + ", ".join(expected_columns)
            + "."
        )


def _function_name(function: exp.Func) -> str:
    if isinstance(function, exp.Anonymous):
        return _normalize_part(str(function.this))
    return _normalize_part(function.sql_name())


def _check_intent_source_hints(
    statement: exp.Expression,
    intent: CSVIntent,
    errors: list[str],
) -> None:
    required_hints = [_normalize_source_hint(column.source_hint) for column in intent.columns if column.source_hint]
    if not required_hints:
        return

    selected_sources = _selected_source_names(statement)
    for source_hint in required_hints:
        if source_hint not in selected_sources:
            errors.append(f"SQL must select from approved source hint '{source_hint}'.")


def _selected_source_names(statement: exp.Expression) -> set[str]:
    sources: set[str] = set()
    if not isinstance(statement, exp.Select):
        return sources

    table_aliases = _table_aliases(statement)
    for expression in statement.expressions:
        if isinstance(expression, exp.Alias):
            expression = expression.this
        for column in expression.find_all(exp.Column):
            _add_column_source(sources, column, table_aliases)
        if isinstance(expression, exp.Column):
            _add_column_source(sources, expression, table_aliases)
    return sources


def _table_aliases(statement: exp.Expression) -> dict[str, str]:
    aliases: dict[str, str] = {}
    for table in statement.find_all(exp.Table):
        table_name = _normalize_part(table.name)
        if not table_name:
            continue
        aliases[table_name] = table_name
        alias = _normalize_part(table.alias)
        if alias:
            aliases[alias] = table_name
    return aliases


def _add_column_source(sources: set[str], column: exp.Column, table_aliases: dict[str, str]) -> None:
    column_name = _normalize_part(column.name)
    table_name = _normalize_part(column.table)
    if column_name:
        sources.add(column_name)
    if table_name and column_name:
        base_table = table_aliases.get(table_name)
        if base_table and base_table != table_name:
            sources.add(f"{base_table}.{column_name}")
        else:
            sources.add(f"{table_name}.{column_name}")


def _normalize_source_hint(source_hint: str | None) -> str:
    if source_hint is None:
        return ""
    parts = [_normalize_part(part) for part in source_hint.split(".") if _normalize_part(part)]
    if len(parts) >= 2:
        return ".".join(parts[-2:])
    return parts[0] if parts else ""


def _column_matches_schema_qualified_block(column: exp.Column, blocked_columns: set[str]) -> bool:
    table_name = _normalize_part(column.table)
    column_name = _normalize_part(column.name)

    if not table_name:
        return False

    for blocked in blocked_columns:
        parts = blocked.split(".")
        if len(parts) == 3 and parts[1] == table_name and parts[2] == column_name:
            return True

    return False
