import { expect, test } from "./fixtures";
import type { AgentEntry, AgentTask } from "../src/bindings";

for (const theme of ["light", "dark"] as const)
  for (const width of [760, 1400]) {
    test(`shows compact file activity and real diffs at ${width}px in ${theme}`, async ({ page, workbench }) => {
      void workbench;
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate((theme) => {
        document.documentElement.dataset.theme = theme;
      }, theme);
      const path = "/Users/example/.copilot/session-state/89c45d5f-3ddd-41ee-82b0-9726b9bf63c9/files/p0pom/adddeps.py";
      await page.evaluate(async (path) => {
        const storePath = "/src/features/agents/store.ts";
        const projectPath = "/src/platform/project.ts";
        const layoutPath = "/src/workbench/toolwindows/store.ts";
        const store = await import(storePath);
        const project = await import(projectPath);
        project.useProject.setState({ settings: { agents: { foldTurns: false, toolCalls: "each" } } });
        const task: AgentTask = {
          id: "activity",
          title: "Inspect dependency changes",
          provider: "copilot",
          status: "running",
          isolation: "local",
          model: null,
          cwd: "/dev/acme-api",
          branch: null,
          base: null,
          baseCommit: null,
          error: null,
          createdMs: Date.now() - 38_000,
          updatedMs: Date.now(),
          config: [],
          commands: [],
          usage: null,
          queue: [],
        };
        const tool = (id: string, rest: Partial<Extract<AgentEntry, { type: "tool" }>>): AgentEntry => ({
          type: "tool",
          id,
          kind: "execute",
          title: id,
          status: "completed",
          output: null,
          locations: [],
          diffs: [],
          ...rest,
        });
        const after =
          "from pathlib import Path\n\ndef update_dependencies():\n    return Path('pom.xml').read_text()\n";
        const entries: AgentEntry[] = [
          {
            type: "user",
            text: "Update and verify dependencies",
            attachments: [],
            steered: false,
            sentMs: Date.now() - 38_000,
            doneMs: null,
          },
          { type: "agent", text: "I will update the dependency helper and check the result." },
          tool("create", {
            kind: "edit",
            title: `Creating ${path}`,
            locations: [path],
            diffs: [{ path, added: 4, removed: 0, preview: { type: "text", before: "", after } }],
          }),
          { type: "agent", text: `Info: ${path}` },
          tool("Root deps move", {
            output:
              "pom.xml | 108 +++++-----\n1 file changed, 30 insertions(+), 78 deletions(-)\n<shellId: 300 completed with exit code 0>",
          }),
          tool("Check dependencies indentation", {
            status: "failed",
            output:
              "cat: illegal option -- A\nusage: cat [-benstuv] [file ...]\n<shellId: 301 completed with exit code 1>",
          }),
          tool("Watch build", { status: "running", output: "Checking modules…" }),
        ];
        store.useAgents.setState({
          loaded: true,
          error: null,
          providers: [],
          tasks: new Map([[task.id, task]]),
          unread: new Set(),
          docked: null,
          dockedTabs: [],
          entries: new Map([[task.id, entries]]),
        });
        store.dockTask(task.id);
        (await import(layoutPath)).toggleMaximizeToolWindow("agents");
        await document.fonts.ready;
      }, path);
      const stream = page.locator("[class*='_stream_']:visible");
      await expect(stream.getByText("Root deps move", { exact: true })).toBeVisible();
      if (process.env.OPENIDEA_ACTIVITY_SCREENSHOT) {
        await page.screenshot({
          path: process.env.OPENIDEA_ACTIVITY_SCREENSHOT.replace(/\.png$/, `-${theme}-${width}.png`),
          animations: "disabled",
        });
      }
      const file = stream
        .locator("details")
        .filter({ has: page.locator(":scope > summary", { hasText: "adddeps.py" }) });
      await expect(stream.getByText(`Info: ${path}`, { exact: true })).toHaveCount(0);
      await expect(file.locator(":scope > summary")).toContainText("adddeps.py");
      await expect(file.locator(":scope > summary")).not.toContainText("session-state");
      await expect(file.locator(":scope > summary")).not.toContainText("−0");
      const bounds = await file.boundingBox();
      const streamBounds = await stream.boundingBox();
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(streamBounds!.x + streamBounds!.width);
      await file.locator(":scope > summary").click();
      await expect(file.locator("[data-change='added']")).toHaveCount(4);
      await expect(file.getByText("from pathlib import Path", { exact: true })).toBeVisible();
      await expect(file.getByText("1", { exact: true })).toBeVisible();
      if (process.env.OPENIDEA_ACTIVITY_SCREENSHOT) {
        await page.screenshot({
          path: process.env.OPENIDEA_ACTIVITY_SCREENSHOT.replace(/\.png$/, `-${theme}-${width}-expanded.png`),
          animations: "disabled",
        });
      }
      const failed = stream
        .locator("details")
        .filter({ has: page.locator(":scope > summary", { hasText: "Check dependencies indentation" }) });
      await expect(failed).toHaveAttribute("open", "");
      await expect(failed).toContainText("cat: illegal option -- A");
      await expect(failed.getByText("Exit code 1", { exact: true })).toBeVisible();
      await expect(stream.getByText(/<shellId:/)).toHaveCount(0);
      const done = stream
        .locator("details")
        .filter({ has: page.locator(":scope > summary", { hasText: "Root deps move" }) });
      await expect(done).not.toHaveAttribute("open");
      await done.locator(":scope > summary").click();
      await expect(done).toContainText("1 file changed, 30 insertions(+), 78 deletions(-)");
      const running = stream
        .locator("details")
        .filter({ has: page.locator(":scope > summary", { hasText: "Watch build" }) });
      await expect(running).toHaveAttribute("open", "");
      await page.evaluate(async () => {
        const storePath = "/src/features/agents/store.ts";
        const store = await import(storePath);
        const state = store.useAgents.getState();
        store.useAgents.setState({
          entries: new Map(state.entries).set(
            "activity",
            state.entries
              .get("activity")!
              .map((e) => (e.type === "tool" && e.id === "Watch build" ? { ...e, status: "completed" as const } : e)),
          ),
        });
      });
      await expect(running).not.toHaveAttribute("open");
      await file.getByRole("button", { name: "Open full diff" }).click();
      const diffTab = page.getByRole("tab", { name: /adddeps.py \(Before ↔ After\)/ });
      await expect(diffTab).toHaveAttribute("aria-selected", "true");
      await expect(page.locator(".cm-content").filter({ hasText: "def update_dependencies():" })).toBeVisible();
    });
  }
