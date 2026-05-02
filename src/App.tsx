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
  Sparkles,
  Terminal
} from "lucide-react";
import { FormEvent, useRef, useState } from "react";
import {
  addMessage,
  approveIntent,
  createSession,
  createSessionExport,
  getSession,
  prepareSql,
  proposeIntent,
  scanContext
} from "./api";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { CSVIntent, CSVIntentProposal, ExportCreateResponse, ExportSession, SQLPreparationResponse } from "./types";

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
  const pendingSessionRef = useRef<Promise<ExportSession> | null>(null);

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

  const scanMutation = useMutation({
    mutationFn: scanContext,
    onSuccess: (context) => {
      queryClient.setQueryData(["context"], context);
      setNotice({ type: "info", text: "Database context refreshed." });
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
      return proposeIntent(session.id);
    },
    onSuccess: (nextProposal) => {
      setProposal(nextProposal);
      setNotice(null);
      void queryClient.invalidateQueries({ queryKey: ["session", sessionId] });
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
      setNotice({ type: "info", text: "CSV plan approved. SQL can now be prepared." });
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
          ? { type: "info", text: "Export query validated. Export is ready to run." }
          : {
              type: "error",
              text: "The export query could not be validated after repair attempts."
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
    startSessionMutation.isPending ||
    scanMutation.isPending ||
    sendMutation.isPending ||
    proposeMutation.isPending ||
    approveMutation.isPending ||
    prepareMutation.isPending ||
    exportMutation.isPending;

  const session = sessionQuery.data;
  const hasMessages = Boolean(session?.messages.length);
  const hasWorkflow = Boolean(proposal || session?.approved_intent || sqlPrep || exportResult || advancedOpen);

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
            <Button variant="outline" size="sm" type="button" onClick={() => scanMutation.mutate()} disabled={busy}>
              {scanMutation.isPending ? <Loader2 data-icon="inline-start" className="animate-spin" aria-hidden="true" /> : <RefreshCw data-icon="inline-start" aria-hidden="true" />}
              Scan database
            </Button>
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

function Line({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex justify-between gap-3">
      <dt>{label}</dt>
      <dd className="font-medium text-foreground">{value}</dd>
    </div>
  );
}

function Status({ value }: { value: string }) {
  return <Badge variant="secondary">{value.split("_").join(" ")}</Badge>;
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
          <Advanced sqlPrep={sqlPrep} />
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

function Advanced({ sqlPrep }: { sqlPrep: SQLPreparationResponse | null }) {
  if (!sqlPrep) return <div className="rounded-md border p-3 text-sm text-muted-foreground">No SQL prepared yet.</div>;
  return (
    <div className="flex flex-col gap-3 text-sm">
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
    </div>
  );
}
