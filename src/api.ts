import type {
  CSVIntent,
  CSVIntentProposal,
  ChatMessage,
  ExportCreateResponse,
  ExportSession,
  DatabaseConnectionTestResponse,
  ModelProviderSettingsResponse,
  ModelProviderSettingsUpdate,
  ContextDocument,
  SetupStatusResponse,
  SQLPreparationResponse
} from "./types";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...init?.headers
    },
    ...init
  });

  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const body = (await response.json()) as { detail?: string };
      if (body.detail) message = body.detail;
    } catch {
      // Keep the HTTP status message when the backend returns non-JSON.
    }
    throw new Error(message);
  }

  return (await response.json()) as T;
}

export function getModelProviderSettings(): Promise<ModelProviderSettingsResponse> {
  return request<ModelProviderSettingsResponse>("/settings/model-provider");
}

export function updateModelProviderSettings(
  settings: ModelProviderSettingsUpdate
): Promise<ModelProviderSettingsResponse> {
  return request<ModelProviderSettingsResponse>("/settings/model-provider", {
    method: "PUT",
    body: JSON.stringify(settings)
  });
}

export function getSetupStatus(): Promise<SetupStatusResponse> {
  return request<SetupStatusResponse>("/setup/status");
}

export function bootstrapSetup(): Promise<SetupStatusResponse> {
  return request<SetupStatusResponse>("/setup/bootstrap", { method: "POST" });
}

export function rescanContext(): Promise<ContextDocument> {
  return request<ContextDocument>("/context/scan", { method: "POST" });
}

export function testDatabaseConnection(): Promise<DatabaseConnectionTestResponse> {
  return request<DatabaseConnectionTestResponse>("/settings/database/test", { method: "POST" });
}

export async function createSession(): Promise<ExportSession> {
  const response = await request<{ session: ExportSession }>("/sessions", { method: "POST" });
  return response.session;
}

export function getSession(sessionId: string): Promise<ExportSession> {
  return request<ExportSession>(`/sessions/${sessionId}`);
}

export function addMessage(sessionId: string, message: ChatMessage): Promise<ExportSession> {
  return request<ExportSession>(`/sessions/${sessionId}/messages`, {
    method: "POST",
    body: JSON.stringify({ message })
  });
}

export function proposeIntent(sessionId: string): Promise<CSVIntentProposal> {
  return request<CSVIntentProposal>(`/sessions/${sessionId}/propose-intent`, {
    method: "POST"
  });
}

export function approveIntent(sessionId: string, intent: CSVIntent): Promise<ExportSession> {
  return request<ExportSession>(`/sessions/${sessionId}/approve-intent`, {
    method: "POST",
    body: JSON.stringify({ intent })
  });
}

export function prepareSql(sessionId: string): Promise<SQLPreparationResponse> {
  return request<SQLPreparationResponse>(`/sessions/${sessionId}/prepare-sql`, {
    method: "POST"
  });
}

export function createSessionExport(sessionId: string, sql: string): Promise<ExportCreateResponse> {
  return request<ExportCreateResponse>(`/sessions/${sessionId}/export`, {
    method: "POST",
    body: JSON.stringify({ sql })
  });
}
