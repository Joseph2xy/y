import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUp, CheckIcon, CircleCheckIcon, CircleIcon, DownloadIcon, PlusIcon, RefreshCwIcon, SettingsIcon, TerminalIcon } from "lucide-react";
import { ReactNode, useEffect, useRef, useState } from "react";
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
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ChatContainerContent, ChatContainerRoot, ChatContainerScrollAnchor } from "@/components/prompt-kit/chat-container";
import { CodeBlock, CodeBlockCode } from "@/components/prompt-kit/code-block";
import { Message, MessageAvatar, MessageContent } from "@/components/prompt-kit/message";
import { PromptInput, PromptInputAction, PromptInputActions, PromptInputTextarea } from "@/components/prompt-kit/prompt-input";
import { PromptSuggestion } from "@/components/prompt-kit/prompt-suggestion";
import { ScrollButton } from "@/components/prompt-kit/scroll-button";
import { Steps, StepsContent, StepsItem, StepsTrigger } from "@/components/prompt-kit/steps";
import { SystemMessage } from "@/components/prompt-kit/system-message";
import { ThinkingBar } from "@/components/prompt-kit/thinking-bar";
import { cn } from "@/lib/utils";
import type {
  ChatMessage,
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

const EXAMPLE_REQUESTS = [
  "Active customer emails created this quarter",
  "March revenue by product category",
  "Open high-priority support tickets"
];

export function App() {
  const queryClient = useQueryClient();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [proposal, setProposal] = useState<CSVIntentProposal | null>(null);
  const [sqlPrep, setSqlPrep] = useState<SQLPreparationResponse | null>(null);
  const [exportResult, setExportResult] = useState<ExportCreateResponse | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
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
      setNotice(null);
      queryClient.setQueryData(["session", session.id], session);
    },
    onError: showError
  });

  const bootstrapMutation = useMutation({
    mutationFn: bootstrapSetup,
    onSuccess: (status) => {
      queryClient.setQueryData(["setup-status"], status);
      if (!status.ready) {
        setNotice({ type: "info", text: status.context.message ?? "Setup still needs attention." });
      }
    },
    onError: showError
  });

  const rescanContextMutation = useMutation({
    mutationFn: rescanContext,
    onSuccess: () => {
      setNotice({ type: "info", text: "Database context was rescanned." });
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
      setNotice(null);
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
      setNotice(response.valid ? null : { type: "error", text: "The CSV could not be prepared." });
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
      setNotice(null);
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

  const busy =
    startSessionMutation.isPending ||
    bootstrapMutation.isPending ||
    rescanContextMutation.isPending ||
    providerMutation.isPending ||
    sendMutation.isPending ||
    proposeMutation.isPending ||
    approveMutation.isPending ||
    prepareMutation.isPending ||
    exportMutation.isPending;

  const setupStatus = setupQuery.data;
  const providerSettings = providerQuery.data;
  const session = sessionQuery.data;
  const workflowNotice = notice ?? (session?.last_error ? { type: "error" as const, text: session.last_error } : null);

  useEffect(() => {
    if (providerSettings?.model) {
      setProviderKind(providerSettings.provider === "custom" ? "custom" : "openrouter");
      setProviderModel(providerSettings.model);
      setProviderBaseUrl(providerSettings.base_url ?? "");
    }
  }, [providerSettings?.provider, providerSettings?.model, providerSettings?.base_url]);

  function submitCurrentMessage() {
    if (!message.trim() || busy || !setupStatus?.ready) return;
    sendMutation.mutate();
  }

  if (setupQuery.isLoading) {
    return (
      <CenteredShell status={null}>
        <InlineStatus text="Checking setup" />
      </CenteredShell>
    );
  }

  if (!setupStatus?.ready) {
    return (
      <CenteredShell status={setupStatus ?? null}>
        <SetupFallback
          status={setupStatus ?? null}
          providerSettings={providerSettings}
          provider={providerKind}
          model={providerModel}
          baseUrl={providerBaseUrl}
          apiKey={providerApiKey}
          busy={busy}
          notice={notice}
          onProviderChange={setProviderKind}
          onModelChange={setProviderModel}
          onBaseUrlChange={setProviderBaseUrl}
          onApiKeyChange={setProviderApiKey}
          onSaveProvider={() => providerMutation.mutate()}
          onBootstrap={() => bootstrapMutation.mutate()}
          onRescanContext={() => rescanContextMutation.mutate()}
        />
      </CenteredShell>
    );
  }

  return (
    <main className="relative isolate flex h-svh flex-col overflow-hidden bg-background text-foreground">
      <section className="flex min-h-0 flex-1 flex-col" aria-label="CSV Chat">
        <AppHeader
          status={setupStatus}
          session={session ?? null}
          busy={busy}
          onNewSession={() => startSessionMutation.mutate()}
        />

        <ChatContainerRoot className="relative min-h-0 flex-1 px-4">
          <ChatContainerContent className="min-h-full gap-6 py-8">
            <Conversation
              session={session ?? null}
              proposal={proposal}
              sqlPrep={sqlPrep}
              exportResult={exportResult}
              notice={workflowNotice}
              planning={proposeMutation.isPending}
              preparing={prepareMutation.isPending}
              busy={busy}
              onApprove={(intent) => approveMutation.mutate(intent)}
              onExport={() => exportMutation.mutate()}
              onSuggestion={setMessage}
            />
            <ChatContainerScrollAnchor />
          </ChatContainerContent>
          <div className="pointer-events-none sticky bottom-3 flex justify-center">
            <ScrollButton className="pointer-events-auto" />
          </div>
        </ChatContainerRoot>

        <div className="shrink-0 px-4 pb-4">
          <div className="mx-auto w-full max-w-3xl px-0 md:px-6">
            <PromptInput
              value={message}
              onValueChange={setMessage}
              onSubmit={submitCurrentMessage}
              isLoading={sendMutation.isPending || proposeMutation.isPending}
              disabled={busy}
              maxHeight={160}
            >
              <PromptInputTextarea placeholder="Describe the CSV you need" disabled={busy} />
              <PromptInputActions className="justify-between">
                <p className="min-w-0 truncate px-2 text-xs text-muted-foreground">{contextStatusText(setupStatus)}</p>
                <PromptInputAction tooltip="Send">
                  <Button size="icon-sm" type="button" disabled={busy || !message.trim()} aria-label="Send" onClick={submitCurrentMessage}>
                    {sendMutation.isPending || proposeMutation.isPending ? (
                      <Spinner data-icon="inline-start" />
                    ) : (
                      <ArrowUp data-icon="inline-start" />
                    )}
                  </Button>
                </PromptInputAction>
              </PromptInputActions>
            </PromptInput>
          </div>
        </div>
      </section>
    </main>
  );
}

function AppHeader({
  status,
  session,
  busy,
  onNewSession
}: {
  status: SetupStatusResponse;
  session: ExportSession | null;
  busy: boolean;
  onNewSession: () => void;
}) {
  return (
    <header className="mx-auto flex w-full max-w-3xl shrink-0 items-center justify-between gap-3 px-4 py-4 md:px-10">
      <div className="min-w-0">
        <h1 className="truncate font-heading text-sm font-medium">CSV Chat</h1>
        <p className="truncate text-xs text-muted-foreground">{session ? statusLabel(session.status) : "Validated CSV exports"}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <ReadinessBadge status={status} />
        {session ? (
          <Button size="icon-sm" variant="ghost" type="button" onClick={onNewSession} disabled={busy} aria-label="New chat">
            <PlusIcon data-icon="inline-start" />
          </Button>
        ) : null}
      </div>
    </header>
  );
}

function Conversation({
  session,
  proposal,
  sqlPrep,
  exportResult,
  notice,
  planning,
  preparing,
  busy,
  onApprove,
  onExport,
  onSuggestion
}: {
  session: ExportSession | null;
  proposal: CSVIntentProposal | null;
  sqlPrep: SQLPreparationResponse | null;
  exportResult: ExportCreateResponse | null;
  notice: Notice;
  planning: boolean;
  preparing: boolean;
  busy: boolean;
  onApprove: (intent: CSVIntent) => void;
  onExport: () => void;
  onSuggestion: (value: string) => void;
}) {
  const messages = visibleMessages(session?.messages ?? [], proposal);
  const traces = session?.debug_traces ?? [];
  const approved = session?.approved_intent ?? null;
  const hasWork = Boolean(proposal || approved || sqlPrep || exportResult || planning || preparing);
  const empty = !messages.length && !hasWork;

  if (empty) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-0 md:px-6">
        {notice ? <NoticeBanner notice={notice} /> : null}
        <EmptyChat onSuggestion={onSuggestion} />
      </div>
    );
  }

  return (
    <>
      {notice ? (
        <div className="mx-auto w-full max-w-3xl px-0 md:px-6">
          <NoticeBanner notice={notice} />
        </div>
      ) : null}
      {messages.map((item, index) => (
        <ChatBubble key={`${item.role}-${index}-${item.content}`} message={item} />
      ))}
      {hasWork ? (
        <AssistantBubble>
          <CsvWorkCard
            proposal={proposal}
            approved={approved}
            sqlPrep={sqlPrep}
            exportResult={exportResult}
            traces={traces}
            planning={planning}
            preparing={preparing}
            busy={busy}
            onApprove={onApprove}
            onExport={onExport}
          />
        </AssistantBubble>
      ) : null}
    </>
  );
}

