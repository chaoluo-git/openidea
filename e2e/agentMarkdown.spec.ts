/** Markdown in agent replies, in the real conversation: browser defaults don't suit a narrow chat. */
import { expect, test, type Page } from "@playwright/test";

const TASK = {
  id: "t1",
  title: "Repro task",
  status: "ready" as const,
  isolation: "local" as const,
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

const PIXEL = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const REPLY = [
  "# Heading one",
  "",
  "## Heading two",
  "",
  "##### Heading five",
  "",
  "> A quote",
  "",
  "- [x] done",
  "- [ ] open",
  "",
  "---",
  "",
  `![pixel](${PIXEL})`,
  "",
  "| Path | Owner | Status | Notes |",
  "| --- | --- | --- | --- |",
  "| src/features/agents/conversation/very/long/path/file.tsx | someone | modified | a fairly long note |",
  "",
  "```ts",
  "const a = 1;",
  "```",
].join("\n");

async function openReply(page: Page, text: string, imageData?: string, theme?: "dark" | "light") {
  await page.goto("/");
  await page.getByRole("tree", { name: "Project" }).waitFor();
  await page.evaluate(
    async ({ task, text, imageData, theme }) => {
      if (theme) document.documentElement.dataset.theme = theme;
      if (imageData) {
        const routePath = "/src/platform/tauriCore.ts";
        const { setInvokeRoute } = await import(routePath);
        setInvokeRoute((cmd: string) => (cmd === "fs_read_image" ? Promise.resolve(imageData) : null));
      }
      // Paths go through variables: knip can't resolve these browser-absolute URLs.
      const storePath = "/src/features/agents/store.ts";
      const store = await import(storePath);
      store.useAgents.setState({
        loaded: true,
        error: null,
        providers: [],
        tasks: new Map([[task.id, task]]),
        entries: new Map([
          [
            task.id,
            [
              { type: "user", text: "Show Markdown", attachments: [], sentMs: 0, doneMs: 1, steered: false },
              { type: "agent", text },
            ],
          ],
        ]),
        unread: new Set(),
        docked: null,
      });
      store.dockTask(task.id);
    },
    { task: TASK, text, imageData, theme },
  );
  const reply = page.locator("[class*='_markdown_']").first();
  await reply.locator("h1, p").first().waitFor();
  return reply;
}

const css = (reply: ReturnType<Page["locator"]>, selector: string, property: string) =>
  reply
    .locator(selector)
    .first()
    .evaluate((el, name) => getComputedStyle(el).getPropertyValue(name), property);
const px = (value: string) => Number.parseFloat(value);

const SQL_REPLY = [
  "## PostgreSQL performance summary",
  "",
  "The table compares the three queries and their share of the total execution time.",
  "",
  "| Rank | SQL | Share | Calls | Average | Notes |",
  "| --- | --- | ---: | ---: | ---: | --- |",
  "| #1 | `UPDATE registrations SET modified_at` | **33.02%** | 76,165 | 108ms | Update timestamp |",
  "| #2 | `SELECT user_id FROM registrations` | **31.83%** | 76,243 | 104ms | Check registration |",
  "| #3 | `SELECT user_id FROM subscriptions` | **27.75%** | 77,252 | 90ms | List subscriptions |",
  "",
  "### Inspect indexes",
  "",
  "```sql",
  "-- Read the existing indexes",
  "SELECT indexname, indexdef",
  "FROM pg_indexes",
  "WHERE tablename = 'registrations';",
  "```",
].join("\n");

const POD_REPLY = [
  "## Pods",
  "",
  "Current **context:** `example-cluster`. All workloads are ready.",
  "",
  "| Name | Namespace | Ready | Status | Restarts | Age | Node | IP |",
  "| --- | --- | --- | --- | --- | --- | --- | --- |",
  ...Array.from(
    { length: 6 },
    (_, i) =>
      `| api-server-prod-7466b8b584-${i} | workspace-dashboard-prod | 2/2 | Running | 0 | 13h9m | worker-services-c931c.cluster.example.net | 192.0.2.${i + 10} |`,
  ),
].join("\n");

for (const theme of ["light", "dark"] as const) {
  test(`adapts table width and density while preserving the reading column in ${theme}`, async ({ page }, info) => {
    await page.setViewportSize({ width: 2200, height: 1000 });
    const reply = await openReply(
      page,
      "Summary:\n\n| Metric | Before | After |\n| --- | --- | --- |\n| CPU | 3 cores | 0.1 cores |",
      undefined,
      theme,
    );
    await page.evaluate(async (id) => {
      const path = "/src/features/agents/store.ts";
      const store = await import(path);
      store.openTaskInEditorLocation(id);
    }, TASK.id);
    await expect
      .poll(() => reply.getByRole("region", { name: "Table" }).evaluate((frame) => frame.clientWidth))
      .toBeGreaterThan(1000);
    const simpleSize = px(await css(reply, "table", "font-size"));
    await page.evaluate(
      async ({ id, text }) => {
        const path = "/src/features/agents/store.ts";
        const store = await import(path);
        const entries = store.useAgents.getState().entries.get(id)!;
        store.useAgents.setState({ entries: new Map([[id, [entries[0], { type: "agent", text }]]]) });
      },
      { id: TASK.id, text: POD_REPLY },
    );
    await expect(reply.locator("th")).toHaveCount(8);
    const geometry = await reply.evaluate((root) => {
      const px = (value: string) => Number.parseFloat(value);
      const row = root.closest("[class*='_conversationRow_']")!;
      const stream = row.parentElement!;
      const pad = getComputedStyle(stream);
      const table = root.querySelector("table")!;
      const card = table.parentElement!.parentElement!;
      const prose = root.querySelector("p")!;
      const pr = prose.getBoundingClientRect();
      return {
        table: card.getBoundingClientRect().width,
        available: stream.clientWidth - px(pad.paddingLeft) - px(pad.paddingRight),
        tableLeft: card.getBoundingClientRect().left,
        expectedLeft: stream.getBoundingClientRect().left + px(pad.paddingLeft),
        prose: pr.width,
        proseLeft: pr.left,
        authorLeft: row.querySelector("[class*='_agentAuthor_']")!.getBoundingClientRect().left,
        footerLeft: row.querySelector("[class*='_messageFooter_']")!.getBoundingClientRect().left,
        font: px(getComputedStyle(table).fontSize),
        bodyFont: px(getComputedStyle(root).fontSize),
        bodyColor: getComputedStyle(root).color,
        tableColor: getComputedStyle(table).color,
      };
    });
    expect(Math.abs(geometry.table - geometry.available)).toBeLessThan(2);
    expect(Math.abs(geometry.tableLeft - geometry.expectedLeft)).toBeLessThan(2);
    expect(geometry.table).toBeGreaterThan(geometry.prose * 1.3);
    expect(Math.abs(geometry.authorLeft - geometry.proseLeft)).toBeLessThan(2);
    expect(Math.abs(geometry.footerLeft - geometry.proseLeft)).toBeLessThan(2);
    expect(geometry.font).toBeLessThan(simpleSize);
    expect(geometry.font).toBeLessThan(geometry.bodyFont);
    expect(geometry.font).toBeGreaterThanOrEqual(12);
    if (theme === "light") {
      expect(geometry.bodyColor).toBe("rgb(51, 51, 51)");
      expect(geometry.tableColor).not.toBe(geometry.bodyColor);
    }
    await expect(reply.locator("strong")).toHaveCSS("font-weight", "600");
    await page.screenshot({ path: info.outputPath(`adaptive-tables-${theme}.png`), animations: "disabled" });
    await page.setViewportSize({ width: 900, height: 1000 });
    await expect.poll(async () => px(await css(reply, "table", "font-size"))).toBeLessThan(geometry.font);
    const narrow = await reply.evaluate((root) => {
      const frame = root.querySelector("table")!.parentElement!;
      return {
        visible: frame.clientWidth,
        content: frame.scrollWidth,
        page: document.documentElement.clientWidth,
        pageContent: document.documentElement.scrollWidth,
        font: Number.parseFloat(getComputedStyle(root.querySelector("table")!).fontSize),
      };
    });
    expect(narrow.content).toBeGreaterThan(narrow.visible);
    expect(narrow.pageContent).toBeLessThanOrEqual(narrow.page);
    expect(narrow.font).toBeGreaterThanOrEqual(12);
    await expect(reply.getByRole("button", { name: "Copy Table" })).toBeVisible();
  });
}

test("expands tables while keeping prose and code in the reading column", async ({ page }, info) => {
  await page.setViewportSize({ width: 1500, height: 1000 });
  const reply = await openReply(page, SQL_REPLY, undefined, "light");
  await page.evaluate(async (id) => {
    const path = "/src/features/agents/store.ts";
    const store = await import(path);
    store.openTaskInEditorLocation(id);
  }, TASK.id);
  await reply.screenshot({ path: info.outputPath("markdown-cards.png") });
  const sizes = await reply.evaluate((root) => ({
    column: root.closest("[class*='_agentMessage_']")!.getBoundingClientRect().width,
    table: root.querySelector("table")!.getBoundingClientRect().width,
    code: root.querySelector("pre")!.getBoundingClientRect().width,
    prose: root.querySelector("p")!.getBoundingClientRect().width,
  }));
  expect(Math.abs(sizes.column - sizes.table)).toBeLessThan(3);
  expect(Math.abs(sizes.prose - sizes.code)).toBeLessThan(3);
  expect(sizes.table).toBeGreaterThan(sizes.prose + 50);
});

test("preserves a raw image's requested size when a table expands the reply", async ({ page }) => {
  await page.setViewportSize({ width: 2200, height: 1000 });
  const reply = await openReply(
    page,
    `Summary:\n\n<img src="${PIXEL}" width="40" height="40">\n\n| A | B |\n| --- | --- |\n| one | two |`,
  );
  await page.evaluate(async (id) => {
    const path = "/src/features/agents/store.ts";
    const store = await import(path);
    store.openTaskInEditorLocation(id);
  }, TASK.id);
  await expect(reply.locator("img")).toHaveCSS("width", "40px");
});

for (const theme of ["light", "dark"] as const) {
  test(`aligns chat typography and highlights sent SQL in ${theme}`, async ({ page, context }, info) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.setViewportSize({ width: 1500, height: 1000 });
    const reply = await openReply(page, SQL_REPLY, undefined, theme);
    const sql =
      "-- 确认当前没有长事务\nSELECT pid, state FROM pg_stat_activity\nWHERE state != 'idle'\nORDER BY pid DESC;";
    await page.evaluate(
      async ({ id, sql }) => {
        const path = "/src/features/agents/store.ts";
        const store = await import(path);
        const entries = store.useAgents.getState().entries.get(id)!;
        store.useAgents.setState({
          entries: new Map([[id, [{ ...entries[0], text: sql }, ...entries.slice(1)]]]),
        });
        store.openTaskInEditorLocation(id);
      },
      { id: TASK.id, sql },
    );
    const user = page.locator("[class*='_user_']").first();
    await expect(user.locator(".tok-keyword").first()).toBeVisible();
    await expect(user.locator("code")).toHaveText(sql);
    const input = page.getByPlaceholder("Reply to the agent", { exact: true });
    await input.fill("确认当前没有长事务");
    const sizes = await page.evaluate(() => {
      const style = (selector: string) => getComputedStyle(document.querySelector(selector)!);
      const body = document.querySelector("[class*='_agentCard_']")!;
      const column = body.querySelector("p")!.getBoundingClientRect();
      const panel = body.closest("[class*='_conversation_']")!.getBoundingClientRect();
      return {
        body: getComputedStyle(body).fontSize,
        user: style("[class*='_user_']").fontSize,
        userCode: style("[class*='_user_'] code").fontSize,
        input: style("[class*='_textarea_']").fontSize,
        mirror: style("[class*='_mirror_']").fontSize,
        left: column.left - panel.left,
        right: panel.right - column.right,
        panel: panel.width,
      };
    });
    expect(sizes.input).toBe(sizes.body);
    expect(sizes.mirror).toBe(sizes.body);
    expect(sizes.user).toBe(sizes.body);
    expect(sizes.userCode).toBe(sizes.body);
    expect(sizes.left).toBeGreaterThan(sizes.panel * 0.075);
    expect(Math.abs(sizes.left - sizes.right)).toBeLessThan(2);
    const colours = await user
      .locator("code")
      .evaluate((code) =>
        [".tok-keyword", ".tok-string", ".tok-comment"].map(
          (selector) => getComputedStyle(code.querySelector(selector)!).color,
        ),
      );
    expect(new Set(colours).size).toBe(3);
    await expect(reply.locator("pre .tok-keyword").first()).toHaveCSS("color", colours[0]!);
    await user.hover();
    await user.locator("..").getByRole("button", { name: "Copy", exact: true }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(sql);
    await page.screenshot({ path: info.outputPath(`chat-typography-${theme}.png`), animations: "disabled" });
    await user.hover();
    await page.getByRole("button", { name: "Edit & Rerun", exact: true }).click();
    const editor = page.locator("[class*='_editMessage_']");
    await expect(editor).toHaveValue(sql);
    await expect(editor).toHaveCSS("font-size", sizes.body);
  });
}

for (const theme of ["light", "dark"] as const) {
  for (const width of [760, 1500]) {
    test(`fills a short table in ${theme} at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      const reply = await openReply(
        page,
        "Summary:\n\n| Metric | Before | After |\n| --- | --- | --- |\n| CPU | 3 cores | 0.1 cores |\n| Memory | 7 GiB | 1 GiB |",
        undefined,
        theme,
      );
      const geometry = await reply.evaluate((root) => {
        const frame = root.querySelector("table")!.parentElement!;
        return {
          column: root.closest("[class*='_agentMessage_']")!.getBoundingClientRect().width,
          frame: frame.parentElement!.getBoundingClientRect().width,
          row: root.querySelector("tr")!.getBoundingClientRect().width,
          visible: frame.clientWidth,
          page: document.documentElement.clientWidth,
          content: document.documentElement.scrollWidth,
        };
      });
      expect(Math.abs(geometry.column - geometry.frame)).toBeLessThan(1);
      expect(geometry.row).toBeGreaterThanOrEqual(geometry.visible - 1);
      expect(geometry.content).toBeLessThanOrEqual(geometry.page);
    });
  }
}

test("reveals compact SQL controls on hover and keyboard focus, wraps and copies the source", async ({
  page,
  context,
}, info) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.setViewportSize({ width: 900, height: 1000 });
  const code = `SELECT user_id, field_name, field_value, last_modified FROM filter_push_user_registration WHERE field_name = '${"registration_".repeat(18)}';`;
  const reply = await openReply(page, `SQL:\n\n\`\`\`sql\n${code}\n\`\`\``);
  await page.mouse.move(0, 0);
  const copy = reply.getByRole("button", { name: "Copy Code", exact: true });
  const wrap = reply.getByRole("button", { name: "Use Soft Wraps" });
  const toolbar = reply.locator("[class*='_codeToolbar_']");
  await expect(toolbar).toHaveCSS("opacity", "0");
  await expect(toolbar).toHaveCSS("height", "0px");
  await expect(copy).toHaveText("");
  await reply.locator("pre").hover();
  await expect(toolbar).toHaveCSS("opacity", "1");
  await expect(copy).toBeVisible();
  await expect(wrap).toHaveAttribute("aria-pressed", "false");
  await expect(reply.locator("code .tok-keyword").first()).toBeVisible();
  const pre = reply.locator("pre");
  const before = await pre.evaluate((el) => ({
    width: el.clientWidth,
    content: el.scrollWidth,
    height: el.clientHeight,
  }));
  expect(before.content).toBeGreaterThan(before.width);
  await wrap.click();
  await expect(wrap).toHaveAttribute("aria-pressed", "true");
  const after = await pre.evaluate((el) => ({
    width: el.clientWidth,
    content: el.scrollWidth,
    height: el.clientHeight,
  }));
  expect(after.content).toBeLessThanOrEqual(after.width);
  expect(after.height).toBeGreaterThan(before.height);
  await wrap.focus();
  await page.keyboard.press("Tab");
  await expect(copy).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(reply.getByRole("button", { name: "Copied", exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(code);
  await reply.screenshot({ path: info.outputPath("code-wrapped-copied.png") });
  await wrap.click();
  await expect(wrap).toHaveAttribute("aria-pressed", "false");
  expect(await pre.evaluate((el) => el.scrollWidth)).toBeGreaterThan(before.width);
});

test("styles tables so a reply reads as a table", async ({ page }) => {
  const reply = await openReply(page, REPLY);
  expect(await css(reply, "table", "display")).toBe("table");
  expect(await css(reply, "td", "padding-left")).toBe("12px");
  expect(await css(reply, "th", "border-bottom-width")).toBe("0px");
  expect(await css(reply, "th", "font-weight")).toBe("400");
  const frame = reply.getByRole("region", { name: "Table" });
  await expect(frame.locator("..")).toHaveCSS("border-top-width", "1px");
  expect(px(await frame.evaluate((el) => getComputedStyle(el).borderRadius))).toBeGreaterThan(0);
  // A narrow chat must not squeeze a column to a few letters.
  const widths = await reply
    .locator("td")
    .evaluateAll((cells) => cells.map((cell) => cell.getBoundingClientRect().width));
  for (const width of widths) expect(width).toBeGreaterThanOrEqual(70);
});

test("copies a whole table while its copy button stays visible after horizontal scrolling", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.setViewportSize({ width: 760, height: 1000 });
  const reply = await openReply(page, REPLY);
  const frame = reply.getByRole("region", { name: "Table" });
  await frame.evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
  });
  const copy = reply.getByRole("button", { name: "Copy Table" });
  await expect(copy).toBeVisible();
  await copy.click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "Path\tOwner\tStatus\tNotes\nsrc/features/agents/conversation/very/long/path/file.tsx\tsomeone\tmodified\ta fairly long note",
  );
});

