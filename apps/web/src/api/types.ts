export type Role = "user" | "assistant";

export type RunMeta = {
  taskId: string;
  status: "running" | "done" | "error";
  startedAt: string;
  completedAt?: string;
};

export type MessageMeta = {
  run?: RunMeta;
};

export type ChatSummary = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type Message = {
  id: string;
  role: Role;
  content: string;
  createdAt: string;
  meta?: MessageMeta | null;
  events?: any[];
};

export type Chat = ChatSummary & {
  messages: Message[];
};

export type ContextBundle = {
  dir: string;
  files: string[];
  items: Array<{ filename: string; content: string }>;
};

export type CodexProfile = {
  id: string;
  label: string;
  codexHomePath: string;
  createdAt: string;
  updatedAt: string;
  lastVerifiedAt: string | null;
  authMode: "unknown" | "device" | "api_key";
  loggedIn: boolean;
  statusText: string;
  totalInputTokens: number;
  totalCachedInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  estimatedTotalCostUsd?: number | null;
  totalCostUpdatedAt: string | null;
};

export type CodexAccountsResponse = {
  ok: true;
  activeProfileId: string | null;
  profiles: CodexProfile[];
  runner: {
    sandboxMode: "read-only" | "workspace-write" | "danger-full-access";
    reasoningEffort: "" | "none" | "low" | "medium" | "high";
  };
};

export type TaskEvent =
  | { type: "log"; stream: "stdout" | "stderr"; line: string }
  | { type: "device"; url: string; code: string }
  | { type: "done"; ok: boolean; exitCode: number | null }
  | { type: "canceled"; reason: string };

export type ContextMetrics = {
  files: number;
  chars: number;
  bytes: number;
  approxTokens: number;
};

export type GoogleAccount = {
  accountKey: "work" | "personal";
  connected: boolean;
  email?: string;
  scopes?: string;
  connectedAt?: string;
  updatedAt?: string;
};

export type GoogleAccountsResponse = {
  ok: true;
  accounts: GoogleAccount[];
};

export type MicrosoftAccount = {
  accountKey: string;
  connected: boolean;
  label?: string;
  kind?: string;
  tenantId?: string | null;
  email?: string;
  displayName?: string;
  scopes?: string;
  connectedAt?: string;
  updatedAt?: string;
};

export type MicrosoftAccountsResponse = {
  ok: true;
  accounts: MicrosoftAccount[];
};

export type AssistantRunner = "noop" | "auto" | "codex" | "openai" | "metered" | "api" | "vertex";

export type RunnerPrefs = {
  runner: AssistantRunner;
  openai: {
    model: string;
    baseUrl: string;
  };
  vertex: {
    model: string;
    projectId: string;
    location: string;
    authMode?: "aws_secret" | "google_oauth";
    googleAccountKey?: "work" | "personal";
  };
};

export type RunnerSettingsResponse = {
  ok: true;
  prefs: RunnerPrefs;
  effective: { runner: string; source: "env" | "settings" };
  env: { FRIDAY_RUNNER: string | null };
  caps?: { vertexCodeExecution?: boolean; vertexToolExec?: boolean };
};

export type VertexModelProbeResult = { id: string; ok: boolean; error?: string };

export type VertexModelsResponse = {
  ok: true;
  projectId: string;
  location: string;
  candidates: string[];
  results: VertexModelProbeResult[];
  available: string[];
};

export type TriageItem = {
  id: string;
  runbookId: string | null;
  kind: "quick_read" | "next_action";
  status: "open" | "completed" | "dismissed";
  title: string;
  summaryMd: string;
  priority: number;
  confidencePct: number | null;
  sourceKey: string;
  source: any;
  chatId: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type TriageItemsResponse = {
  ok: true;
  items: TriageItem[];
};

export type RunbookSummary = {
  id: string;
  title: string;
  enabled: boolean;
  everyMinutes: number | null;
  timezone: string;
  accounts: Array<"work" | "personal">;
  cursorStrategy: string;
  path: string;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  nextRunAt: string | null;
};

export type RunbooksResponse = {
  ok: true;
  runbooks: RunbookSummary[];
};

export type AuthUser = {
  id: string;
  label: string;
  createdAt: string;
};

export type AuthStatusResponse = {
  ok: true;
  authenticated: boolean;
  hasAnyUsers: boolean;
  hasAnyPasskeys: boolean;
  user: AuthUser | null;
};

export type Passkey = {
  id: string;
  userId: string;
  credentialId: string;
  counter: number;
  transports: string | null;
  createdAt: string;
};

export type PasskeysResponse = {
  ok: true;
  user: AuthUser;
  passkeys: Passkey[];
};
