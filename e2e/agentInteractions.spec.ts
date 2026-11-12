import type { Page } from "@playwright/test";
import type { AgentEntry, AgentTask } from "../src/bindings";
import { expect, test } from "./fixtures";

const task: AgentTask = {
  id: "interaction-a",
  title: "Inspect source",
  status: "ready",
  isolation: "local",
  provider: "codex",
  model: null,
  cwd: "/dev/acme-api",
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
  capabilities: { fork: true, rollback: true, steer: true, images: true },
};
const user: AgentEntry = { type: "user", text: "Inspect this source", attachments: [], steered: false };
const paragraphs = (count: number) =>
  Array.from({ length: count }, (_, i) => `Paragraph ${i}: readable conversation output.`).join("\n\n");

async function openChat(
  page: Page,
  entries: AgentEntry[] = [user, { type: "agent", text: "Source inspected." }],
  busy = false,
) {
  await page.goto("/");
  await page.getByRole("tree", { name: "Project" }).waitFor();
  await page.evaluate(
    async ({ task, entries, busy }) => {
      const path = "/src/features/agents/store.ts";
      const layoutPath = "/src/workbench/toolwindows/store.ts";
      const store = await import(path);
      store.useAgents.setState({
        loaded: true,
        error: null,
        providers: [],
        tasks: new Map([
          [task.id, { ...task, status: busy ? "running" : "ready" }],
          ["interaction-b", { ...task, id: "interaction-b", title: "Review changes" }],
        ]),
        entries: new Map([
          [task.id, entries],
          ["interaction-b", [{ type: "agent", text: "Second session." }]],
        ]),
        unread: new Set(),
        docked: null,
        dockedTabs: [],
      });
      store.dockTask(task.id);
      (await import(layoutPath)).toggleMaximizeToolWindow("agents");
      await document.fonts.ready;
    },
    { task, entries, busy },
  );
  return page.locator("[class*='_stream_']:visible");
}

test("fills the conversation width with the composer while keeping prose readable", async ({ page }, info) => {
  const stream = await openChat(page);
  const composer = page.getByRole("textbox", { name: "Message", exact: true });
  for (const width of [1400, 800]) {
    await page.setViewportSize({ width, height: 900 });
    const bounds = await composer.evaluate((input) => {
      const area = input.closest("[class*='_composerArea_']")!;
      const conversation = area.parentElement!;
      const card = input.closest("[class*='_composer_']")!;
      return {
        conversation: conversation.getBoundingClientRect().toJSON(),
        composer: card.getBoundingClientRect().toJSON(),
      };
    });
    expect(bounds.composer.width).toBeGreaterThan(bounds.conversation.width * 0.94);
    expect(bounds.composer.x).toBeGreaterThanOrEqual(bounds.conversation.x);
    expect(bounds.composer.right).toBeLessThanOrEqual(bounds.conversation.right);
    if (width === 1400) {
      const prose = (await stream.locator("[class*='_agentCard_']").first().boundingBox())!;
      expect(prose.width).toBeLessThan(bounds.composer.width * 0.9);
    }
    await page.screenshot({ path: info.outputPath(`composer-width-${width}.png`) });
  }
});

