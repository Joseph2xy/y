from tools.api_client import APIClient

from app.main import app


def test_health() -> None:
    client = APIClient(app)

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
