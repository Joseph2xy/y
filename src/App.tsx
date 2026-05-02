import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, Database, Download, Loader2, Plus, Send, Terminal } from "lucide-react";
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
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Separator } from "@/components/ui/separator";
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
      setNotice(response.valid ? { type: "info", text: "Export query validated. Export is ready to run." } : {
        type: "error",
        text: "The export query could not be validated after repair attempts."
      });
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
  const hasWorkflow =
    Boolean(proposal || session?.approved_intent || sqlPrep || exportResult || advancedOpen);

  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-4 text-foreground">
      <Card className="h-[min(680px,calc(100svh-2rem))] w-full max-w-2xl">
        <CardHeader className="border-b">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Database aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate font-heading text-base leading-snug font-medium">CSV Chat</h1>
              <p className="truncate text-xs text-muted-foreground">
                {session ? `Session ${session.id.slice(0, 8)}` : "Ask for a CSV from your database."}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Status value={session?.status ?? "not_started"} />
            {session ? (
              <Button size="icon-sm" variant="ghost" onClick={() => startSessionMutation.mutate()} disabled={busy} aria-label="New session">
                <Plus aria-hidden="true" />
              </Button>
            ) : null}
          </div>
        </CardHeader>

        <CardContent className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden py-3">
          {notice ? <NoticeBanner notice={notice} /> : null}

          <section className="min-h-0 flex-1 overflow-auto rounded-lg border bg-muted/20 p-3" aria-label="Messages">
            {session?.messages.length ? (
              <div className="flex flex-col-reverse gap-3">
                {[...session.messages]
                  .reverse()
                  .map((item, index) => <MessageEvent key={`${item.role}-${session.messages.length - index}`} role={item.role} content={item.content} />)}
              </div>
            ) : (
              <div className="flex min-h-full items-center justify-center px-4 text-center">
                <div className="max-w-sm">
                  <p className="text-sm font-medium">What CSV do you need?</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Describe the export in plain language. You will approve the CSV plan before anything runs.
                  </p>
                </div>
              </div>
            )}
          </section>

          {hasWorkflow ? (
            <section className="max-h-[45%] overflow-auto rounded-lg border p-3" aria-label="CSV workflow">
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
        </CardContent>

        <CardFooter>
          <form className="flex w-full flex-col gap-2" onSubmit={handleSubmit}>
            <div className="flex flex-wrap gap-2">
              {hasMessages ? (
                <Button variant="outline" size="sm" type="button" onClick={() => proposeMutation.mutate()} disabled={busy || !sessionId}>
                  {proposeMutation.isPending ? <Loader2 data-icon="inline-start" className="animate-spin" aria-hidden="true" /> : <Check data-icon="inline-start" aria-hidden="true" />}
                  Propose CSV plan
                </Button>
              ) : null}
              <Button variant="outline" size="sm" type="button" onClick={() => scanMutation.mutate()} disabled={busy}>
                <Database data-icon="inline-start" aria-hidden="true" />
                Scan database
              </Button>
            </div>
            <div className="flex gap-2">
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
                className="min-h-10 resize-none"
              />
              <Button size="icon" type="submit" disabled={busy || !message.trim()} aria-label="Send">
                <Send aria-hidden="true" />
              </Button>
            </div>
          </form>
        </CardFooter>
      </Card>
    </main>
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
    <Alert variant={notice.type === "error" ? "destructive" : "default"}>
      <AlertDescription>{notice.text}</AlertDescription>
    </Alert>
  );
}

function MessageEvent({ role, content }: { role: string; content: string }) {
  const own = role === "user";
  return (
    <article className={cn("flex gap-2", own && "justify-end text-right")}>
      <div className={cn("max-w-[85%] rounded-lg border bg-background px-3 py-2 text-sm", own && "bg-primary text-primary-foreground")}>
        <div className="mb-1 text-xs font-medium opacity-80">{own ? "You" : "CSV Chat"}</div>
        <p>{content}</p>
      </div>
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
  const hasPlan = Boolean(approved ?? proposal?.intent);
  const hasExportControls = Boolean(canPrepare || sqlPrep || exportResult);
  const hasAdvanced = Boolean(sqlPrep || advancedOpen);
  return (
    <div className="flex flex-col gap-3">
      {hasExportControls ? (
        <ExportPanel
          canPrepare={canPrepare}
          sqlPrep={sqlPrep}
          exportResult={exportResult}
          busy={busy}
          onPrepare={onPrepare}
          onExport={onExport}
        />
      ) : null}
      {hasPlan ? (
        <>
          {hasExportControls ? <Separator /> : null}
          <PlanPanel proposal={proposal} approved={approved} busy={busy} onApprove={onApprove} />
        </>
      ) : null}
      {hasAdvanced ? (
        <>
        <Separator />
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
        </>
      ) : null}
    </div>
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
        <h2 className="text-sm font-medium">CSV plan</h2>
        {approved ? <Badge variant="outline">approved</Badge> : null}
        {!approved && intent ? (
          <Button size="sm" onClick={() => onApprove(intent)} disabled={busy}>
            <Check data-icon="inline-start" aria-hidden="true" />
            Approve plan
          </Button>
        ) : null}
      </div>
      {intent ? (
        <div className="flex flex-col gap-3 text-sm">
          <p className="font-medium">{intent.summary}</p>
          <p className="text-muted-foreground">{intent.row_meaning}</p>
          <div>
            <div className="mb-2 text-xs font-medium text-muted-foreground">Fields</div>
            <ul className="flex flex-col gap-2">
              {intent.columns.map((column) => (
                <li key={column.name} className="rounded-lg bg-muted/50 p-2">
                  <div className="font-medium">{column.name}</div>
                  <div className="text-muted-foreground">{column.description}</div>
                </li>
              ))}
            </ul>
          </div>
          <Line label="Max rows" value={intent.max_row_count} />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No CSV plan proposed yet.</p>
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
      <h2 className="text-sm font-medium">Export</h2>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={onPrepare} disabled={busy || !canPrepare}>
          <Terminal data-icon="inline-start" aria-hidden="true" />
          Prepare export
        </Button>
        <Button onClick={onExport} disabled={busy || !sqlPrep?.valid}>
          <Download data-icon="inline-start" aria-hidden="true" />
          Run export
        </Button>
      </div>
      {exportResult ? (
        <a className={cn(buttonVariants({ variant: "secondary" }), "w-fit")} href={exportResult.download_url}>
          <Download data-icon="inline-start" aria-hidden="true" />
          Download CSV ({exportResult.row_count} rows)
        </a>
      ) : null}
    </section>
  );
}

function Advanced({ sqlPrep }: { sqlPrep: SQLPreparationResponse | null }) {
  if (!sqlPrep) return <div className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">No SQL prepared yet.</div>;
  return (
    <div className="flex flex-col gap-3 text-sm">
      <pre className="max-h-52 overflow-auto rounded-lg bg-foreground p-3 text-background">{sqlPrep.sql}</pre>
      <div className="flex flex-col gap-2">
        {sqlPrep.attempts.map((attempt, index) => (
          <div key={`${attempt.sql}-${index}`} className="rounded-lg bg-muted/50 p-2">
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