function EmptyChat({ onSuggestion }: { onSuggestion: (value: string) => void }) {
  return (
    <div className="flex min-h-[55svh] flex-col justify-center gap-5">
      <div className="flex flex-col gap-2">
        <h2 className="font-heading text-2xl font-medium tracking-normal">What CSV do you need?</h2>
        <p className="text-sm text-muted-foreground">You will approve the CSV plan before anything runs.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {EXAMPLE_REQUESTS.map((request) => (
          <PromptSuggestion
            key={request}
            size="sm"
            className="h-auto max-w-full whitespace-normal"
            onClick={() => onSuggestion(request)}
          >
            {request}
          </PromptSuggestion>
        ))}
      </div>
    </div>
  );
}

function ChatBubble({ message }: { message: ChatMessage }) {
  const user = message.role === "user";
  return (
    <Message className={cn("mx-auto w-full max-w-3xl px-0 md:px-6", user ? "justify-end" : "justify-start")}>
      {!user ? <MessageAvatar alt="CSV Chat" fallback="C" /> : null}
      <MessageContent
        markdown={!user}
        className={cn(
          "text-sm",
          user ? "max-w-[85%] rounded-3xl bg-muted px-5 py-2.5 text-primary sm:max-w-[75%]" : "w-full flex-1 bg-transparent p-0 text-foreground"
        )}
      >
        {message.content}
      </MessageContent>
    </Message>
  );
}