test("scrolls a wide table inside the reply", async ({ page }) => {
  const reply = await openReply(page, REPLY);
  const sizes = await reply.evaluate((el) => {
    const table = el.querySelector("table")!;
    return { reply: el.clientWidth, frame: table.parentElement!.clientWidth, table: table.clientWidth };
  });
  expect(sizes.frame).toBeLessThanOrEqual(sizes.reply);
  expect(sizes.table).toBeGreaterThan(sizes.frame);
});

test("sizes headings for a chat and keeps small ones readable", async ({ page }) => {
  const reply = await openReply(page, REPLY);
  const body = px(await reply.evaluate((root) => getComputedStyle(root).fontSize));
  const h1 = px(await css(reply, "h1", "font-size"));
  expect(h1).toBeGreaterThan(body);
  expect(h1).toBeLessThanOrEqual(body * 1.2);
  expect(px(await css(reply, "h2", "font-size"))).toBeLessThan(h1);
  expect(px(await css(reply, "h5", "font-size"))).toBe(body);
});

test("starts and ends a reply without stray margins", async ({ page }) => {
  const reply = await openReply(page, REPLY);
  expect(await css(reply, "> :first-child", "margin-top")).toBe("0px");
  expect(await css(reply, "> :last-child", "margin-bottom")).toBe("0px");
});

