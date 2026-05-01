// Temporary hand-maintained API types. Replace with OpenAPI-generated types once
// the backend endpoint shape settles.
export type ChatRole = "user" | "assistant" | "system";

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

export type CSVColumnIntent = {
  name: string;
  description: string;
  source_hint?: string | null;
};

export type CSVIntent = {
  summary: string;
  row_meaning: string;
  columns: CSVColumnIntent[];
  filters: string[];
  derived_fields: string[];
  assumptions: string[];
  max_row_count: number;
};

export type ExportSession = {
  id: string;
  status:
    | "drafting_intent"
    | "awaiting_approval"
    | "generating_sql"
    | "validating_sql"
    | "exporting"
    | "complete"
    | "failed";
  messages: ChatMessage[];
  approved_intent: CSVIntent | null;
  export_id: string | null;
  last_error: string | null;
};

export type ContextPolicy = {
  blocked_schemas: string[];
  blocked_tables: string[];
  blocked_columns: string[];
  blocked_functions: string[];
  max_row_count: number;
  max_export_bytes: number;
  statement_timeout_ms: number;
  lock_timeout_ms: number;
};

export type SchemaColumn = {
  name: string;
  data_type: string;
  is_nullable: boolean;
  ordinal_position: number;
  default?: string | null;
};

export type SchemaTable = {
  schema_name: string;
  table_name: string;
  table_type: string;
  columns: SchemaColumn[];
};

export type ContextDocument = {
  context: string;
  schema: {
    tables: SchemaTable[];
  };
  policy: ContextPolicy;
};

export type CSVIntentProposal = {
  message: string;
  intent: CSVIntent;
};

export type SQLValidationAttempt = {
  sql: string;
  valid: boolean;
  errors: string[];
  repair_changes: string[];
};

export type SQLPreparationResponse = {
  sql: string;
  valid: boolean;
  errors: string[];
  attempts: SQLValidationAttempt[];
};

export type ExportCreateResponse = {
  export_id: string;
  row_count: number;
  byte_count: number;
  columns: string[];
  download_url: string;
};