function AssistantBubble({ children }: { children: ReactNode }) {
  return (
    <article className="mx-auto flex w-full max-w-3xl justify-start px-0 md:px-6">
      <div className="w-full">{children}</div>
    </article>
  );
}

function CsvWorkCard({
  proposal,
  approved,
  sqlPrep,
  exportResult,
  traces,
  planning,
  preparing,
  busy,
  onApprove,
  onExport
}: {
  proposal: CSVIntentProposal | null;
  approved: CSVIntent | null;
  sqlPrep: SQLPreparationResponse | null;
  exportResult: ExportCreateResponse | null;
  traces: SessionDebugTrace[];
  planning: boolean;
  preparing: boolean;
  busy: boolean;
  onApprove: (intent: CSVIntent) => void;
  onExport: () => void;
}) {
  const intent = approved ?? proposal?.intent ?? null;
  const needsClarification = Boolean(proposal && !proposal.intent);
  const hasAdvancedDetails = Boolean(sqlPrep || traces.length);

  return (
    <Card aria-label="CSV plan">
      <CardHeader>
        <CardTitle>{workTitle({ planning, preparing, approved, sqlPrep, exportResult, needsClarification })}</CardTitle>
        <CardDescription>{workDescription({ planning, preparing, approved, sqlPrep, exportResult, needsClarification })}</CardDescription>
        <CardAction>
          <div className="flex items-center gap-1">
            {approved ? <Badge variant="outline">approved</Badge> : null}
            {needsClarification ? <Badge variant="secondary">question</Badge> : null}
            {hasAdvancedDetails ? <AdvancedDialog sqlPrep={sqlPrep} traces={traces} /> : null}
          </div>
        </CardAction>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {planning ? <InlineStatus text="Planning CSV" /> : null}
        {needsClarification ? <Clarification proposal={proposal} /> : null}
        {intent ? <PlanDetails intent={intent} message={proposal?.message ?? null} approved={Boolean(approved)} /> : null}
        {preparing ? <InlineStatus text="Checking CSV" /> : null}
        <CsvSteps
          proposal={proposal}
          approved={approved}
          sqlPrep={sqlPrep}
          exportResult={exportResult}
          planning={planning}
          preparing={preparing}
          needsClarification={needsClarification}
        />
        {sqlPrep && !sqlPrep.valid ? <SystemMessage variant="error">The CSV could not be prepared.</SystemMessage> : null}
        {sqlPrep?.valid && !exportResult ? (
          <SystemMessage>
            <div>
              <p className="font-medium">Ready to create</p>
              <p className="text-muted-foreground">The app checked the CSV and will use read-only limits.</p>
            </div>
          </SystemMessage>
        ) : null}
        {exportResult ? <ExportSummary exportResult={exportResult} /> : null}
      </CardContent>

      {!approved && intent ? (
        <CardFooter>
          <Button type="button" onClick={() => onApprove(intent)} disabled={busy}>
            <CheckIcon data-icon="inline-start" />
            Approve CSV plan
          </Button>
        </CardFooter>
      ) : null}

      {sqlPrep?.valid && !exportResult ? (
        <CardFooter>
          <Button type="button" onClick={onExport} disabled={busy}>
            {busy ? <Spinner data-icon="inline-start" /> : <CheckIcon data-icon="inline-start" />}
            Create CSV
          </Button>
        </CardFooter>
      ) : null}

      {exportResult ? (
        <CardFooter>
          <a className={buttonVariants({ variant: "default" })} href={exportResult.download_url}>
            <DownloadIcon data-icon="inline-start" />
            Download CSV
          </a>
        </CardFooter>
      ) : null}
    </Card>
  );
}