test("styles quotes, rules, images and task lists", async ({ page }) => {
  const reply = await openReply(page, REPLY);
  expect(await css(reply, "blockquote", "margin-left")).toBe("0px");
  expect(await css(reply, "blockquote", "border-left-width")).toBe("3px");
  expect(await css(reply, "hr", "border-left-width")).toBe("0px");
  expect(await css(reply, "hr", "border-top-width")).toBe("1px");
  expect(await css(reply, "img", "max-width")).toBe("100%");
  // A checkbox stands in for the bullet.
  expect(await css(reply, "li:has(> input)", "list-style-type")).toBe("none");
});

test("loads local reply images, and web ones when asked", async ({ page }) => {
  let fetched = 0;
  await page.route("https://images.example.com/code.gif", (route) => {
    fetched++;
    return route.fulfill({ contentType: "image/gif", body: Buffer.from(PIXEL.split(",")[1]!, "base64") });
  });
  const reply = await openReply(
    page,
    "![Local QR](/tmp/code.png)\n\n![Web QR](https://images.example.com/code.gif)",
    PIXEL,
  );
  const width = (name: string) =>
    reply.getByRole("img", { name, includeHidden: true }).evaluate((img: HTMLImageElement) => img.naturalWidth);
  await expect.poll(() => width("Local QR")).toBe(1);
  const load = reply.getByRole("button", { name: "Load image from images.example.com" });
  await expect(load).toBeVisible();
  expect(fetched).toBe(0);
  await load.click();
  await expect.poll(() => width("Web QR")).toBe(1);
  expect(fetched).toBe(1);
});

