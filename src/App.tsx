import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUp,
  Check,
  ChevronDown,
  Download,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Settings,
  Terminal
} from "lucide-react";
import { FormEvent, ReactNode, useEffect, useRef, useState } from "react";
import {
  addMessage,
  approveIntent,
  bootstrapSetup,
  createSession,
  createSessionExport,
  getModelProviderSettings,
  getSession,
  getSetupStatus,
  prepareSql,
  proposeIntent,
  rescanContext,
  updateModelProviderSettings
} from "./api";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type {
  CSVIntent,
  CSVIntentProposal,
  ExportCreateResponse,
  ExportSession,
  ModelProviderSettingsResponse,
  SessionDebugTrace,
  SetupStatusResponse,
  SQLPreparationResponse
} from "./types";

type Notice = { type: "error" | "info"; text: string } | null;

export function App() {
  const queryClient = useQueryClient();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [proposal, setProposal] = useState<CSVIntentProposal | null>(null);
  const [sqlPrep, setSqlPrep] = useState<SQLPreparationResponse | null>(null);
  const [exportResult, setExportResult] = useState<ExportCreateResponse | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [providerKind, setProviderKind] = useState<"openrouter" | "custom">("openrouter");
  const [providerModel, setProviderModel] = useState("openrouter/openai/gpt-4o-mini");
  const [providerBaseUrl, setProviderBaseUrl] = useState("");
  const [providerApiKey, setProviderApiKey] = useState("");
  const pendingSessionRef = useRef<Promise<ExportSession> | null>(null);

  const setupQuery = useQuery({
    queryKey: ["setup-status"],
    queryFn: getSetupStatus,
    refetchOnWindowFocus: false
  });

  const providerQuery = useQuery({
    queryKey: ["model-provider"],
    queryFn: getModelProviderSettings,
    enabled: setupQuery.data?.next_action === "configure_model_provider"
  });

  const sessionQuery = useQuery({
    queryKey: ["session", sessionId],
    queryFn: () => getSession(sessionId!),
    enabled: Boolean(sessionId)
  });

  const startSessionMutation = useMutation({
    mutationFn: createSession,
    onSuccess: (session) => {
      setSessionId(session.id);
      setProposal(null);
      setSqlPrep(null);
      setExportResult(null);
      setNotice({ type: "info", text: "New CSV session started." });
      queryClient.setQueryData(["session", session.id], session);
    },
    onError: showError
  });

  const bootstrapMutation = useMutation({
    mutationFn: bootstrapSetup,
    onSuccess: (status) => {
      queryClient.setQueryData(["setup-status"], status);
      setNotice(status.ready ? null : { type: "info", text: status.context.message ?? "Setup still needs attention." });
    },
    onError: showError
  });

  const rescanContextMutation = useMutation({
    mutationFn: rescanContext,
    onSuccess: () => {
      setNotice({ type: "info", text: "Database context was rescanned. Review local context notes before exporting." });
      void queryClient.invalidateQueries({ queryKey: ["setup-status"] });
    },
    onError: showError
  });

  const providerMutation = useMutation({
    mutationFn: () =>
      updateModelProviderSettings({
        provider: providerKind,
        model: providerModel.trim(),
        api_key: providerApiKey.trim() || null,
        base_url: providerKind === "custom" ? providerBaseUrl.trim() : null,
        temperature: 0
      }),
    onSuccess: (settings) => {
      setProviderApiKey("");
      setProviderKind(settings.provider === "custom" ? "custom" : "openrouter");
      setProviderModel(settings.model);
      setProviderBaseUrl(settings.base_url ?? "");
      queryClient.setQueryData(["model-provider"], settings);
      void queryClient.invalidateQueries({ queryKey: ["setup-status"] });
    },
    onError: showError
  });

  const sendMutation = useMutation({
    mutationFn: async () => {
      const session = await ensureSession();
      return addMessage(session.id, { role: "user", content: message.trim() });
    },
    onSuccess: (session) => {
      setSessionId(session.id);
      setMessage("");
      setProposal(null);
      setSqlPrep(null);
      setExportResult(null);
      queryClient.setQueryData(["session", session.id], session);
      proposeMutation.mutate(session.id);
    },
    onError: showError
  });

  const proposeMutation = useMutation({
    mutationFn: async (targetSessionId?: string) => {
      const session = targetSessionId ? await getSession(targetSessionId) : await ensureSession();
      return { sessionId: session.id, proposal: await proposeIntent(session.id) };
    },
    onSuccess: ({ sessionId: nextSessionId, proposal: nextProposal }) => {
      setSessionId(nextSessionId);
      setProposal(nextProposal);
      setSqlPrep(null);
      setExportResult(null);
      setNotice(null);
      void queryClient.invalidateQueries({ queryKey: ["session", nextSessionId] });
    },
    onError: showError
  });

  const approveMutation = useMutation({
    mutationFn: async (intent: CSVIntent) => {
      if (!sessionId) throw new Error("Start a session first.");
      return approveIntent(sessionId, intent);
    },
    onSuccess: (session) => {
      queryClient.setQueryData(["session", session.id], session);
      setSqlPrep(null);
      setExportResult(null);
      setNotice(null);
      prepareMutation.mutate(session.id);
    },
    onError: showError
  });

  const prepareMutation = useMutation({
    mutationFn: async (targetSessionId?: string) => {
      const activeSessionId = targetSessionId ?? sessionId;
      if (!activeSessionId) throw new Error("Start a session first.");
      return { sessionId: activeSessionId, response: await prepareSql(activeSessionId) };
    },
    onSuccess: ({ sessionId: preparedSessionId, response }) => {
      setSqlPrep(response);
      setNotice(
        response.valid
          ? null
          : {
              type: "error",
              text: "The CSV could not be prepared after repair attempts."
            }
      );
      void queryClient.invalidateQueries({ queryKey: ["session", preparedSessionId] });
    },
    onError: showError
  });

  const exportMutation = useMutation({
    mutationFn: async () => {
      if (!sessionId) throw new Error("Start a session first.");
      if (!sqlPrep?.valid) throw new Error("Prepare the export before running it.");
      return createSessionExport(sessionId, sqlPrep.sql);
    },
    onSuccess: (response) => {
      setExportResult(response);
      setNotice({ type: "info", text: "CSV export is ready." });
      void queryClient.invalidateQueries({ queryKey: ["session", sessionId] });
    },
    onError: showError
  });

  async function ensureSession() {
    if (sessionId) return getSession(sessionId);
    if (!pendingSessionRef.current) {
      pendingSessionRef.current = createSession().finally(() => {
        pendingSessionRef.current = null;
      });
    }
    const session = await pendingSessionRef.current;
    setSessionId(session.id);
    queryClient.setQueryData(["session", session.id], session);
    return session;
  }

  function showError(error: Error) {
    setNotice({ type: "error", text: friendlyErrorMessage(error.message) });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!message.trim()) return;
    sendMutation.mutate();
  }

  const busy =
    bootstrapMutation.isPending ||
    rescanContextMutation.isPending ||
    startSessionMutation.isPending ||
    providerMutation.isPending ||
    sendMutation.isPending ||
    proposeMutation.isPending ||
    approveMutation.isPending ||
    prepareMutation.isPending ||
    exportMutation.isPending;

  const session = sessionQuery.data;
  const hasWorkflow = Boolean(
    proposal ||
      session?.approved_intent ||
      sqlPrep ||
      exportResult ||
      session?.debug_traces.length ||
      advancedOpen ||
      proposeMutation.isPending ||
      prepareMutation.isPending
  );
  const providerSettings = providerQuery.data;
  const setupStatus = setupQuery.data;
  const workflowNotice = notice ?? (session?.last_error ? { type: "error" as const, text: session.last_error } : null);

  useEffect(() => {
    if (setupStatus?.next_action === "setup_context" && !bootstrapMutation.isPending) {
      bootstrapMutation.mutate();
    }
  }, [setupStatus?.next_action]);

  useEffect(() => {
    if (providerSettings?.model) {
      setProviderKind(providerSettings.provider === "custom" ? "custom" : "openrouter");
      setProviderModel(providerSettings.model);
      setProviderBaseUrl(providerSettings.base_url ?? "");
    }
  }, [providerSettings?.provider, providerSettings?.model, providerSettings?.base_url]);

  if (setupQuery.isLoading) {
    return <Shell status={null}>Checking setup...</Shell>;
  }

  if (!setupStatus?.ready) {
    return (
      <Shell status={setupStatus ?? null}>
        <SetupGate
          status={setupStatus ?? null}
          providerSettings={providerSettings}
          provider={providerKind}
          model={providerModel}
          baseUrl={providerBaseUrl}
          apiKey={providerApiKey}
          busy={busy}
          error={notice?.type === "error" ? notice.text : null}
          onProviderChange={setProviderKind}
          onModelChange={setProviderModel}
          onBaseUrlChange={setProviderBaseUrl}
          onApiKeyChange={setProviderApiKey}
          onSaveProvider={() => providerMutation.mutate()}
          onBootstrap={() => bootstrapMutation.mutate()}
          onRescanContext={() => rescanContextMutation.mutate()}
        />
      </Shell>
    );
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-5 py-10 text-foreground">
      <div className="flex w-full max-w-[744px] flex-col gap-8">
        <header className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="truncate font-heading text-sm leading-snug font-semibold">CSV Chat</h1>
            <p className="truncate text-xs text-muted-foreground">
              {session ? `Session ${session.id.slice(0, 8)}` : "Validated database exports"}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <ReadinessStatus status={setupStatus} />
            <Status value={session?.status ?? "not_started"} />
            {session ? (
              <Button size="icon-sm" variant="ghost" onClick={() => startSessionMutation.mutate()} disabled={busy} aria-label="New session">
                <Plus aria-hidden="true" />
              </Button>
            ) : null}
          </div>
        </header>

        <section className="flex flex-col gap-4" aria-label="Messages">
          {workflowNotice ? <NoticeBanner notice={workflowNotice} /> : null}
          {session?.messages.length ? (
            <div className="flex max-h-[28svh] flex-col gap-3 overflow-auto pr-1">
              {session.messages.map((item, index) => (
                <MessageEvent key={`${item.role}-${index}`} role={item.role} content={item.content} />
              ))}
            </div>
          ) : (
            <EmptyChat />
          )}
        </section>

        <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
          <div className="rounded-md border bg-card p-1.5">
            <div className="flex items-center gap-2">
              <Textarea
                id="csv-request"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    if (message.trim()) sendMutation.mutate();
                  }
                }}
                placeholder="Export customer emails for active accounts created this quarter."
                className="max-h-28 min-h-9 resize-none border-0 bg-transparent px-3 py-2 text-sm shadow-none focus-visible:ring-0"
              />
              <Button size="icon-sm" type="submit" disabled={busy || !message.trim()} aria-label="Send">
                {sendMutation.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <ArrowUp aria-hidden="true" />}
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap justify-between gap-2">
            <span className="text-xs text-muted-foreground">{contextStatusText(setupStatus)}</span>
          </div>
        </form>

        {hasWorkflow ? (
          <section className="flex flex-col gap-6 border-t pt-6" aria-label="CSV workflow">
            <WorkflowPanel
              proposal={proposal}
              approved={session?.approved_intent ?? null}
              sqlPrep={sqlPrep}
              exportResult={exportResult}
              traces={session?.debug_traces ?? []}
              busy={busy}
              planning={proposeMutation.isPending}
              preparing={prepareMutation.isPending}
              advancedOpen={advancedOpen}
              onApprove={(intent) => approveMutation.mutate(intent)}
              onExport={() => exportMutation.mutate()}
              onAdvancedOpenChange={setAdvancedOpen}
            />
          </section>
        ) : null}
      </div>
    </main>
  );
}

