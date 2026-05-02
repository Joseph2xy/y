from app.csv_writer import escape_csv_cell, write_csv


def test_escapes_formula_like_cells() -> None:
    assert escape_csv_cell("=1+1") == "'=1+1"
    assert escape_csv_cell("+SUM(A1:A2)") == "'+SUM(A1:A2)"
    assert escape_csv_cell("-10") == "'-10"
    assert escape_csv_cell("@cmd") == "'@cmd"
    assert escape_csv_cell("\tvalue") == "'\tvalue"
    assert escape_csv_cell("\rvalue") == "'\rvalue"
    assert escape_csv_cell(" =1+1") == "' =1+1"
    assert escape_csv_cell("\n=1+1") == "'\n=1+1"
    assert escape_csv_cell("normal") == "normal"


def test_write_csv_escapes_values(tmp_path) -> None:
    path = tmp_path / "export.csv"

    count = write_csv(path, ["email", "note"], [{"email": "a@example.com", "note": "=1+1"}])

    assert count == 1
    assert path.read_text(encoding="utf-8") == "email,note\na@example.com,'=1+1\n"