test("copies reply Markdown with the keyboard and keeps code copying separate", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const reply = await openReply(page, REPLY);
  const copy = page.getByRole("button", { name: "Copy Markdown", exact: true });
  const actions = copy.locator("..");
  await page.mouse.move(0, 0);
  await expect(actions).toHaveCSS("opacity", "1");
  await copy.focus();
  await expect(actions).toHaveCSS("opacity", "1");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Copied", exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(REPLY);
  await reply.getByRole("button", { name: "Copy Code", exact: true }).focus();
  await page.keyboard.press("Enter");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("const a = 1;");
});

test("keeps latest reply actions visible and quotes into the draft without shifting content", async ({ page }) => {
  const reply = await openReply(page, REPLY);
  const copy = page.getByRole("button", { name: "Copy Markdown", exact: true });
  const actions = copy.locator("..");
  await page.mouse.move(0, 0);
  await expect(actions).toHaveCSS("opacity", "1");
  const before = await reply.boundingBox();
  await reply.hover();
  await expect(actions).toHaveCSS("opacity", "1");
  expect(await reply.boundingBox()).toEqual(before);
  await expect(actions.getByRole("button")).toHaveCount(4);
  await page.mouse.move(0, 0);
  await expect(actions).toHaveCSS("opacity", "1");
  const userCopy = page.getByRole("button", { name: "Copy", exact: true });
  await expect(userCopy.locator("..")).toHaveCSS("opacity", "0");
  await page.getByText("Show Markdown", { exact: true }).hover();
  await expect(userCopy.locator("..")).toHaveCSS("opacity", "1");
  await reply.hover();
  await page.getByRole("button", { name: "Quote Reply", exact: true }).click();
  const draft = page.getByRole("textbox", { name: "Message", exact: true });
  await expect(draft).toBeFocused();
  await expect(draft).toHaveValue(
    REPLY.trimEnd()
      .split("\n")
      .map((line) => (line ? `> ${line}` : ">"))
      .join("\n") + "\n\n",
  );
});

