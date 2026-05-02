import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUp,
  Check,
  ChevronDown,
  CircleCheck,
  Download,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Settings,
  Sparkles,
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
  const [providerModel, setProviderModel] = useState("openrouter/openai/gpt-4o-mini");
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

  const providerMutation = useMutation({
    mutationFn: () =>
      updateModelProviderSettings({
        provider: "openrouter",
        model: providerModel.trim(),
        api_key: providerApiKey.trim() || null,
        temperature: 0
      }),
    onSuccess: (settings) => {
      setProviderApiKey("");
      setProviderModel(settings.model);
      queryClient.setQueryData(["model-provider"], settings);
      void bootstrapMutation.mutateAsync().catch(showError);
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
    },
    onError: showError
  });

  const proposeMutation = useMutation({
    mutationFn: async () => {
      const session = await ensureSession();
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
      setNotice({ type: "info", text: "CSV plan approved. You can prepare the export now." });
    },
    onError: showError
  });

  const prepareMutation = useMutation({
    mutationFn: async () => {
      if (!sessionId) throw new Error("Start a session first.");
      return prepareSql(sessionId);
    },
    onSuccess: (response) => {
      setSqlPrep(response);
      setNotice(
        response.valid
          ? { type: "info", text: "CSV checks passed. Export is ready to run." }
          : {
              type: "error",
              text: "The CSV could not be prepared after repair attempts."
            }
      );
      void queryClient.invalidateQueries({ queryKey: ["session", sessionId] });
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
    setNotice({ type: "error", text: error.message });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!message.trim()) return;
    sendMutation.mutate();
  }

  const busy =
    bootstrapMutation.isPending ||
    startSessionMutation.isPending ||
    providerMutation.isPending ||
    sendMutation.isPending ||
    proposeMutation.isPending ||
    approveMutation.isPending ||
    prepareMutation.isPending ||
    exportMutation.isPending;

  const session = sessionQuery.data;
  const hasMessages = Boolean(session?.messages.length);
  const hasWorkflow = Boolean(proposal || session?.approved_intent || sqlPrep || exportResult || advancedOpen);
  const providerSettings = providerQuery.data;
  const setupStatus = setupQuery.data;

  useEffect(() => {
    if (setupStatus?.next_action === "setup_context" && !bootstrapMutation.isPending) {
      bootstrapMutation.mutate();
    }
  }, [setupStatus?.next_action]);

  useEffect(() => {
    if (providerSettings?.model) {
      setProviderModel(providerSettings.model);
    }
  }, [providerSettings?.model]);

  if (setupQuery.isLoading) {
    return <Shell status={null}>Checking setup...</Shell>;
  }

  if (!setupStatus?.ready) {
    return (
      <Shell status={setupStatus ?? null}>
        <SetupGate
          status={setupStatus ?? null}
          providerSettings={providerSettings}
          model={providerModel}
          apiKey={providerApiKey}
          busy={busy}
          error={notice?.type === "error" ? notice.text : null}
          onModelChange={setProviderModel}
          onApiKeyChange={setProviderApiKey}
          onSaveProvider={() => providerMutation.mutate()}
          onBootstrap={() => bootstrapMutation.mutate()}
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

        <WorkflowSteps
          hasPlan={Boolean(proposal || session?.approved_intent)}
          approved={Boolean(session?.approved_intent)}
          prepared={Boolean(sqlPrep?.valid)}
          exported={Boolean(exportResult)}
        />

        <section className="flex flex-col gap-4" aria-label="Messages">
          {notice ? <NoticeBanner notice={notice} /> : null}
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
            <span className="text-xs text-muted-foreground">Setup is ready.</span>
            {hasMessages ? (
              <Button variant="outline" size="sm" type="button" onClick={() => proposeMutation.mutate()} disabled={busy || !sessionId}>
                {proposeMutation.isPending ? <Loader2 data-icon="inline-start" className="animate-spin" aria-hidden="true" /> : <Sparkles data-icon="inline-start" aria-hidden="true" />}
                Propose CSV plan
              </Button>
            ) : null}
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
              canPrepare={Boolean(session?.approved_intent)}
              advancedOpen={advancedOpen}
              onApprove={(intent) => approveMutation.mutate(intent)}
              onPrepare={() => prepareMutation.mutate()}
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
  model,
  apiKey,
  busy,
  error,
  onModelChange,
  onApiKeyChange,
  onSaveProvider,
  onBootstrap
}: {
  status: SetupStatusResponse | null;
  providerSettings?: ModelProviderSettingsResponse;
  model: string;
  apiKey: string;
  busy: boolean;
  error: string | null;
  onModelChange: (value: string) => void;
  onApiKeyChange: (value: string) => void;
  onSaveProvider: () => void;
  onBootstrap: () => void;
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

      {action === "configure_model_provider" ? (
        <ProviderPanel
          settings={providerSettings}
          model={model}
          apiKey={apiKey}
          busy={busy}
          onModelChange={onModelChange}
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
  model,
  apiKey,
  busy,
  onModelChange,
  onApiKeyChange,
  onSave
}: {
  settings?: ModelProviderSettingsResponse;
  model: string;
  apiKey: string;
  busy: boolean;
  onModelChange: (value: string) => void;
  onApiKeyChange: (value: string) => void;
  onSave: () => void;
}) {
  return (
    <section className="flex flex-col gap-3 border-t pt-6" aria-label="Provider settings">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium">OpenRouter</h2>
          <p className="text-xs text-muted-foreground">
            {settings?.api_key_configured ? "API key saved locally on the backend." : "Add an API key before using model features."}
          </p>
        </div>
        <Badge variant="outline">default provider</Badge>
      </div>
      <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Model
          <input
            value={model}
            onChange={(event) => onModelChange(event.target.value)}
            className="h-8 rounded-md border bg-background px-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          API key
          <input
            value={apiKey}
            onChange={(event) => onApiKeyChange(event.target.value)}
            type="password"
            placeholder={settings?.api_key_configured ? "Leave blank to keep saved key" : "sk-or-..."}
            className="h-8 rounded-md border bg-background px-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
        <div className="flex items-end">
          <Button size="sm" onClick={onSave} disabled={busy || !model.trim() || (!apiKey.trim() && !settings?.api_key_configured)}>
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
  canPrepare,
  advancedOpen,
  onApprove,
  onPrepare,
  onExport,
  onAdvancedOpenChange
}: {
  proposal: CSVIntentProposal | null;
  approved: CSVIntent | null;
  sqlPrep: SQLPreparationResponse | null;
  exportResult: ExportCreateResponse | null;
  traces: SessionDebugTrace[];
  busy: boolean;
  canPrepare: boolean;
  advancedOpen: boolean;
  onApprove: (intent: CSVIntent) => void;
  onPrepare: () => void;
  onExport: () => void;
  onAdvancedOpenChange: (open: boolean) => void;
}) {
  return (
    <div className="flex flex-col gap-6">
      <PlanPanel proposal={proposal} approved={approved} busy={busy} onApprove={onApprove} />
      <ExportPanel canPrepare={canPrepare} sqlPrep={sqlPrep} exportResult={exportResult} busy={busy} onPrepare={onPrepare} onExport={onExport} />
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

function WorkflowSteps({ hasPlan, approved, prepared, exported }: { hasPlan: boolean; approved: boolean; prepared: boolean; exported: boolean }) {
  const steps = [
    { label: "Describe CSV", description: "Tell the app what you need", done: hasPlan || approved || prepared || exported },
    { label: "Approve plan", description: "Review the CSV plan", done: approved || prepared || exported },
    { label: "Export CSV", description: "Validate and download", done: prepared || exported }
  ];

  return (
    <ol className="grid gap-5 md:grid-cols-3">
      {steps.map((step, index) => (
        <li key={step.label} className="flex min-w-0 items-start gap-2.5">
          <span
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-full border text-sm font-medium",
              step.done ? "border-foreground bg-foreground text-background" : "border-border bg-muted text-muted-foreground"
            )}
          >
            {step.done ? <CircleCheck aria-hidden="true" /> : index + 1}
          </span>
          <span className="min-w-0">
            <span className="block text-sm leading-tight font-semibold">{step.label}</span>
            <span className="block text-xs leading-snug text-muted-foreground">{step.description}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

function PlanPanel({
  proposal,
  approved,
  busy,
  onApprove
}: {
  proposal: CSVIntentProposal | null;
  approved: CSVIntent | null;
  busy: boolean;
  onApprove: (intent: CSVIntent) => void;
}) {
  const intent = approved ?? proposal?.intent ?? null;
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium">CSV plan</h3>
        {approved ? <Badge variant="outline">approved</Badge> : null}
      </div>
      {intent ? (
        <div className="flex flex-col gap-3 text-sm">
          <div className="rounded-md border p-3">
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
            <Button size="sm" onClick={() => onApprove(intent)} disabled={busy}>
              <Check data-icon="inline-start" aria-hidden="true" />
              Approve plan
            </Button>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">After you send a message, ask the app to propose a CSV plan.</p>
      )}
    </section>
  );
}

function ExportPanel({
  canPrepare,
  sqlPrep,
  exportResult,
  busy,
  onPrepare,
  onExport
}: {
  canPrepare: boolean;
  sqlPrep: SQLPreparationResponse | null;
  exportResult: ExportCreateResponse | null;
  busy: boolean;
  onPrepare: () => void;
  onExport: () => void;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-sm font-medium">Export</h3>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={onPrepare} disabled={busy || !canPrepare}>
          <Terminal data-icon="inline-start" aria-hidden="true" />
          Prepare export
        </Button>
        <Button variant={sqlPrep?.valid ? "default" : "secondary"} onClick={onExport} disabled={busy || !sqlPrep?.valid}>
          <Play data-icon="inline-start" aria-hidden="true" />
          Run export
        </Button>
      </div>
      {exportResult ? (
        <a className={cn(buttonVariants({ variant: "secondary" }), "w-full")} href={exportResult.download_url}>
          <Download data-icon="inline-start" aria-hidden="true" />
          Download CSV ({exportResult.row_count} rows)
        </a>
      ) : null}
    </section>
  );
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
