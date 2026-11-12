import type { Page } from "@playwright/test";
import { expect, ipcCalls, stubDesktop, test } from "./fixtures";

async function prepare(page: Page, openDiffAsTab = false) {
  await stubDesktop(page);
  await page.evaluate(async (openDiffAsTab) => {
    const root = "/dev/acme-api";
    const vcsPath = "/src/features/vcs/store.ts";
    const projectPath = "/src/platform/project.ts";
    const backendPath = "/src/editor/core/backend.ts";
    const vcs = await import(vcsPath);
    const { useProject } = await import(projectPath);
    const { docBackend } = await import(backendPath);
    useProject.setState((s) => ({
      settings: { ...s.settings, vcs: { ...s.settings?.vcs, openDiffAsTab } },
    }));
    localStorage.removeItem("openidea.vcs.diffDialogMaximized");
    localStorage.removeItem("openidea.vcs.diffDialogSize");
    const changes = ["a.ts", "b.ts"].map((name) => ({
      path: `${root}/${name}`,
      relPath: name,
      staged: null,
      unstaged: "modified",
      renamedFrom: null,
    }));
    for (const file of changes) docBackend().files.set(file.path, "same\nafter\ntail\n");
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
    h.vcs_file_at = () => "same\nbefore\ntail\n";
    h.fs_read_text = () => "same\nafter\ntail\n";
    h.fs_probe = () => ({ size: 16, binary: false, tooLarge: false });
    h.vcs_diff_hunks = () => [{ kind: "modified", start: 1, lines: 1, oldStart: 1, oldLines: 1, oldText: "before\n" }];
    vcs.useVcs.setState({ available: true, root, repo: root, branchesLoaded: false, stashesLoaded: false });
    await vcs.refreshNow();
    await document.fonts.ready;
  }, openDiffAsTab);
  await page.keyboard.press("Meta+k");
  const panel = page.getByRole("region", { name: "Commit", exact: true });
  await panel.getByRole("textbox", { name: "Commit message" }).fill("fix(api): preserve cancellation");
  await panel.getByRole("checkbox", { name: "Include b.ts in commit" }).uncheck();
  return panel;
}

test("exposes an independent diff placement setting without changing the Commit interface", async ({
  workbench: page,
}) => {
  await page.keyboard.press("Meta+,");
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  await settings.getByRole("textbox", { name: "Search settings" }).fill("Open Diff as Editor Tab");
  await settings
    .getByRole("tree", { name: "Settings pages" })
    .getByRole("treeitem", { name: "Version Control", exact: true })
    .click();
  const placement = settings.getByRole("checkbox", { name: "Open Diff as Editor Tab", exact: true });
  await expect(placement).not.toBeChecked();
  await placement.check();
  await settings.getByRole("button", { name: "OK", exact: true }).click();
  const saved = await page.evaluate(async () => {
    const path = "/src/platform/workflowSettings.ts";
    return (await import(path)).workflowSettings().vcs;
  });
  expect(saved.openDiffAsTab).toBe(true);
  expect(saved.commit.nonModal).toBe(true);
});

test("double-click opens a full-workspace diff, navigates files and preserves the Commit draft", async ({
  workbench: page,
}, info) => {
  const panel = await prepare(page);
  await panel.getByRole("treeitem", { name: /a\.ts/ }).dblclick();
  const viewer = page.getByRole("dialog", { name: "a.ts (HEAD ↔ Your version)", exact: true });
  await expect(viewer).toHaveAttribute("data-maximized", "true");
  await expect(viewer.getByRole("toolbar", { name: "Diff", exact: true })).toContainText("1 difference");
  const size = page.viewportSize()!;
  const bounds = (await viewer.boundingBox())!;
  expect(bounds.x).toBe(0);
  expect(bounds.y).toBe(0);
  expect(bounds.width).toBe(size.width);
  expect(bounds.height).toBe(size.height);
  expect((await viewer.locator(".cm-mergeView").boundingBox())!.height).toBeGreaterThan(600);
  await page.screenshot({ path: info.outputPath("full-workspace-diff.png") });
  await viewer.getByRole("button", { name: "Compare Next File", exact: true }).click();
  const next = page.getByRole("dialog", { name: "b.ts (HEAD ↔ Your version)", exact: true });
  await expect(next).toBeVisible();
  await expect(next.getByRole("button", { name: "Compare Next File", exact: true })).toBeDisabled();
  await page.keyboard.press("Control+Shift+ArrowLeft");
  await expect(viewer).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(viewer).toBeHidden();
  await expect(panel.getByRole("textbox", { name: "Commit message" })).toHaveValue("fix(api): preserve cancellation");
  await expect(panel.getByRole("checkbox", { name: "Include b.ts in commit" })).not.toBeChecked();
  expect(await ipcCalls(page, "vcs_commit")).toHaveLength(0);
});

