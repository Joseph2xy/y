from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any


INTENT_RESPONSE = {
    "message": "I will create a CSV of active customers created in 2026 with their account details.",
    "intent": {
        "summary": "Active customers created in 2026",
        "row_meaning": "One row per active customer created in 2026.",
        "columns": [
            {"name": "email", "description": "Customer email address."},
            {"name": "full_name", "description": "Customer full name."},
            {"name": "account_name", "description": "Account name for the customer."},
            {"name": "plan", "description": "Account plan."},
            {"name": "created_at", "description": "Date the customer record was created."},
        ],
        "filters": ["Only active customers.", "Only customers created in 2026."],
        "derived_fields": [],
        "assumptions": ["Use the customer's account to include account name and plan."],
        "max_row_count": 100,
    },
}

CLARIFICATION_RESPONSE = {
    "message": "I can help create a CSV export from the database. What CSV do you want to create?",
    "intent": None,
    "questions": ["What should one row represent?", "Which fields or values should be included?"],
}

SQL_RESPONSE = {
    "sql": (
        "select c.email as email, c.full_name as full_name, a.name as account_name, "
        "a.plan as plan, c.created_at as created_at "
        "from customers c join accounts a on a.id = c.account_id "
        "where c.status = 'active' and c.created_at >= date '2026-01-01' "
        "and c.created_at < date '2027-01-01' "
        "order by c.created_at desc "
        "limit 100"
    ),
    "notes": ["Uses only approved CSV fields and includes a literal limit."],
}

REPAIR_RESPONSE = {
    "sql": SQL_RESPONSE["sql"],
    "changes": ["Returned the validated demo SQL."],
}


class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        if self.path == "/health":
            self._send_json({"status": "ok"})
            return
        self.send_error(404)

    def do_POST(self) -> None:
        if not self.path.endswith("/chat/completions"):
            self.send_error(404)
            return

        length = int(self.headers.get("content-length", "0"))
        body = self.rfile.read(length)
        try:
            request = json.loads(body)
        except json.JSONDecodeError:
            self.send_error(400, "Invalid JSON")
            return

        content = json.dumps(_choose_response(request), separators=(",", ":"))
        self._send_json(
            {
                "id": "chatcmpl-demo",
                "object": "chat.completion",
                "created": 0,
                "model": request.get("model", "demo-model"),
                "choices": [
                    {
                        "index": 0,
                        "message": {"role": "assistant", "content": content},
                        "finish_reason": "stop",
                    }
                ],
            }
        )

    def log_message(self, format: str, *args: Any) -> None:
        return

    def _send_json(self, payload: dict[str, Any]) -> None:
        data = json.dumps(payload).encode("utf-8")
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def _choose_response(request: dict[str, Any]) -> dict[str, Any]:
    messages = request.get("messages", [])
    prompt = "\n".join(str(message.get("content", "")) for message in messages)
    if "SQLRepairProposal" in prompt or "repaired SQL" in prompt:
        return REPAIR_RESPONSE
    if "SQLProposal" in prompt or "Propose one Postgres SELECT" in prompt:
        return SQL_RESPONSE
    if _contains_unclear_user_request(prompt):
        return CLARIFICATION_RESPONSE
    return INTENT_RESPONSE


def _contains_unclear_user_request(prompt: str) -> bool:
    normalized = prompt.lower()
    return any(
        marker in normalized
        for marker in (
            '"content": "hello"',
            '"content": "what can you do?"',
            '"content": "make me a csv"',
        )
    )


def main() -> None:
    server = ThreadingHTTPServer(("127.0.0.1", 4010), Handler)
    print("mock OpenAI-compatible server on http://127.0.0.1:4010", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