function CsvSteps({
  proposal,
  approved,
  sqlPrep,
  exportResult,
  planning,
  preparing,
  needsClarification
}: {
  proposal: CSVIntentProposal | null;
  approved: CSVIntent | null;
  sqlPrep: SQLPreparationResponse | null;
  exportResult: ExportCreateResponse | null;
  planning: boolean;
  preparing: boolean;
  needsClarification: boolean;
}) {
  if (!proposal && !approved && !sqlPrep && !exportResult && !planning && !preparing) return null;

  const items = csvStepItems({ proposal, approved, sqlPrep, exportResult, planning, preparing, needsClarification });

  return (
    <Steps className="rounded-lg border p-3">
      <StepsTrigger leftIcon={<CircleIcon className="size-4" />}>Progress</StepsTrigger>
      <StepsContent>
        {items.map((item) => (
          <StepsItem key={item.label} className="flex items-start gap-2">
            {item.done ? <CircleCheckIcon className="mt-0.5 size-4 shrink-0 text-foreground" /> : <CircleIcon className="mt-0.5 size-4 shrink-0" />}
            <div className="min-w-0">
              <p className={cn("font-medium", item.active ? "text-foreground" : null)}>{item.label}</p>
              <p>{item.description}</p>
            </div>
          </StepsItem>
        ))}
      </StepsContent>
    </Steps>
  );
}

