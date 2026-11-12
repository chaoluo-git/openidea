import { expect, test } from "./fixtures";
import type { AgentEntry, AgentTask } from "../src/bindings";

const id = "reading-thought";
const asked: AgentEntry = {
  type: "user",
  text: "Inspect the implementation",
  attachments: [],
  steered: false,
  sentMs: 1000,
  doneMs: null,
};
const tool = (number: number): AgentEntry => ({
  type: "tool",
  id: `read-${number}`,
  kind: "read",
  title: `Read source ${number}`,
  status: "running",
  output: "",
  locations: [],
  diffs: [],
});

for (const activation of ["click", "Enter", "Space"] as const) {
  test(`keeps an opened thought in place as new work arrives (${activation})`, async ({ page, workbench }) => {
    void workbench;
    await page.evaluate(
      async ({ id, asked, tool }) => {
        const storePath = "/src/features/agents/store.ts";
        const layoutPath = "/src/workbench/toolwindows/store.ts";
        const store = await import(storePath);
        const task: AgentTask = {
          id,
          title: "Read reasoning",
          provider: "codex",
          status: "running",
          isolation: "local",
          model: null,
          cwd: "/dev/acme-api",
          branch: null,
          base: null,
          baseCommit: null,
          error: null,
          createdMs: 1000,
          updatedMs: 1000,
          config: [],
          commands: [],
          usage: null,
          queue: [],
        };
        store.useAgents.setState({
          loaded: true,
          error: null,
          providers: [],
          tasks: new Map([[id, task]]),
          unread: new Set(),
          docked: null,
          dockedTabs: [],
          entries: new Map([
            [
              id,
              [
                asked,
                { type: "agent", text: "Previous output.\n\n".repeat(28) },
                {
                  type: "thought",
                  text: "Reading marker\n\n" + "Reasoning to inspect without interruption.\n\n".repeat(24),
                },
                tool,
              ],
            ],
          ]),
        });
        store.dockTask(id);
        (await import(layoutPath)).toggleMaximizeToolWindow("agents");
        await document.fonts.ready;
      },
      { id, asked, tool: tool(0) },
    );
    const stream = page.locator("[class*='_stream_']:visible");
    await expect.poll(() => stream.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThan(2);
    const thought = stream.locator("[class*='_thought_']");
    const summary = thought.locator(":scope > summary");
    await expect(summary).toHaveText("Thoughts");
    if (activation === "click") await summary.click();
    else {
      await summary.focus();
      await page.keyboard.press(activation);
    }
    await expect(thought).toHaveAttribute("open", "");
    await expect(thought.getByText("Reading marker", { exact: true })).toBeVisible();
    const top = await stream.evaluate((el) => el.scrollTop);
    const body = stream.locator("[class*='_processBody_']");
    const inner = await body.evaluate((el) => el.scrollTop);
    const samples = await page.evaluate(
      async ({ id, tool }) => {
        const storePath = "/src/features/agents/store.ts";
        const store = await import(storePath);
        const stream = document.querySelector<HTMLElement>("[class*='_stream_']")!;
        const values: Array<{ outer: number; inner: number }> = [];
        for (let n = 1; n <= 5; n++) {
          const state = store.useAgents.getState();
          store.useAgents.setState({
            entries: new Map(state.entries).set(id, [
              ...state.entries.get(id)!,
              { ...tool, id: `read-${n}`, title: `Read source ${n}` },
            ]),
          });
          for (let frame = 0; frame < 6; frame++) await new Promise(requestAnimationFrame);
          values.push({
            outer: stream.scrollTop,
            inner: stream.querySelector<HTMLElement>("[class*='_processBody_']")!.scrollTop,
          });
        }
        return values;
      },
      { id, tool: tool(1) },
    );
    for (const sample of samples) {
      expect(Math.abs(sample.outer - top), "new work must not steal the conversation position").toBeLessThanOrEqual(1);
      expect(Math.abs(sample.inner - inner), "new tools must not scroll past the thought").toBeLessThanOrEqual(1);
    }
    const jump = page.getByRole("button", { name: "Scroll to bottom" });
    await expect(jump).toBeVisible();
    // Reading must survive the initial 40-entry paint window, including messages that split runs.
    await page.evaluate(async (id) => {
      const storePath = "/src/features/agents/store.ts";
      const store = await import(storePath);
      const state = store.useAgents.getState();
      store.useAgents.setState({
        entries: new Map(state.entries).set(id, [
          ...state.entries.get(id)!,
          ...Array.from({ length: 52 }, (_, n) => ({ type: "agent" as const, text: `Background update ${n}` })),
        ]),
      });
    }, id);
    await expect(thought).toHaveAttribute("open", "");
    expect(Math.abs((await stream.evaluate((el) => el.scrollTop)) - top)).toBeLessThanOrEqual(1);
    await page.evaluate(
      async ({ id, asked }) => {
        const storePath = "/src/features/agents/store.ts";
        const store = await import(storePath);
        const state = store.useAgents.getState();
        const entries = state.entries.get(id)!;
        store.useAgents.setState({
          tasks: new Map(state.tasks).set(id, { ...state.tasks.get(id)!, status: "ready" }),
          entries: new Map(state.entries).set(id, [
            { ...asked, doneMs: 5000 },
            ...entries.slice(1).map((e) => (e.type === "tool" ? { ...e, status: "completed" as const } : e)),
            { type: "agent", text: "Finished inspection.\n\n".repeat(10) },
          ]),
        });
      },
      { id, asked },
    );
    // Finishing a turn may regroup its rows, but must preserve the thought being read.
    await expect(stream.locator("[class*='_thought_']").filter({ hasText: "Reading marker" })).toHaveAttribute(
      "open",
      "",
    );
    await expect(stream.locator("[class*='_thoughtBody_']").getByText("Reading marker", { exact: true })).toBeVisible();
    await jump.click();
    await expect(jump).toBeHidden();
    await expect.poll(() => stream.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThan(2);
    await page.evaluate(async (id) => {
      const storePath = "/src/features/agents/store.ts";
      const store = await import(storePath);
      const state = store.useAgents.getState();
      store.useAgents.setState({
        entries: new Map(state.entries).set(id, [
          ...state.entries.get(id)!,
          { type: "agent", text: "Latest output.\n\n".repeat(20) },
        ]),
      });
    }, id);
    await expect.poll(() => stream.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThan(2);
  });
}