test("quotes a selection from its context menu, leaving Ctrl+C to copy", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const reply = await openReply(page, "Selectable answer");
  const text = reply.locator("p").first();
  const box = (await text.boundingBox())!;
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2);
  await page.mouse.up();
  await expect(page.getByRole("button", { name: "Quote", exact: true })).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+c");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("Selectable answer");
  await text.click({ button: "right", position: { x: 10, y: box.height / 2 } });
  const quote = page.getByRole("menuitem", { name: "Quote", exact: true });
  await expect(quote).toBeVisible();
  await quote.click();
  await expect(quote).toHaveCount(0);
  const draft = page.getByRole("textbox", { name: "Message", exact: true });
  await expect(draft).toBeFocused();
  await expect(draft).toHaveValue("> Selectable answer\n\n");
});

test("dismisses the selection quote menu on a click elsewhere", async ({ page }) => {
  const reply = await openReply(page, "Selectable answer");
  const box = (await reply.locator("p").first().boundingBox())!;
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2);
  await page.mouse.up();
  await reply
    .locator("p")
    .first()
    .click({ button: "right", position: { x: 10, y: box.height / 2 } });
  const quote = page.getByRole("menuitem", { name: "Quote", exact: true });
  await expect(quote).toBeVisible();
  const draft = page.getByRole("textbox", { name: "Message", exact: true });
  await draft.click();
  await expect(quote).toHaveCount(0);
  await expect(draft).toHaveValue("");
});

