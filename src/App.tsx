import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUp,
  CheckIcon,
  DownloadIcon,
  FileSpreadsheetIcon,
  LockKeyholeIcon,
  MoonIcon,
  PlusIcon,
  RefreshCwIcon,
  SettingsIcon,
  ShieldCheckIcon,
  SunIcon,
  TerminalIcon
} from "lucide-react";
import { ReactNode, useEffect, useRef, useState } from "react";
import {
  addMessage,
  approveIntent,
  bootstrapSetup,
  createSession,
  createSessionExport,
  getContext,
  getModelProviderSettings,
  getSession,
  getSetupStatus,
  prepareSql,
  proposeIntent,
  rescanContext,
  testDatabaseConnection,
  updateContext,
  updateModelProviderSettings
} from "./api";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ChatContainerContent, ChatContainerRoot, ChatContainerScrollAnchor } from "@/components/prompt-kit/chat-container";
import { CodeBlock, CodeBlockCode } from "@/components/prompt-kit/code-block";
import { Message, MessageContent } from "@/components/prompt-kit/message";
import { PromptInput, PromptInputAction, PromptInputActions, PromptInputTextarea } from "@/components/prompt-kit/prompt-input";
import { PromptSuggestion } from "@/components/prompt-kit/prompt-suggestion";
import { ScrollButton } from "@/components/prompt-kit/scroll-button";
import { SystemMessage } from "@/components/prompt-kit/system-message";
import { ThinkingBar } from "@/components/prompt-kit/thinking-bar";
import { cn } from "@/lib/utils";
import type {
  CSVIntent,
  CSVIntentProposal,
  ChatMessage,
  ContextDocument,
  DatabaseConnectionTestResponse,
  ExportCreateResponse,
  ExportSession,
  ModelProviderSettingsResponse,
  SQLPreparationResponse,
  SessionDebugTrace,
  SetupStatusResponse
} from "./types";

type Notice = { type: "error" | "info"; text: string } | null;
type Theme = "light" | "dark";
type ProviderKind = "openrouter" | "openai" | "opencode" | "custom";

const EXAMPLE_REQUESTS = [
  "Active customer emails created this quarter",
  "March revenue by product category",
  "Open high-priority support tickets"
];

const THEME_STORAGE_KEY = "csv-chat-theme";

