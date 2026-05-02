from app.db import run_read_only_query


class FakeCursor:
    def __enter__(self):
        return [{"email": "ava@example.com"}]

    def __exit__(self, exc_type, exc, tb):
        return None


class FakeTransaction:
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return None


class FakeConnection:
    def __init__(self) -> None:
        self.statements: list[str] = []

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return None

    def transaction(self):
        return FakeTransaction()

    def execute(self, statement, params=None):
        self.statements.append(str(statement))
        if str(statement).startswith("select"):
            return FakeCursor()
        return None


def test_run_read_only_query_uses_literal_timeout_statements(monkeypatch) -> None:
    connection = FakeConnection()
    monkeypatch.setattr("app.db.psycopg.connect", lambda *args, **kwargs: connection)

    rows = list(
        run_read_only_query(
            "postgresql://example",
            "select email from customers limit 1",
            statement_timeout_ms=123,
            lock_timeout_ms=45,
        )
    )

    assert rows == [{"email": "ava@example.com"}]
    assert connection.statements == [
        "SET TRANSACTION READ ONLY",
        "SET LOCAL statement_timeout = 123",
        "SET LOCAL lock_timeout = 45",
        "select email from customers limit 1",
    ]