test("restores and maximizes the diff window and remembers the chosen size mode", async ({ workbench: page }) => {
  const panel = await prepare(page);
  await panel.getByRole("treeitem", { name: /a\.ts/ }).dblclick();
  const viewer = page.getByRole("dialog", { name: "a.ts (HEAD ↔ Your version)", exact: true });
  await viewer.getByRole("button", { name: "Restore Size", exact: true }).last().click();
  await expect(viewer).not.toHaveAttribute("data-maximized");
  expect((await viewer.boundingBox())!.width).toBeLessThan(page.viewportSize()!.width);
  await page.keyboard.press("Escape");
  await panel.getByRole("treeitem", { name: /a\.ts/ }).dblclick();
  await expect(viewer).not.toHaveAttribute("data-maximized");
  await viewer.locator("[data-dialog-titlebar]").dblclick();
  await expect(viewer).toHaveAttribute("data-maximized", "true");
  await page.setViewportSize({ width: 800, height: 650 });
  await expect.poll(async () => (await viewer.boundingBox())!.width).toBe(800);
  await expect.poll(async () => (await viewer.boundingBox())!.height).toBe(650);
});

test("covers the macOS project title bar and restores its native controls", async ({ workbench: page }) => {
  const panel = await prepare(page);
  await page.evaluate(async () => {
    const path = "/src/platform/platformInfo.ts";
    (await import(path)).usePlatform.setState({ os: "macos", overlayTitleBar: true });
  });
  await panel.getByRole("treeitem", { name: /a\.ts/ }).dblclick();
  const viewer = page.getByRole("dialog", { name: "a.ts (HEAD ↔ Your version)", exact: true });
  await expect(viewer).toHaveAttribute("data-maximized", "true");
  const bounds = (await viewer.boundingBox())!;
  expect(bounds.y).toBe(0);
  expect(bounds.height).toBe(page.viewportSize()!.height);
  await expect
    .poll(() => ipcCalls(page, "window_set_titlebar_height"))
    .toContainEqual(expect.objectContaining({ height: 28 }));
  await expect(
    viewer.locator("[data-dialog-titlebar]").getByRole("button", { name: "Close", exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(viewer).toBeHidden();
  await expect(panel).toBeVisible();
  await expect
    .poll(() => ipcCalls(page, "window_set_titlebar_height"))
    .toContainEqual(expect.objectContaining({ height: 40 }));
});

test("retains explicit editor-tab placement and the one-off New Tab context action", async ({ workbench: page }) => {
  const panel = await prepare(page, true);
  await panel.getByRole("treeitem", { name: /a\.ts/ }).dblclick();
  await expect(page.getByRole("tab", { name: /a\.ts.*HEAD/ })).toBeVisible();
  await expect(page.getByRole("dialog", { name: /a\.ts/ })).toBeHidden();
  await panel.getByRole("treeitem", { name: /b\.ts/ }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Show Diff in a New Tab", exact: true }).click();
  await expect(page.getByRole("tab", { name: /b\.ts.*HEAD/ })).toBeVisible();
});

test("retains unsaved edits when switching files with autosave disabled", async ({ workbench: page }) => {
  const panel = await prepare(page);
  await page.evaluate(async () => {
    const path = "/src/platform/project.ts";
    const { useProject } = await import(path);
    useProject.setState((s) => ({ settings: { ...s.settings, files: { ...s.settings?.files, autoSave: false } } }));
  });
  await panel.getByRole("treeitem", { name: /a\.ts/ }).dblclick();
  const viewer = page.getByRole("dialog", { name: "a.ts (HEAD ↔ Your version)", exact: true });
  const editor = viewer.locator(".cm-editor.cm-merge-b .cm-content");
  await editor.click();
  await page.keyboard.press("Meta+Home");
  await page.keyboard.insertText("// unsaved local edit\n");
  await expect(editor).toContainText("unsaved local edit");
  await viewer.getByRole("button", { name: "Compare Next File", exact: true }).click();
  const next = page.getByRole("dialog", { name: "b.ts (HEAD ↔ Your version)", exact: true });
  await expect(next.getByRole("toolbar", { name: "Diff", exact: true })).toContainText("1 difference");
  await next.getByRole("button", { name: "Compare Previous File", exact: true }).click();
  await expect(editor).toContainText("unsaved local edit");
  const saved = await page.evaluate(async () => {
    const path = "/src/editor/core/backend.ts";
    return (await import(path)).docBackend().files.get("/dev/acme-api/a.ts");
  });
  expect(saved).not.toContain("unsaved local edit");
  await page.keyboard.press("Escape");
  await page.evaluate(async () => {
    const path = "/src/workbench/contributions.ts";
    await (await import(path)).editorService().openFile("/dev/acme-api/a.ts", { focus: true });
  });
  await expect(page.locator(".cm-content:visible")).toContainText("unsaved local edit");
  await page.keyboard.press("Meta+s");
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const path = "/src/editor/core/backend.ts";
        return (await import(path)).docBackend().files.get("/dev/acme-api/a.ts");
      }),
    )
    .toContain("unsaved local edit");
});
