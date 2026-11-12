import { expect, test } from "./fixtures";
import type { AgentEntry, AgentTask } from "../src/bindings";

for (const { theme, width } of [
  { theme: "light", width: 1400 },
  { theme: "dark", width: 760 },
]) {
  test(`expanded agent activity scrolls with the conversation (${theme}, ${width}px)`, async ({
    page,
    context,
    workbench,
  }) => {
    void workbench;
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.setViewportSize({ width, height: 900 });
    const command = Array.from({ length: 20 }, (_, n) => `printf 'batch-${n}\\n'`).join("\n");
    const output = Array.from({ length: 80 }, (_, n) => `output-${n}: ${"review this change ".repeat(12)}`).join("\n");
    await page.evaluate(
      async ({ theme, command, output }) => {
        const storePath = "/src/features/agents/store.ts";
        const projectPath = "/src/platform/project.ts";
        const layoutPath = "/src/workbench/toolwindows/store.ts";
        const store = await import(storePath);
        (await import(projectPath)).useProject.setState({
          settings: { theme, agents: { foldTurns: true, toolCalls: "grouped", thinking: "expanded" } },
        });
        const task: AgentTask = {
          id: "scroll-review",
          title: "Review expanded activity",
          provider: "copilot",
          status: "ready",
          isolation: "local",
          model: null,
          cwd: "/dev/acme-api",
          branch: null,
          base: null,
          baseCommit: null,
          error: null,
          createdMs: 1000,
          updatedMs: 5000,
          config: [],
          commands: [],
          usage: null,
          queue: [],
        };
        const shell: AgentEntry = {
          type: "tool",
          id: "review-output",
          title: "Show full command output",
          kind: "execute",
          status: "completed",
          command: { text: command, cwd: task.cwd },
          output,
          locations: [],
          diffs: [],
        };
        const entries: AgentEntry[] = [
          {
            type: "user",
            text: "Review the complete activity",
            attachments: [],
            steered: false,
            sentMs: 1000,
            doneMs: 5000,
          },
          {
            type: "thought",
            text: "Reasoning to review\n\n" + "Inspect every change before continuing.\n\n".repeat(24),
          },
          shell,
          { ...shell, id: "legacy-output", title: "Read captured output", kind: "read", command: undefined },
          {
            ...shell,
            id: "review-file",
            title: "Edited src/review.ts",
            kind: "edit",
            command: undefined,
            output: "",
            diffs: [
              {
                path: "src/review.ts",
                added: 60,
                removed: 0,
                preview: {
                  type: "text",
                  before: "",
                  after: Array.from({ length: 60 }, (_, n) => `export const item${n} = ${n};`).join("\n"),
                },
              },
            ],
          },
          {
            type: "subagent",
            id: "child",
            title: "Review independently",
            description: "Read the child activity in this conversation",
            status: "completed",
            error: null,
            prompt: "Review changes",
            reply: "Child review notes.\n\n".repeat(30),
            tools: 1,
            activity: null,
            startedMs: 1000,
            endedMs: 5000,
            cancellable: false,
          },
          { type: "agent", text: "Review complete" },
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
            [`${task.id}/child`, [{ ...shell, id: "child-output", title: "Child command output" }]],
          ]),
        });
        store.dockTask(task.id);
        (await import(layoutPath)).toggleMaximizeToolWindow("agents");
        await document.fonts.ready;
      },
      { theme, command, output },
    );
    const stream = page.locator("[class*='_stream_']:visible");
    await stream.locator("[class*='_turnFold_'] > summary").click();
    await stream.locator("[class*='_processRun_'] > summary").click();
    for (const title of ["Show full command output", "Read captured output", "Child command output"]) {
      if (title === "Child command output") {
        const child = stream.locator("[class*='_subagent_']");
        await child.getByText("Recent activity", { exact: true }).click();
        await child
          .locator("[class*='_subagentSection_'] > summary")
          .filter({ hasText: /^Result$/ })
          .click();
      }
      await stream.locator("[class*='_toolDetails_'] > summary").filter({ hasText: title }).click();
    }
    await stream.locator("[class*='_toolFileHeader_']").click();
    const parentTool = stream.locator("[class*='_toolDetails_']").filter({
      has: page.locator(":scope > summary", { hasText: "Show full command output" }),
    });
    const outputBlock = parentTool.locator("[class*='_shellOutput_']");
    const label = outputBlock.getByText("Output", { exact: true });
    await label.scrollIntoViewIfNeeded();
    const preview = outputBlock.getByRole("region", { name: "Output", exact: true });
    expect(
      await preview.evaluate((el) => {
        const pre = el.firstElementChild!;
        return pre.getBoundingClientRect().bottom - el.getBoundingClientRect().bottom;
      }),
      "the preview must show the end of the retained output",
    ).toBeLessThan(1);
    if (process.env.OPENIDEA_SCROLL_SCREENSHOTS) {
      await page.screenshot({
        path: `${process.env.OPENIDEA_SCROLL_SCREENSHOTS}/activity-${theme}-${width}.png`,
        animations: "disabled",
      });
    }
    const nestedScrollers = () =>
      stream.evaluate((root) =>
        [...root.querySelectorAll<HTMLElement>("*")]
          .filter(
            (el) =>
              el.clientHeight > 0 &&
              el.scrollHeight - el.clientHeight > 1 &&
              /^(auto|scroll)$/.test(getComputedStyle(el).overflowY),
          )
          .map((el) => el.getAttribute("aria-label") ?? el.className),
      );
    expect(await nestedScrollers(), "expanded activity must not add vertical scroll containers").toEqual([]);
    const top = await stream.evaluate((el) => el.scrollTop);
    const box = (await label.boundingBox())!;
    await page.mouse.move(box.x + 30, box.y + box.height + 25);
    await page.mouse.wheel(0, 260);
    await expect.poll(() => stream.evaluate((el) => el.scrollTop)).toBeGreaterThan(top + 150);
    await outputBlock.getByRole("button", { name: "Copy Output", exact: true }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(output);
    await outputBlock.getByRole("button", { name: "Show full output", exact: true }).click();
    const viewport = outputBlock.getByRole("region", { name: "Output", exact: true });
    await expect(viewport).toHaveAttribute("tabindex", "0");
    expect(await nestedScrollers(), "only the explicitly expanded output may scroll inside").toEqual(["Output"]);
    await viewport.hover({ position: { x: 30, y: 30 } });
    const outerTop = await stream.evaluate((el) => el.scrollTop);
    await page.mouse.wheel(0, 200);
    await expect.poll(() => viewport.evaluate((el) => el.scrollTop)).toBeGreaterThan(100);
    expect(await stream.evaluate((el) => el.scrollTop)).toBe(outerTop);
    if (process.env.OPENIDEA_SCROLL_SCREENSHOTS) {
      await page.screenshot({
        path: `${process.env.OPENIDEA_SCROLL_SCREENSHOTS}/expanded-${theme}-${width}.png`,
        animations: "disabled",
      });
    }
    await outputBlock.getByRole("button", { name: "Wrap Lines", exact: true }).click();
    await expect.poll(() => viewport.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeGreaterThan(100);
    expect(await nestedScrollers(), "wrapping must not introduce another vertical scroll container").toEqual([
      "Output",
    ]);
    for (const status of ["running", "ready"] as const) {
      await page.evaluate(async (status) => {
        const storePath = "/src/features/agents/store.ts";
        const { useAgents } = await import(storePath);
        const state = useAgents.getState();
        const task = state.tasks.get("scroll-review")!;
        useAgents.setState({ tasks: new Map([[task.id, { ...task, status }]]) });
      }, status);
      await expect(outputBlock.getByRole("button", { name: "Collapse output", exact: true })).toBeVisible();
      await expect(viewport).toHaveAttribute("tabindex", "0");
      expect(await nestedScrollers(), "remounting a finished turn must retain the output disclosure").toEqual([
        "Output",
      ]);
      await expect(stream.getByText("Child review notes.", { exact: true }).first()).toBeVisible();
      await expect(stream.getByText("Child command output", { exact: true })).toBeVisible();
    }
    await outputBlock.getByRole("button", { name: "Collapse output", exact: true }).click();
    expect(await nestedScrollers()).toEqual([]);
    await expect(outputBlock.getByRole("button", { name: "Show full output", exact: true })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await stream.getByText("Review complete", { exact: true }).scrollIntoViewIfNeeded();
    await expect(stream.getByText("Review complete", { exact: true })).toBeInViewport();
    await stream.focus();
    await page.keyboard.press("Meta+f");
    const find = page.getByRole("textbox", { name: "Find in Conversation", exact: true });
    await find.fill("output-0:");
    await expect(page.locator("[class*='_findCount_']")).toHaveText("1/3");
    await find.press("Enter");
    expect(await viewport.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeLessThan(2);
    expect(await nestedScrollers(), "finding retained output must use the conversation scroll").toEqual([]);
    await find.press("Escape");
    await expect(outputBlock.getByRole("button", { name: "Show full output", exact: true })).toBeVisible();
  });
}
