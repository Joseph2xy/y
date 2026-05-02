# CSV Chat

CSV Chat is a local/customer-installed product context for turning a natural-language request into a safe CSV export from a connected Postgres database. The product boundary is the full path from request, through user-approved CSV plan, to validated CSV download.

## Language

**CSV Request**:
The user's natural-language description of the CSV they want.
_Avoid_: prompt, query request, export job

**CSV Plan**:
A user-facing description of the CSV that will be produced before any SQL is run.
_Avoid_: contract, specification, SQL plan

**CSV Intent**:
The structured form of a **CSV Plan** that the app validates against later steps.
_Avoid_: contract, schema contract

**Approved Intent**:
The **CSV Intent** the user has accepted as the boundary for SQL generation and export.
_Avoid_: approval workflow, signed-off contract

**Context**:
Editable business and schema knowledge that helps the model understand what the database means.
_Avoid_: prompt file, schema dump

**Context Setup**:
The first-run database scan that prepares editable Markdown context and useful database hints for better CSV requests.
_Avoid_: semantic model setup, join builder

**Policy**:
Explicit local blocks and limits that restrict what data and database behavior an export may use.
_Avoid_: permissions model, access-control system, sensitivity classifier

**Export**:
The downloadable CSV artifact produced from an **Approved Intent**.
_Avoid_: report, job, extract

**Advanced**:
The read-only user-facing area where SQL and validation details may be inspected.
_Avoid_: normal mode, SQL editor

**Model Provider**:
The configured service or local endpoint the app uses for model calls.
_Avoid_: agent platform, subscription workflow

## Relationships

- A **CSV Request** may produce one **CSV Plan**.
- A **CSV Plan** becomes one **CSV Intent** when represented structurally by the app.
- An **Approved Intent** is required before SQL generation or export execution.
- An **Export** must match the **Approved Intent**.
- **Context** informs model proposals, while **Policy** constrains validation and execution.
- **Context Setup** creates starter **Context** that an admin may tweak directly.
- A **Model Provider** may be API-key-based in V0, with account/subscription providers deferred.
- **Advanced** reveals implementation details without changing the normal user-facing CSV flow or the **Approved Intent**.

## Example Dialogue

> **Dev:** "If the user asks for active customers with balances, do we show them SQL before running anything?"
> **Domain expert:** "No. We show a **CSV Plan** in plain language. SQL stays in **Advanced**, and the app only proceeds after there is an **Approved Intent**."

## Flagged Ambiguities

- "CSV plan" and "CSV intent" are both used in the project. Use **CSV Plan** for user-facing copy and **CSV Intent** for the structured app object.
- "Advanced/debug" currently refers to one disclosure area. Use **Advanced** in user-facing copy and "debug traces" for internal validation/model details.
- **Advanced** is read-only for V0; it is not a SQL editor.
- Synonyms and common joins belong in editable **Context** notes for V0, not a structured management feature.
- **Context Setup** may include representative values and database hints to improve model precision, excluding anything blocked by **Policy**.
