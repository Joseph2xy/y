import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

const approvedIntent = {
  summary: "Customer export",
  row_meaning: "One row per customer",
  columns: [{ name: "email", description: "Email address" }],
  filters: ["Only active customers"],
  derived_fields: [],
  assumptions: [],
  max_row_count: 10
};

const sessionResponse = {
  id: "session123",
  status: "drafting_intent",
  messages: [],
  approved_intent: null,
  export_id: null,
  last_export_sql: null,
  last_error: null,
  debug_traces: []
};

const providerResponse = {
  provider: "openrouter",
  model: "openrouter/openai/gpt-4o-mini",
  base_url: null,
  temperature: 0,
  api_key_configured: false
};

const setupReadyResponse = {
  ready: true,
  database: { configured: true, ready: true, message: null },
  model_provider: { configured: true, ready: true, message: null },
  context: { configured: true, ready: true, message: null },
  current_database: {
    host: "localhost",
    port: "5432",
    database: "appdb",
    scanned_at: "2026-05-03T00:00:00Z",
    fingerprint: "appdb"
  },
  context_source: {
    host: "localhost",
    port: "5432",
    database: "appdb",
    scanned_at: "2026-05-03T00:00:00Z",
    fingerprint: "appdb"
  },
  next_action: null
};

const contextResponse = {
  context: "# Local Context\n",
  schema: { tables: [], relationships: [], source: setupReadyResponse.context_source },
  policy: {
    blocked_schemas: [],
    blocked_tables: [],
    blocked_columns: [],
    blocked_functions: ["pg_sleep", "set_config"],
    max_row_count: 1000,
    max_export_bytes: 50000000,
    statement_timeout_ms: 30000,
    lock_timeout_ms: 5000
  }
};

const savedPlanResponse = {
  id: "saved123",
  name: "Customer emails",
  description: "Reusable customer email CSV",
  intent: approvedIntent,
  sql: "select email from customers limit 10",
  created_at: "2026-05-05T12:00:00Z",
  updated_at: "2026-05-05T12:00:00Z",
  last_run_at: null,
  last_export_id: null,
  schema_fingerprint: "appdb",
  row_limit: 10
};

const providerNeededResponse = {
  ready: false,
  database: { configured: true, ready: true, message: null },
  model_provider: { configured: false, ready: false, message: "Model provider is not configured." },
  context: { configured: true, ready: true, message: null },
  next_action: "configure_model_provider"
};

const contextStaleResponse = {
  ready: false,
  database: { configured: true, ready: true, message: null },
  model_provider: { configured: true, ready: true, message: null },
  context: {
    configured: true,
    ready: false,
    message: "Context was scanned from old_app on localhost:5432, but .env points to new_app on localhost:5432. Run a context rescan."
  },
  current_database: {
    host: "localhost",
    port: "5432",
    database: "new_app",
    scanned_at: "2026-05-03T00:00:00Z",
    fingerprint: "new"
  },
  context_source: {
    host: "localhost",
    port: "5432",
    database: "old_app",
    scanned_at: "2026-05-02T23:00:00Z",
    fingerprint: "old"
  },
  next_action: "rescan_context"
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function renderApp() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false }
    }
  });

  render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  );
}

