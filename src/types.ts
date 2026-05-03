import type { components } from "./api-types";

type Schema = components["schemas"];
type WithRequired<T, K extends keyof T> = T & Required<Pick<T, K>>;

export type ChatMessage = Schema["ChatMessage"];

export type CSVIntent = WithRequired<
  Schema["CSVIntent"],
  "filters" | "derived_fields" | "assumptions"
>;

export type ExportSession = Omit<
  WithRequired<Schema["ExportSession"], "approved_intent" | "debug_traces" | "export_id" | "last_error" | "messages">,
  "approved_intent" | "messages"
> & {
  approved_intent: CSVIntent | null;
  messages: ChatMessage[];
};

export type SessionDebugTrace = Schema["SessionDebugTrace"];

export type CSVIntentProposal = Omit<Schema["CSVIntentProposal"], "intent"> & {
  intent: CSVIntent | null;
};

export type SQLValidationAttempt = WithRequired<
  Schema["SQLValidationAttempt"],
  "errors" | "repair_changes"
>;

export type SQLPreparationResponse = Omit<
  WithRequired<Schema["SQLPreparationResponse"], "attempts" | "errors">,
  "attempts"
> & {
  attempts: SQLValidationAttempt[];
};

export type ExportCreateResponse = Schema["ExportCreateResponse"];

export type ModelProviderSettingsResponse = Schema["ModelProviderSettingsResponse"];

export type ModelProviderSettingsUpdate = Schema["ModelProviderSettingsUpdate"];

export type DatabaseConnectionTestResponse = Schema["DatabaseConnectionTestResponse"];

export type SetupStatusResponse = Schema["SetupStatusResponse"];