test("keeps chat history readable and selections free of timestamps and status labels", async ({ page, context }) => {
  await page.setViewportSize({ width: 1800, height: 1000 });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openReply(page, "Hi! What would you like to work on?");
  await page.evaluate(async (task) => {
    const path = "/src/features/agents/store.ts";
    const store = await import(path);
    const user = (text: string) => ({ type: "user", text, attachments: [], sentMs: 1, doneMs: 5001, steered: false });
    store.useAgents.setState({
      entries: new Map([
        [
          task.id,
          [
            user("hi"),
            { type: "agent", text: "Hi! What would you like to work on?" },
            user("im bob"),
            { type: "agent", text: "Hi Bob! What are we working on today?" },
            user("yes"),
            { type: "thought", text: "**Requesting task context**" },
            { type: "agent", text: "What would you like me to proceed with?" },
          ],
        ],
      ]),
    });
    store.openTaskInEditorLocation(task.id);
  }, TASK);
  const stream = page.locator("[class*='_stream_']:visible");
  const replies = stream.locator("[class*='_reply_']");
  await expect(replies).toHaveCount(3);
  const geometry = await stream.evaluate((root) => {
    const reply = root.querySelector<HTMLElement>("[class*='_reply_']")!;
    const bubble = root.querySelector<HTMLElement>("[class*='_user_']")!;
    const composer = root
      .closest("[class*='_conversation_']")!
      .querySelector<HTMLElement>("[class*='_composerArea_']")!;
    const rr = reply.getBoundingClientRect();
    const br = bubble.getBoundingClientRect();
    const cr = composer.getBoundingClientRect();
    return {
      reply: rr.width,
      root: root.clientWidth,
      bubbleLeft: br.left,
      replyLeft: rr.left,
      bubbleRight: br.right,
      replyRight: rr.right,
      columnCenter: (() => {
        const column = reply.closest("[class*='_agentMessage_']")!.getBoundingClientRect();
        return (column.left + column.right) / 2;
      })(),
      composerCenter: (cr.left + cr.right) / 2,
    };
  });
  expect(geometry.reply).toBeGreaterThan(0);
  expect(geometry.reply).toBeLessThan(geometry.root);
  expect(geometry.bubbleLeft).toBeGreaterThan(geometry.replyLeft);
  expect(geometry.bubbleRight).toBeGreaterThan(geometry.replyRight);
  expect(Math.abs(geometry.columnCenter - geometry.composerCenter)).toBeLessThan(1);
  await stream.getByText("hi", { exact: true }).hover();
  await expect(stream.locator("[class*='_messageTime_']").first()).toBeVisible();
  const selected = await stream.evaluate((root) => {
    const range = document.createRange();
    range.selectNodeContents(root);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    return selection.toString();
  });
  expect(selected).toContain("hi");
  expect(selected).toContain("Hi Bob!");
  expect(selected).toContain("What would you like me to proceed with?");
  expect(selected).not.toMatch(/AM|PM|5s|Reasoning|Requesting task context/);
  await page.keyboard.press("ControlOrMeta+c");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(selected);
  // The finished turn's reasoning is folded with its work.
  await stream.locator("[class*='_turnFold_'] > summary").click();
  await stream.locator("[class*='_thought_'] > summary").click();
  await expect(
    stream.locator("[class*='_thoughtBody_']").getByText("Requesting task context", { exact: true }),
  ).toBeVisible();
  await expect(stream.locator("[class*='_thoughtBody_'] strong")).toHaveText("Requesting task context");
  await page.evaluate(async (id) => {
    const path = "/src/features/agents/store.ts";
    const store = await import(path);
    store.dockTask(id);
  }, TASK.id);
  await expect(stream).toBeVisible();
  const narrow = await stream.evaluate((root) => ({
    width: root.clientWidth,
    content: root.scrollWidth,
    reply: root.querySelector<HTMLElement>("[class*='_reply_']")!.getBoundingClientRect().width,
    padding:
      Number.parseFloat(getComputedStyle(root).paddingLeft) + Number.parseFloat(getComputedStyle(root).paddingRight),
  }));
  expect(narrow.width).toBeGreaterThan(0);
  expect(narrow.content).toBeLessThanOrEqual(narrow.width);
  expect(narrow.reply).toBeLessThanOrEqual((narrow.width - narrow.padding) * 0.96);
});

test("keeps hover actions reachable when the pointer leaves the message body", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const reply = await openReply(page, "A short answer.");
  const copy = page.getByRole("button", { name: "Copy Markdown", exact: true });
  await reply.hover();
  const box = await copy.boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2, { steps: 20 });
  await expect(copy.locator("..")).toHaveCSS("opacity", "1");
  await copy.click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("A short answer.");
});

test("selects through code blocks and tables while keeping copy controls outside the code", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const tree = "rust/\n├── Cargo.toml\n└── src/\n    └── main.rs";
  const flow = "内置文本 SAMPLE\n    ↓ parser::parse\nVec<Item>\n    ↓ Inventory::add\n终端输出";
  const text = `项目结构：\n\n\`\`\`text\n${tree}\n\`\`\`\n\n| 模块 | 职责 |\n| --- | --- |\n| main.rs | 程序入口 |\n\n数据流是：\n\n\`\`\`text\n${flow}\n\`\`\``;
  const reply = await openReply(page, text);
  await expect(reply.getByRole("button", { name: "Copy Code", exact: true })).toHaveCount(2);
  const selected = await reply.evaluate((root) => {
    const codes = [...root.querySelectorAll("pre > code")];
    if (codes.some((code) => code.parentElement!.querySelector("button"))) throw new Error("Control in code selection");
    const start = root.querySelector("p")!.firstChild!;
    const end = codes.at(-1)!.lastChild!;
    window.getSelection()!.setBaseAndExtent(start, 0, end, end.textContent!.length);
    return window.getSelection()!.toString();
  });
  expect(selected).toContain(tree);
  expect(selected).toContain("程序入口");
  expect(selected).toContain(flow);
  await page.keyboard.press("ControlOrMeta+c");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(selected);
  await page.evaluate(() => window.getSelection()!.removeAllRanges());
  const copies = reply.getByRole("button", { name: "Copy Code", exact: true });
  await copies.first().focus();
  await page.keyboard.press("Enter");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(tree);
  await copies.last().focus();
  await page.keyboard.press("Enter");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(flow);
});

