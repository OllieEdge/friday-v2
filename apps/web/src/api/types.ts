export type Role = "user" | "assistant";

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
  loggedIn: boolean;
  statusText: string;
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
