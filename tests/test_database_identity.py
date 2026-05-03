from app.database_identity import database_source_from_url, database_sources_match


def test_database_source_treats_default_postgres_port_as_5432() -> None:
    without_port = database_source_from_url("postgresql://readonly:secret@localhost/appdb")
    with_port = database_source_from_url("postgresql://readonly:secret@localhost:5432/appdb")

    assert without_port.port == "5432"
    assert database_sources_match(without_port, with_port)