for (const { theme, width } of [
  { theme: "light", width: 1400 },
  { theme: "dark", width: 760 },
]) {
  test(`shares one header row between session tabs and window actions in ${theme} at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openChat(page);
    await page.evaluate(async (theme) => {
      const path = "/src/platform/project.ts";
      (await import(path)).useProject.setState({ settings: { theme } });
    }, theme);
    const agents = page.getByRole("region", { name: "Agents", exact: true });
    const tabs = agents.getByRole("tablist", { name: "Agent sessions", exact: true });
    await expect(tabs).toBeVisible();
    if (process.env.OPENIDEA_HEADER_SCREENSHOTS) {
      await page.screenshot({
        path: `${process.env.OPENIDEA_HEADER_SCREENSHOTS}/header-${theme}-${width}.png`,
        animations: "disabled",
      });
    }
    await expect(agents.locator("header")).toHaveCount(1);
    const header = agents.locator("header");
    await expect(header.getByRole("tablist", { name: "Agent sessions", exact: true })).toBeVisible();
    const box = (await header.boundingBox())!;
    const tabBox = (await tabs.boundingBox())!;
    expect(tabBox.y).toBeGreaterThanOrEqual(box.y);
    expect(tabBox.y + tabBox.height).toBeLessThanOrEqual(box.y + box.height);
    await header.hover();
    for (const name of ["New Agent Task", "External MCP Servers…", "Options", "Hide"]) {
      await expect(header.getByRole("button", { name, exact: true })).toBeVisible();
    }
    await header.getByRole("button", { name: "Agent sessions", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Agent sessions", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await header.getByRole("button", { name: "New Agent Task", exact: true }).click();
    await expect(header.getByRole("tab", { name: /New Agent Task/ })).toHaveAttribute("aria-selected", "true");
    await expect(agents.locator("header")).toHaveCount(1);
  });
}

for (const theme of ["light", "dark"] as const) {
  test(`keeps sent messages soft and their controls available on hover or focus in ${theme}`, async ({ page }) => {
    const text = "查看当前 k8s，用 table 的形式展示出来";
    const stream = await openChat(page, [
      { ...user, text },
      { type: "agent", text: "I will inspect the current context." },
      { ...user, text: "Keep the complete message readable.\n" + "long-path-segment/".repeat(40) },
      { type: "agent", text: "The message can still be edited directly." },
    ]);
    await page.evaluate(async (theme) => {
      const path = "/src/platform/project.ts";
      (await import(path)).useProject.setState({ settings: { theme } });
    }, theme);
    await stream.evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.mouse.move(10, 10);
    const message = stream.getByRole("button", { name: text, exact: true }).locator("..");
    const footer = message.locator("..").locator(":scope > [class*='_messageFooter_']");
    if (process.env.OPENIDEA_BUBBLE_SCREENSHOTS) {
      await page.screenshot({
        path: `${process.env.OPENIDEA_BUBBLE_SCREENSHOTS}/bubble-${theme}.png`,
        animations: "disabled",
      });
    }
    expect(await message.evaluate((el) => parseFloat(getComputedStyle(el).borderRadius))).toBeGreaterThanOrEqual(20);
    await expect(footer).toHaveCSS("opacity", "0");
    const before = (await message.boundingBox())!;
    await message.hover();
    await expect(footer).toHaveCSS("opacity", "1");
    expect(await message.boundingBox()).toEqual(before);
    await page.mouse.move(10, 10);
    await expect(footer).toHaveCSS("opacity", "0");
    const sent = message.getByRole("button", { name: text, exact: true });
    await sent.focus();
    await expect(footer).toHaveCSS("opacity", "1");
    await sent.press("Enter");
    await expect(page.getByRole("textbox", { name: "Message", exact: true }).first()).toHaveValue(text);
    await page.keyboard.press("Escape");
    await expect(sent).toBeVisible();
    const streamBox = (await stream.boundingBox())!;
    for (const bubble of await stream.locator("[class*='_user_']").all()) {
      const box = (await bubble.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(streamBox.x);
      expect(box.x + box.width).toBeLessThanOrEqual(streamBox.x + streamBox.width);
    }
  });
}

test("clicks sent text to edit, preserves selection, and applies Enter, Shift+Enter and Escape", async ({ page }) => {
  await openChat(page, [
    { ...user, text: "Previous request" },
    { type: "agent", text: "Previous answer." },
    user,
    { type: "agent", text: "Source inspected." },
  ]);
  const sent = page.getByRole("button", { name: "Inspect this source", exact: true });
  await expect(sent).toHaveCSS("cursor", "pointer");
  await sent.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
  });
  await expect(sent).toBeVisible();
  expect(await page.evaluate(() => window.getSelection()!.toString())).toBe("Inspect this source");
  await page.evaluate(() => window.getSelection()!.removeAllRanges());
  await sent.click();
  const edit = page.getByRole("textbox", { name: "Message", exact: true }).first();
  await expect(edit).toBeFocused();
  await edit.fill("First line");
  await edit.press("Shift+Enter");
  await edit.press("a");
  await expect(edit).toHaveValue("First line\na");
  await edit.press("Escape");
  await expect(sent).toBeVisible();
  await sent.focus();
  await sent.press("Enter");
  await expect(edit).toHaveValue("Inspect this source");
  await edit.fill("Updated source request");
  await edit.dispatchEvent("keydown", { key: "Enter", isComposing: true });
  await expect(edit).toHaveValue("Updated source request");
  await page.evaluate(async (id) => {
    const path = "/src/features/agents/store.ts";
    const routePath = "/src/platform/tauriCore.ts";
    const store = await import(path);
    const { setInvokeRoute } = await import(routePath);
    setInvokeRoute((cmd, args) => {
      if (cmd === "agent_rollback") return Promise.resolve(null);
      if (cmd === "agent_prompt") {
        const text = (args as { prompt: { text: string } }).prompt.text;
        store.useAgents.setState({
          entries: new Map([
            [
              id,
              [
                { type: "user", text, attachments: [], steered: false },
                { type: "agent", text: "Regenerated source answer." },
              ],
            ],
          ]),
        });
        return Promise.resolve(null);
      }
      return null;
    });
  }, task.id);
  await edit.press("Enter");
  await expect(page.getByText("Regenerated source answer.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Updated source request", exact: true })).toBeVisible();
});

test("keeps session tabs, drafts and history offsets while switching and closing views", async ({ page }) => {
  const stream = await openChat(page, [user, { type: "agent", text: paragraphs(60) }]);
  await stream.evaluate((el) => {
    el.scrollTop = 200;
  });
  await expect(page.getByRole("button", { name: "Scroll to bottom" })).toBeVisible();
  const composer = page.getByRole("textbox", { name: "Message", exact: true });
  await composer.fill("First draft");
  await page.evaluate(async () => {
    const path = "/src/features/agents/store.ts";
    (await import(path)).dockTask("interaction-b");
  });
  const tabs = page.getByRole("tablist", { name: "Agent sessions" });
  await expect(tabs.getByRole("tab")).toHaveCount(2);
  await composer.fill("Second draft");
  await tabs.getByRole("tab", { name: /Inspect source/ }).click();
  await expect(composer).toHaveValue("First draft");
  await expect.poll(() => stream.evaluate((el) => el.scrollTop)).toBeCloseTo(200, 0);
  await tabs.getByRole("tab", { name: /Review changes/ }).click();
  await expect(composer).toHaveValue("Second draft");
  await tabs.getByRole("tab", { name: /Review changes/ }).press("Delete");
  await expect(tabs.getByRole("tab")).toHaveCount(1);
  await expect(composer).toHaveValue("First draft");
  await page.getByRole("button", { name: "Agent sessions", exact: true }).click();
  await page.getByRole("treeitem", { name: /Review changes/ }).dblclick();
  await expect(tabs.getByRole("tab")).toHaveCount(2);
  await expect(composer).toHaveValue("Second draft");
});

test("uses readable reasoning text and a centered floating jump button", async ({ page }, info) => {
  const stream = await openChat(page, [
    user,
    { type: "thought", text: "Checking the source and its tests.\n\n检查实现和验证结果。" },
    {
      type: "tool",
      id: "read",
      kind: "read",
      title: "Read source",
      status: "completed",
      locations: [],
      output: "Source file loaded.",
      diffs: [],
    },
    { type: "agent", text: paragraphs(40) },
  ]);
  await stream.evaluate((el) => {
    el.scrollTop = 0;
  });
  const turn = stream.locator("[class*='_turnFold_'] > summary");
  await expect(turn).toHaveCSS("font-size", "15px");
  await turn.click();
  await expect(stream.locator("[class*='_processRun_'] > summary")).toHaveCount(0);
  await expect(stream.getByText("Read 1 file", { exact: true })).toHaveCount(1);
  const thought = stream.locator("[class*='_thought_'] > summary");
  await expect(thought).toHaveText("Thoughts");
  await expect(thought).toHaveCSS("font-size", "15px");
  await thought.click();
  await expect(stream.getByText("Checking the source and its tests.", { exact: false }).last()).toHaveCSS(
    "font-size",
    "15px",
  );
  const jump = page.getByRole("button", { name: "Scroll to bottom" });
  expect(await jump.locator("svg").evaluate((el) => getComputedStyle(el).color)).toBe(
    await jump.evaluate((el) => getComputedStyle(el).color),
  );
  expect(
    await jump
      .locator("svg [stroke]")
      .first()
      .evaluate((el) => getComputedStyle(el).stroke),
  ).toBe(await jump.evaluate((el) => getComputedStyle(el).color));
  const button = (await jump.boundingBox())!;
  const bounds = (await stream.boundingBox())!;
  expect(button.width).toBe(40);
  expect(button.height).toBe(40);
  expect(Math.abs(button.x + 20 - (bounds.x + bounds.width / 2))).toBeLessThan(2);
  await page.screenshot({ path: info.outputPath("reasoning-and-tabs.png") });
  await jump.click();
  await expect.poll(() => stream.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThan(1);
});

for (const reduced of [false, true]) {
  test(`follows streaming output smoothly and respects manual scrolling (reduced motion: ${reduced})`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
    const stream = await openChat(page, [user, { type: "agent", text: paragraphs(30) }], true);
    await expect.poll(() => stream.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThan(1);
    const samples = await stream.evaluate(async (el) => {
      const path = "/src/features/agents/store.ts";
      const store = await import(path);
      const initial = el.scrollTop;
      const previous = store.useAgents.getState().entries.get("interaction-a")!;
      store.useAgents.setState({
        entries: new Map([["interaction-a", [...previous, { type: "agent", text: "New output.\n\n".repeat(15) }]]]),
      });
      const samples = [];
      for (let i = 0; i < 20; i++) {
        await new Promise(requestAnimationFrame);
        samples.push({ top: el.scrollTop, bottom: el.scrollHeight - el.clientHeight });
      }
      return { initial, samples };
    });
    expect(samples.samples.at(-1)!.top).toBeGreaterThan(samples.initial);
    if (!reduced) expect(samples.samples.some((s) => s.top > samples.initial && s.top < s.bottom - 1)).toBe(true);
    else expect(samples.samples.every((s) => Math.abs(s.top - s.bottom) < 1)).toBe(true);
    await expect.poll(() => stream.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThan(1);
    await stream.hover();
    await page.mouse.wheel(0, -600);
    await expect(page.getByRole("button", { name: "Scroll to bottom" })).toBeVisible();
    const top = await stream.evaluate((el) => el.scrollTop);
    await page.evaluate(async () => {
      const path = "/src/features/agents/store.ts";
      const store = await import(path);
      const entries = store.useAgents.getState().entries.get("interaction-a")!;
      store.useAgents.setState({
        entries: new Map([["interaction-a", [...entries, { type: "agent", text: "More output.\n\n".repeat(15) }]]]),
      });
    });
    await expect.poll(() => stream.evaluate((el) => el.scrollTop)).toBeCloseTo(top, 0);
    await page.getByRole("button", { name: "Scroll to bottom" }).click();
    await expect.poll(() => stream.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThan(1);
  });
}

test("opens a linked local file in an editor tab at its requested line and column", async ({ page }) => {
  await openChat(page);
  await page.evaluate(async () => {
    const backendPath = "/src/editor/core/backend.ts";
    const routePath = "/src/platform/tauriCore.ts";
    const storePath = "/src/features/agents/store.ts";
    const layoutPath = "/src/workbench/toolwindows/store.ts";
    const { docBackend } = await import(backendPath);
    docBackend().files.set(
      "/dev/acme-api/reference.txt",
      Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n"),
    );
    (await import(routePath)).setInvokeRoute((cmd, args) => {
      if (cmd !== "fs_probe") return null;
      sessionStorage.setItem("reference-probe", JSON.stringify(args));
      return Promise.resolve({ size: 200, binary: false, tooLarge: false });
    });
    (await import(storePath)).useAgents.setState({
      entries: new Map([
        [
          "interaction-a",
          [{ type: "agent", text: "Read `reference.txt:12:3` or [the file](file:///dev/acme-api/reference.txt#L7)." }],
        ],
      ]),
    });
    (await import(layoutPath)).toggleMaximizeToolWindow("agents");
  });
  const link = page.getByRole("link", { name: "reference.txt:12:3" });
  await expect
    .poll(() => page.evaluate(() => sessionStorage.getItem("reference-probe")))
    .toBe(JSON.stringify({ path: "/dev/acme-api/reference.txt" }));
  await expect(link).toBeVisible();
  await link.focus();
  await link.press("Enter");
  await expect(page.getByRole("tab", { name: /reference.txt/ })).toBeVisible();
  const selection = () =>
    page
      .locator(".cm-content:visible")
      .first()
      .evaluate((el) => {
        const view = (
          el as unknown as {
            cmTile: {
              view: {
                state: {
                  selection: { main: { head: number } };
                  doc: { lineAt(pos: number): { number: number; from: number } };
                };
              };
            };
          }
        ).cmTile.view;
        const head = view.state.selection.main.head;
        const line = view.state.doc.lineAt(head);
        return { line: line.number, col: head - line.from + 1 };
      });
  await expect.poll(selection).toEqual({ line: 12, col: 3 });
  await page.getByRole("link", { name: "the file", exact: true }).click();
  await expect.poll(selection).toEqual({ line: 7, col: 1 });
});