test("keeps mermaid `<style>` rules scoped to the rendered svg after id rewriting", async ({ page }) => {
  const diagram = [
    "```mermaid",
    "%%{init: {'theme': 'base', 'flowchart': {'htmlLabels': false, 'curve': 'basis'}}}%%",
    "flowchart TB",
    '    subgraph T1["Tier 1"]',
    "        A[(Local)] <--> B[(Peer)]",
    "    end",
    '    subgraph T2["Tier 2"]',
    "        C[(Host RAM)]",
    "    end",
    '    C -->|"PCIe"| A',
    "```",
  ].join("\n");
  const reply = await openReply(page, `Diagram:\n\n${diagram}`);
  await expect(reply.locator("[data-mermaid-state='ok'] .mermaid-output svg")).toBeVisible();
  expect(await css(reply, ".cluster rect", "fill")).not.toBe("rgb(0, 0, 0)");
  expect(await css(reply, ".flowchart-link", "fill")).toBe("none");
});

test("renders KaTeX math in mermaid labels", async ({ page }) => {
  const diagram = ["```mermaid", "flowchart LR", '  A["$$x^2 + \\frac{a}{b}$$"] --> B', "```"].join("\n");
  const reply = await openReply(page, `Diagram:\n\n${diagram}`);
  const svg = reply.locator("[data-mermaid-state='ok'] .mermaid-output svg");
  await expect(svg).toBeVisible();
  await expect(svg.locator("math mfrac")).toHaveCount(1);
});

test("keeps mermaid flowchart nodes and sequence control blocks off solid black", async ({ page }) => {
  const flow = [
    "```mermaid",
    "flowchart LR",
    '  subgraph Client["Client"]',
    '    A["Local agent"]',
    '    B["Voice input"]',
    "  end",
    '  subgraph Cloud["Cloud"]',
    '    C["Cloud agent"]',
    '    D["Memory service"]',
    "  end",
    "  B --> A",
    "  A --> C",
    "  C --> D",
    "```",
  ].join("\n");
  const sequence = ["```mermaid", "sequenceDiagram", "  loop every minute", "    A->>B: ping", "  end", "```"].join(
    "\n",
  );
  const reply = await openReply(page, `Flow:\n\n${flow}\n\nSequence:\n\n${sequence}`);
  await expect(reply.locator("[data-mermaid-state='ok'] .mermaid-output svg")).toHaveCount(2);
  expect(await css(reply, ".node rect", "fill")).not.toBe("rgb(0, 0, 0)");
  expect(await css(reply, ".cluster rect", "fill")).not.toBe("rgb(0, 0, 0)");
  expect(await css(reply, ".labelBox", "fill")).not.toBe("rgb(0, 0, 0)");
});

const DIAGRAMS = [
  "flowchart LR\n  subgraph Client\n    A[Local agent] --> B[Voice input]\n  end",
  "sequenceDiagram\n  loop every minute\n    A->>B: ping\n  end",
  "classDiagram\n  class Agent {\n    +String name\n    +run()\n  }",
  "stateDiagram-v2\n  [*] --> Ready\n  Ready --> Running\n  Running --> [*]",
  'pie title Work\n  "Ready" : 40\n  "Running" : 35\n  "Done" : 25',
  "gantt\n  dateFormat YYYY-MM-DD\n  section Delivery\n  Shipped :done, shipped, 2026-01-01, 5d\n  Building :active, building, after shipped, 5d\n  Next :next, after building, 5d\n  Critical :crit, critical, after next, 5d",
]
  .map((source) => `\`\`\`mermaid\n${source}\n\`\`\``)
  .join("\n\n");

for (const theme of ["dark", "light"] as const) {
  test(`keeps Mermaid shapes, labels and chart series readable in ${theme} theme`, async ({ page }) => {
    const reply = await openReply(page, `Diagrams:\n\n${DIAGRAMS}`, undefined, theme);
    const svgs = reply.locator("[data-mermaid-state='ok'] .mermaid-output svg");
    await expect(svgs).toHaveCount(6);
    for (const [index, selector] of [
      [0, ".node rect"],
      [1, ".labelBox"],
      [2, ".outer-path path"],
      [3, ".node rect"],
    ] as const) {
      expect(await css(svgs.nth(index), selector, "fill")).not.toBe("rgb(0, 0, 0)");
      expect(await css(svgs.nth(index), selector, "stroke")).not.toContain("url(");
    }
    expect(await css(svgs.nth(2), ".nodeLabel", "color")).not.toBe(await css(svgs.nth(2), ".outer-path path", "fill"));
    const slices = await svgs
      .nth(4)
      .locator(".pieCircle")
      .evaluateAll((els) => els.map((el) => getComputedStyle(el).fill));
    expect(new Set(slices).size).toBe(3);
    expect(slices).not.toContain("rgb(0, 0, 0)");
    const contrasts = await svgs
      .nth(5)
      .locator("text.taskText")
      .evaluateAll((els) => {
        const luminance = (color: string) => {
          const [r, g, b] = color
            .match(/\d+/g)!
            .map(Number)
            .map((v) => {
              const c = v / 255;
              return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
            });
          return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
        };
        return els.map((el) => {
          const bar = document.getElementById(el.id.replace(/-text$/, ""))!;
          const fg = luminance(getComputedStyle(el).fill);
          const bg = luminance(getComputedStyle(bar).fill);
          return { text: el.textContent, ratio: (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05) };
        });
      });
    expect(contrasts).toHaveLength(4);
    for (const { text, ratio } of contrasts) expect(ratio, `${theme}: ${text}`).toBeGreaterThanOrEqual(4.5);
  });
}

