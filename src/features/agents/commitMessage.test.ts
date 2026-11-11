import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import type { AgentProvider, AgentTask } from "@/bindings";
import { provideCommitService, provideNotificationService, type CommitMessageContext } from "@/workbench/contributions";
import { useProject } from "@/platform/project";
import { useAgents } from "./store";
import {
  commitMessageActions,
  commitMessagePrompt,
  generateCommitMessage,
  generatedMessage,
  generationConfig,
} from "./commitMessage";

const task: AgentTask = {
  id: "utility",
  title: "Generate message",
  provider: "codex",
  model: null,
  status: "running",
  isolation: "local",
  cwd: "/repo",
  branch: null,
  base: null,
  baseCommit: null,
  error: null,
  createdMs: 0,
  updatedMs: 0,
  config: [],
  commands: [],
  usage: null,
  queue: [],
};
const provider = {
  id: "codex",
  name: "Codex",
  installed: true,
  config: [
    { id: "mode", category: "mode", current: "full-access", values: [{ value: "read-only", name: "Read Only" }] },
    { id: "model", category: "model", current: "chosen-model", values: [] },
  ],
} as unknown as AgentProvider;
const context: CommitMessageContext = {
  revision: 1,
  message: "",
  amend: false,
  repositories: [
    {
      root: "/repo",
      changes: "File: api.ts\n-old\n+new",
      instructions: "Use Conventional Commits",
      recentMessages: ["fix(api): preserve timeouts"],
    },
  ],
};
const notify = vi.fn();
const setMessage = vi.fn();
const calls: string[] = [];
let current: CommitMessageContext;
let output: string;
let onCreate: () => void;
beforeEach(() => {
  vi.useRealTimers();
  calls.length = 0;
  notify.mockClear();
  setMessage.mockReset().mockReturnValue(true);
  current = context;
  output =
    '{"message":"fix(api): preserve request cancellation\\n\\nKeep cancellation active until the request finishes."}';
  onCreate = () => {};
  useProject.setState({ project: { root: "/repo" } as never });
  useAgents.setState({
    tasks: new Map(),
    entries: new Map(),
    lastTask: null,
    draft: { ...useAgents.getState().draft, provider: "codex" },
  });
  provideNotificationService({ notify });
  provideCommitService({ selection: async () => null, messageContext: async () => current, setMessage });
  mockIPC((cmd) => {
    calls.push(cmd);
    if (cmd === "agent_providers") return [provider];
    if (cmd === "agent_create") {
      onCreate();
      return task;
    }
    if (cmd === "agent_entries") return [{ type: "agent", text: output }];
    if (cmd === "agent_cancel" || cmd === "agent_delete" || cmd === "agent_respond") return null;
    throw new Error(`Unexpected ${cmd}`);
  });
});
afterEach(() => {
  provideCommitService(undefined);
  clearMocks();
  vi.useRealTimers();
});
const ready = async () => {
  await vi.waitFor(() => expect(useAgents.getState().tasks.has(task.id)).toBe(true));
  useAgents.setState({ tasks: new Map([[task.id, { ...task, status: "ready" }]]) });
};
it("uses repository conventions and the concrete diff, requesting structured text only", () => {
  const prompt = commitMessagePrompt(context);
  expect(prompt).toContain("Conventional Commits");
  expect(prompt).toContain("do not call tools");
  expect(prompt).toContain("preserve timeouts");
  expect(prompt).toContain("api.ts");
});
it("keeps the configured model while replacing permission bypass with read-only", () => {
  expect(generationConfig(provider)).toEqual([
    { id: "model", value: "chosen-model" },
    { id: "mode", value: "read-only" },
  ]);
});
it("writes the generated message as a draft and closes only its utility session", async () => {
  const pending = generateCommitMessage();
  await ready();
  await pending;
  expect(setMessage).toHaveBeenCalledWith(
    1,
    "fix(api): preserve request cancellation\n\nKeep cancellation active until the request finishes.",
  );
  expect(calls.slice(-2)).toEqual(["agent_cancel", "agent_delete"]);
  expect(calls).not.toContain("vcs_commit");
  expect(notify).not.toHaveBeenCalled();
});
it("preserves text typed or changes selected while generation runs", async () => {
  const pending = generateCommitMessage();
  await ready();
  current = { ...context, revision: 2, message: "User draft" };
  await pending;
  expect(setMessage).not.toHaveBeenCalled();
  expect(notify).toHaveBeenCalledWith(
    expect.objectContaining({ level: "error", body: expect.stringContaining("draft changed") }),
  );
});
it("cancels without changing the draft and cleans up the task", async () => {
  const pending = generateCommitMessage();
  await vi.waitFor(() => expect(useAgents.getState().tasks.has(task.id)).toBe(true));
  await commitMessageActions[1]!.run({} as never);
  await pending;
  expect(setMessage).not.toHaveBeenCalled();
  expect(calls.slice(-2)).toEqual(["agent_cancel", "agent_delete"]);
  expect(notify).not.toHaveBeenCalled();
});
it("reports malformed output instead of filling the commit field with an explanation", async () => {
  output = "Here is a commit message";
  const pending = generateCommitMessage();
  await ready();
  await pending;
  expect(setMessage).not.toHaveBeenCalled();
  expect(notify).toHaveBeenCalledWith(expect.objectContaining({ level: "error" }));
});
it("accepts a fenced JSON reply and rejects empty messages", () => {
  expect(generatedMessage('```json\n{"message":"fix: preserve cancellation"}\n```')).toBe("fix: preserve cancellation");
  expect(() => generatedMessage('{"message":""}')).toThrow("valid commit message");
});

it("stops a timed-out generation and preserves the draft", async () => {
  vi.useFakeTimers();
  const pending = generateCommitMessage();
  for (let i = 0; i < 30; i++) await Promise.resolve();
  expect(useAgents.getState().tasks.has(task.id)).toBe(true);
  await vi.advanceTimersByTimeAsync(120_001);
  await pending;
  expect(setMessage).not.toHaveBeenCalled();
  expect(notify).toHaveBeenCalledWith(
    expect.objectContaining({ level: "error", body: expect.stringContaining("timed out") }),
  );
  expect(calls.slice(-2)).toEqual(["agent_cancel", "agent_delete"]);
});

it("cancels when the project changes without replacing another project's draft", async () => {
  const pending = generateCommitMessage();
  await vi.waitFor(() => expect(useAgents.getState().tasks.has(task.id)).toBe(true));
  useProject.setState({ project: { root: "/other" } as never });
  await pending;
  expect(setMessage).not.toHaveBeenCalled();
  expect(notify).not.toHaveBeenCalled();
});

it("rejects permission requests made by the text-only generation task", async () => {
  const pending = generateCommitMessage();
  await vi.waitFor(() => expect(useAgents.getState().tasks.has(task.id)).toBe(true));
  useAgents.setState({
    entries: new Map([[task.id, [{ type: "permission", id: 4, title: "Run tool", options: [], chosen: null }]]]),
  });
  await ready();
  await pending;
  expect(calls).toContain("agent_respond");
  expect(setMessage).toHaveBeenCalledOnce();
});
