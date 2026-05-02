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
    renderApp();

    await user.type(await screen.findByPlaceholderText("Export customer emails for active accounts created this quarter."), "Export customer emails");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await user.click(await screen.findByRole("button", { name: "Prepare export" }));

    expect(await screen.findByText("CSV checks passed. Export is ready to run.")).toBeInTheDocument();
    expect(screen.queryByText("select email from customers limit 10")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Advanced/i }));

    expect(screen.getByText("select email from customers limit 10")).toBeInTheDocument();
    expect(screen.getByText(/validate_sql: SQL validation attempt 1 passed./)).toBeInTheDocument();
  });

  it("saves OpenRouter provider settings", async () => {
    const user = userEvent.setup();
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/setup/status") {
        return new Response(JSON.stringify(providerNeededResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      if (url === "/settings/model-provider" && init?.method === "PUT") {
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
      if (url === "/setup/bootstrap") {
        return new Response(JSON.stringify(setupReadyResponse), {
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
  });
});
