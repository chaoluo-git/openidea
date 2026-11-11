import { expect, test } from "./fixtures";
import type { AgentTask } from "../src/bindings";

test("long-running task time includes live seconds and stops when the turn finishes", async ({ page, workbench }) => {
  void workbench;
  const time = new Date("2026-11-11T12:00:00Z");
  await page.clock.install({ time });
  await page.clock.pauseAt(new Date(time.getTime() + 60_000));
  await page.evaluate(async () => {
    const storePath = "/src/features/agents/store.ts";
    const layoutPath = "/src/workbench/toolwindows/store.ts";
    const store = await import(storePath);
    const task: AgentTask = {
      id: "timer",
      title: "Long-running task",
      provider: "codex",
      status: "running",
      isolation: "local",
      model: null,
      cwd: "/dev/acme-api",
      branch: null,
      base: null,
      baseCommit: null,
      error: null,
      createdMs: Date.now(),
      updatedMs: Date.now(),
      config: [],
      commands: [],
      usage: null,
      queue: [],
    };
    store.useAgents.setState({
      loaded: true,
      error: null,
      providers: [],
      tasks: new Map([[task.id, task]]),
      unread: new Set(),
      docked: null,
      dockedTabs: [],
      entries: new Map([
        [
          task.id,
          [
            {
              type: "user",
              text: "Long task",
              attachments: [],
              steered: false,
              sentMs: Date.now() - 3983_000,
              doneMs: null,
            },
          ],
        ],
      ]),
    });
    store.dockTask(task.id);
    (await import(layoutPath)).toggleMaximizeToolWindow("agents");
  });
  await page.clock.runFor(50);
  const timer = page.getByTitle("Time the agent spent on this task", { exact: true });
  await expect(timer).toHaveText("1h 06m 23s");
  await page.clock.runFor(1000);
  await expect(timer).toHaveText("1h 06m 24s");
  await page.evaluate(async () => {
    const storePath = "/src/features/agents/store.ts";
    const store = await import(storePath);
    const state = store.useAgents.getState();
    store.useAgents.setState({
      tasks: new Map(state.tasks).set("timer", { ...state.tasks.get("timer")!, status: "ready" }),
      entries: new Map(state.entries).set(
        "timer",
        state.entries.get("timer")!.map((entry) => (entry.type === "user" ? { ...entry, doneMs: Date.now() } : entry)),
      ),
    });
  });
  await page.clock.runFor(5000);
  await expect(timer).toHaveText("1h 06m 24s");
});