function csvStepItems({
  proposal,
  approved,
  sqlPrep,
  exportResult,
  planning,
  preparing,
  needsClarification
}: {
  proposal: CSVIntentProposal | null;
  approved: CSVIntent | null;
  sqlPrep: SQLPreparationResponse | null;
  exportResult: ExportCreateResponse | null;
  planning: boolean;
  preparing: boolean;
  needsClarification: boolean;
}) {
  const hasPlan = Boolean(proposal?.intent || approved);
  const planDone = hasPlan || Boolean(exportResult);
  const approvedDone = Boolean(approved || exportResult);
  const checkedDone = Boolean(sqlPrep?.valid || exportResult);
  const exportedDone = Boolean(exportResult);

  return [
    {
      label: needsClarification ? "Clarify details" : "Draft CSV plan",
      description: needsClarification ? "Answer the question in chat to continue." : planning ? "Drafting a plan for approval." : planDone ? "Plan is ready." : "Waiting for a request.",
      done: planDone && !needsClarification,
      active: planning || needsClarification
    },
    {
      label: "Approve CSV plan",
      description: approvedDone ? "Approved." : hasPlan ? "Review the plan before anything runs." : "Available after a plan is drafted.",
      done: approvedDone,
      active: hasPlan && !approvedDone
    },
    {
      label: "Check export",
      description: preparing ? "Validating the export against read-only rules." : checkedDone ? "Validation passed." : approvedDone ? "Validation will run next." : "Available after approval.",
      done: checkedDone,
      active: preparing
    },
    {
      label: "Create CSV",
      description: exportedDone ? `Rows exported: ${exportResult?.row_count ?? 0}` : checkedDone ? "Ready to create the download." : "Available after validation.",
      done: exportedDone,
      active: checkedDone && !exportedDone
    }
  ];
}