export function App() {
  const queryClient = useQueryClient();
  const [theme, setTheme] = useState<Theme>(() => initialTheme());
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [proposal, setProposal] = useState<CSVIntentProposal | null>(null);
  const [sqlPrep, setSqlPrep] = useState<SQLPreparationResponse | null>(null);
  const [exportResult, setExportResult] = useState<ExportCreateResponse | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [providerKind, setProviderKind] = useState<ProviderKind>("openrouter");
  const [providerModel, setProviderModel] = useState("openrouter/openai/gpt-4o-mini");
  const [providerBaseUrl, setProviderBaseUrl] = useState("");
  const [providerApiKey, setProviderApiKey] = useState("");
  const [defaultRowLimit, setDefaultRowLimit] = useState("100000");
  const [databaseTest, setDatabaseTest] = useState<DatabaseConnectionTestResponse | null>(null);
  const pendingSessionRef = useRef<Promise<ExportSession> | null>(null);

  const setupQuery = useQuery({
    queryKey: ["setup-status"],
    queryFn: getSetupStatus,
    refetchOnWindowFocus: false
  });

  const providerQuery = useQuery({
    queryKey: ["model-provider"],
    queryFn: getModelProviderSettings,
    enabled: !setupQuery.isLoading
  });

  const contextQuery = useQuery({
    queryKey: ["context"],
    queryFn: getContext,
    enabled: Boolean(setupQuery.data?.context.configured)
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
      setMessage("");
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

  const databaseTestMutation = useMutation({
    mutationFn: testDatabaseConnection,
    onSuccess: (result) => {
      setDatabaseTest(result);
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
      setProviderKind(providerKindFromSettings(settings.provider));
      setProviderModel(settings.model);
      setProviderBaseUrl(settings.base_url ?? "");
      setNotice({ type: "info", text: "Model provider settings saved." });
      queryClient.setQueryData(["model-provider"], settings);
      void queryClient.invalidateQueries({ queryKey: ["setup-status"] });
    },
    onError: showError
  });

  const safetyMutation = useMutation({
    mutationFn: () => {
      const document = contextQuery.data;
      if (!document) throw new Error("Context is not ready.");
      const parsedLimit = Number(defaultRowLimit);
      if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 100000) {
        throw new Error("Default row limit must be a whole number from 1 to 100000.");
      }
      return updateContext({
        context: document.context,
        policy: {
          ...document.policy,
          max_row_count: parsedLimit
        }
      });
    },
    onSuccess: (document) => {
      setDefaultRowLimit(String(document.policy.max_row_count));
      setNotice({ type: "info", text: "Export safety settings saved." });
      queryClient.setQueryData(["context"], document);
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

  function handleProviderChange(provider: ProviderKind) {
    setProviderKind(provider);
    if (provider === "openrouter") setProviderModel("openrouter/openai/gpt-4o-mini");
    if (provider === "openai") setProviderModel("openai/gpt-4.1-mini");
    if (provider === "opencode") setProviderModel("nemotron-3-super-free");
  }

  const busy =
    startSessionMutation.isPending ||
    bootstrapMutation.isPending ||
    rescanContextMutation.isPending ||
    databaseTestMutation.isPending ||
    providerMutation.isPending ||
    safetyMutation.isPending ||
    sendMutation.isPending ||
    proposeMutation.isPending ||
    approveMutation.isPending ||
    prepareMutation.isPending ||
    exportMutation.isPending;

  const setupStatus = setupQuery.data;
  const providerSettings = providerQuery.data;
  const contextDocument = contextQuery.data;
  const session = sessionQuery.data;
  const workflowNotice = notice ?? (session?.last_error ? { type: "error" as const, text: session.last_error } : null);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (providerSettings?.model) {
      setProviderKind(providerKindFromSettings(providerSettings.provider));
      setProviderModel(providerSettings.model);
      setProviderBaseUrl(providerSettings.base_url ?? "");
    }
  }, [providerSettings?.provider, providerSettings?.model, providerSettings?.base_url]);

  useEffect(() => {
    if (contextDocument?.policy.max_row_count) {
      setDefaultRowLimit(String(contextDocument.policy.max_row_count));
    }
  }, [contextDocument?.policy.max_row_count]);

  function submitCurrentMessage() {
    if (!message.trim() || busy || !setupStatus?.ready) return;
    sendMutation.mutate();
  }

  function toggleTheme() {
    setTheme((current) => {
      const next = current === "dark" ? "light" : "dark";
      saveTheme(next);
      return next;
    });
  }

  if (setupQuery.isLoading) {
    return (
      <CenteredShell status={null} theme={theme} onToggleTheme={toggleTheme}>
        <InlineStatus text="Checking setup" />
      </CenteredShell>
    );
  }

  if (!setupStatus?.ready) {
    return (
      <CenteredShell status={setupStatus ?? null} theme={theme} onToggleTheme={toggleTheme}>
        <SetupFallback
          status={setupStatus ?? null}
          providerSettings={providerSettings}
          provider={providerKind}
          model={providerModel}
          baseUrl={providerBaseUrl}
          apiKey={providerApiKey}
          busy={busy}
          notice={notice}
          onProviderChange={handleProviderChange}
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
    <main className="flex h-svh min-w-0 flex-col overflow-hidden bg-background text-foreground">
      <AppHeader
        status={setupStatus}
        session={session ?? null}
        busy={busy}
        theme={theme}
        contextDocument={contextDocument}
        providerSettings={providerSettings}
        provider={providerKind}
        model={providerModel}
        baseUrl={providerBaseUrl}
        apiKey={providerApiKey}
        defaultRowLimit={defaultRowLimit}
        onToggleTheme={toggleTheme}
        onNewSession={() => startSessionMutation.mutate()}
        onDefaultRowLimitChange={setDefaultRowLimit}
        onSaveSafety={() => safetyMutation.mutate()}
        onProviderChange={handleProviderChange}
        onModelChange={setProviderModel}
        onBaseUrlChange={setProviderBaseUrl}
        onApiKeyChange={setProviderApiKey}
        onSaveProvider={() => providerMutation.mutate()}
        onRescanContext={() => rescanContextMutation.mutate()}
        databaseTest={databaseTest}
        onTestDatabase={() => databaseTestMutation.mutate()}
      />
      <section className="mx-auto grid min-h-0 w-full max-w-7xl flex-1 grid-cols-1 gap-4 px-4 pb-4 lg:grid-cols-[minmax(0,1fr)_minmax(360px,440px)] lg:px-6" aria-label="CSV Chat">
        <ConversationPane
          session={session ?? null}
          proposal={proposal}
          notice={workflowNotice}
          message={message}
          busy={busy}
          sending={sendMutation.isPending}
          planning={proposeMutation.isPending}
          onMessageChange={setMessage}
          onSubmit={submitCurrentMessage}
          onSuggestion={setMessage}
        />
        <ArtifactPanel
          session={session ?? null}
          proposal={proposal}
          sqlPrep={sqlPrep}
          exportResult={exportResult}
          traces={session?.debug_traces ?? []}
          planning={proposeMutation.isPending}
          preparing={prepareMutation.isPending}
          exporting={exportMutation.isPending}
          busy={busy}
          onApprove={(intent) => approveMutation.mutate(intent)}
          onPrepare={() => prepareMutation.mutate(sessionId ?? undefined)}
          onExport={() => exportMutation.mutate()}
        />
      </section>
    </main>
  );
}

function AppHeader({
  status,
  session,
  busy,
  theme,
  contextDocument,
  providerSettings,
  provider,
  model,
  baseUrl,
  apiKey,
  defaultRowLimit,
  onToggleTheme,
  onNewSession,
  onDefaultRowLimitChange,
  onSaveSafety,
  onProviderChange,
  onModelChange,
  onBaseUrlChange,
  onApiKeyChange,
  onSaveProvider,
  onRescanContext,
  databaseTest,
  onTestDatabase
}: {
  status: SetupStatusResponse;
  session: ExportSession | null;
  busy: boolean;
  theme: Theme;
  contextDocument?: ContextDocument;
  providerSettings?: ModelProviderSettingsResponse;
  provider: ProviderKind;
  model: string;
  baseUrl: string;
  apiKey: string;
  defaultRowLimit: string;
  onToggleTheme: () => void;
  onNewSession: () => void;
  onDefaultRowLimitChange: (value: string) => void;
  onSaveSafety: () => void;
  onProviderChange: (value: ProviderKind) => void;
  onModelChange: (value: string) => void;
  onBaseUrlChange: (value: string) => void;
  onApiKeyChange: (value: string) => void;
  onSaveProvider: () => void;
  onRescanContext: () => void;
  databaseTest: DatabaseConnectionTestResponse | null;
  onTestDatabase: () => void;
}) {
  return (
    <header className="mx-auto flex w-full max-w-7xl shrink-0 items-center justify-between gap-3 px-4 py-4 lg:px-6">
      <div className="min-w-0">
        <h1 className="truncate font-heading text-sm font-medium">CSV Chat</h1>
        <p className="truncate text-xs text-muted-foreground">{session ? statusLabel(session.status) : "Chat to validated CSV"}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <ReadinessBadge status={status} />
        <SettingsDialog
          status={status}
          contextDocument={contextDocument}
          providerSettings={providerSettings}
          provider={provider}
          model={model}
          baseUrl={baseUrl}
          apiKey={apiKey}
          defaultRowLimit={defaultRowLimit}
          onDefaultRowLimitChange={onDefaultRowLimitChange}
          onSaveSafety={onSaveSafety}
          busy={busy}
          onProviderChange={onProviderChange}
          onModelChange={onModelChange}
          onBaseUrlChange={onBaseUrlChange}
          onApiKeyChange={onApiKeyChange}
          onSaveProvider={onSaveProvider}
          onRescanContext={onRescanContext}
          databaseTest={databaseTest}
          onTestDatabase={onTestDatabase}
        />
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
        {session ? (
          <Button size="icon-sm" variant="ghost" type="button" onClick={onNewSession} disabled={busy} aria-label="New CSV">
            <PlusIcon data-icon="inline-start" />
          </Button>
        ) : null}
      </div>
    </header>
  );
}

function SettingsDialog({
  status,
  contextDocument,
  providerSettings,
  provider,
  model,
  baseUrl,
  apiKey,
  defaultRowLimit,
  busy,
  onDefaultRowLimitChange,
  onSaveSafety,
  onProviderChange,
  onModelChange,
  onBaseUrlChange,
  onApiKeyChange,
  onSaveProvider,
  onRescanContext,
  databaseTest,
  onTestDatabase
}: {
  status: SetupStatusResponse;
  contextDocument?: ContextDocument;
  providerSettings?: ModelProviderSettingsResponse;
  provider: ProviderKind;
  model: string;
  baseUrl: string;
  apiKey: string;
  defaultRowLimit: string;
  busy: boolean;
  onDefaultRowLimitChange: (value: string) => void;
  onSaveSafety: () => void;
  onProviderChange: (value: ProviderKind) => void;
  onModelChange: (value: string) => void;
  onBaseUrlChange: (value: string) => void;
  onApiKeyChange: (value: string) => void;
  onSaveProvider: () => void;
  onRescanContext: () => void;
  databaseTest: DatabaseConnectionTestResponse | null;
  onTestDatabase: () => void;
}) {
  return (
    <Dialog>
      <DialogTrigger render={<Button type="button" variant="ghost" size="icon-sm" aria-label="Settings" />}>
        <SettingsIcon data-icon="inline-start" />
      </DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Database status, export safety, and model provider settings.</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="database">
          <TabsList>
            <TabsTrigger value="database">Database</TabsTrigger>
            <TabsTrigger value="safety">Safety</TabsTrigger>
            <TabsTrigger value="provider">Provider</TabsTrigger>
          </TabsList>
          <TabsContent value="database" className="flex flex-col gap-4">
            <DatabaseSettingsPanel
              status={status}
              busy={busy}
              databaseTest={databaseTest}
              onTestDatabase={onTestDatabase}
              onRescanContext={onRescanContext}
            />
          </TabsContent>
          <TabsContent value="safety">
            <SafetySettingsPanel
              contextDocument={contextDocument}
              defaultRowLimit={defaultRowLimit}
              busy={busy}
              onDefaultRowLimitChange={onDefaultRowLimitChange}
              onSave={onSaveSafety}
            />
          </TabsContent>
          <TabsContent value="provider">
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
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function DatabaseSettingsPanel({
  status,
  busy,
  databaseTest,
  onTestDatabase,
  onRescanContext
}: {
  status: SetupStatusResponse;
  busy: boolean;
  databaseTest: DatabaseConnectionTestResponse | null;
  onTestDatabase: () => void;
  onRescanContext: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Database connection</CardTitle>
          <CardDescription>{status.database.ready ? "Configured by the local backend `.env` file." : status.database.message ?? "Database setup needs attention."}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <ContextSourceDetails status={status} />
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">Database credentials are not edited in the browser for V0. To change the database, update `.env`, restart or refresh the backend, then rescan context.</p>
            <CodeBlock>
              <CodeBlockCode code="DATABASE_URL=postgresql://readonly:password@localhost:5432/appdb" language="shell" />
            </CodeBlock>
          </div>
          {databaseTest ? (
            <SystemMessage variant={databaseTest.ok ? "action" : "error"}>{databaseTest.message}</SystemMessage>
          ) : null}
        </CardContent>
        <CardFooter>
          <Button type="button" variant="outline" onClick={onTestDatabase} disabled={busy}>
            {busy ? <Spinner data-icon="inline-start" /> : <CheckIcon data-icon="inline-start" />}
            Test connection
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Context</CardTitle>
          <CardDescription>{status.context.ready ? "Database context is ready for CSV requests." : status.context.message ?? "Context needs to be prepared."}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">Rescan after changing `.env` or after schema changes. Local context notes and policy stay file-based for V0.</p>
          <Button type="button" variant="outline" onClick={onRescanContext} disabled={busy || !status.database.ready}>
            {busy ? <Spinner data-icon="inline-start" /> : <RefreshCwIcon data-icon="inline-start" />}
            Rescan context
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function ThemeToggle({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  const dark = theme === "dark";
  return (
    <Button size="icon-sm" variant="ghost" type="button" onClick={onToggle} aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}>
      {dark ? <SunIcon data-icon="inline-start" /> : <MoonIcon data-icon="inline-start" />}
    </Button>
  );
}

function ConversationPane({
  session,
  proposal,
  notice,
  message,
  busy,
  sending,
  planning,
  onMessageChange,
  onSubmit,
  onSuggestion
}: {
  session: ExportSession | null;
  proposal: CSVIntentProposal | null;
  notice: Notice;
  message: string;
  busy: boolean;
  sending: boolean;
  planning: boolean;
  onMessageChange: (value: string) => void;
  onSubmit: () => void;
  onSuggestion: (value: string) => void;
}) {
  const messages = conversationMessages(session?.messages ?? [], proposal);
  const empty = !messages.length && !proposal && !planning;

  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border bg-card" aria-label="Conversation">
      <ChatContainerRoot className="relative min-h-0 flex-1 px-4">
        <ChatContainerContent className="min-h-full py-6">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
            {notice ? <NoticeBanner notice={notice} /> : null}
            {empty ? <EmptyChat onSuggestion={onSuggestion} /> : null}
            {messages.map((item, index) => (
              <ChatBubble key={`${item.role}-${index}-${item.content}`} message={item} />
            ))}
            {planning ? <AssistantStatus text="Drafting CSV plan" /> : null}
          </div>
          <ChatContainerScrollAnchor />
        </ChatContainerContent>
        <div className="pointer-events-none sticky bottom-3 flex justify-center">
          <ScrollButton className="pointer-events-auto" />
        </div>
      </ChatContainerRoot>
      <div className="shrink-0 border-t bg-background/80 p-3">
        <div className="mx-auto max-w-3xl">
          <PromptInput
            value={message}
            onValueChange={onMessageChange}
            onSubmit={onSubmit}
            isLoading={sending || planning}
            disabled={busy}
            maxHeight={160}
          >
            <PromptInputTextarea placeholder="Describe the CSV you need" disabled={busy} />
            <PromptInputActions className="justify-end pt-2">
              <PromptInputAction tooltip="Send">
                <Button
                  size="icon"
                  type="button"
                  disabled={busy || !message.trim()}
                  aria-label="Send"
                  onClick={onSubmit}
                  className="rounded-full"
                >
                  {sending || planning ? <Spinner data-icon="inline-start" /> : <ArrowUp data-icon="inline-start" />}
                </Button>
              </PromptInputAction>
            </PromptInputActions>
          </PromptInput>
        </div>
      </div>
    </section>
  );
}

function EmptyChat({ onSuggestion }: { onSuggestion: (value: string) => void }) {
  return (
    <div className="flex min-h-[45svh] flex-col justify-center gap-5">
      <div className="flex flex-col gap-2">
        <h2 className="font-heading text-2xl font-medium tracking-normal">What CSV do you need?</h2>
        <p className="max-w-xl text-sm text-muted-foreground">Describe the file in plain language. You will approve the CSV plan before the app prepares or creates anything.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {EXAMPLE_REQUESTS.map((request) => (
          <PromptSuggestion key={request} size="sm" className="h-auto max-w-full whitespace-normal" onClick={() => onSuggestion(request)}>
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
    <Message className={cn(user ? "justify-end" : "justify-start")}>
      <MessageContent
        markdown={!user}
        className={cn(
          "text-sm",
          user ? "max-w-[85%] rounded-3xl bg-muted px-5 py-2.5 text-foreground sm:max-w-[75%]" : "w-full flex-1 bg-transparent p-0 text-foreground"
        )}
      >
        {message.content}
      </MessageContent>
    </Message>
  );
}

function AssistantStatus({ text }: { text: string }) {
  return (
    <Message className="justify-start">
      <div className="rounded-lg bg-transparent p-0 text-foreground">
        <InlineStatus text={text} />
      </div>
    </Message>
  );
}

function ArtifactPanel({
  session,
  proposal,
  sqlPrep,
  exportResult,
  traces,
  planning,
  preparing,
  exporting,
  busy,
  onApprove,
  onPrepare,
  onExport
}: {
  session: ExportSession | null;
  proposal: CSVIntentProposal | null;
  sqlPrep: SQLPreparationResponse | null;
  exportResult: ExportCreateResponse | null;
  traces: SessionDebugTrace[];
  planning: boolean;
  preparing: boolean;
  exporting: boolean;
  busy: boolean;
  onApprove: (intent: CSVIntent) => void;
  onPrepare: () => void;
  onExport: () => void;
}) {
  const approved = session?.approved_intent ?? null;
  const intent = approved ?? proposal?.intent ?? null;
  const hasAdvancedDetails = Boolean(sqlPrep || traces.length);

  return (
    <aside className="min-h-[420px] overflow-hidden rounded-xl border bg-card lg:min-h-0" aria-label="CSV artifact">
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b p-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <FileSpreadsheetIcon className="text-muted-foreground" />
              <h2 className="truncate font-heading text-sm font-medium">CSV plan</h2>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {artifactSubtitle({ planning, preparing, exporting, approved, sqlPrep, exportResult, hasIntent: Boolean(intent) })}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {approved ? <Badge variant="outline">approved</Badge> : null}
            {exportResult ? <Badge variant="secondary">ready</Badge> : null}
            {hasAdvancedDetails ? <AdvancedDialog sqlPrep={sqlPrep} traces={traces} /> : null}
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4">
          {!intent && !planning ? <EmptyArtifact /> : null}
          {planning ? <InlineStatus text="Drafting CSV plan" /> : null}
          {intent ? <PlanArtifact intent={intent} approved={Boolean(approved)} /> : null}
          {preparing ? <SafetyStatus mode="checking" /> : null}
          {sqlPrep?.valid && !exportResult ? <SafetyStatus mode="ready" /> : null}
          {sqlPrep && !sqlPrep.valid ? <SystemMessage variant="error">The CSV could not be prepared. Open Advanced for validation details.</SystemMessage> : null}
          {exporting ? <InlineStatus text="Creating CSV" /> : null}
          {exportResult ? <ExportSummary exportResult={exportResult} /> : null}
        </div>

        <ArtifactActions
          intent={intent}
          approved={Boolean(approved)}
          sqlPrep={sqlPrep}
          exportResult={exportResult}
          busy={busy}
          onApprove={onApprove}
          onPrepare={onPrepare}
          onExport={onExport}
        />
      </div>
    </aside>
  );
}

function EmptyArtifact() {
  return (
    <Empty className="min-h-[300px]">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FileSpreadsheetIcon />
        </EmptyMedia>
        <EmptyTitle>CSV plan will appear here</EmptyTitle>
        <EmptyDescription>Start in chat. The plan becomes the artifact you approve.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function PlanArtifact({ intent, approved }: { intent: CSVIntent; approved: boolean }) {
  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-medium text-muted-foreground">{approved ? "Approved CSV plan" : "Draft CSV plan"}</p>
          <Badge variant={approved ? "outline" : "secondary"}>{approved ? "locked" : "review"}</Badge>
        </div>
        <h3 className="text-lg font-medium">{intent.summary}</h3>
        <p className="text-sm text-muted-foreground">{intent.row_meaning}</p>
      </section>
      <Separator />
      <section className="flex flex-col gap-2">
        <p className="text-xs font-medium text-muted-foreground">Columns</p>
        <div className="flex flex-col gap-2">
          {intent.columns.map((column) => (
            <Card key={column.name} size="sm">
              <CardHeader>
                <CardTitle>{column.name}</CardTitle>
                <CardDescription>{column.description}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </section>
      {intent.filters.length ? <TextList title="Filters" items={intent.filters} /> : null}
      {intent.derived_fields.length ? <TextList title="Calculated fields" items={intent.derived_fields} /> : null}
      {intent.assumptions.length ? <TextList title="Assumptions" items={intent.assumptions} /> : null}
    </div>
  );
}

function SafetyStatus({ mode }: { mode: "checking" | "ready" }) {
  return (
    <div className="rounded-xl border bg-card p-4 text-card-foreground">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">{mode === "checking" ? "Checking CSV" : "Ready to create"}</p>
        <p className="text-sm text-muted-foreground">{mode === "checking" ? "The app is validating the export before anything runs." : "Validation passed. The app will create the file with read-only limits."}</p>
      </div>
      <div className="mt-4 flex flex-col gap-3 text-sm">
        <SafetyLine icon={<LockKeyholeIcon />} text="Read-only database access" done={mode === "ready"} />
        <SafetyLine icon={<ShieldCheckIcon />} text="Approved columns and source hints checked" done={mode === "ready"} />
        <SafetyLine icon={<FileSpreadsheetIcon />} text="Row, size, and spreadsheet-safety limits" done={mode === "ready"} />
      </div>
    </div>
  );
}

function SafetyLine({ icon, text, done }: { icon: ReactNode; text: string; done: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className={cn("text-muted-foreground", done && "text-foreground")}>{icon}</span>
      <span className={cn(done ? "text-foreground" : "text-muted-foreground")}>{text}</span>
    </div>
  );
}

function ExportSummary({ exportResult }: { exportResult: ExportCreateResponse }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>CSV ready</CardTitle>
        <CardDescription>{exportResult.row_count} rows exported.</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-2 text-sm text-muted-foreground">
          <Line label="Rows" value={exportResult.row_count} />
          <Line label="Columns" value={exportResult.columns.length} />
        </dl>
      </CardContent>
    </Card>
  );
}

function ArtifactActions({
  intent,
  approved,
  sqlPrep,
  exportResult,
  busy,
  onApprove,
  onPrepare,
  onExport
}: {
  intent: CSVIntent | null;
  approved: boolean;
  sqlPrep: SQLPreparationResponse | null;
  exportResult: ExportCreateResponse | null;
  busy: boolean;
  onApprove: (intent: CSVIntent) => void;
  onPrepare: () => void;
  onExport: () => void;
}) {
  if (!intent && !exportResult) return null;

  return (
    <div className="shrink-0 border-t bg-background/80 p-4">
      {!approved && intent ? (
        <Button type="button" className="w-full" onClick={() => onApprove(intent)} disabled={busy}>
          {busy ? <Spinner data-icon="inline-start" /> : <CheckIcon data-icon="inline-start" />}
          Approve CSV plan
        </Button>
      ) : null}
      {sqlPrep?.valid && !exportResult ? (
        <Button type="button" className="w-full" onClick={onExport} disabled={busy}>
          {busy ? <Spinner data-icon="inline-start" /> : <CheckIcon data-icon="inline-start" />}
          Create CSV
        </Button>
      ) : null}
      {approved && sqlPrep && !sqlPrep.valid && !exportResult ? (
        <Button type="button" className="w-full" onClick={onPrepare} disabled={busy}>
          {busy ? <Spinner data-icon="inline-start" /> : <RefreshCwIcon data-icon="inline-start" />}
          Try again
        </Button>
      ) : null}
      {exportResult ? (
        <div className="flex flex-col gap-2">
          <a className={cn(buttonVariants({ variant: "default" }), "w-full")} href={exportResult.download_url}>
            <DownloadIcon data-icon="inline-start" />
            Download CSV
          </a>
        </div>
      ) : null}
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
          <DialogDescription>Read-only SQL, validation, and debug details.</DialogDescription>
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
            <Card key={`${attempt.sql}-${index}`} size="sm">
              <CardHeader>
                <CardTitle>
                  Attempt {index + 1}: {attempt.valid ? "valid" : "invalid"}
                </CardTitle>
                {attempt.errors.length ? <CardDescription className="text-destructive">{attempt.errors.join("; ")}</CardDescription> : null}
                {attempt.repair_changes.length ? <CardDescription>{attempt.repair_changes.join("; ")}</CardDescription> : null}
              </CardHeader>
            </Card>
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
  provider: ProviderKind;
  model: string;
  baseUrl: string;
  apiKey: string;
  busy: boolean;
  notice: Notice;
  onProviderChange: (value: ProviderKind) => void;
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

function SafetySettingsPanel({
  contextDocument,
  defaultRowLimit,
  busy,
  onDefaultRowLimitChange,
  onSave
}: {
  contextDocument?: ContextDocument;
  defaultRowLimit: string;
  busy: boolean;
  onDefaultRowLimitChange: (value: string) => void;
  onSave: () => void;
}) {
  const parsedLimit = Number(defaultRowLimit);
  const invalid = !Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 100000;

  return (
    <Card aria-label="Export safety settings">
      <CardHeader>
        <CardTitle>Export safety</CardTitle>
        <CardDescription>Limits that keep generated CSVs bounded before anything runs.</CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <Field data-invalid={invalid || undefined}>
            <FieldLabel htmlFor="default-row-limit">Default row limit</FieldLabel>
            <Input
              id="default-row-limit"
              type="number"
              min={1}
              max={100000}
              step={1}
              value={defaultRowLimit}
              onChange={(event) => onDefaultRowLimitChange(event.target.value)}
              disabled={!contextDocument || busy}
            />
            <FieldDescription>Maximum rows a CSV can include by default. Allowed range: 1 to 100000.</FieldDescription>
          </Field>
        </FieldGroup>
      </CardContent>
      <CardFooter>
        <Button type="button" onClick={onSave} disabled={busy || !contextDocument || invalid}>
          {busy ? <Spinner data-icon="inline-start" /> : <CheckIcon data-icon="inline-start" />}
          Save
        </Button>
      </CardFooter>
    </Card>
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
  provider: ProviderKind;
  model: string;
  baseUrl: string;
  apiKey: string;
  busy: boolean;
  onProviderChange: (value: ProviderKind) => void;
  onModelChange: (value: string) => void;
  onBaseUrlChange: (value: string) => void;
  onApiKeyChange: (value: string) => void;
  onSave: () => void;
}) {
  const custom = provider === "custom";
  const opencode = provider === "opencode";
  const savedKeyMatches =
    Boolean(settings?.api_key_configured) &&
    settings?.provider === provider &&
    (settings.base_url ?? null) === (custom ? baseUrl.trim() : null);
  const disabled = busy || !model.trim() || (custom && !baseUrl.trim()) || (!opencode && !apiKey.trim() && !savedKeyMatches);

  return (
    <Card aria-label="Provider settings">
      <CardHeader>
        <CardTitle>Model provider</CardTitle>
        <CardDescription>{settings?.api_key_configured ? "Editable here. API key saved locally by the backend." : "Add provider details. These settings can be edited here."}</CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <Field>
            <FieldLabel>Provider</FieldLabel>
            <ToggleGroup
              value={[provider]}
              onValueChange={(value) => {
                const nextValue = value[value.length - 1];
                if (nextValue === "openrouter" || nextValue === "openai" || nextValue === "opencode" || nextValue === "custom") onProviderChange(nextValue);
              }}
              variant="outline"
              size="sm"
            >
              <ToggleGroupItem value="openrouter">OpenRouter</ToggleGroupItem>
              <ToggleGroupItem value="openai">OpenAI</ToggleGroupItem>
              <ToggleGroupItem value="opencode">OpenCode Zen</ToggleGroupItem>
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
              <Input id="provider-base-url" value={baseUrl} onChange={(event) => onBaseUrlChange(event.target.value)} placeholder="http://127.0.0.1:4010/v1" />
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
            <FieldDescription>{opencode ? "Optional for free Zen models. Stored locally by the backend if provided." : "Stored locally by the backend."}</FieldDescription>
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

function CenteredShell({
  status,
  theme,
  onToggleTheme,
  children
}: {
  status: SetupStatusResponse | null;
  theme: Theme;
  onToggleTheme: () => void;
  children: ReactNode;
}) {
  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-4 py-10 text-foreground">
      <section className="flex w-full max-w-lg flex-col gap-6">
        <header className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate font-heading text-sm font-medium">CSV Chat</h1>
            <p className="truncate text-xs text-muted-foreground">Chat to validated CSV</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <ReadinessBadge status={status} />
            <ThemeToggle theme={theme} onToggle={onToggleTheme} />
          </div>
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

function conversationMessages(messages: ChatMessage[], proposal: CSVIntentProposal | null) {
  if (!proposal?.message) return messages;
  const hasProposalMessage = messages.some((item) => item.role === "assistant" && item.content === proposal.message);
  return hasProposalMessage ? messages : [...messages, { role: "assistant", content: proposal.message }];
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

function providerKindFromSettings(provider: string): ProviderKind {
  if (provider === "openai" || provider === "opencode" || provider === "custom") return provider;
  return "openrouter";
}

function artifactSubtitle({
  planning,
  preparing,
  exporting,
  approved,
  sqlPrep,
  exportResult,
  hasIntent
}: {
  planning: boolean;
  preparing: boolean;
  exporting: boolean;
  approved: CSVIntent | null;
  sqlPrep: SQLPreparationResponse | null;
  exportResult: ExportCreateResponse | null;
  hasIntent: boolean;
}) {
  if (exportResult) return "Download is ready.";
  if (exporting) return "Creating the downloadable file.";
  if (sqlPrep?.valid) return "Validation passed.";
  if (preparing) return "Checking the approved plan.";
  if (approved) return "Approved and ready for validation.";
  if (hasIntent) return "Review before anything runs.";
  if (planning) return "Drafting from your request.";
  return "The current CSV appears here.";
}

function initialTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  const saved = readStoredTheme();
  if (saved === "light" || saved === "dark") return saved;
  if (typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: light)").matches) return "light";
  return "dark";
}

function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.style.colorScheme = theme;
}

function saveTheme(theme: Theme) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Theme persistence is best-effort; keep the in-memory toggle working.
  }
}

function readStoredTheme() {
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    return null;
  }
}