test("edits an earlier Copilot message with a visible restart confirmation", async ({ page }, info) => {
  await openReply(page, "Earlier answer");
  await page.evaluate(async (id) => {
    const storePath = "/src/features/agents/store.ts";
    const routePath = "/src/platform/tauriCore.ts";
    const store = await import(storePath);
    const { setInvokeRoute } = await import(routePath);
    const task = store.useAgents.getState().tasks.get(id)!;
    const before = store.useAgents.getState().entries.get(id)!;
    store.useAgents.setState({
      tasks: new Map([[id, { ...task, provider: "copilot", capabilities: { ...task.capabilities, rollback: false } }]]),
      entries: new Map([
        [
          id,
          [
            ...before,
            { type: "user", text: "Original follow up", attachments: [], steered: false },
            { type: "agent", text: "Reply to replace" },
          ],
        ],
      ]),
    });
    setInvokeRoute((cmd, args) => {
      if (cmd === "agent_rollback") {
        if ((args as { turns: number }).turns !== 1) return Promise.reject(new Error("Wrong turn"));
        store.useAgents.setState({ entries: new Map([[id, before]]) });
        return Promise.resolve(null);
      }
      if (cmd === "agent_prompt") {
        const text = (args as { prompt: { text: string } }).prompt.text;
        store.useAgents.setState({
          entries: new Map([
            [
              id,
              [
                ...before,
                { type: "user", text, attachments: [], steered: false },
                { type: "agent", text: "Regenerated answer" },
              ],
            ],
          ]),
        });
        return Promise.resolve(null);
      }
      return null;
    });
  }, TASK.id);
  await page.getByRole("group", { name: "You", exact: true }).nth(1).hover();
  await page.getByRole("button", { name: "Edit & Rerun", exact: true }).nth(1).click();
  const edit = page.getByRole("textbox", { name: "Message", exact: true }).first();
  await expect(edit).toHaveValue("Original follow up");
  await edit.fill("Updated follow up");
  await page.getByRole("button", { name: "Send", exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "Restart With Earlier Messages" });
  await expect(dialog).toContainText("This agent cannot rewind.");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(edit).toHaveValue("Updated follow up");
  await page.getByRole("button", { name: "Send", exact: true }).first().click();
  await page
    .getByRole("dialog", { name: "Restart With Earlier Messages" })
    .getByRole("button", { name: "Edit & Rerun", exact: true })
    .click();
  await expect(page.getByText("Regenerated answer", { exact: true })).toBeVisible();
  await expect(page.getByText("Original follow up", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Reply to replace", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Earlier answer", { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("copilot-edited.png") });
});

test("draws a diagram without reaching the hosts its configuration names", async ({ page }) => {
  const asked: string[] = [];
  await page.route(/^https:\/\/([a-z\d-]+\.)*example\.com\//, (route) => {
    asked.push(new URL(route.request().url()).pathname);
    return route.fulfill({ contentType: "image/gif", body: Buffer.from(PIXEL.split(",")[1]!, "base64") });
  });
  const at = (name: string) => `https://images.example.com/${name}`;
  const fence = (...lines: string[]) => ["```mermaid", ...lines, "```"].join("\n");
  const diagrams = [
    fence(
      `%%{init: {"themeCSS": ".nodeLabel{background-image:url(${at("theme-css")})} svg{background-image:url(${at("theme-css-root")})}"}}%%`,
      "flowchart TD",
      "    A[One]-->B[Two]",
    ),
    fence(
      `%%{init: {"fontFamily": "x;background-image:url(${at("font-family")})"}}%%`,
      "flowchart TD",
      "    A[One]-->B[Two]",
    ),
    fence(
      "---",
      "config:",
      `  themeCSS: ".nodeLabel{background-image:url(${at("front-matter")})}"`,
      "---",
      "flowchart TD",
      "    A[One]-->B[Two]",
    ),
  ];
  const reply = await openReply(page, `Diagrams:\n\n${diagrams.join("\n\n")}`);
  await expect(reply.locator("[data-mermaid-state='ok'] .mermaid-output svg")).toHaveCount(diagrams.length);
  await page.evaluate(
    (src) =>
      new Promise<void>((done) => {
        const img = new Image();
        img.onload = img.onerror = () => done();
        img.src = src;
      }),
    "https://example.com/after",
  );
  expect(asked).toEqual(["/after"]);
});
