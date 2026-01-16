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
  | { type: "status"; stage: string }
  | { type: "trello_card"; url: string; board?: string; list?: string }
  | { type: "command_result"; ok: boolean; output?: string; error?: string; exitCode?: number | null }
  | { type: "assistant_message"; message: Message }
  | { type: "usage"; usage: any; costUsd?: number | null }
  | { type: "error"; message: string }
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

export type PmSettings = {
  trelloBoard: string;
  trelloList: string;
};

export type PmSettingsResponse = {
  ok: true;
  settings: PmSettings;
};

export type PmRequestResponse = {
  ok: true;
  taskId: string;
};

export type PmTaskSummary = {
  id: string;
  kind: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  input: any;
  lastEvent?: TaskEvent | null;
};

export type PmRequestsResponse = {
  ok: true;
  items: PmTaskSummary[];
};

export type PmCommandsResponse = {
  ok: true;
  items: PmTaskSummary[];
};

export type PmCommandRequest = {
  ok: true;
  taskId: string;
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

export type PersonAlias = {
  provider: string;
  spaceId: string;
  personId: string;
  displayName: string;
  providerUserId: string | null;
  identityLabel: string | null;
};

export type ResolveAliasesResponse = {
  ok: true;
  aliases: PersonAlias[];
};

export type UpsertAliasResponse = {
  ok: true;
  alias: PersonAlias;
};

export type GchatSenderResponse = {
  ok: true;
  sender: { senderUserId: string | null; senderDisplayName: string | null };
};

export type GchatThreadMessage = {
  name: string | null;
  createTime: string | null;
  text: string;
  sender: { name: string | null; displayName: string | null };
  thread: string | null;
};

export type GchatThreadResponse = {
  ok: true;
  messages: GchatThreadMessage[];
};

export type PersonIdentity = {
  id: string;
  personId: string;
  provider: string;
  providerUserId: string;
  label: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PersonRecord = {
  id: string;
  displayName: string;
  notes: string | null;
  isMe: boolean;
  createdAt: string;
  updatedAt: string;
  identities: PersonIdentity[];
};

export type PeopleResponse = {
  ok: true;
  people: PersonRecord[];
};

export type IdentifyPersonResponse = {
  ok: true;
  person: PersonRecord;
};

export type UpdatePersonResponse = {
  ok: true;
  person: PersonRecord;
};

export type DeletePersonResponse = {
  ok: true;
};

export type DeleteIdentityResponse = {
  ok: true;
};

export type BootstrapMeResponse = {
  ok: true;
  person: PersonRecord;
};

export type GchatSpaceInfo = {
  spaceId: string;
  displayName: string;
  spaceType: string;
  type: string;
  error?: string;
};

export type GchatSpacesResponse = {
  ok: true;
  spaces: GchatSpaceInfo[];
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


export type PmProject = {
  id: string;
  chatId: string;
  title: string;
  summary?: string | null;
  trelloCardUrl?: string | null;
  trelloCardId?: string | null;
  trelloBoardId?: string | null;
  trelloListId?: string | null;
  sizeLabel?: string | null;
  sizeEstimate?: string | null;
  sizeRisks?: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  lastActivityAt?: string | null;
};

export type PmProjectWorker = {
  projectId: string;
  workerId: string;
  lane?: string | null;
  lastActivityAt: string;
};

export type PmProjectsResponse = {
  ok: true;
  projects: Array<PmProject & { workers?: PmProjectWorker[] }>;
};

export type PmProjectResponse = {
  ok: true;
  project: PmProject;
  chat: Chat | null;
  workers: PmProjectWorker[];
};

export type PmProjectCreateResponse = {
  ok: true;
  project: PmProject;
  chat: Chat;
};

export type PmProjectMessageResponse = {
  ok: true;
  taskId: string;
  userMessage: Message;
  assistantMessage: Message;
};


export type PmProjectDeleteResponse = {
  ok: true;
};
export type PmTrelloBoard = { id: string; name: string; url: string; shortLink?: string };
export type PmTrelloList = { id: string; name: string };
export type PmTrelloCard = { id: string; name: string; url: string; idBoard?: string; idList?: string };

export type PmTrelloBoardsResponse = { ok: true; boards: PmTrelloBoard[] };
export type PmTrelloListsResponse = { ok: true; lists: PmTrelloList[] };
export type PmTrelloSearchResponse = { ok: true; cards: PmTrelloCard[] };

export type PmSizingResponse = {
  ok: true;
  project: PmProject;
  sizing: { ok: true; sizeLabel: string; timeEstimate: string; risks: string[] };
};
