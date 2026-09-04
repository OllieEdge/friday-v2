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
  accountKey: string;
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

export type AssistantRunner = "noop" | "auto" | "codex" | "openai" | "metered" | "api" | "vertex" | "hybrid";

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
    googleAccountKey?: string;
  };
  hybrid: {
    model: string;
    baseUrl: string;
    apiKey: string;
    fallbackRunner: "vertex" | "openai" | "codex";
    localOnlyMaxChars: number;
    maxContextChars: number;
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
  accounts: string[];
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

export type PersonaRecord = {
  id: string;
  label: string;
  description: string;
  traits: string[];
  responsibilities: string[];
  tone: { voice: string; formality: string; verbosity: string };
  boundaries: string[];
  toolPolicy: { mode: string; allow: string[]; deny: string[] };
  channels: string[];
  promptAddendum: string;
  source?: any;
  updatedAt?: string;
};

export type PersonasResponse = {
  ok: true;
  updatedAt: string;
  template: any;
  personas: PersonaRecord[];
  file: string;
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

export type OpsHealth = {
  level: "ok" | "warn" | "critical";
  blockers: number;
  warnings: number;
  summary: string;
};

export type OpsChannel = {
  channel: string;
  accountId: string;
  name: string;
  enabled: boolean;
  configured: boolean;
  running: boolean;
  connected: boolean;
  state: "ok" | "degraded" | "missing";
  lastError: string | null;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
};

export type OpsCapability = {
  id: string;
  area: string;
  configured: boolean;
  status: "ok" | "missing" | "degraded";
  access: string;
  testCommand: string;
  notes?: string;
};

export type OpsActionStatus = "pending" | "confirmed" | "cancelled" | "completed";

export type OpsAction = {
  id: string;
  createdAt: string;
  status: OpsActionStatus;
  channel: string;
  contact: string;
  intent: string;
  summary: string;
  sourceText: string;
  dueAt: string | null;
  meta: any;
  confirmedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
};

export type OpsRunbook = {
  runbookId: string;
  title: string;
  enabled: boolean;
  everyMinutes: number | null;
  timezone: string;
  accounts: string[];
  path: string | null;
  lastStatus: string;
  lastRunAt: string | null;
  lastError: string | null;
  nextRunAt: string | null;
  stale: boolean;
};

export type OpsFinding = {
  kind: "quick_read" | "next_action";
  priority: number;
  confidence_pct: number;
  source_key: string;
  title: string;
  summary_md: string;
  source: any;
};

export type OpsTimelineEvent = {
  id: string;
  ts: string | null;
  source: "actions" | "ops" | "runbook" | "triage";
  kind: string;
  severity: "ok" | "info" | "warn" | "error";
  title: string;
  detail: string | null;
};

export type OpsOverview = {
  generatedAt: string;
  health: OpsHealth;
  queue: {
    actions: {
      total: number;
      pending: number;
      confirmed: number;
      cancelled: number;
      completed: number;
    };
    triage: {
      open: number;
      completed: number;
      dismissed: number;
      nextActionOpen: number;
      quickReadOpen: number;
      urgentOpen: number;
    };
    runbooks: {
      total: number;
      ok: number;
      error: number;
      running: number;
      stale: number;
    };
  };
  channels: OpsChannel[];
  capabilities: {
    summary: {
      total: number;
      configured: number;
      healthy: number;
      missing: number;
      degraded: number;
    };
    items: OpsCapability[];
    checks: any;
    missing: OpsCapability[];
    degraded: OpsCapability[];
  };
  actions: OpsAction[];
  triage: TriageItem[];
  runbooks: OpsRunbook[];
  byAccount: {
    summary: {
      accounts: number;
      triageOpen: number;
      actionsPending: number;
      actionsConfirmed: number;
      draftPending: number;
      draftConfirmed: number;
    };
    rows: Array<{
      accountKey: string;
      triageOpen: number;
      triageUrgent: number;
      triageNextAction: number;
      triageQuickRead: number;
      actionsPending: number;
      actionsConfirmed: number;
      actionsCompleted: number;
      actionsCancelled: number;
      draftPending: number;
      draftConfirmed: number;
      draftCompleted: number;
      draftCancelled: number;
    }>;
  };
  findings: {
    controlTower: { ok?: boolean; summary?: any; findings?: OpsFinding[] };
    workstream: { ok?: boolean; summary?: any; findings?: OpsFinding[]; repoCount?: number; github?: any };
  };
  timeline: OpsTimelineEvent[];
  digestMarkdown: string;
  files: {
    digestJson: string;
    digestMarkdown: string;
    auditJson: string;
    controlTowerJson: string;
    workstreamJson: string;
    actionsJson: string;
    actionsEvents: string;
    opsEvents: string;
    dbPath: string;
  };
};

export type OpsOverviewResponse = {
  ok: true;
  overview: OpsOverview;
};

export type OpsRefreshResponse = {
  ok: true;
  refresh: {
    digest: { ok: boolean; code: number | null; stderr: string | null };
    audit: { ok: boolean; code: number | null; stderr: string | null };
    controlTower: { ok: boolean; code: number | null; stderr: string | null; persisted: boolean };
    workstream: { ok: boolean; code: number | null; stderr: string | null; persisted: boolean };
  };
  overview: OpsOverview;
};

export type OpsActionsResponse = {
  ok: true;
  status: "all" | OpsActionStatus;
  counts: OpsOverview["queue"]["actions"];
  actions: OpsAction[];
  events: Array<{ ts: string; type: string; payload: any }>;
};

export type OpsActionUpdateResponse = {
  ok: true;
  action: OpsAction | null;
  triageItem?: TriageItem | null;
  sent?: {
    actionId: string;
    accountKey: string;
    to: string;
    subject: string;
    gmailMessageId: string | null;
    sentAt?: string;
  } | null;
  overview: OpsOverview;
};

export type TriageDraftQueueResponse = {
  ok: true;
  existed: boolean;
  action: OpsAction | null;
  sent: {
    actionId: string;
    accountKey: string;
    to: string;
    subject: string;
    gmailMessageId: string | null;
    sentAt?: string;
  } | null;
  item: TriageItem;
  overview: OpsOverview;
};

export type OpsTimelineResponse = {
  ok: true;
  generatedAt: string;
  timeline: OpsTimelineEvent[];
};

export type OpsFlowStepKind = "ai_cmd" | "shell_cmd" | "note";

export type OpsFlowPlanStep = {
  id: string;
  kind: OpsFlowStepKind;
  requiredInputs: string[];
  missingInputs: string[];
  requiresFixIntent: boolean;
  condition: string | null;
  blockedByFixIntent: boolean;
  runnable: boolean;
  command?: string;
  argsTemplate?: string;
  args?: string;
  run?: string;
  template?: string;
  note?: string;
};

export type OpsFlowPlanPhase = {
  ready: boolean;
  missingInputs: string[];
  steps: OpsFlowPlanStep[];
  enabled?: boolean;
  reason?: string | null;
};

export type OpsFlowIntentMatch = {
  id: string;
  title: string;
  priority: number;
  score: number;
  matchedTriggers: Array<{ matched: boolean; score: number; trigger: string; mode: "exact" | "phrase" | "token_set" | "none" }>;
};

export type OpsFlowIntentResolution = {
  ok: true;
  text: string;
  normalizedText: string;
  fixIntent: { value: boolean; source: "explicit" | "pattern"; pattern: string | null };
  match: OpsFlowIntentMatch | null;
  candidates: OpsFlowIntentMatch[];
  plan: {
    diagnose: OpsFlowPlanPhase;
    repair: OpsFlowPlanPhase;
    verify: OpsFlowPlanPhase;
  } | null;
  missingInputs: string[];
};

export type OpsFlowRegistryValidation = {
  ok: boolean;
  errors: string[];
  warnings: string[];
  stats: {
    flowCount: number;
    triggerCount: number;
    aiStepCount: number;
    shellStepCount: number;
    noteStepCount: number;
    aiCommandCount: number;
  };
};

export type OpsFlowRegistryResponse = {
  ok: true;
  registry: {
    schemaVersion: number;
    responseContract: string[];
    fixIntentPatterns: string[];
    flows: Array<{ id: string; title: string; priority: number; triggers: string[] }>;
  };
  validation: OpsFlowRegistryValidation;
  sources: { flowRegistryPath: string; aiRegistryPath: string };
};

export type OpsResolveIntentResponse = {
  ok: true;
  resolution: OpsFlowIntentResolution;
  validation: OpsFlowRegistryValidation;
};

export type OpsFlowExecutionStep = {
  id: string;
  phase: "diagnose" | "repair" | "verify";
  kind: OpsFlowStepKind;
  status: "ok" | "failed" | "skipped" | "noted";
  ok: boolean;
  reason: string | null;
  command: string;
  note: string;
  cwd?: string;
  code: number | null;
  durationMs: number;
  stdout: string;
  stderr: string;
  facts: Record<string, any>;
};

export type OpsFlowExecutionSummary = {
  total: number;
  ok: number;
  failed: number;
  skipped: number;
  noted: number;
  durationMs: number;
};

export type OpsFlowExecutionResult = {
  ok: boolean;
  error?: string;
  phases: {
    diagnose: OpsFlowExecutionStep[];
    repair: OpsFlowExecutionStep[];
    verify: OpsFlowExecutionStep[];
  };
  summaries: {
    diagnose: OpsFlowExecutionSummary;
    repair: OpsFlowExecutionSummary;
    verify: OpsFlowExecutionSummary;
  };
  runRepairRequested: boolean;
  runVerify: boolean;
  repairAttempted: boolean;
  facts: Record<string, any>;
};

export type OpsFlowContractResponse = {
  diagnosis: string;
  evidence: string[];
  actions: string[];
  status: "healthy" | "degraded" | "still failing";
  nextAction: string;
  contractTemplate: string[];
};

export type OpsResolveIntentExecuteResponse = {
  ok: true;
  resolution: OpsFlowIntentResolution;
  execution: OpsFlowExecutionResult;
  response: OpsFlowContractResponse;
  validation: OpsFlowRegistryValidation;
};

export type ModelLane = "triage" | "planning" | "coding" | "highRisk" | "ops";

export type ModelCapabilitySet = {
  planning: boolean;
  coding: boolean;
  toolCalling: boolean;
  longContext: boolean;
  maxContextTokens: number;
};

export type ModelCertificationCheck = {
  id: string;
  ok: boolean;
  detail: string;
};

export type ModelCertification = {
  status: "unknown" | "ok" | "failed";
  lastRunAt: string | null;
  lastOk: boolean;
  checks: ModelCertificationCheck[];
};

export type ModelRegistryModel = {
  id: string;
  label: string;
  provider: string;
  model: string;
  enabled: boolean;
  capabilities: ModelCapabilitySet;
  costTier: "low" | "medium" | "high";
  latencyTier: "low" | "medium" | "high";
  notes: string;
  certification: ModelCertification;
  updatedAt: string;
};

export type ModelRegistryRouting = {
  laneDefaults: Partial<Record<ModelLane, string>>;
  personaOverrides: Record<string, Partial<Record<ModelLane, string>>>;
};

export type ModelRegistryStore = {
  version: number;
  updatedAt: string;
  template?: {
    title?: string;
    description?: string;
    laneKeys?: ModelLane[];
  };
  models: ModelRegistryModel[];
  routing: ModelRegistryRouting;
};

export type ModelRegistryResponse = {
  ok: true;
  store: ModelRegistryStore;
  file: string;
};

export type ModelRegistryCertifyResponse = {
  ok: true;
  model: ModelRegistryModel;
  certification: {
    ok: boolean;
    summary: string;
    checks: ModelCertificationCheck[];
  };
  store: ModelRegistryStore;
  file: string;
};