describe("App", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/setup/status") return jsonResponse(setupReadyResponse);
        if (url === "/settings/model-provider") return jsonResponse(providerResponse);
        if (url === "/context") return jsonResponse(contextResponse);
        if (url === "/saved-csv-plans") return jsonResponse({ plans: [] });
        if (url === "/sessions") return jsonResponse({ session: sessionResponse });
        if (url === "/sessions/session123") return jsonResponse(sessionResponse);
        return jsonResponse({ detail: "Not found" }, 404);
      })
    );
  });

  afterEach(() => {
    cleanup();
    document.documentElement.className = "";
    document.documentElement.style.colorScheme = "";
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("opens on the centered chat experience when setup is ready", async () => {
    renderApp();

    expect(await screen.findByText("What CSV do you need?")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "CSV Chat" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "CSV Chat" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Describe the CSV you need")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Setup needed" })).not.toBeInTheDocument();
    expect(screen.queryByText(/select email/i)).not.toBeInTheDocument();
  });

  it("toggles between dark and light mode", async () => {
    const user = userEvent.setup();

    renderApp();

    await screen.findByText("What CSV do you need?");
    expect(document.documentElement).toHaveClass("dark");

    await user.click(screen.getByRole("button", { name: "Switch to light mode" }));

    expect(document.documentElement).not.toHaveClass("dark");
    expect(document.documentElement.style.colorScheme).toBe("light");
    expect(window.localStorage.getItem("csv-chat-theme")).toBe("light");

    await user.click(screen.getByRole("button", { name: "Switch to dark mode" }));

    expect(document.documentElement).toHaveClass("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it("shows database and provider settings from the ready state", async () => {
    const user = userEvent.setup();
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const requests: Array<{ url: string; method: string; body?: string }> = [];

    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      requests.push({ url, method, body: typeof init?.body === "string" ? init.body : undefined });
      if (url === "/setup/status") return jsonResponse(setupReadyResponse);
      if (url === "/settings/model-provider" && method === "GET") return jsonResponse({ ...providerResponse, api_key_configured: true });
      if (url === "/context" && method === "GET") return jsonResponse(contextResponse);
      if (url === "/context" && method === "PUT") {
        return jsonResponse({
          ...contextResponse,
          policy: {
            ...contextResponse.policy,
            max_row_count: 2500
          }
        });
      }
      if (url === "/settings/database/test") {
        return jsonResponse({
          configured: true,
          ok: true,
          message: "Connected to appdb on localhost:5432.",
          current_database: setupReadyResponse.current_database
        });
      }
      if (url === "/settings/model-provider" && method === "PUT") {
        return jsonResponse({
          provider: "custom",
          model: "local-model",
          base_url: "http://127.0.0.1:4010/v1",
          temperature: 0,
          api_key_configured: true
        });
      }
      if (url === "/context/scan") {
        return jsonResponse({ context_markdown: "", schema: {}, policy: {} });
      }
      if (url === "/sessions") return jsonResponse({ session: sessionResponse });
      if (url === "/sessions/session123") return jsonResponse(sessionResponse);
      return jsonResponse({ detail: "Not found" }, 404);
    });

    renderApp();

    await screen.findByText("What CSV do you need?");
    await user.click(screen.getByRole("button", { name: "Settings" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Database connection")).toBeInTheDocument();
    expect(within(dialog).getByText(/DATABASE_URL=postgresql/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Test connection" }));
    expect(await within(dialog).findByText("Connected to appdb on localhost:5432.")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Rescan context" }));

    await user.click(within(dialog).getByRole("tab", { name: "Safety" }));
    expect(within(dialog).getByText("Export safety")).toBeInTheDocument();
    await user.clear(within(dialog).getByLabelText("Default row limit"));
    await user.type(within(dialog).getByLabelText("Default row limit"), "2500");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await user.click(within(dialog).getByRole("tab", { name: "Provider" }));
    await user.click(within(dialog).getByText("Custom"));
    await user.clear(within(dialog).getByLabelText("Model"));
    await user.type(within(dialog).getByLabelText("Model"), "local-model");
    await user.type(within(dialog).getByLabelText("Base URL"), "http://127.0.0.1:4010/v1");
    await user.type(within(dialog).getByLabelText("API key"), "secret-key");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(requests.some((request) => request.url === "/context/scan" && request.method === "POST")).toBe(true);
    expect(requests.some((request) => request.url === "/settings/database/test" && request.method === "POST")).toBe(true);
    const safetyUpdate = requests.find((request) => request.url === "/context" && request.method === "PUT");
    expect(safetyUpdate?.body).toContain('"max_row_count":2500');
    const providerUpdate = requests.find((request) => request.url === "/settings/model-provider" && request.method === "PUT");
    expect(providerUpdate?.body).toContain('"provider":"custom"');
    expect(providerUpdate?.body).toContain('"api_key":"secret-key"');
  });

  it("keeps prepared SQL hidden until Advanced is opened", async () => {
    const user = userEvent.setup();
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    let currentSession: Record<string, unknown> = { ...sessionResponse };

    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/setup/status") return jsonResponse(setupReadyResponse);
      if (url === "/sessions") return jsonResponse({ session: currentSession });
      if (url === "/sessions/session123") return jsonResponse(currentSession);
      if (url === "/sessions/session123/messages") {
        currentSession = {
          ...currentSession,
          messages: [{ role: "user", content: "Export customer emails" }]
        };
        return jsonResponse(currentSession);
      }
      if (url === "/sessions/session123/propose-intent") {
        return jsonResponse({ message: "Here is the CSV plan.", intent: approvedIntent, questions: [] });
      }
      if (url === "/sessions/session123/approve-intent") {
        currentSession = {
          ...currentSession,
          status: "generating_sql",
          approved_intent: approvedIntent,
          debug_traces: [{ step: "validate_sql", summary: "SQL validation attempt 1 passed.", details: { valid: true } }]
        };
        return jsonResponse(currentSession);
      }
      if (url === "/sessions/session123/prepare-sql") {
        return jsonResponse({
          sql: "select email from customers limit 10",
          valid: true,
          errors: [],
          attempts: [{ sql: "select email from customers limit 10", valid: true, errors: [], repair_changes: [] }]
        });
      }
      if (url === "/sessions/session123/export") {
        return jsonResponse({
          export_id: "export123",
          row_count: 3,
          byte_count: 42,
          columns: ["email"],
          download_url: "/exports/export123/download"
        });
      }
      return jsonResponse({ detail: "Not found" }, 404);
    });

    renderApp();

    await user.type(await screen.findByPlaceholderText("Describe the CSV you need"), "Export customer emails");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await user.click(await screen.findByRole("button", { name: "Approve CSV plan" }));

    expect(await screen.findByRole("link", { name: "Download CSV" })).toBeInTheDocument();
    expect(screen.queryByText("select email from customers limit 10")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Advanced" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("select email from customers limit 10")).toBeInTheDocument();
    expect(within(dialog).getByText(/validate_sql: SQL validation attempt 1 passed./)).toBeInTheDocument();
  });

  it("allows retrying SQL preparation after validation fails", async () => {
    const user = userEvent.setup();
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    let currentSession: Record<string, unknown> = { ...sessionResponse };
    let prepareCalls = 0;

    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/setup/status") return jsonResponse(setupReadyResponse);
      if (url === "/sessions") return jsonResponse({ session: currentSession });
      if (url === "/sessions/session123") return jsonResponse(currentSession);
      if (url === "/sessions/session123/messages") {
        currentSession = { ...currentSession, messages: [{ role: "user", content: "Export customer emails" }] };
        return jsonResponse(currentSession);
      }
      if (url === "/sessions/session123/propose-intent") {
        return jsonResponse({ message: "Here is the CSV plan.", intent: approvedIntent, questions: [] });
      }
      if (url === "/sessions/session123/approve-intent") {
        currentSession = { ...currentSession, status: "generating_sql", approved_intent: approvedIntent };
        return jsonResponse(currentSession);
      }
      if (url === "/sessions/session123/prepare-sql") {
        prepareCalls += 1;
        if (prepareCalls === 1) {
          return jsonResponse({
            sql: "select created_at as email from customers limit 10",
            valid: false,
            errors: ["SQL must select from approved source hint 'customers.email'."],
            attempts: [
              {
                sql: "select created_at as email from customers limit 10",
                valid: false,
                errors: ["SQL must select from approved source hint 'customers.email'."],
                repair_changes: []
              }
            ]
          });
        }
        return jsonResponse({
          sql: "select email from customers limit 10",
          valid: true,
          errors: [],
          attempts: [{ sql: "select email from customers limit 10", valid: true, errors: [], repair_changes: [] }]
        });
      }
      if (url === "/sessions/session123/export") {
        return jsonResponse({
          export_id: "export123",
          row_count: 3,
          byte_count: 42,
          columns: ["email"],
          download_url: "/exports/export123/download"
        });
      }
      return jsonResponse({ detail: "Not found" }, 404);
    });

    renderApp();

    await user.type(await screen.findByPlaceholderText("Describe the CSV you need"), "Export customer emails");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await user.click(await screen.findByRole("button", { name: "Approve CSV plan" }));

    expect(await screen.findByRole("button", { name: "Try again" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("link", { name: "Download CSV" })).toBeInTheDocument();
    expect(prepareCalls).toBe(2);
  });

  it("creates a CSV after validation", async () => {
    const user = userEvent.setup();
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    let currentSession: Record<string, unknown> = { ...sessionResponse };
    const nextSession = { ...sessionResponse, id: "session456", messages: [], approved_intent: null };
    let sessionCreates = 0;

    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/setup/status") return jsonResponse(setupReadyResponse);
      if (url === "/sessions") {
        sessionCreates += 1;
        return jsonResponse({ session: sessionCreates > 1 ? nextSession : currentSession });
      }
      if (url === "/sessions/session123") return jsonResponse(currentSession);
      if (url === "/sessions/session456") return jsonResponse(nextSession);
      if (url === "/sessions/session123/messages") {
        currentSession = { ...currentSession, messages: [{ role: "user", content: "Export customer emails" }] };
        return jsonResponse(currentSession);
      }
      if (url === "/sessions/session123/propose-intent") {
        return jsonResponse({ message: "Here is the CSV plan.", intent: approvedIntent, questions: [] });
      }
      if (url === "/sessions/session123/approve-intent") {
        currentSession = { ...currentSession, status: "generating_sql", approved_intent: approvedIntent };
        return jsonResponse(currentSession);
      }
      if (url === "/sessions/session123/prepare-sql") {
        return jsonResponse({
          sql: "select email from customers limit 10",
          valid: true,
          errors: [],
          attempts: [{ sql: "select email from customers limit 10", valid: true, errors: [], repair_changes: [] }]
        });
      }
      if (url === "/sessions/session123/export") {
        return jsonResponse({
          export_id: "export123",
          row_count: 3,
          byte_count: 42,
          columns: ["email"],
          download_url: "/exports/export123/download"
        });
      }
      return jsonResponse({ detail: "Not found" }, 404);
    });

    renderApp();

    await user.type(await screen.findByPlaceholderText("Describe the CSV you need"), "Export customer emails");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await user.click(await screen.findByRole("button", { name: "Approve CSV plan" }));

    expect((await screen.findAllByText("ready")).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "Download CSV" })).toHaveAttribute("href", "/exports/export123/download");
    await waitFor(() => {
      expect(screen.queryByPlaceholderText("Describe the CSV you need")).not.toBeInTheDocument();
    });
    expect(screen.queryByText("3 rows exported.")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Start over" }));

    expect(await screen.findByPlaceholderText("Describe the CSV you need")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Download CSV" })).not.toBeInTheDocument();
  });

  it("saves a completed CSV plan from the download step", async () => {
    const user = userEvent.setup();
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const requests: Array<{ url: string; method: string; body?: string }> = [];
    let currentSession: Record<string, unknown> = { ...sessionResponse };

    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      requests.push({ url, method, body: typeof init?.body === "string" ? init.body : undefined });
      if (url === "/setup/status") return jsonResponse(setupReadyResponse);
      if (url === "/context") return jsonResponse(contextResponse);
      if (url === "/saved-csv-plans" && method === "GET") return jsonResponse({ plans: [] });
      if (url === "/saved-csv-plans" && method === "POST") return jsonResponse(savedPlanResponse);
      if (url === "/sessions") return jsonResponse({ session: currentSession });
      if (url === "/sessions/session123") return jsonResponse(currentSession);
      if (url === "/sessions/session123/messages") {
        currentSession = { ...currentSession, messages: [{ role: "user", content: "Export customer emails" }] };
        return jsonResponse(currentSession);
      }
      if (url === "/sessions/session123/propose-intent") {
        return jsonResponse({ message: "Here is the CSV plan.", intent: approvedIntent, questions: [] });
      }
      if (url === "/sessions/session123/approve-intent") {
        currentSession = { ...currentSession, status: "generating_sql", approved_intent: approvedIntent, export_id: null };
        return jsonResponse(currentSession);
      }
      if (url === "/sessions/session123/prepare-sql") {
        return jsonResponse({
          sql: "select email from customers limit 10",
          valid: true,
          errors: [],
          attempts: [{ sql: "select email from customers limit 10", valid: true, errors: [], repair_changes: [] }]
        });
      }
      if (url === "/sessions/session123/export") {
        currentSession = { ...currentSession, status: "complete", export_id: "export123", last_export_sql: "select email from customers limit 10" };
        return jsonResponse({
          export_id: "export123",
          row_count: 3,
          byte_count: 42,
          columns: ["email"],
          download_url: "/exports/export123/download"
        });
      }
      return jsonResponse({ detail: "Not found" }, 404);
    });

    renderApp();

    await user.type(await screen.findByPlaceholderText("Describe the CSV you need"), "Export customer emails");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await user.click(await screen.findByRole("button", { name: "Approve CSV plan" }));
    await screen.findByRole("link", { name: "Download CSV" });
    await user.click(screen.getByRole("button", { name: "Save CSV Plan" }));
    await user.clear(await screen.findByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "Customer emails");
    await user.click(screen.getByRole("button", { name: /^Save$/ }));

    await screen.findByText('Saved as "Customer emails".');
    expect(screen.getByRole("button", { name: "Saved" })).toBeDisabled();

    const saveRequest = requests.find((request) => request.url === "/saved-csv-plans" && request.method === "POST");
    expect(saveRequest?.body).toContain('"session_id":"session123"');
    expect(saveRequest?.body).not.toContain('"sql"');
  });

  it("runs a saved CSV from the Saved CSVs view", async () => {
    const user = userEvent.setup();
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;

    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "/setup/status") return jsonResponse(setupReadyResponse);
      if (url === "/context") return jsonResponse(contextResponse);
      if (url === "/saved-csv-plans" && method === "GET") return jsonResponse({ plans: [savedPlanResponse] });
      if (url === "/saved-csv-plans/saved123/run") {
        return jsonResponse({
          export_id: "export456",
          row_count: 2,
          byte_count: 30,
          columns: ["email"],
          download_url: "/exports/export456/download"
        });
      }
      if (url === "/sessions") return jsonResponse({ session: sessionResponse });
      if (url === "/sessions/session123") return jsonResponse(sessionResponse);
      return jsonResponse({ detail: "Not found" }, 404);
    });

    renderApp();

    await user.click(await screen.findByRole("button", { name: "Saved CSVs" }));
    expect(await screen.findByText("Customer emails")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Run" }));

    expect(await screen.findByRole("link", { name: "Download CSV" })).toHaveAttribute("href", "/exports/export456/download");
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("marks saved CSVs from another database as not runnable", async () => {
    const user = userEvent.setup();
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const staleSavedPlan = { ...savedPlanResponse, schema_fingerprint: "otherdb" };

    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "/setup/status") return jsonResponse(setupReadyResponse);
      if (url === "/context") return jsonResponse(contextResponse);
      if (url === "/saved-csv-plans" && method === "GET") return jsonResponse({ plans: [staleSavedPlan] });
      if (url === "/sessions") return jsonResponse({ session: sessionResponse });
      if (url === "/sessions/session123") return jsonResponse(sessionResponse);
      return jsonResponse({ detail: "Not found" }, 404);
    });

    renderApp();

    await user.click(await screen.findByRole("button", { name: "Saved CSVs" }));

    expect(await screen.findByText("Different database")).toBeInTheDocument();
    expect(screen.getByText("Create a new saved CSV for the current database.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
  });

  it("hides chat and shows progress while approval starts the export", async () => {
    const user = userEvent.setup();
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    let currentSession: Record<string, unknown> = { ...sessionResponse };
    const approvalDeferred: { resolve?: (session: typeof currentSession) => void } = {};
    const approvalPromise = new Promise<typeof currentSession>((resolve) => {
      approvalDeferred.resolve = resolve;
    });

    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/setup/status") return jsonResponse(setupReadyResponse);
      if (url === "/sessions") return jsonResponse({ session: currentSession });
      if (url === "/sessions/session123") return jsonResponse(currentSession);
      if (url === "/sessions/session123/messages") {
        currentSession = { ...currentSession, messages: [{ role: "user", content: "Export customer emails" }] };
        return jsonResponse(currentSession);
      }
      if (url === "/sessions/session123/propose-intent") {
        return jsonResponse({ message: "Here is the CSV plan.", intent: approvedIntent, questions: [] });
      }
      if (url === "/sessions/session123/approve-intent") {
        currentSession = { ...currentSession, status: "generating_sql", approved_intent: approvedIntent };
        return jsonResponse(await approvalPromise);
      }
      if (url === "/sessions/session123/prepare-sql") {
        return jsonResponse({
          sql: "select email from customers limit 10",
          valid: true,
          errors: [],
          attempts: [{ sql: "select email from customers limit 10", valid: true, errors: [], repair_changes: [] }]
        });
      }
      if (url === "/sessions/session123/export") {
        return jsonResponse({
          export_id: "export123",
          row_count: 3,
          byte_count: 42,
          columns: ["email"],
          download_url: "/exports/export123/download"
        });
      }
      return jsonResponse({ detail: "Not found" }, 404);
    });

    renderApp();

    await user.type(await screen.findByPlaceholderText("Describe the CSV you need"), "Export customer emails");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await user.click(await screen.findByRole("button", { name: "Approve CSV plan" }));

    expect(await screen.findByText("Starting CSV export")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByPlaceholderText("Describe the CSV you need")).not.toBeInTheDocument();
    });

    approvalDeferred.resolve?.(currentSession);
  });

  it("shows clarification in chat instead of the artifact panel when the plan is not ready", async () => {
    const user = userEvent.setup();
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    let currentSession: Record<string, unknown> = { ...sessionResponse };

    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/setup/status") return jsonResponse(setupReadyResponse);
      if (url === "/sessions") return jsonResponse({ session: currentSession });
      if (url === "/sessions/session123") return jsonResponse(currentSession);
      if (url === "/sessions/session123/messages") {
        currentSession = { ...currentSession, messages: [{ role: "user", content: "Send me useful customer stuff." }] };
        return jsonResponse(currentSession);
      }
      if (url === "/sessions/session123/propose-intent") {
        return jsonResponse({
          message: "Which customer fields should the CSV include?",
          intent: null,
          questions: ["Which customer fields should the CSV include?"]
        });
      }
      return jsonResponse({ detail: "Not found" }, 404);
    });

    renderApp();

    await user.type(await screen.findByPlaceholderText("Describe the CSV you need"), "Send me useful customer stuff.");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("Which customer fields should the CSV include?")).toBeInTheDocument();
    expect(screen.queryByText("Clarify request")).not.toBeInTheDocument();
    expect(screen.getByText("CSV plan will appear here")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve CSV plan" })).not.toBeInTheDocument();
  });

  it("shows provider setup only as a fallback and saves OpenRouter settings", async () => {
    const user = userEvent.setup();
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    let savedBody: unknown = null;
    let providerSaved = false;

    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/setup/status") return jsonResponse(providerSaved ? setupReadyResponse : providerNeededResponse);
      if (url === "/settings/model-provider" && init?.method === "PUT") {
        savedBody = JSON.parse(String(init.body));
        providerSaved = true;
        return jsonResponse({ ...providerResponse, api_key_configured: true });
      }
      if (url === "/settings/model-provider") return jsonResponse(providerResponse);
      return jsonResponse({ detail: "Not found" }, 404);
    });

    renderApp();

    expect(await screen.findByRole("region", { name: "Setup needed" })).toBeInTheDocument();
    await user.type(await screen.findByLabelText("API key"), "sk-or-test");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("What CSV do you need?")).toBeInTheDocument();
    expect(savedBody).toMatchObject({
      provider: "openrouter",
      model: "openrouter/openai/gpt-4o-mini",
      api_key: "sk-or-test",
      base_url: null,
      temperature: 0
    });
  });

  it("saves OpenAI provider settings without a base URL", async () => {
    const user = userEvent.setup();
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    let savedBody: unknown = null;
    let providerSaved = false;

    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/setup/status") return jsonResponse(providerSaved ? setupReadyResponse : providerNeededResponse);
      if (url === "/settings/model-provider" && init?.method === "PUT") {
        savedBody = JSON.parse(String(init.body));
        providerSaved = true;
        return jsonResponse({
          provider: "openai",
          model: "openai/gpt-4.1-mini",
          base_url: null,
          temperature: 0,
          api_key_configured: true
        });
      }
      if (url === "/settings/model-provider") return jsonResponse(providerResponse);
      return jsonResponse({ detail: "Not found" }, 404);
    });

    renderApp();

    await user.click(await screen.findByRole("button", { name: "OpenAI" }));
    await user.type(screen.getByLabelText("API key"), "sk-test");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("What CSV do you need?")).toBeInTheDocument();
    expect(savedBody).toMatchObject({
      provider: "openai",
      model: "openai/gpt-4.1-mini",
      api_key: "sk-test",
      base_url: null,
      temperature: 0
    });
    expect(screen.queryByLabelText("Base URL")).not.toBeInTheDocument();
  });

  it("saves OpenCode Zen provider settings without requiring an API key", async () => {
    const user = userEvent.setup();
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    let savedBody: unknown = null;
    let providerSaved = false;

    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/setup/status") return jsonResponse(providerSaved ? setupReadyResponse : providerNeededResponse);
      if (url === "/settings/model-provider" && init?.method === "PUT") {
        savedBody = JSON.parse(String(init.body));
        providerSaved = true;
        return jsonResponse({
          provider: "opencode",
          model: "nemotron-3-super-free",
          base_url: "https://opencode.ai/zen/v1",
          temperature: 0,
          api_key_configured: false
        });
      }
      if (url === "/settings/model-provider") return jsonResponse(providerResponse);
      return jsonResponse({ detail: "Not found" }, 404);
    });

    renderApp();

    await user.click(await screen.findByRole("button", { name: "OpenCode Zen" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("What CSV do you need?")).toBeInTheDocument();
    expect(savedBody).toMatchObject({
      provider: "opencode",
      model: "nemotron-3-super-free",
      api_key: null,
      base_url: null,
      temperature: 0
    });
  });

  it("saves custom OpenAI-compatible provider settings", async () => {
    const user = userEvent.setup();
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    let savedBody: unknown = null;
    let providerSaved = false;

    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/setup/status") return jsonResponse(providerSaved ? setupReadyResponse : providerNeededResponse);
      if (url === "/settings/model-provider" && init?.method === "PUT") {
        savedBody = JSON.parse(String(init.body));
        providerSaved = true;
        return jsonResponse({
          provider: "custom",
          model: "openai/gpt-4.1-mini",
          base_url: "http://127.0.0.1:4010/v1",
          temperature: 0,
          api_key_configured: true
        });
      }
      if (url === "/settings/model-provider") return jsonResponse(providerResponse);
      return jsonResponse({ detail: "Not found" }, 404);
    });

    renderApp();

    await user.click(await screen.findByRole("button", { name: "Custom" }));
    await user.clear(screen.getByLabelText("Model"));
    await user.type(screen.getByLabelText("Model"), "openai/gpt-4.1-mini");
    await user.type(screen.getByLabelText("Base URL"), "http://127.0.0.1:4010/v1");
    await user.type(screen.getByLabelText("API key"), "sk-test");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("What CSV do you need?")).toBeInTheDocument();
    expect(savedBody).toMatchObject({
      provider: "custom",
      model: "openai/gpt-4.1-mini",
      api_key: "sk-test",
      base_url: "http://127.0.0.1:4010/v1",
      temperature: 0
    });
  });

  it("shows stale context details and rescans context explicitly", async () => {
    const user = userEvent.setup();
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    let rescanCalled = false;

    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/setup/status") return jsonResponse(rescanCalled ? setupReadyResponse : contextStaleResponse);
      if (url === "/context/scan") {
        rescanCalled = true;
        return jsonResponse({ context: "# Context", schema: { tables: [] }, policy: {} });
      }
      return jsonResponse({ detail: "Not found" }, 404);
    });

    renderApp();

    expect(await screen.findByText("Rescan database context")).toBeInTheDocument();
    expect(screen.getByText("new_app on localhost:5432")).toBeInTheDocument();
    expect(screen.getByText("old_app on localhost:5432")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Rescan context" }));

    expect(await screen.findByText("What CSV do you need?")).toBeInTheDocument();
    expect(rescanCalled).toBe(true);
  });
});
