import type { components } from "./api-types";

type Schema = components["schemas"];
type WithRequired<T, K extends keyof T> = T & Required<Pick<T, K>>;

export type ChatMessage = Schema["ChatMessage"];

export type CSVColumnIntent = Schema["CSVColumnIntent"];

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

export type ContextPolicy = WithRequired<
  Schema["ContextPolicy"],
  "blocked_schemas" | "blocked_tables" | "blocked_columns" | "blocked_functions"
>;

export type SchemaColumn = Schema["SchemaColumn"];

export type SchemaTable = Omit<WithRequired<Schema["SchemaTable"], "columns">, "columns"> & {
  columns: SchemaColumn[];
};

export type SchemaContext = Omit<WithRequired<Schema["SchemaContext"], "tables">, "tables"> & {
  tables: SchemaTable[];
};

export type ContextDocument = Omit<Schema["ContextDocument"], "policy" | "schema"> & {
  policy: ContextPolicy;
  schema: SchemaContext;
};

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
