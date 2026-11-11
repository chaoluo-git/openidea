import type { Page } from "@playwright/test";
import { expect, ipcCalls, stubDesktop, test } from "./fixtures";

async function prepare(page: Page) {
  await stubDesktop(page);
  await page.evaluate(async () => {
    const root = "/dev/acme-api";
    const vcsPath = "/src/features/vcs/store.ts";
    const agentsPath = "/src/features/agents/store.ts";
    const vcs = await import(vcsPath);
    const agents = await import(agentsPath);
    const changes = ["api.ts", "excluded.ts"].map((name) => ({
      path: `${root}/${name}`,
      relPath: name,
      staged: null,
      unstaged: "modified",
      renamedFrom: null,
    }));
    const h = window.__ipc.handlers;
    h.vcs_roots = () => [{ root, operation: null, head: "main", headCommit: "1111111" }];
    h.vcs_branch_info = () => ({
      head: "main",
      headCommit: "1111111",
      upstream: null,
      ahead: 0,
      behind: 0,
      operation: null,
    });
    h.vcs_status = () => changes;
    h.fs_probe = (args) => {
      if (String(args.path).endsWith("api.ts")) return { size: 48, binary: false, tooLarge: false };
      throw { kind: "notFound", message: "Not found" };
    };
    h.fs_read_text = () => "return cancellableRequest();\n";
    h.vcs_file_at = () => "return request();\n";
    h.vcs_diff_hunks = () => [
      { kind: "modified", start: 0, lines: 1, oldStart: 0, oldLines: 1, oldText: "return request();\n" },
    ];
    h.vcs_log = () => [{ summary: "fix(api): preserve request timeouts" }];
    h.agent_providers = () => [
      {
        id: "codex",
        name: "Codex",
        installed: true,
        config: [
          { id: "mode", category: "mode", current: "full-access", values: [{ value: "read-only", name: "Read Only" }] },
          { id: "model", category: "model", current: "configured-model", values: [] },
        ],
      },
    ];
    h.agent_create = () => {
      const task = {
        id: "commit-generation",
        title: "Generate commit message",
        provider: "codex",
        model: "configured-model",
        status: "running",
        isolation: "local",
        cwd: root,
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
      agents.useAgents.setState((s) => ({
        tasks: new Map(s.tasks).set(task.id, task),
        entries: new Map(s.entries).set(task.id, []),
      }));
      return task;
    };
    h.agent_entries = () => [
      {
        type: "agent",
        text: JSON.stringify({
          message: "fix(api): preserve request cancellation\n\nKeep cancellation active until the request completes.",
        }),
      },
    ];
    h.agent_cancel = () => null;
    h.agent_delete = () => {
      agents.useAgents.setState((s) => {
        const tasks = new Map(s.tasks);
        tasks.delete("commit-generation");
        return { tasks };
      });
      return null;
    };
    vcs.useVcs.setState({ available: true, root, repo: root, branchesLoaded: false, stashesLoaded: false });
    await vcs.refreshNow();
  });
  await page.keyboard.press("Meta+k");
  const panel = page.getByRole("region", { name: "Commit", exact: true });
  await panel.getByRole("checkbox", { name: "Include excluded.ts in commit" }).uncheck();
  return panel;
}

async function finish(page: Page) {
  await page.evaluate(async () => {
    const path = "/src/features/agents/store.ts";
    const { useAgents } = await import(path);
    useAgents.setState((s) => {
      const tasks = new Map(s.tasks);
      const task = tasks.get("commit-generation")!;
      tasks.set(task.id, { ...task, status: "ready" });
      return { tasks };
    });
  });
}

test("generates a meaningful editable commit draft using the configured agent and selected changes", async ({
  workbench: page,
}, info) => {
  const panel = await prepare(page);
  await panel.getByRole("button", { name: "Generate Commit Message", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Cancel Commit Message Generation", exact: true })).toBeVisible();
  const [request] = await ipcCalls(page, "agent_create");
  const payload = request!.request as { prompt: { text: string }; config: Array<{ id: string; value: string }> };
  expect(payload.prompt.text).toContain("cancellableRequest");
  expect(payload.prompt.text).not.toContain("excluded.ts");
  expect(payload.config).toContainEqual({ id: "mode", value: "read-only" });
  expect(payload.config).toContainEqual({ id: "model", value: "configured-model" });
  await finish(page);
  const message = panel.getByRole("textbox", { name: "Commit message" });
  await expect(message).toHaveValue(
    "fix(api): preserve request cancellation\n\nKeep cancellation active until the request completes.",
  );
  await expect(panel.getByRole("button", { name: "Cancel Commit Message Generation", exact: true })).toBeHidden();
  await panel.screenshot({ path: info.outputPath("generated-commit-message.png") });
  await message.fill("fix(api): preserve cancellation while streaming");
  expect(await ipcCalls(page, "vcs_commit")).toHaveLength(0);
  expect(await ipcCalls(page, "agent_delete")).toHaveLength(1);
});

test("keeps the labeled Generate action visible in a narrow Commit panel", async ({ workbench: page }, info) => {
  await page.setViewportSize({ width: 800, height: 900 });
  const panel = await prepare(page);
  const generate = panel.getByRole("button", { name: "Generate Commit Message", exact: true });
  await expect(generate).toHaveText("Generate");
  const bounds = (await panel.boundingBox())!;
  const button = (await generate.boundingBox())!;
  expect(button.x).toBeGreaterThanOrEqual(bounds.x);
  expect(button.x + button.width).toBeLessThanOrEqual(bounds.x + bounds.width);
  await generate.click();
  await expect(panel.getByRole("button", { name: "Cancel Commit Message Generation", exact: true })).toBeInViewport();
  await panel.screenshot({ path: info.outputPath("narrow-commit-generation.png") });
  await panel.getByRole("button", { name: "Cancel Commit Message Generation", exact: true }).click();
});

test("retains a draft edited while the agent generates and offers cancellation", async ({ workbench: page }) => {
  const panel = await prepare(page);
  const message = panel.getByRole("textbox", { name: "Commit message" });
  await message.fill("Original draft");
  await panel.getByRole("button", { name: "Generate Commit Message", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Cancel Commit Message Generation", exact: true })).toBeVisible();
  await message.fill("My new draft");
  await finish(page);
  await expect(page.getByText("Couldn't generate commit message", { exact: true })).toBeVisible();
  await expect(message).toHaveValue("My new draft");
  await expect(panel.getByRole("button", { name: "Cancel Commit Message Generation", exact: true })).toBeHidden();
  await panel.getByRole("button", { name: "Generate Commit Message", exact: true }).click();
  await panel.getByRole("button", { name: "Cancel Commit Message Generation", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Cancel Commit Message Generation", exact: true })).toBeHidden();
  await expect(message).toHaveValue("My new draft");
  expect(await ipcCalls(page, "vcs_commit")).toHaveLength(0);
});
