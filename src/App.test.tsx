import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

const contextResponse = {
  context: "# Test context",
  schema: {
    tables: [
      {
        schema_name: "public",
        table_name: "customers",
        table_type: "BASE TABLE",
        columns: [
          {
            name: "email",
            data_type: "text",
            is_nullable: false,
            ordinal_position: 1
          }
        ]
      }
    ]
  },
  policy: {
    blocked_schemas: [],
    blocked_tables: [],
    blocked_columns: [],
    blocked_functions: ["pg_sleep"],
    max_row_count: 1000,
    max_export_bytes: 50000000,
    statement_timeout_ms: 30000,
    lock_timeout_ms: 5000
  }
};

const approvedIntent = {
  summary: "Customer export",
  row_meaning: "One row per customer",
  columns: [{ name: "email", description: "Email" }],
  filters: [],
  derived_fields: [],
  assumptions: [],
  max_row_count: 10
};

const sessionResponse = {
  id: "session123",
  status: "generating_sql",
  messages: [],
  approved_intent: approvedIntent,
  export_id: null,
  last_error: null,
  debug_traces: [
    {
      step: "validate_sql",
      summary: "SQL validation attempt 1 passed.",
      details: { valid: true }
    }
  ]
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
  context: { configured: false, ready: false, message: "Context files are missing." },
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
        if (url === "/context") {
          return new Response(JSON.stringify(contextResponse), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          });
        }
        if (url === "/setup/status") {
          return new Response(JSON.stringify(setupReadyResponse), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          });
        }
        if (url === "/settings/model-provider") {
          return new Response(JSON.stringify(providerResponse), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          });
        }
        if (url === "/sessions") {
          return new Response(JSON.stringify({ session: sessionResponse }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          });
        }
        if (url === "/sessions/session123") {
          return new Response(JSON.stringify(sessionResponse), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          });
        }
        if (url === "/sessions/session123/messages") {
          return new Response(JSON.stringify(sessionResponse), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          });
        }
        if (url === "/sessions/session123/prepare-sql") {
          return new Response(
            JSON.stringify({
              sql: "select email from customers limit 10",
              valid: true,
              errors: [],
              attempts: [
                {
                  sql: "select email from customers limit 10",
                  valid: true,
                  errors: [],
                  repair_changes: []
                }
              ]
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" }
            }
          );
        }
        return new Response(JSON.stringify({ detail: "Not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" }
        });
      })
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders the main CSV workflow", async () => {
    renderApp();

    expect(await screen.findByPlaceholderText("Export customer emails for active accounts created this quarter.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "CSV Chat" })).toBeInTheDocument();
    expect(screen.getByText("Setup is ready.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Propose CSV plan/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Prepare SQL/i)).not.toBeInTheDocument();
  });

  it("keeps prepared SQL hidden until Advanced is opened", async () => {
    const user = userEvent.setup();
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    let currentSession: Record<string, unknown> = { ...sessionResponse, status: "drafting_intent", messages: [], approved_intent: null };
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/setup/status") {
        return new Response(JSON.stringify(setupReadyResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      if (url === "/sessions") {
        return new Response(JSON.stringify({ session: currentSession }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      if (url === "/sessions/session123") {
        return new Response(JSON.stringify(currentSession), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      if (url === "/sessions/session123/messages") {
        currentSession = {
          ...currentSession,
          messages: [{ role: "user", content: "Export customer emails" }]
        };
        return new Response(JSON.stringify(currentSession), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      if (url === "/sessions/session123/propose-intent") {
        return new Response(JSON.stringify({ message: "Here is the CSV plan.", intent: approvedIntent, questions: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      if (url === "/sessions/session123/approve-intent") {
        currentSession = { ...currentSession, status: "generating_sql", approved_intent: approvedIntent };
        return new Response(JSON.stringify(currentSession), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      if (url === "/sessions/session123/prepare-sql") {
        return new Response(
          JSON.stringify({
            sql: "select email from customers limit 10",
            valid: true,
            errors: [],
            attempts: [
              {
                sql: "select email from customers limit 10",
                valid: true,
                errors: [],
                repair_changes: []
              }
            ]
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" }
          }
        );
      }
      return new Response(JSON.stringify({ detail: "Not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" }
      });
    });
    renderApp();

    await user.type(await screen.findByPlaceholderText("Export customer emails for active accounts created this quarter."), "Export customer emails");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await user.click(await screen.findByRole("button", { name: "Approve CSV plan" }));

    expect(await screen.findByText("The CSV is ready to create.")).toBeInTheDocument();
    expect(screen.queryByText("select email from customers limit 10")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Advanced/i }));

    expect(screen.getByText("select email from customers limit 10")).toBeInTheDocument();
    expect(screen.getByText(/validate_sql: SQL validation attempt 1 passed./)).toBeInTheDocument();
  });

  it("shows persisted session errors after a provider failure", async () => {
    const user = userEvent.setup();
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const failedSession = {
      ...sessionResponse,
      status: "failed",
      messages: [{ role: "user", content: "Export customer emails" }],
      last_error:
        "Model provider could not respond because the provider reported a quota, credit, or rate-limit problem. Check your provider account or switch to a provider/model with available usage, then try again."
    };
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/setup/status") {
        return new Response(JSON.stringify(setupReadyResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      if (url === "/sessions") {
        return new Response(JSON.stringify({ session: { ...sessionResponse, status: "drafting_intent", messages: [] } }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      if (url === "/sessions/session123/messages" || url === "/sessions/session123") {
        return new Response(JSON.stringify(failedSession), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      if (url === "/sessions/session123/propose-intent") {
        return new Response(
          JSON.stringify({
            detail:
              "Model provider could not respond because the provider reported a quota, credit, or rate-limit problem. Check your provider account or switch to a provider/model with available usage, then try again."
          }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" }
          }
        );
      }
      return new Response(JSON.stringify({ detail: "Not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" }
      });
    });

    renderApp();

    await user.type(await screen.findByPlaceholderText("Export customer emails for active accounts created this quarter."), "Export customer emails");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText(/quota, credit, or rate-limit problem/)).toBeInTheDocument();
  });

  it("shows clarification when a CSV plan is not ready", async () => {
    const user = userEvent.setup();
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    let currentSession: Record<string, unknown> = { ...sessionResponse, status: "drafting_intent", messages: [], approved_intent: null };
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/setup/status") {
        return new Response(JSON.stringify(setupReadyResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      if (url === "/sessions") {
        return new Response(JSON.stringify({ session: currentSession }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      if (url === "/sessions/session123") {
        return new Response(JSON.stringify(currentSession), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      if (url === "/sessions/session123/messages") {
        currentSession = {
          ...currentSession,
          messages: [{ role: "user", content: "Send me the useful customer stuff." }]
        };
        return new Response(JSON.stringify(currentSession), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      if (url === "/sessions/session123/propose-intent") {
        return new Response(
          JSON.stringify({
            message: "Which customer fields should the CSV include?",
            intent: null,
            questions: ["Which customer fields should the CSV include?"]
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" }
          }
        );
      }
      return new Response(JSON.stringify({ detail: "Not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" }
      });
    });

    renderApp();

    await user.type(await screen.findByPlaceholderText("Export customer emails for active accounts created this quarter."), "Send me the useful customer stuff.");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findAllByText("Which customer fields should the CSV include?")).not.toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Approve CSV plan" })).not.toBeInTheDocument();
  });

  it("saves OpenRouter provider settings", async () => {
    const user = userEvent.setup();
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    let savedBody: unknown = null;
    let providerSaved = false;
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/setup/status") {
        return new Response(JSON.stringify(providerSaved ? setupReadyResponse : providerNeededResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      if (url === "/settings/model-provider" && init?.method === "PUT") {
        savedBody = JSON.parse(String(init.body));
        providerSaved = true;
        return new Response(
          JSON.stringify({
            ...providerResponse,
            api_key_configured: true
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" }
          }
        );
      }
      if (url === "/settings/model-provider") {
        return new Response(JSON.stringify(providerResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      return new Response(JSON.stringify({ detail: "Not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" }
      });
    });

    renderApp();

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
      if (url === "/setup/status") {
        return new Response(JSON.stringify(providerSaved ? setupReadyResponse : providerNeededResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      if (url === "/settings/model-provider" && init?.method === "PUT") {
        savedBody = JSON.parse(String(init.body));
        providerSaved = true;
        return new Response(
          JSON.stringify({
            provider: "custom",
            model: "openai/gpt-4.1-mini",
            base_url: "http://127.0.0.1:4010/v1",
            temperature: 0,
            api_key_configured: true
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" }
          }
        );
      }
      if (url === "/settings/model-provider") {
        return new Response(JSON.stringify(providerResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      return new Response(JSON.stringify({ detail: "Not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" }
      });
    });

    renderApp();

    await user.selectOptions(await screen.findByLabelText("Provider"), "custom");
    await user.clear(screen.getByLabelText("Model"));
    await user.type(screen.getByLabelText("Model"), "openai/gpt-4.1-mini");
    await user.type(screen.getByLabelText("Base URL"), "http://127.0.0.1:4010/v1");
    await user.type(screen.getByLabelText("API key"), "local-key");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("What CSV do you need?")).toBeInTheDocument();
    expect(savedBody).toMatchObject({
      provider: "custom",
      model: "openai/gpt-4.1-mini",
      api_key: "local-key",
      base_url: "http://127.0.0.1:4010/v1",
      temperature: 0
    });
  });

  it("shows stale context details and rescans context", async () => {
    const user = userEvent.setup();
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    let scanned = false;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/setup/status") {
        return new Response(JSON.stringify(scanned ? setupReadyResponse : contextStaleResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      if (url === "/context/scan") {
        scanned = true;
        return new Response(JSON.stringify(contextResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      return new Response(JSON.stringify({ detail: "Not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" }
      });
    });

    renderApp();

    expect(await screen.findByText("Database context needs a rescan")).toBeInTheDocument();
    expect(screen.getByText("Current database")).toBeInTheDocument();
    expect(screen.getByText("new_app on localhost:5432")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Rescan context" }));

    expect(await screen.findByText("What CSV do you need?")).toBeInTheDocument();
    expect(scanned).toBe(true);
  });

  it("does not silently rescan stale context after saving provider settings", async () => {
    const user = userEvent.setup();
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    let providerSaved = false;
    let bootstrapCalled = false;
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/setup/status") {
        return new Response(JSON.stringify(providerSaved ? contextStaleResponse : providerNeededResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      if (url === "/settings/model-provider" && init?.method === "PUT") {
        providerSaved = true;
        return new Response(JSON.stringify({ ...providerResponse, api_key_configured: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      if (url === "/settings/model-provider") {
        return new Response(JSON.stringify(providerResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      if (url === "/setup/bootstrap") {
        bootstrapCalled = true;
      }
      return new Response(JSON.stringify({ detail: "Not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" }
      });
    });

    renderApp();

    await user.type(await screen.findByLabelText("API key"), "sk-or-test");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Database context needs a rescan")).toBeInTheDocument();
    expect(bootstrapCalled).toBe(false);
  });
});