function EmptyChat() {
  return (
    <div className="flex max-w-lg flex-col gap-1">
      <h2 className="font-heading text-base font-semibold">What CSV do you need?</h2>
      <p className="text-sm text-muted-foreground">
        Describe the export in plain language. You will approve the CSV plan before anything runs.
      </p>
    </div>
  );
}

function Shell({ status, children }: { status: SetupStatusResponse | null; children: ReactNode }) {
  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-5 py-10 text-foreground">
      <div className="flex w-full max-w-[744px] flex-col gap-8">
        <header className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="truncate font-heading text-sm leading-snug font-semibold">CSV Chat</h1>
            <p className="truncate text-xs text-muted-foreground">
              {status?.ready ? "Validated database exports" : "Setup check"}
            </p>
          </div>
          <ReadinessStatus status={status} />
        </header>
        {typeof children === "string" ? <p className="text-sm text-muted-foreground">{children}</p> : children}
      </div>
    </main>
  );
}

function SetupGate({
  status,
  providerSettings,
  provider,
  model,
  baseUrl,
  apiKey,
  busy,
  error,
  onProviderChange,
  onModelChange,
  onBaseUrlChange,
  onApiKeyChange,
  onSaveProvider,
  onBootstrap,
  onRescanContext
}: {
  status: SetupStatusResponse | null;
  providerSettings?: ModelProviderSettingsResponse;
  provider: "openrouter" | "custom";
  model: string;
  baseUrl: string;
  apiKey: string;
  busy: boolean;
  error: string | null;
  onProviderChange: (value: "openrouter" | "custom") => void;
  onModelChange: (value: string) => void;
  onBaseUrlChange: (value: string) => void;
  onApiKeyChange: (value: string) => void;
  onSaveProvider: () => void;
  onBootstrap: () => void;
  onRescanContext: () => void;
}) {
  const action = status?.next_action;
  return (
    <section className="flex flex-col gap-5" aria-label="Setup needed">
      <div className="flex items-start gap-3 rounded-md border bg-card p-4">
        <Settings className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0">
          <h2 className="text-sm font-medium">Setup needed</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            CSV Chat will open directly to the chat once the database, model provider, and generated context are ready.
          </p>
        </div>
      </div>

      {error ? <NoticeBanner notice={{ type: "error", text: error }} /> : null}

      {action === "configure_database" ? (
        <div className="rounded-md border p-4 text-sm">
          <h3 className="font-medium">Database connection missing</h3>
          <p className="mt-1 text-muted-foreground">
            Add the local database connection to `.env`, then restart or refresh the backend.
          </p>
          <pre className="mt-3 overflow-auto rounded-md bg-muted p-3 text-xs text-foreground">
            DATABASE_URL=postgresql://readonly:password@localhost:5432/appdb
          </pre>
        </div>
      ) : null}

      {action === "connect_database" ? (
        <div className="rounded-md border p-4 text-sm">
          <h3 className="font-medium">Database connection failed</h3>
          <p className="mt-1 text-muted-foreground">
            {status?.database.message ?? "The configured database could not be reached."}
          </p>
          <p className="mt-3 text-muted-foreground">
            Start Postgres, or update `.env` so `DATABASE_URL` points to a reachable read-only database.
          </p>
          <ContextSourceDetails status={status} />
        </div>
      ) : null}

      {action === "configure_model_provider" ? (
        <ProviderPanel
          settings={providerSettings}
          provider={provider}
          model={model}
          baseUrl={baseUrl}
          apiKey={apiKey}
          busy={busy}
          onProviderChange={onProviderChange}
          onModelChange={onModelChange}
          onBaseUrlChange={onBaseUrlChange}
          onApiKeyChange={onApiKeyChange}
          onSave={onSaveProvider}
        />
      ) : null}

      {action === "setup_context" ? (
        <div className="flex flex-col gap-3 rounded-md border p-4 text-sm">
          <div>
            <h3 className="font-medium">Preparing database context</h3>
            <p className="mt-1 text-muted-foreground">
              The app needs to scan the database once before chat exports are available.
            </p>
          </div>
          <Button className="w-fit" onClick={onBootstrap} disabled={busy}>
            {busy ? <Loader2 data-icon="inline-start" className="animate-spin" aria-hidden="true" /> : <RefreshCw data-icon="inline-start" aria-hidden="true" />}
            Prepare app
          </Button>
        </div>
      ) : null}

      {action === "rescan_context" ? (
        <div className="flex flex-col gap-3 rounded-md border p-4 text-sm">
          <div>
            <h3 className="font-medium">Database context needs a rescan</h3>
            <p className="mt-1 text-muted-foreground">
              {status?.context.message ?? "The saved context does not match the configured database."}
            </p>
          </div>
          <ContextSourceDetails status={status} />
          <Button className="w-fit" onClick={onRescanContext} disabled={busy}>
            {busy ? <Loader2 data-icon="inline-start" className="animate-spin" aria-hidden="true" /> : <RefreshCw data-icon="inline-start" aria-hidden="true" />}
            Rescan context
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function Line({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex justify-between gap-3">
      <dt>{label}</dt>
      <dd className="font-medium text-foreground">{value}</dd>
    </div>
  );
}

function ContextSourceDetails({ status }: { status: SetupStatusResponse | null }) {
  if (!status?.current_database && !status?.context_source) return null;
  return (
    <dl className="grid gap-2 rounded-md bg-muted p-3 text-xs text-muted-foreground">
      {status.current_database ? <Line label="Current database" value={databaseSourceLabel(status.current_database)} /> : null}
      {status.context_source ? <Line label="Context scanned from" value={databaseSourceLabel(status.context_source)} /> : null}
      {status.context_source?.scanned_at ? <Line label="Last scanned" value={formatDateTime(status.context_source.scanned_at)} /> : null}
    </dl>
  );
}

function contextStatusText(status: SetupStatusResponse | undefined) {
  if (!status?.context_source) return "Setup is ready.";
  return `Context: ${databaseSourceLabel(status.context_source)}; scanned ${formatDateTime(status.context_source.scanned_at)}.`;
}

function databaseSourceLabel(source: NonNullable<SetupStatusResponse["context_source"]>) {
  const database = source.database || "default database";
  let host = source.host || "default host";
  if (source.port) host = `${host}:${source.port}`;
  return `${database} on ${host}`;
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function Status({ value }: { value: string }) {
  const labels: Record<string, string> = {
    not_started: "not started",
    drafting_intent: "drafting plan",
    awaiting_approval: "needs approval",
    generating_sql: "preparing export",
    validating_sql: "checking export",
    exporting: "exporting",
    complete: "complete",
    failed: "failed"
  };
  return <Badge variant="secondary">{labels[value] ?? value.split("_").join(" ")}</Badge>;
}

function ReadinessStatus({ status }: { status: SetupStatusResponse | null }) {
  if (!status) return <Badge variant="secondary">checking</Badge>;
  return <Badge variant={status.ready ? "outline" : "secondary"}>{status.ready ? "ready" : "setup needed"}</Badge>;
}

function ProviderPanel({
  settings,
  provider,
  model,
  baseUrl,
  apiKey,
  busy,
  onProviderChange,
  onModelChange,
  onBaseUrlChange,
  onApiKeyChange,
  onSave
}: {
  settings?: ModelProviderSettingsResponse;
  provider: "openrouter" | "custom";
  model: string;
  baseUrl: string;
  apiKey: string;
  busy: boolean;
  onProviderChange: (value: "openrouter" | "custom") => void;
  onModelChange: (value: string) => void;
  onBaseUrlChange: (value: string) => void;
  onApiKeyChange: (value: string) => void;
  onSave: () => void;
}) {
  const customProvider = provider === "custom";
  const baseUrlValue = customProvider ? baseUrl.trim() : null;
  const canKeepSavedKey =
    Boolean(settings?.api_key_configured) &&
    settings?.provider === provider &&
    (settings.base_url ?? null) === baseUrlValue;
  return (
    <section className="flex flex-col gap-3 border-t pt-6" aria-label="Provider settings">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium">Model provider</h2>
          <p className="text-xs text-muted-foreground">
            {settings?.api_key_configured ? "API key saved locally on the backend." : "Add provider details before using model features."}
          </p>
        </div>
        <Badge variant="outline">{customProvider ? "OpenAI-compatible" : "OpenRouter"}</Badge>
      </div>
      <div className="grid gap-3 md:grid-cols-[0.75fr_1fr_1fr_auto]">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Provider
          <select
            value={provider}
            onChange={(event) => onProviderChange(event.target.value === "custom" ? "custom" : "openrouter")}
            className="h-8 rounded-md border bg-background px-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="openrouter">OpenRouter</option>
            <option value="custom">Custom</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Model
          <input
            value={model}
            onChange={(event) => onModelChange(event.target.value)}
            className="h-8 rounded-md border bg-background px-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
        {customProvider ? (
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Base URL
            <input
              value={baseUrl}
              onChange={(event) => onBaseUrlChange(event.target.value)}
              placeholder="http://127.0.0.1:4010/v1"
              className="h-8 rounded-md border bg-background px-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
        ) : null}
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          API key
          <input
            value={apiKey}
            onChange={(event) => onApiKeyChange(event.target.value)}
            type="password"
            placeholder={canKeepSavedKey ? "Leave blank to keep saved key" : "API key"}
            className="h-8 rounded-md border bg-background px-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
        <div className="flex items-end">
          <Button
            size="sm"
            onClick={onSave}
            disabled={busy || !model.trim() || (customProvider && !baseUrl.trim()) || (!apiKey.trim() && !canKeepSavedKey)}
          >
            {busy ? <Loader2 data-icon="inline-start" className="animate-spin" aria-hidden="true" /> : <Check data-icon="inline-start" aria-hidden="true" />}
            Save
          </Button>
        </div>
      </div>
    </section>
  );
}

function NoticeBanner({ notice }: { notice: Exclude<Notice, null> }) {
  return (
    <Alert variant={notice.type === "error" ? "destructive" : "default"} className="mb-4">
      <AlertDescription>{notice.text}</AlertDescription>
    </Alert>
  );
}

function friendlyErrorMessage(message: string) {
  const normalized = message.toLowerCase();
  if (["rate limit", "ratelimit", "quota", "insufficient credits", "429"].some((token) => normalized.includes(token))) {
    return (
      "Model provider could not respond because the provider reported a quota, credit, or rate-limit problem. " +
      "Check your provider account or switch to a provider/model with available usage, then try again."
    );
  }
  if (normalized.includes("invalid json") || normalized.includes("did not match schema")) {
    return "Model provider returned a response the app could not use. Try again, or switch to a different provider/model if it keeps happening.";
  }
  return message;
}

function MessageEvent({ role, content }: { role: string; content: string }) {
  const own = role === "user";
  return (
    <article className={cn("flex flex-col gap-1", own ? "items-end" : "items-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-md border px-3 py-2 text-sm",
          own ? "bg-primary text-primary-foreground" : "bg-card text-card-foreground"
        )}
      >
        <p className="whitespace-pre-wrap">{content}</p>
      </div>
      <div className="px-1 text-xs text-muted-foreground">{own ? "You" : "CSV Chat"}</div>
    </article>
  );
}

function WorkflowPanel({
  proposal,
  approved,
  sqlPrep,
  exportResult,
  traces,
  busy,
  planning,
  preparing,
  advancedOpen,
  onApprove,
  onExport,
  onAdvancedOpenChange
}: {
  proposal: CSVIntentProposal | null;
  approved: CSVIntent | null;
  sqlPrep: SQLPreparationResponse | null;
  exportResult: ExportCreateResponse | null;
  traces: SessionDebugTrace[];
  busy: boolean;
  planning: boolean;
  preparing: boolean;
  advancedOpen: boolean;
  onApprove: (intent: CSVIntent) => void;
  onExport: () => void;
  onAdvancedOpenChange: (open: boolean) => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      <AssistantWorkPanel
        proposal={proposal}
        approved={approved}
        sqlPrep={sqlPrep}
        exportResult={exportResult}
        busy={busy}
        planning={planning}
        preparing={preparing}
        onApprove={onApprove}
        onExport={onExport}
      />
      <Collapsible open={advancedOpen} onOpenChange={onAdvancedOpenChange} className="flex flex-col gap-3">
        <CollapsibleTrigger
          render={
            <Button variant="ghost" className="w-fit px-0">
              <Terminal data-icon="inline-start" aria-hidden="true" />
              Advanced
              <ChevronDown data-icon="inline-end" aria-hidden="true" />
            </Button>
          }
        />
        <CollapsibleContent>
          <Advanced sqlPrep={sqlPrep} traces={traces} />
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

function AssistantWorkPanel({
  proposal,
  approved,
  sqlPrep,
  exportResult,
  busy,
  planning,
  preparing,
  onApprove,
  onExport
}: {
  proposal: CSVIntentProposal | null;
  approved: CSVIntent | null;
  sqlPrep: SQLPreparationResponse | null;
  exportResult: ExportCreateResponse | null;
  busy: boolean;
  planning: boolean;
  preparing: boolean;
  onApprove: (intent: CSVIntent) => void;
  onExport: () => void;
}) {
  const intent = approved ?? proposal?.intent ?? null;
  const needsClarification = proposal && !proposal.intent;
  return (
    <section className="flex flex-col gap-4 rounded-md border bg-card p-4 text-sm" aria-label="CSV progress">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium">CSV Chat</h2>
          <p className="text-xs text-muted-foreground">{progressText({ approved, sqlPrep, exportResult, planning, preparing })}</p>
        </div>
        {approved ? <Badge variant="outline">plan approved</Badge> : null}
      </div>

      {planning ? <InlineProgress text="Working out the CSV plan..." /> : null}

      {needsClarification ? (
        <div className="flex flex-col gap-2">
          <p>{proposal.message}</p>
          {proposal.questions?.length ? (
            <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
              {proposal.questions.map((question) => (
                <li key={question}>{question}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {intent ? (
        <div className="flex flex-col gap-3">
          <div>
            <p className="text-xs font-medium text-muted-foreground">{approved ? "Approved CSV plan" : "I can create this CSV"}</p>
            <p className="font-medium">{intent.summary}</p>
            <p className="mt-1 text-muted-foreground">{intent.row_meaning}</p>
          </div>
          <div>
            <div className="mb-2 text-xs font-medium text-muted-foreground">Fields</div>
            <ul className="flex flex-col gap-2">
              {intent.columns.map((column) => (
                <li key={column.name} className="rounded-md border p-2">
                  <div className="font-medium">{column.name}</div>
                  <div className="text-muted-foreground">{column.description}</div>
                </li>
              ))}
            </ul>
          </div>
          <Line label="Max rows" value={intent.max_row_count} />
          {!approved ? (
            <Button className="w-fit" onClick={() => onApprove(intent)} disabled={busy}>
              <Check data-icon="inline-start" aria-hidden="true" />
              Approve CSV plan
            </Button>
          ) : null}
        </div>
      ) : null}

      {preparing ? <InlineProgress text="Checking that the CSV can be created safely..." /> : null}

      {sqlPrep && !sqlPrep.valid ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-destructive">
          The CSV could not be prepared. Open Advanced for validation details.
        </div>
      ) : null}

      {sqlPrep?.valid && !exportResult ? (
        <div className="flex flex-col gap-2 rounded-md border p-3">
          <p className="font-medium">The CSV is ready to create.</p>
          <p className="text-muted-foreground">The app checked it and will run the export with read-only limits.</p>
          <Button className="w-fit" onClick={onExport} disabled={busy}>
            <Play data-icon="inline-start" aria-hidden="true" />
            Create CSV
          </Button>
        </div>
      ) : null}

      {exportResult ? (
        <a className={cn(buttonVariants({ variant: "secondary" }), "w-full")} href={exportResult.download_url}>
          <Download data-icon="inline-start" aria-hidden="true" />
          Download CSV ({exportResult.row_count} rows)
        </a>
      ) : null}
    </section>
  );
}

function InlineProgress({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 text-muted-foreground">
      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      <span>{text}</span>
    </div>
  );
}

function progressText({
  approved,
  sqlPrep,
  exportResult,
  planning,
  preparing
}: {
  approved: CSVIntent | null;
  sqlPrep: SQLPreparationResponse | null;
  exportResult: ExportCreateResponse | null;
  planning: boolean;
  preparing: boolean;
}) {
  if (exportResult) return "CSV ready";
  if (sqlPrep?.valid) return "Ready to create";
  if (preparing) return "Checking safely";
  if (approved) return "Plan approved";
  if (planning) return "Planning";
  return "Review the next step";
}

function Advanced({ sqlPrep, traces }: { sqlPrep: SQLPreparationResponse | null; traces: SessionDebugTrace[] }) {
  if (!sqlPrep && !traces.length) {
    return <div className="rounded-md border p-3 text-sm text-muted-foreground">No debug details yet.</div>;
  }
  return (
    <div className="flex flex-col gap-3 text-sm">
      {sqlPrep ? (
        <>
          <pre className="max-h-52 overflow-auto rounded-md bg-muted p-3 text-foreground">{sqlPrep.sql}</pre>
          <div className="flex flex-col gap-2">
            {sqlPrep.attempts.map((attempt, index) => (
              <div key={`${attempt.sql}-${index}`} className="rounded-md border p-2">
                <div className="font-medium">
                  Attempt {index + 1}: {attempt.valid ? "valid" : "invalid"}
                </div>
                {attempt.errors.length ? <div className="mt-1 text-destructive">{attempt.errors.join("; ")}</div> : null}
                {attempt.repair_changes.length ? <div className="mt-1 text-muted-foreground">{attempt.repair_changes.join("; ")}</div> : null}
              </div>
            ))}
          </div>
        </>
      ) : null}
      {traces.length ? (
        <div className="flex flex-col gap-2">
          <div className="text-xs font-medium text-muted-foreground">Debug trace</div>
          {traces.map((trace, index) => (
            <details key={`${trace.step}-${index}`} className="rounded-md border p-2">
              <summary className="cursor-pointer font-medium">
                {index + 1}. {trace.step}: {trace.summary}
              </summary>
              <pre className="mt-2 max-h-52 overflow-auto rounded-md bg-muted p-2 text-xs text-foreground">
                {JSON.stringify(trace.details, null, 2)}
              </pre>
            </details>
          ))}
        </div>
      ) : null}
    </div>
  );
}
