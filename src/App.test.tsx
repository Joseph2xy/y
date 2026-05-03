import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
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
  next_action: null
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
      return jsonResponse({ detail: "Not found" }, 404);
    });

    renderApp();

    await user.type(await screen.findByPlaceholderText("Describe the CSV you need"), "Export customer emails");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await user.click(await screen.findByRole("button", { name: "Approve CSV plan" }));

    expect(await screen.findByText("Ready to create")).toBeInTheDocument();
    expect(screen.queryByText("select email from customers limit 10")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Advanced" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("select email from customers limit 10")).toBeInTheDocument();
    expect(within(dialog).getByText(/validate_sql: SQL validation attempt 1 passed./)).toBeInTheDocument();
  });

  it("creates a CSV after validation", async () => {
    const user = userEvent.setup();
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    let currentSession: Record<string, unknown> = { ...sessionResponse };

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
    await user.click(await screen.findByRole("button", { name: "Create CSV" }));

    expect((await screen.findAllByText("CSV ready")).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "Download CSV" })).toHaveAttribute("href", "/exports/export123/download");
    expect(screen.getByText("3 rows exported.")).toBeInTheDocument();
  });

  it("shows clarification instead of an approval button when the plan is not ready", async () => {
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

    expect(await screen.findByText("Clarify request")).toBeInTheDocument();
    expect(screen.getAllByText("Which customer fields should the CSV include?").length).toBeGreaterThan(0);
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
