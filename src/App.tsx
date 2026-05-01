import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Database, Download, Loader2, Send, Terminal } from "lucide-react";
import { FormEvent, useRef, useState } from "react";
import {
  addMessage,
  approveIntent,
  createSession,
  createSessionExport,
  getContext,
  getSession,
  prepareSql,
  proposeIntent,
  scanContext
} from "./api";
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

  const contextQuery = useQuery({
    queryKey: ["context"],
    queryFn: getContext,
    retry: false
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

  return (
    <main className="min-h-screen bg-[#f6f7f4] text-[#17211b]">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 py-4">
        <section className="flex min-h-[calc(100vh-2rem)] flex-1 flex-col">
          <header className="flex flex-col gap-3 border-b border-[#d5d8cf] pb-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <Database className="h-5 w-5" aria-hidden="true" />
                <h1 className="text-xl font-semibold">CSV Chat</h1>
              </div>
              <p className="mt-1 text-sm text-[#647067]">{session ? `Session ${session.id.slice(0, 8)}` : "No active session"}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Status value={session?.status ?? "not_started"} />
              <button className="secondary-button" onClick={() => startSessionMutation.mutate()} disabled={busy}>
                New session
              </button>
              <button className="secondary-button" onClick={() => scanMutation.mutate()} disabled={busy}>
                Scan database
              </button>
            </div>
          </header>

          {notice ? <NoticeBanner notice={notice} /> : null}

          <div className="grid flex-1 gap-4 py-4 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="flex min-h-[520px] flex-col rounded-md border border-[#d5d8cf] bg-white">
              <div className="flex-1 space-y-3 overflow-auto p-4">
                {session?.messages.length ? (
                  session.messages.map((item, index) => <MessageBubble key={`${item.role}-${index}`} role={item.role} content={item.content} />)
                ) : (
                  <div className="flex h-full items-center justify-center text-center text-sm text-[#647067]">
                    Describe the CSV you need, then ask the model to propose a CSV plan.
                  </div>
                )}
              </div>
              <form className="border-t border-[#d5d8cf] p-3" onSubmit={handleSubmit}>
                <label className="sr-only" htmlFor="csv-request">
                  CSV request
                </label>
                <textarea
                  id="csv-request"
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  className="h-24 w-full resize-none rounded-md border border-[#c4c9bf] bg-[#fbfcfa] p-3 text-sm outline-none focus:border-[#287a52] focus:ring-2 focus:ring-[#287a52]/20"
                  placeholder="Example: Export customer emails for active accounts created this quarter."
                />
                <div className="mt-3 flex flex-wrap gap-2">
                  <button className="primary-button" type="submit" disabled={busy || !message.trim()}>
                    <Send className="h-4 w-4" aria-hidden="true" />
                    Send
                  </button>
                  <button className="secondary-button" type="button" onClick={() => proposeMutation.mutate()} disabled={busy || !sessionId}>
                    {proposeMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}
                    Propose CSV plan
                  </button>
                </div>
              </form>
            </div>

            <div className="space-y-4">
              <PlanPanel
                proposal={proposal}
                approved={session?.approved_intent ?? null}
                busy={busy}
                onApprove={(intent) => approveMutation.mutate(intent)}
              />
              <ExportPanel
                canPrepare={Boolean(session?.approved_intent)}
                sqlPrep={sqlPrep}
                exportResult={exportResult}
                busy={busy}
                onPrepare={() => prepareMutation.mutate()}
                onExport={() => exportMutation.mutate()}
              />
              <section className="rounded-md border border-[#d5d8cf] bg-white">
                <button
                  className="flex w-full items-center justify-between px-3 py-3 text-left text-sm font-medium"
                  onClick={() => setAdvancedOpen((open) => !open)}
                >
                  <span className="flex items-center gap-2">
                    <Terminal className="h-4 w-4" aria-hidden="true" />
                    Advanced
                  </span>
                  <span>{advancedOpen ? "Hide" : "Show"}</span>
                </button>
                {advancedOpen ? <Advanced sqlPrep={sqlPrep} /> : null}
              </section>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function Line({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex justify-between gap-3">
      <dt>{label}</dt>
      <dd className="font-medium text-[#17211b]">{value}</dd>
    </div>
  );
}

function Status({ value }: { value: string }) {
  return <span className="w-fit rounded-md bg-[#e7ece6] px-2.5 py-1 text-sm font-medium text-[#334238]">{value.split("_").join(" ")}</span>;
}

function NoticeBanner({ notice }: { notice: Exclude<Notice, null> }) {
  const className =
    notice.type === "error"
      ? "mt-4 rounded-md border border-[#d7aaa0] bg-[#fff4f1] px-3 py-2 text-sm text-[#7f2f1d]"
      : "mt-4 rounded-md border border-[#b8cdbd] bg-[#eef7f0] px-3 py-2 text-sm text-[#235038]";
  return <div className={className}>{notice.text}</div>;
}

function MessageBubble({ role, content }: { role: string; content: string }) {
  const own = role === "user";
  return (
    <div className={`flex ${own ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[78%] rounded-md px-3 py-2 text-sm ${own ? "bg-[#287a52] text-white" : "bg-[#edf0ea] text-[#17211b]"}`}>
        {content}
      </div>
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
    <section className="rounded-md border border-[#d5d8cf] bg-white p-3">
      <h3 className="text-base font-semibold">CSV plan</h3>
      {intent ? (
        <div className="mt-3 space-y-3 text-sm">
          <p className="font-medium">{intent.summary}</p>
          <p className="text-[#4a544d]">{intent.row_meaning}</p>
          <div>
            <div className="mb-2 text-xs uppercase tracking-wide text-[#647067]">Fields</div>
            <ul className="space-y-2">
              {intent.columns.map((column) => (
                <li key={column.name} className="rounded-md bg-[#f6f7f4] p-2">
                  <div className="font-medium">{column.name}</div>
                  <div className="text-[#4a544d]">{column.description}</div>
                </li>
              ))}
            </ul>
          </div>
          <Line label="Max rows" value={intent.max_row_count} />
          {!approved ? (
            <button className="primary-button w-full" onClick={() => onApprove(intent)} disabled={busy}>
              <Check className="h-4 w-4" aria-hidden="true" />
              Approve plan
            </button>
          ) : null}
        </div>
      ) : (
        <p className="mt-3 text-sm text-[#647067]">No CSV plan proposed yet.</p>
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
    <section className="rounded-md border border-[#d5d8cf] bg-white p-3">
      <h3 className="text-base font-semibold">Export</h3>
      <div className="mt-3 flex flex-col gap-2">
        <button className="secondary-button" onClick={onPrepare} disabled={busy || !canPrepare}>
          <Terminal className="h-4 w-4" aria-hidden="true" />
          Prepare export
        </button>
        <button className="primary-button" onClick={onExport} disabled={busy || !sqlPrep?.valid}>
          <Download className="h-4 w-4" aria-hidden="true" />
          Run export
        </button>
      </div>
      {exportResult ? (
        <a className="mt-3 flex items-center gap-2 rounded-md bg-[#e9f3ec] px-3 py-2 text-sm font-medium text-[#235038]" href={exportResult.download_url}>
          <Download className="h-4 w-4" aria-hidden="true" />
          Download CSV ({exportResult.row_count} rows)
        </a>
      ) : null}
    </section>
  );
}

function Advanced({ sqlPrep }: { sqlPrep: SQLPreparationResponse | null }) {
  if (!sqlPrep) return <div className="border-t border-[#d5d8cf] p-3 text-sm text-[#647067]">No SQL prepared yet.</div>;
  return (
    <div className="space-y-3 border-t border-[#d5d8cf] p-3 text-sm">
      <pre className="max-h-52 overflow-auto rounded-md bg-[#17211b] p-3 text-[#eef7f0]">{sqlPrep.sql}</pre>
      <div className="space-y-2">
        {sqlPrep.attempts.map((attempt, index) => (
          <div key={`${attempt.sql}-${index}`} className="rounded-md bg-[#f6f7f4] p-2">
            <div className="font-medium">Attempt {index + 1}: {attempt.valid ? "valid" : "invalid"}</div>
            {attempt.errors.length ? <div className="mt-1 text-[#7f2f1d]">{attempt.errors.join("; ")}</div> : null}
            {attempt.repair_changes.length ? <div className="mt-1 text-[#4a544d]">{attempt.repair_changes.join("; ")}</div> : null}
          </div>
        ))}
      </div>
    </div>
  );
}