function Clarification({ proposal }: { proposal: CSVIntentProposal | null }) {
  return (
    <div className="flex flex-col gap-2">
      {proposal?.message ? <p>{proposal.message}</p> : null}
      {proposal?.questions?.length ? (
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground">
          {proposal.questions.map((question) => (
            <li key={question}>{question}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function PlanDetails({
  intent,
  message,
  approved
}: {
  intent: CSVIntent;
  message: string | null;
  approved: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      {message ? <p>{message}</p> : null}
      <div className="flex flex-col gap-1">
        <p className="text-xs font-medium text-muted-foreground">{approved ? "Approved CSV plan" : "CSV plan"}</p>
        <p className="font-medium">{intent.summary}</p>
        <p className="text-sm text-muted-foreground">{intent.row_meaning}</p>
      </div>
      <Separator />
      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium text-muted-foreground">Columns</p>
        <ul className="flex flex-col gap-2">
          {intent.columns.map((column) => (
            <li key={column.name} className="rounded-lg border p-3">
              <p className="font-medium">{column.name}</p>
              <p className="text-sm text-muted-foreground">{column.description}</p>
            </li>
          ))}
        </ul>
      </div>
      {intent.filters.length ? <TextList title="Filters" items={intent.filters} /> : null}
      {intent.derived_fields.length ? <TextList title="Calculated fields" items={intent.derived_fields} /> : null}
      {intent.assumptions.length ? <TextList title="Assumptions" items={intent.assumptions} /> : null}
      <dl className="text-sm text-muted-foreground">
        <Line label="Max rows" value={intent.max_row_count} />
      </dl>
    </div>
  );
}

function ExportSummary({ exportResult }: { exportResult: ExportCreateResponse }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="font-medium">CSV ready</p>
      <dl className="grid gap-1 text-sm text-muted-foreground">
        <Line label="Rows" value={exportResult.row_count} />
        <Line label="Columns" value={exportResult.columns.length} />
      </dl>
    </div>
  );
}

function AdvancedDialog({ sqlPrep, traces }: { sqlPrep: SQLPreparationResponse | null; traces: SessionDebugTrace[] }) {
  return (
    <Dialog>
      <DialogTrigger render={<Button type="button" variant="ghost" size="icon-sm" aria-label="Advanced" />}>
        <TerminalIcon data-icon="inline-start" />
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Advanced</DialogTitle>
          <DialogDescription>Read-only validation and debug details.</DialogDescription>
        </DialogHeader>
        <AdvancedDetails sqlPrep={sqlPrep} traces={traces} />
      </DialogContent>
    </Dialog>
  );
}

function AdvancedDetails({ sqlPrep, traces }: { sqlPrep: SQLPreparationResponse | null; traces: SessionDebugTrace[] }) {
  if (!sqlPrep && !traces.length) {
    return <p className="text-sm text-muted-foreground">No details yet.</p>;
  }

  return (
    <div className="flex max-h-[70svh] flex-col gap-4 overflow-auto text-sm">
      {sqlPrep ? (
        <div className="flex flex-col gap-2">
          <p className="font-medium">Prepared SQL</p>
          <CodeBlock>
            <CodeBlockCode code={sqlPrep.sql} language="sql" />
          </CodeBlock>
          {sqlPrep.attempts.map((attempt, index) => (
            <div key={`${attempt.sql}-${index}`} className="rounded-lg border p-3">
              <p className="font-medium">
                Attempt {index + 1}: {attempt.valid ? "valid" : "invalid"}
              </p>
              {attempt.errors.length ? <p className="text-destructive">{attempt.errors.join("; ")}</p> : null}
              {attempt.repair_changes.length ? <p className="text-muted-foreground">{attempt.repair_changes.join("; ")}</p> : null}
            </div>
          ))}
        </div>
      ) : null}
      {traces.length ? (
        <div className="flex flex-col gap-2">
          <p className="font-medium">Trace</p>
          {traces.map((trace, index) => (
            <details key={`${trace.step}-${index}`} className="rounded-lg border p-3">
              <summary className="cursor-pointer">
                {trace.step}: {trace.summary}
              </summary>
              <CodeBlock className="mt-2">
                <CodeBlockCode code={JSON.stringify(trace.details, null, 2)} language="json" />
              </CodeBlock>
            </details>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SetupFallback({
  status,
  providerSettings,
  provider,
  model,
  baseUrl,
  apiKey,
  busy,
  notice,
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
  notice: Notice;
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
    <section className="flex flex-col gap-4" aria-label="Setup needed">
      {notice ? <NoticeBanner notice={notice} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>{setupTitle(action)}</CardTitle>
          <CardDescription>{setupDescription(status)}</CardDescription>
          <CardAction>
            <SettingsIcon className="text-muted-foreground" />
          </CardAction>
        </CardHeader>
        {action === "configure_database" ? (
          <CardContent>
            <CodeBlock>
              <CodeBlockCode code="DATABASE_URL=postgresql://readonly:password@localhost:5432/appdb" language="shell" />
            </CodeBlock>
          </CardContent>
        ) : null}
        {action === "connect_database" ? (
          <CardContent className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">{status?.database.message ?? "The configured database could not be reached."}</p>
            <ContextSourceDetails status={status} />
          </CardContent>
        ) : null}
        {action === "setup_context" ? (
          <CardFooter>
            <Button type="button" onClick={onBootstrap} disabled={busy}>
              {busy ? <Spinner data-icon="inline-start" /> : <RefreshCwIcon data-icon="inline-start" />}
              Prepare app
            </Button>
          </CardFooter>
        ) : null}
        {action === "rescan_context" ? (
          <>
            <CardContent>
              <ContextSourceDetails status={status} />
            </CardContent>
            <CardFooter>
              <Button type="button" onClick={onRescanContext} disabled={busy}>
                {busy ? <Spinner data-icon="inline-start" /> : <RefreshCwIcon data-icon="inline-start" />}
                Rescan context
              </Button>
            </CardFooter>
          </>
        ) : null}
      </Card>

      {action === "configure_model_provider" ? (
        <ProviderForm
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
    </section>
  );
}

function ProviderForm({
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
  const custom = provider === "custom";
  const savedKeyMatches =
    Boolean(settings?.api_key_configured) &&
    settings?.provider === provider &&
    (settings.base_url ?? null) === (custom ? baseUrl.trim() : null);
  const disabled = busy || !model.trim() || (custom && !baseUrl.trim()) || (!apiKey.trim() && !savedKeyMatches);

  return (
    <Card aria-label="Provider settings">
      <CardHeader>
        <CardTitle>Model provider</CardTitle>
        <CardDescription>{settings?.api_key_configured ? "API key saved locally." : "Add provider details."}</CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <Field>
            <FieldLabel>Provider</FieldLabel>
            <ToggleGroup
              value={[provider]}
              onValueChange={(value) => {
                const nextValue = value[value.length - 1];
                if (nextValue === "openrouter" || nextValue === "custom") onProviderChange(nextValue);
              }}
              variant="outline"
              size="sm"
            >
              <ToggleGroupItem value="openrouter">OpenRouter</ToggleGroupItem>
              <ToggleGroupItem value="custom">Custom</ToggleGroupItem>
            </ToggleGroup>
          </Field>
          <Field>
            <FieldLabel htmlFor="provider-model">Model</FieldLabel>
            <Input id="provider-model" value={model} onChange={(event) => onModelChange(event.target.value)} />
          </Field>
          {custom ? (
            <Field>
              <FieldLabel htmlFor="provider-base-url">Base URL</FieldLabel>
              <Input
                id="provider-base-url"
                value={baseUrl}
                onChange={(event) => onBaseUrlChange(event.target.value)}
                placeholder="http://127.0.0.1:4010/v1"
              />
            </Field>
          ) : null}
          <Field>
            <FieldLabel htmlFor="provider-api-key">API key</FieldLabel>
            <Input
              id="provider-api-key"
              value={apiKey}
              onChange={(event) => onApiKeyChange(event.target.value)}
              type="password"
              placeholder={savedKeyMatches ? "Leave blank to keep saved key" : "API key"}
            />
            <FieldDescription>Stored locally by the backend.</FieldDescription>
          </Field>
        </FieldGroup>
      </CardContent>
      <CardFooter>
        <Button type="button" onClick={onSave} disabled={disabled}>
          {busy ? <Spinner data-icon="inline-start" /> : <CheckIcon data-icon="inline-start" />}
          Save
        </Button>
      </CardFooter>
    </Card>
  );
}

function CenteredShell({ status, children }: { status: SetupStatusResponse | null; children: ReactNode }) {
  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-4 py-10 text-foreground">
      <section className="flex w-full max-w-lg flex-col gap-6">
        <header className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate font-heading text-sm font-medium">CSV Chat</h1>
            <p className="truncate text-xs text-muted-foreground">Validated CSV exports</p>
          </div>
          <ReadinessBadge status={status} />
        </header>
        {children}
      </section>
    </main>
  );
}

function NoticeBanner({ notice }: { notice: Exclude<Notice, null> }) {
  return <SystemMessage variant={notice.type === "error" ? "error" : "action"}>{notice.text}</SystemMessage>;
}

function InlineStatus({ text }: { text: string }) {
  return <ThinkingBar text={text} className="text-sm text-muted-foreground" />;
}

function TextList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function Line({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex justify-between gap-3">
      <dt>{label}</dt>
      <dd className="text-right font-medium text-foreground">{value}</dd>
    </div>
  );
}

function ContextSourceDetails({ status }: { status: SetupStatusResponse | null }) {
  if (!status?.current_database && !status?.context_source) return null;
  return (
    <dl className="grid gap-2 rounded-lg bg-muted p-3 text-xs text-muted-foreground">
      {status.current_database ? <Line label="Current database" value={databaseSourceLabel(status.current_database)} /> : null}
      {status.context_source ? <Line label="Context scanned from" value={databaseSourceLabel(status.context_source)} /> : null}
      {status.context_source?.scanned_at ? <Line label="Last scanned" value={formatDateTime(status.context_source.scanned_at)} /> : null}
    </dl>
  );
}

function ReadinessBadge({ status }: { status: SetupStatusResponse | null }) {
  if (!status) return <Badge variant="secondary">checking</Badge>;
  return <Badge variant={status.ready ? "outline" : "secondary"}>{status.ready ? "ready" : "setup"}</Badge>;
}

function visibleMessages(messages: ChatMessage[], proposal: CSVIntentProposal | null) {
  if (!proposal?.message) return messages;
  let duplicateIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const item = messages[index];
    if (item.role === "assistant" && item.content === proposal.message) {
      duplicateIndex = index;
      break;
    }
  }
  if (duplicateIndex === -1) return messages;
  return messages.filter((_, index) => index !== duplicateIndex);
}

function contextStatusText(status: SetupStatusResponse | undefined) {
  if (!status?.context_source) return "Ready";
  return `Context: ${databaseSourceLabel(status.context_source)}`;
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

function statusLabel(value: string) {
  const labels: Record<string, string> = {
    not_started: "Not started",
    drafting_intent: "Planning",
    awaiting_approval: "Review plan",
    generating_sql: "Preparing",
    validating_sql: "Checking",
    exporting: "Creating CSV",
    complete: "Complete",
    failed: "Needs attention"
  };
  return labels[value] ?? value.split("_").join(" ");
}

function setupTitle(action: SetupStatusResponse["next_action"] | undefined) {
  if (action === "configure_database") return "Database connection missing";
  if (action === "connect_database") return "Database connection failed";
  if (action === "configure_model_provider") return "Model provider needed";
  if (action === "setup_context") return "Prepare app";
  if (action === "rescan_context") return "Rescan database context";
  return "Setup needed";
}

function setupDescription(status: SetupStatusResponse | null) {
  const action = status?.next_action;
  if (action === "configure_database") return "Add DATABASE_URL to .env, then restart or refresh the backend.";
  if (action === "connect_database") return "Check Postgres and DATABASE_URL.";
  if (action === "configure_model_provider") return "Choose a model provider before chat is available.";
  if (action === "setup_context") return "Scan the database once before chat is available.";
  if (action === "rescan_context") return status?.context.message ?? "The saved context does not match the configured database.";
  return "The app is not ready yet.";
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

function workTitle({
  planning,
  preparing,
  approved,
  sqlPrep,
  exportResult,
  needsClarification
}: {
  planning: boolean;
  preparing: boolean;
  approved: CSVIntent | null;
  sqlPrep: SQLPreparationResponse | null;
  exportResult: ExportCreateResponse | null;
  needsClarification: boolean;
}) {
  if (exportResult) return "CSV ready";
  if (sqlPrep?.valid) return "Create CSV";
  if (preparing) return "Checking CSV";
  if (approved) return "CSV plan approved";
  if (needsClarification) return "Clarify request";
  if (planning) return "Planning CSV";
  return "CSV plan";
}

function workDescription({
  planning,
  preparing,
  approved,
  sqlPrep,
  exportResult,
  needsClarification
}: {
  planning: boolean;
  preparing: boolean;
  approved: CSVIntent | null;
  sqlPrep: SQLPreparationResponse | null;
  exportResult: ExportCreateResponse | null;
  needsClarification: boolean;
}) {
  if (exportResult) return `${exportResult.row_count} rows exported.`;
  if (sqlPrep?.valid) return "Ready after validation.";
  if (preparing) return "Validation is running.";
  if (approved) return "Preparing the export.";
  if (needsClarification) return "Answer in chat to continue.";
  if (planning) return "Drafting the CSV plan.";
  return "Review before approval.";
}
