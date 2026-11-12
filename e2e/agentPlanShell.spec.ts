import { expect, test } from "./fixtures";
import type { AgentEntry, AgentTask } from "../src/bindings";

test("shows plan progress and real shell invocations in parent and subagent activity", async ({
  page,
  context,
  workbench,
}) => {
  void workbench;
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const command = "printf 'module-a\\nmodule-b\\n'";
  const directory = `/Users/example/projects/${"long-workspace-directory/".repeat(8)}modules`;
  await page.evaluate(
    async ({ command, directory }) => {
      const storePath = "/src/features/agents/store.ts";
      const projectPath = "/src/platform/project.ts";
      const layoutPath = "/src/workbench/toolwindows/store.ts";
      const store = await import(storePath);
      (await import(projectPath)).useProject.setState({
        settings: { agents: { foldTurns: false, toolCalls: "each" } },
      });
      const task: AgentTask = {
        id: "planning",
        title: "Update modules",
        provider: "copilot",
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
      const shell: AgentEntry = {
        type: "tool",
        id: "inspect",
        kind: "execute",
        title: "Inspect module layout",
        status: "completed",
        locations: [],
        diffs: [],
        command: { text: command, cwd: directory },
        output: "module-a\nmodule-b\n<shellId: 91 completed with exit code 0>",
      };
      const entries: AgentEntry[] = [
        {
          type: "plan",
          items: [
            { content: "Inspect existing modules", status: "completed" },
            { content: "Update dependency helper", status: "in_progress" },
            { content: "Verify module tests", status: "pending" },
          ],
        },
        shell,
        {
          type: "subagent",
          id: "child",
          title: "Explore dependencies",
          description: "Check modules independently",
          status: "running",
          error: null,
          prompt: "Inspect modules",
          reply: null,
          tools: 1,
          activity: "Inspect module layout",
          startedMs: Date.now() - 65000,
          endedMs: null,
          cancellable: false,
        },
      ];
      store.useAgents.setState({
        loaded: true,
        error: null,
        providers: [],
        tasks: new Map([[task.id, task]]),
        unread: new Set(),
        docked: null,
        dockedTabs: [],
        entries: new Map([
          [task.id, entries],
          ["planning/child", [shell]],
        ]),
      });
      store.dockTask(task.id);
      (await import(layoutPath)).toggleMaximizeToolWindow("agents");
    },
    { command, directory },
  );
  const stream = page.locator("[class*='_stream_']:visible");
  const tool = stream
    .locator("details")
    .filter({ has: page.locator(":scope > summary", { hasText: "Inspect module layout" }) })
    .first();
  await tool.locator(":scope > summary").click();
  if (process.env.OPENIDEA_PLAN_SCREENSHOT) {
    await page.screenshot({ path: process.env.OPENIDEA_PLAN_SCREENSHOT, animations: "disabled" });
  }
  const plan = stream.getByRole("list", { name: "Plan", exact: true });
  await expect(plan.getByRole("listitem")).toHaveCount(3);
  await expect(plan.locator("[aria-current='step']")).toHaveText("Update dependency helper");
  await expect(stream.getByText("2/3", { exact: true })).toBeVisible();
  const card = tool.locator("[class*='_shellCard_']");
  await expect(card.getByText(`Command in ${directory}`, { exact: true })).toBeVisible();
  await expect(card.locator("code")).toHaveText(command);
  await expect.poll(() => card.locator("code span").count()).toBeGreaterThan(0);
  await expect(card.getByText("Output", { exact: true })).toBeVisible();
  await expect(card.locator("pre").last()).toHaveText("module-a\nmodule-b");
  const commandBlock = card.locator("[class*='_shellBlock_']");
  const actions = commandBlock.locator("[class*='_shellActions_']");
  await page.mouse.move(10, 10);
  await expect(actions).toHaveCSS("opacity", "0");
  await card.locator("[class*='_shellBlock_']").hover();
  await expect(actions).toHaveCSS("opacity", "1");
  if (process.env.OPENIDEA_PLAN_SCREENSHOT) {
    await page.screenshot({
      path: process.env.OPENIDEA_PLAN_SCREENSHOT.replace(/\.png$/, "-command-hover.png"),
      animations: "disabled",
    });
  }
  await card.getByRole("button", { name: "Copy Command", exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(command);
  await commandBlock.getByRole("button", { name: "Wrap Lines", exact: true }).click();
  await expect(card.locator("pre").first()).toHaveCSS("white-space", "pre");
  await card.getByRole("button", { name: "Copy Command", exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(command);
  const outputBlock = card.locator("[class*='_shellOutput_']");
  await page.mouse.move(10, 10);
  await expect(outputBlock.locator("[class*='_shellActions_']")).toHaveCSS("opacity", "0");
  await outputBlock.hover();
  await expect(outputBlock.locator("[class*='_shellActions_']")).toHaveCSS("opacity", "1");
  if (process.env.OPENIDEA_PLAN_SCREENSHOT) {
    await page.screenshot({
      path: process.env.OPENIDEA_PLAN_SCREENSHOT.replace(/\.png$/, "-output-hover.png"),
      animations: "disabled",
    });
  }
  await outputBlock.getByRole("button", { name: "Wrap Lines", exact: true }).click();
  await expect(outputBlock.locator("pre")).toHaveCSS("white-space", "pre");
  await outputBlock.getByRole("button", { name: "Copy Output", exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("module-a\nmodule-b");
  const child = stream.locator("[class*='_subagent_']").filter({ hasText: "Explore dependencies" });
  await child.getByText("Recent activity", { exact: true }).click();
  await child
    .locator("details")
    .filter({ has: page.locator(":scope > summary", { hasText: "Inspect module layout" }) })
    .locator(":scope > summary")
    .click();
  await expect(child.locator("code")).toHaveText(command);
  await expect(child.locator("pre").last()).toHaveText("module-a\nmodule-b");
  const childPreview = child.locator("[class*='_subagentPreview_']");
  await expect.poll(() => childPreview.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  await child.getByRole("button", { name: "Copy Output", exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("module-a\nmodule-b");
  await expect.poll(() => childPreview.evaluate((el) => el.scrollLeft)).toBe(0);
  await page.evaluate(async () => {
    const storePath = "/src/features/agents/store.ts";
    const store = await import(storePath);
    const state = store.useAgents.getState();
    store.useAgents.setState({
      entries: new Map(state.entries).set("planning/child", [
        ...state.entries.get("planning/child")!,
        ...Array.from({ length: 45 }, (_, n) => ({ type: "agent" as const, text: `Child update ${n}` })),
      ]),
    });
  });
  await expect(child.locator("code")).toHaveText(command);
  if (process.env.OPENIDEA_PLAN_SCREENSHOT) {
    await page.screenshot({
      path: process.env.OPENIDEA_PLAN_SCREENSHOT.replace(/\.png$/, "-child.png"),
      animations: "disabled",
    });
  }
  await page.evaluate(async () => {
    const storePath = "/src/features/agents/store.ts";
    const store = await import(storePath);
    const state = store.useAgents.getState();
    store.useAgents.setState({
      entries: new Map(state.entries).set(
        "planning",
        state.entries
          .get("planning")!
          .map((e) =>
            e.type === "plan" ? { ...e, items: e.items.map((item) => ({ ...item, status: "completed" })) } : e,
          ),
      ),
    });
  });
  await expect(stream.getByText("3/3", { exact: true })).toBeVisible();
  await expect(plan).toBeVisible();
  await stream.locator("[class*='_plan_'] > summary").click();
  await expect(plan).toBeHidden();
  await child.getByRole("button", { name: /Explore dependencies/ }).click();
  await expect(page.getByText("Subagents take their instructions from the agent that started them.")).toBeVisible();
});
