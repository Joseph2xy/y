import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUp,
  CheckIcon,
  DownloadIcon,
  FileSpreadsheetIcon,
  LockKeyholeIcon,
  MoreHorizontalIcon,
  MoonIcon,
  PlusIcon,
  PlayIcon,
  RefreshCwIcon,
  SaveIcon,
  SettingsIcon,
  ShieldCheckIcon,
  SunIcon,
  TerminalIcon,
  Trash2Icon
} from "lucide-react";
import { ReactNode, useEffect, useRef, useState } from "react";
import {
  addMessage,
  approveIntent,
  bootstrapSetup,
  createSavedCSVPlan,
  createSession,
  createSessionExport,
  deleteSavedCSVPlan,
  getContext,
  getModelProviderSettings,
  getSession,
  getSetupStatus,
  listSavedCSVPlans,
  prepareSql,
  proposeIntent,
  rescanContext,
  runSavedCSVPlan,
  testDatabaseConnection,
  updateContext,
  updateSavedCSVPlan,
  updateModelProviderSettings
} from "./api";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
  SavedCSVPlan,
  SQLPreparationResponse,
  SessionDebugTrace,
  SetupStatusResponse
} from "./types";

type Notice = { type: "error" | "info"; text: string } | null;
type Theme = "light" | "dark";
type ProviderKind = "openrouter" | "openai" | "opencode" | "custom";
type AppView = "new" | "saved";
type SavedCSVAction = "rename" | "details" | "delete";

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
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const [activeView, setActiveView] = useState<AppView>("new");
  const [savedPlanForExportId, setSavedPlanForExportId] = useState<SavedCSVPlan | null>(null);
  const [savedRunPlan, setSavedRunPlan] = useState<SavedCSVPlan | null>(null);
  const [savedRunResult, setSavedRunResult] = useState<ExportCreateResponse | null>(null);
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

  const savedPlansQuery = useQuery({
    queryKey: ["saved-csv-plans"],
    queryFn: listSavedCSVPlans,
    enabled: Boolean(setupQuery.data?.ready)
  });

  const startSessionMutation = useMutation({
    mutationFn: createSession,
    onSuccess: (session) => {
      setActiveView("new");
      setSessionId(session.id);
      setProposal(null);
      setSqlPrep(null);
      setExportResult(null);
      setSavedPlanForExportId(null);
      setSavedRunPlan(null);
      setSavedRunResult(null);
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
      if (response.valid) {
        exportMutation.mutate({ sessionId: preparedSessionId, sql: response.sql });
      }
    },
    onError: showError
  });

  const exportMutation = useMutation({
    mutationFn: async (request?: { sessionId?: string; sql?: string }) => {
      const activeSessionId = request?.sessionId ?? sessionId;
      const sql = request?.sql ?? sqlPrep?.sql;
      if (!activeSessionId) throw new Error("Start a session first.");
      if (!sql) throw new Error("Prepare the export before running it.");
      return createSessionExport(activeSessionId, sql);
    },
    onSuccess: (response) => {
      setExportResult(response);
      setSavedPlanForExportId(null);
      setNotice(null);
      void queryClient.invalidateQueries({ queryKey: ["session", sessionId] });
    },
    onError: showError
  });

  const savePlanMutation = useMutation({
    mutationFn: async (request: { name: string; description: string | null }) => {
      if (!sessionId) throw new Error("Start a session first.");
      if (!sqlPrep?.sql) throw new Error("Prepare the CSV before saving it.");
      return createSavedCSVPlan({
        session_id: sessionId,
        name: request.name,
        description: request.description
      });
    },
    onSuccess: (plan) => {
      setSavedPlanForExportId(plan);
      setNotice({ type: "info", text: `Saved as "${plan.name}".` });
      queryClient.setQueryData<SavedCSVPlan[]>(["saved-csv-plans"], (plans) => [plan, ...(plans ?? [])]);
      void queryClient.invalidateQueries({ queryKey: ["saved-csv-plans"] });
    },
    onError: showError
  });

  const runSavedPlanMutation = useMutation({
    mutationFn: async (plan: SavedCSVPlan) => ({ plan, response: await runSavedCSVPlan(plan.id) }),
    onMutate: (plan) => {
      setActiveView("saved");
      setSavedRunPlan(plan);
      setSavedRunResult(null);
      setNotice(null);
    },
    onSuccess: ({ plan, response }) => {
      setSavedRunPlan(plan);
      setSavedRunResult(response);
      setNotice(null);
      void queryClient.invalidateQueries({ queryKey: ["saved-csv-plans"] });
    },
    onError: (error) => {
      setSavedRunPlan(null);
      setSavedRunResult(null);
      showError(error);
    }
  });

  const updateSavedPlanMutation = useMutation({
    mutationFn: (request: { planId: string; name: string; description: string | null }) =>
      updateSavedCSVPlan(request.planId, { name: request.name, description: request.description }),
    onSuccess: () => {
      setNotice({ type: "info", text: "Saved CSV updated." });
      void queryClient.invalidateQueries({ queryKey: ["saved-csv-plans"] });
    },
    onError: showError
  });

  const deleteSavedPlanMutation = useMutation({
    mutationFn: deleteSavedCSVPlan,
    onSuccess: () => {
      setNotice({ type: "info", text: "Saved CSV deleted." });
      setSavedRunPlan(null);
      setSavedRunResult(null);
      void queryClient.invalidateQueries({ queryKey: ["saved-csv-plans"] });
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
    savePlanMutation.isPending ||
    runSavedPlanMutation.isPending ||
    updateSavedPlanMutation.isPending ||
    deleteSavedPlanMutation.isPending ||
    sendMutation.isPending ||
    proposeMutation.isPending ||
    approveMutation.isPending ||
    prepareMutation.isPending ||
    exportMutation.isPending;

  const setupStatus = setupQuery.data;
  const providerSettings = providerQuery.data;
  const contextDocument = contextQuery.data;
  const session = sessionQuery.data;
  const savedPlans = savedPlansQuery.data ?? [];
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

  const exportRunningOrComplete = approveMutation.isPending || Boolean(session?.approved_intent) || Boolean(exportResult);

  useEffect(() => {
    if (!exportRunningOrComplete) {
      setChatCollapsed(false);
      return;
    }
    const timer = window.setTimeout(() => setChatCollapsed(true), 260);
    return () => window.clearTimeout(timer);
  }, [exportRunningOrComplete]);

  function submitCurrentMessage() {
    if (!message.trim() || busy || !setupStatus?.ready || exportResult) return;
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

  const artifactFocused = exportRunningOrComplete && chatCollapsed;
  const showConversation = !exportRunningOrComplete || !chatCollapsed;

  return (
    <main className="flex h-svh min-w-0 flex-col overflow-hidden bg-background text-foreground">
      <AppHeader
        status={setupStatus}
        session={session ?? null}
        busy={busy}
        theme={theme}
        activeView={activeView}
        contextDocument={contextDocument}
        providerSettings={providerSettings}
        provider={providerKind}
        model={providerModel}
        baseUrl={providerBaseUrl}
        apiKey={providerApiKey}
        defaultRowLimit={defaultRowLimit}
        onToggleTheme={toggleTheme}
        onViewChange={setActiveView}
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
      {activeView === "saved" ? (
        <SavedCSVsView
          plans={savedPlans}
          loading={savedPlansQuery.isLoading}
          busy={busy}
          notice={notice}
          contextDocument={contextDocument}
          runningPlan={savedRunPlan}
          runResult={savedRunResult}
          running={runSavedPlanMutation.isPending}
          onRun={(plan) => runSavedPlanMutation.mutate(plan)}
          onUpdate={(planId, name, description) => updateSavedPlanMutation.mutate({ planId, name, description })}
          onDelete={(planId) => deleteSavedPlanMutation.mutate(planId)}
          onNewSession={() => startSessionMutation.mutate()}
        />
      ) : (
        <section
          className={cn(
            "mx-auto grid min-h-0 w-full flex-1 grid-cols-1 gap-4 px-4 pb-4 transition-[max-width] duration-300 ease-out lg:px-6",
            artifactFocused ? "max-w-2xl" : "max-w-7xl lg:grid-cols-[minmax(0,1fr)_minmax(360px,440px)]"
          )}
          aria-label="CSV Chat"
        >
          {showConversation ? (
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
              className={cn(exportRunningOrComplete && "pointer-events-none opacity-0 scale-[0.985]")}
            />
          ) : null}
          <ArtifactPanel
            session={session ?? null}
            proposal={proposal}
            sqlPrep={sqlPrep}
            exportResult={exportResult}
            traces={session?.debug_traces ?? []}
            planning={proposeMutation.isPending}
            approving={approveMutation.isPending}
            preparing={prepareMutation.isPending}
            exporting={exportMutation.isPending}
            busy={busy}
            savedPlan={savedPlanForExportId}
            saving={savePlanMutation.isPending}
            onApprove={(intent) => approveMutation.mutate(intent)}
            onPrepare={() => prepareMutation.mutate(sessionId ?? undefined)}
            onSavePlan={(name, description) => savePlanMutation.mutate({ name, description })}
            onNewSession={() => startSessionMutation.mutate()}
          />
        </section>
      )}
    </main>
  );
}

function AppHeader({
  status,
  session,
  busy,
  theme,
  activeView,
  contextDocument,
  providerSettings,
  provider,
  model,
  baseUrl,
  apiKey,
  defaultRowLimit,
  onToggleTheme,
  onViewChange,
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
  activeView: AppView;
  contextDocument?: ContextDocument;
  providerSettings?: ModelProviderSettingsResponse;
  provider: ProviderKind;
  model: string;
  baseUrl: string;
  apiKey: string;
  defaultRowLimit: string;
  onToggleTheme: () => void;
  onViewChange: (view: AppView) => void;
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
        <ToggleGroup
          value={[activeView]}
          onValueChange={(value) => {
            const nextValue = value[value.length - 1];
            if (nextValue === "new" || nextValue === "saved") onViewChange(nextValue);
          }}
          variant="outline"
          size="sm"
        >
          <ToggleGroupItem value="new">New CSV</ToggleGroupItem>
          <ToggleGroupItem value="saved">Saved CSVs</ToggleGroupItem>
        </ToggleGroup>
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
  onSuggestion,
  className
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
  className?: string;
}) {
  const messages = conversationMessages(session?.messages ?? [], proposal);
  const empty = !messages.length && !proposal && !planning;

  return (
    <section className={cn("flex min-h-0 flex-col overflow-hidden rounded-xl border bg-card transition-all duration-300 ease-out", className)} aria-label="Conversation">
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
  approving,
  preparing,
  exporting,
  busy,
  savedPlan,
  saving,
  onApprove,
  onPrepare,
  onSavePlan,
  onNewSession
}: {
  session: ExportSession | null;
  proposal: CSVIntentProposal | null;
  sqlPrep: SQLPreparationResponse | null;
  exportResult: ExportCreateResponse | null;
  traces: SessionDebugTrace[];
  planning: boolean;
  approving: boolean;
  preparing: boolean;
  exporting: boolean;
  busy: boolean;
  savedPlan: SavedCSVPlan | null;
  saving: boolean;
  onApprove: (intent: CSVIntent) => void;
  onPrepare: () => void;
  onSavePlan: (name: string, description: string | null) => void;
  onNewSession: () => void;
}) {
  const approved = session?.approved_intent ?? null;
  const intent = approved ?? proposal?.intent ?? null;
  const hasAdvancedDetails = Boolean(sqlPrep || traces.length);
  const progressText = exportProgressText({ approving, preparing, exporting, sqlPrep, exportResult });

  return (
    <aside className="min-h-[420px] overflow-hidden rounded-xl border bg-card transition-all duration-300 ease-out lg:min-h-0" aria-label="CSV artifact">
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b p-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <FileSpreadsheetIcon className="text-muted-foreground" />
              <h2 className="truncate font-heading text-sm font-medium">CSV plan</h2>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {artifactSubtitle({ planning, approving, preparing, exporting, approved, sqlPrep, exportResult, hasIntent: Boolean(intent) })}
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
          {progressText ? <ExportProgressStatus text={progressText} /> : null}
          {preparing ? <SafetyStatus mode="checking" /> : null}
          {sqlPrep && !sqlPrep.valid ? <SystemMessage variant="error">The CSV could not be prepared. Open Advanced for validation details.</SystemMessage> : null}
        </div>

        <ArtifactActions
          intent={intent}
          approved={Boolean(approved)}
          sqlPrep={sqlPrep}
          exportResult={exportResult}
          busy={busy}
          savedPlan={savedPlan}
          saving={saving}
          onApprove={onApprove}
          onPrepare={onPrepare}
          onSavePlan={onSavePlan}
          onNewSession={onNewSession}
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
        <p className="text-sm font-medium">{mode === "checking" ? "Checking CSV" : "Validation passed"}</p>
        <p className="text-sm text-muted-foreground">{mode === "checking" ? "The app is validating the export before anything runs." : "The app is creating the file with read-only limits."}</p>
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

function ExportProgressStatus({ text }: { text: string }) {
  return (
    <div className="rounded-xl border bg-muted/30 p-4 text-card-foreground">
      <div className="flex items-center gap-3">
        <Spinner className="size-4 text-primary" />
        <div className="min-w-0">
          <ThinkingBar text={text} className="text-sm" />
          <p className="mt-1 text-xs text-muted-foreground">Keep this window open while the app validates and creates the download.</p>
        </div>
      </div>
    </div>
  );
}

function ArtifactActions({
  intent,
  approved,
  sqlPrep,
  exportResult,
  busy,
  savedPlan,
  saving,
  onApprove,
  onPrepare,
  onSavePlan,
  onNewSession
}: {
  intent: CSVIntent | null;
  approved: boolean;
  sqlPrep: SQLPreparationResponse | null;
  exportResult: ExportCreateResponse | null;
  busy: boolean;
  savedPlan: SavedCSVPlan | null;
  saving: boolean;
  onApprove: (intent: CSVIntent) => void;
  onPrepare: () => void;
  onSavePlan: (name: string, description: string | null) => void;
  onNewSession: () => void;
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
          <SaveCSVPlanDialog
            intent={intent}
            savedPlan={savedPlan}
            busy={busy}
            saving={saving}
            onSave={onSavePlan}
          />
          <Button type="button" variant="outline" className="w-full" onClick={onNewSession} disabled={busy}>
            {busy ? <Spinner data-icon="inline-start" /> : <PlusIcon data-icon="inline-start" />}
            Start over
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function SaveCSVPlanDialog({
  intent,
  savedPlan,
  busy,
  saving,
  onSave
}: {
  intent: CSVIntent | null;
  savedPlan: SavedCSVPlan | null;
  busy: boolean;
  saving: boolean;
  onSave: (name: string, description: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(intent?.summary ?? "");
  const [description, setDescription] = useState(intent?.row_meaning ?? "");

  useEffect(() => {
    if (!open) {
      setName(intent?.summary ?? "");
      setDescription(intent?.row_meaning ?? "");
    }
  }, [intent?.summary, intent?.row_meaning, open]);

  useEffect(() => {
    if (savedPlan) setOpen(false);
  }, [savedPlan]);

  if (savedPlan) {
    return (
      <Button type="button" variant="outline" className="w-full" disabled>
        <CheckIcon data-icon="inline-start" />
        Saved
      </Button>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button type="button" variant="outline" className="w-full" disabled={busy || !intent} />}>
        {saving ? <Spinner data-icon="inline-start" /> : <SaveIcon data-icon="inline-start" />}
        Save CSV Plan
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save CSV Plan</DialogTitle>
          <DialogDescription>Save this completed CSV so it can run again without chat.</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field data-invalid={!name.trim() || undefined}>
            <FieldLabel htmlFor="saved-csv-name">Name</FieldLabel>
            <Input id="saved-csv-name" value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="saved-csv-description">Description</FieldLabel>
            <Input id="saved-csv-description" value={description} onChange={(event) => setDescription(event.target.value)} />
          </Field>
        </FieldGroup>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => onSave(name.trim(), description.trim() || null)}
            disabled={saving || !name.trim()}
          >
            {saving ? <Spinner data-icon="inline-start" /> : <SaveIcon data-icon="inline-start" />}
            {saving ? "Saving" : "Save"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
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

function SavedCSVsView({
  plans,
  loading,
  busy,
  notice,
  contextDocument,
  runningPlan,
  runResult,
  running,
  onRun,
  onUpdate,
  onDelete,
  onNewSession
}: {
  plans: SavedCSVPlan[];
  loading: boolean;
  busy: boolean;
  notice: Notice;
  contextDocument?: ContextDocument;
  runningPlan: SavedCSVPlan | null;
  runResult: ExportCreateResponse | null;
  running: boolean;
  onRun: (plan: SavedCSVPlan) => void;
  onUpdate: (planId: string, name: string, description: string | null) => void;
  onDelete: (planId: string) => void;
  onNewSession: () => void;
}) {
  const [selectedAction, setSelectedAction] = useState<{ action: SavedCSVAction; plan: SavedCSVPlan } | null>(null);

  return (
    <section className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col gap-4 overflow-auto px-4 pb-4 lg:px-6" aria-label="Saved CSVs">
      {notice ? <NoticeBanner notice={notice} /> : null}
      {runningPlan || runResult ? (
        <Card>
          <CardHeader>
            <CardTitle>{runResult ? "CSV ready" : "Running saved CSV"}</CardTitle>
            <CardDescription>{runningPlan?.name ?? "Saved CSV"}</CardDescription>
          </CardHeader>
          <CardContent>
            {running ? <ExportProgressStatus text="Creating CSV" /> : null}
            {runResult ? (
              <dl className="grid gap-2 text-sm text-muted-foreground">
                <Line label="Rows" value={runResult.row_count} />
                <Line label="Columns" value={runResult.columns.length} />
              </dl>
            ) : null}
          </CardContent>
          {runResult ? (
            <CardFooter className="flex gap-2">
              <a className={cn(buttonVariants({ variant: "default" }))} href={runResult.download_url}>
                <DownloadIcon data-icon="inline-start" />
                Download CSV
              </a>
              {runningPlan ? (
                <Button type="button" variant="outline" onClick={() => onRun(runningPlan)} disabled={busy}>
                  {busy ? <Spinner data-icon="inline-start" /> : <PlayIcon data-icon="inline-start" />}
                  Run again
                </Button>
              ) : null}
            </CardFooter>
          ) : null}
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Saved CSVs</CardTitle>
          <CardDescription>Run a previously approved CSV without going through chat.</CardDescription>
          <CardAction>
            <Button type="button" variant="outline" size="sm" onClick={onNewSession} disabled={busy}>
              <PlusIcon data-icon="inline-start" />
              New CSV
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {loading ? <InlineStatus text="Loading saved CSVs" /> : null}
          {!loading && !plans.length ? <EmptySavedCSVs onNewSession={onNewSession} /> : null}
          {plans.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Last run</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {plans.map((plan) => (
                  <SavedCSVTableRow
                    key={plan.id}
                    plan={plan}
                    busy={busy}
                    contextDocument={contextDocument}
                    running={running}
                    runningPlan={runningPlan}
                    onRun={onRun}
                    onSelectAction={(action) => setSelectedAction({ action, plan })}
                  />
                ))}
              </TableBody>
            </Table>
          ) : null}
        </CardContent>
      </Card>
      <RenameSavedCSVDialog
        plan={selectedAction?.action === "rename" ? selectedAction.plan : null}
        busy={busy}
        onOpenChange={(open) => {
          if (!open) setSelectedAction(null);
        }}
        onUpdate={onUpdate}
      />
      <SavedCSVDetailsDialog
        plan={selectedAction?.action === "details" ? selectedAction.plan : null}
        onOpenChange={(open) => {
          if (!open) setSelectedAction(null);
        }}
      />
      <DeleteSavedCSVDialog
        plan={selectedAction?.action === "delete" ? selectedAction.plan : null}
        busy={busy}
        onOpenChange={(open) => {
          if (!open) setSelectedAction(null);
        }}
        onDelete={onDelete}
      />
    </section>
  );
}

function SavedCSVTableRow({
  plan,
  busy,
  contextDocument,
  running,
  runningPlan,
  onRun,
  onSelectAction
}: {
  plan: SavedCSVPlan;
  busy: boolean;
  contextDocument?: ContextDocument;
  running: boolean;
  runningPlan: SavedCSVPlan | null;
  onRun: (plan: SavedCSVPlan) => void;
  onSelectAction: (action: SavedCSVAction) => void;
}) {
  const status = savedCSVStatus(plan, contextDocument);
  const canRun = status.kind === "ready";

  return (
    <TableRow>
      <TableCell>
        <div className="flex max-w-md flex-col gap-1">
          <span className="truncate font-medium">{plan.name}</span>
          <span className="truncate text-xs text-muted-foreground">{plan.description ?? plan.intent.summary}</span>
        </div>
      </TableCell>
      <TableCell>{plan.last_run_at ? formatDateTime(plan.last_run_at) : "Never"}</TableCell>
      <TableCell>
        <div className="flex flex-col items-start gap-1">
          <Badge variant={canRun ? "outline" : "secondary"}>{status.label}</Badge>
          {!canRun ? <span className="max-w-64 text-xs text-muted-foreground">{status.description}</span> : null}
        </div>
      </TableCell>
      <TableCell>
        <div className="flex justify-end gap-2">
          <Button type="button" size="sm" onClick={() => onRun(plan)} disabled={busy || !canRun}>
            {running && runningPlan?.id === plan.id ? <Spinner data-icon="inline-start" /> : <PlayIcon data-icon="inline-start" />}
            Run
          </Button>
          <SavedCSVRowMenu plan={plan} busy={busy} onSelectAction={onSelectAction} />
        </div>
      </TableCell>
    </TableRow>
  );
}

function EmptySavedCSVs({ onNewSession }: { onNewSession: () => void }) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FileSpreadsheetIcon />
        </EmptyMedia>
        <EmptyTitle>No saved CSVs yet</EmptyTitle>
        <EmptyDescription>After a CSV is created successfully, save it from the download step.</EmptyDescription>
      </EmptyHeader>
      <Button type="button" variant="outline" onClick={onNewSession}>
        <PlusIcon data-icon="inline-start" />
        New CSV
      </Button>
    </Empty>
  );
}

function savedCSVStatus(plan: SavedCSVPlan, contextDocument?: ContextDocument) {
  if (!contextDocument) {
    return {
      kind: "blocked",
      label: "Checking",
      description: "Checking the current database."
    };
  }
  const currentFingerprint = contextDocument?.schema.source?.fingerprint ?? null;
  if (!plan.schema_fingerprint) {
    return {
      kind: "blocked",
      label: "Needs rebuild",
      description: "Saved before database matching was tracked."
    };
  }
  if (!currentFingerprint || currentFingerprint !== plan.schema_fingerprint) {
    return {
      kind: "blocked",
      label: "Different database",
      description: "Create a new saved CSV for the current database."
    };
  }
  return { kind: "ready", label: "Ready", description: null };
}

function SavedCSVRowMenu({
  plan,
  busy,
  onSelectAction
}: {
  plan: SavedCSVPlan;
  busy: boolean;
  onSelectAction: (action: SavedCSVAction) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon-sm" aria-label={`Actions for ${plan.name}`} disabled={busy} />}>
        <MoreHorizontalIcon data-icon="inline-start" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={() => onSelectAction("rename")}>Rename</DropdownMenuItem>
          <DropdownMenuItem onClick={() => onSelectAction("details")}>View details</DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={() => onSelectAction("delete")}>Delete</DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function RenameSavedCSVDialog({
  plan,
  busy,
  onOpenChange,
  onUpdate
}: {
  plan: SavedCSVPlan | null;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdate: (planId: string, name: string, description: string | null) => void;
}) {
  const [name, setName] = useState(plan?.name ?? "");
  const [description, setDescription] = useState(plan?.description ?? "");
  const inputId = plan ? `rename-${plan.id}` : "rename-saved-csv";
  const descriptionInputId = plan ? `rename-description-${plan.id}` : "rename-description-saved-csv";

  useEffect(() => {
    if (plan) {
      setName(plan.name);
      setDescription(plan.description ?? "");
    }
  }, [plan]);

  return (
    <Dialog open={Boolean(plan)} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename Saved CSV</DialogTitle>
          <DialogDescription>Update the name shown in Saved CSVs.</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field data-invalid={!name.trim() || undefined}>
            <FieldLabel htmlFor={inputId}>Name</FieldLabel>
            <Input id={inputId} value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor={descriptionInputId}>Description</FieldLabel>
            <Input id={descriptionInputId} value={description} onChange={(event) => setDescription(event.target.value)} />
          </Field>
        </FieldGroup>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => {
              if (!plan) return;
              onUpdate(plan.id, name.trim(), description.trim() || null);
              onOpenChange(false);
            }}
            disabled={busy || !plan || !name.trim()}
          >
            {busy ? <Spinner data-icon="inline-start" /> : <CheckIcon data-icon="inline-start" />}
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SavedCSVDetailsDialog({ plan, onOpenChange }: { plan: SavedCSVPlan | null; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={Boolean(plan)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{plan?.name ?? "Saved CSV"}</DialogTitle>
          <DialogDescription>{plan?.description ?? plan?.intent.summary ?? "Saved CSV details"}</DialogDescription>
        </DialogHeader>
        {plan ? (
          <>
            <PlanArtifact intent={plan.intent} approved />
            <Separator />
            <div className="flex flex-col gap-2">
              <p className="font-medium">Advanced</p>
              <CodeBlock>
                <CodeBlockCode code={plan.sql} language="sql" />
              </CodeBlock>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function DeleteSavedCSVDialog({
  plan,
  busy,
  onOpenChange,
  onDelete
}: {
  plan: SavedCSVPlan | null;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onDelete: (planId: string) => void;
}) {
  return (
    <AlertDialog open={Boolean(plan)} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete saved CSV?</AlertDialogTitle>
          <AlertDialogDescription>This removes "{plan?.name ?? "this saved CSV"}" from Saved CSVs. Existing downloaded CSV files are not changed.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction type="button" onClick={() => plan && onDelete(plan.id)} disabled={busy || !plan}>
            {busy ? <Spinner data-icon="inline-start" /> : <Trash2Icon data-icon="inline-start" />}
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
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
  approving,
  preparing,
  exporting,
  approved,
  sqlPrep,
  exportResult,
  hasIntent
}: {
  planning: boolean;
  approving: boolean;
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
  if (approving) return "Starting the export.";
  if (approved) return "Approved and ready for validation.";
  if (hasIntent) return "Review before anything runs.";
  if (planning) return "Drafting from your request.";
  return "The current CSV appears here.";
}

function exportProgressText({
  approving,
  preparing,
  exporting,
  sqlPrep,
  exportResult
}: {
  approving: boolean;
  preparing: boolean;
  exporting: boolean;
  sqlPrep: SQLPreparationResponse | null;
  exportResult: ExportCreateResponse | null;
}) {
  if (exportResult || sqlPrep?.valid === false) return null;
  if (exporting || sqlPrep?.valid) return "Creating CSV";
  if (preparing) return "Validating CSV";
  if (approving) return "Starting CSV export";
  return null;
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
