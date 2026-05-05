import type {
  CSVIntent,
  CSVIntentProposal,
  ChatMessage,
  ExportCreateResponse,
  ExportSession,
  ContextDocument,
  ContextUpdate,
  DatabaseConnectionTestResponse,
  ModelProviderSettingsResponse,
  ModelProviderSettingsUpdate,
  SavedCSVPlan,
  SavedCSVPlanCreateRequest,
  SavedCSVPlanUpdateRequest,
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

  if (response.status === 204) return undefined as T;
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

export async function rescanContext(): Promise<void> {
  await request<unknown>("/context/scan", { method: "POST" });
}

export function getContext(): Promise<ContextDocument> {
  return request<ContextDocument>("/context");
}

export function updateContext(update: ContextUpdate): Promise<ContextDocument> {
  return request<ContextDocument>("/context", {
    method: "PUT",
    body: JSON.stringify(update)
  });
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

export async function listSavedCSVPlans(): Promise<SavedCSVPlan[]> {
  const response = await request<{ plans: SavedCSVPlan[] }>("/saved-csv-plans");
  return response.plans;
}

export function createSavedCSVPlan(requestBody: SavedCSVPlanCreateRequest): Promise<SavedCSVPlan> {
  return request<SavedCSVPlan>("/saved-csv-plans", {
    method: "POST",
    body: JSON.stringify(requestBody)
  });
}

export function updateSavedCSVPlan(planId: string, requestBody: SavedCSVPlanUpdateRequest): Promise<SavedCSVPlan> {
  return request<SavedCSVPlan>(`/saved-csv-plans/${planId}`, {
    method: "PUT",
    body: JSON.stringify(requestBody)
  });
}

export function runSavedCSVPlan(planId: string): Promise<ExportCreateResponse> {
  return request<ExportCreateResponse>(`/saved-csv-plans/${planId}/run`, {
    method: "POST"
  });
}

export async function deleteSavedCSVPlan(planId: string): Promise<void> {
  await request<unknown>(`/saved-csv-plans/${planId}`, {
    method: "DELETE"
  });
}
