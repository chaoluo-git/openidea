import { describe, expect, it } from "vitest";
import {
  fileHref,
  findAll,
  findRanges,
  formatDuration,
  pathLink,
  pathHref,
  quoteText,
  withQuote,
} from "./conversation";

describe("quoting", () => {
  it("quotes each line and leaves a line to type on", () => {
    expect(quoteText("one\n\ntwo\n")).toBe("> one\n>\n> two\n\n");
  });
  it("adds the quote after a draft", () => {
    expect(withQuote("", "x")).toBe("> x\n\n");
    expect(withQuote("Why?  ", "x")).toBe("Why?\n\n> x\n\n");
  });
});

describe("pathLink", () => {
  const cwd = "/repo";
  it("resolves relative paths with a line and column", () => {
    expect(pathLink("src/lib.rs", cwd)).toEqual({ path: "/repo/src/lib.rs" });
    expect(pathLink("./src/main.rs:12", cwd)).toEqual({ path: "/repo/src/main.rs", line: 11 });
    expect(pathLink("a/b.ts:3:5", cwd)).toEqual({ path: "/repo/a/b.ts", line: 2, col: 4 });
    expect(pathLink("Cargo.toml", cwd)).toEqual({ path: "/repo/Cargo.toml" });
    expect(pathLink("reference.txt:12:3", cwd)).toEqual({ path: "/repo/reference.txt", line: 11, col: 2 });
    expect(pathLink("/abs/x.py#L7", cwd)).toEqual({ path: "/abs/x.py", line: 6 });
    expect(pathLink("../docs/说明.md#L7C3-L9", cwd)).toEqual({ path: "/repo/../docs/说明.md", line: 6, col: 2 });
    expect(pathLink("/tmp/My Project/README.md:12:5", cwd)).toEqual({
      path: "/tmp/My Project/README.md",
      line: 11,
      col: 4,
    });
    expect(pathLink(".gitignore", cwd)).toEqual({ path: "/repo/.gitignore" });
    expect(pathLink("Dockerfile", cwd)).toEqual({ path: "/repo/Dockerfile" });
  });
  it("ignores code that isn't a path", () => {
    for (const t of [
      "foo()",
      "cargo test",
      "https://x.dev/a.md",
      "inventory",
      "1.5",
      "v2.0",
      "a.b()",
      "failing-tests",
      "tests/",
    ]) {
      expect(pathLink(t, cwd)).toBeNull();
    }
  });
});

describe("file hrefs", () => {
  it("resolves local file URLs and preserves encoded filenames and positions", () => {
    const link = { path: "/tmp/设计 #1.md", line: 11, col: 4 };
    expect(fileHref("file:///tmp/%E8%AE%BE%E8%AE%A1%20%231.md#L12C5", "/repo")).toEqual(link);
    expect(fileHref(pathHref(link), "/repo")).toEqual(link);
    expect(fileHref("file://localhost/tmp/main.ts:2", "/repo")).toEqual({ path: "/tmp/main.ts", line: 1 });
  });
  it.each([
    "file://remote/tmp/a.ts",
    "file:///tmp/a.ts?x=1",
    "javascript:alert(1)",
    "//remote/a.ts",
    "/tmp/a.ts:0",
    "/tmp/a.ts:99999999999999999999",
    "/tmp/a%00.ts",
    "/tmp/%ZZ.ts",
  ])("rejects unsupported references: %s", (href) => {
    expect(fileHref(href, "/repo")).toBeNull();
  });
});

describe("formatDuration", () => {
  it("scales the unit", () => {
    expect(formatDuration(850)).toBe("850ms");
    expect(formatDuration(12_400)).toBe("12s");
    expect(formatDuration(65_000)).toBe("1m 05s");
    expect(formatDuration(2 * 3600_000 + 3 * 60_000)).toBe("2h 03m 00s");
  });
  it.each([
    [3599_999, "59m 59s"],
    [3600_000, "1h 00m 00s"],
    [3601_000, "1h 00m 01s"],
    [3983_000, "1h 06m 23s"],
  ])("keeps second precision across the hour boundary (%d)", (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected);
  });
});

describe("finding", () => {
  it("finds every occurrence, ignoring case", () => {
    expect(findAll("Abc abc ABC", "abc")).toEqual([0, 4, 8]);
    expect(findAll("aaa", "")).toEqual([]);
  });
  it("maps matches to DOM ranges", () => {
    const root = document.createElement("div");
    root.innerHTML = "<p>one <code>two</code> one</p>";
    expect(findRanges(root, "one").map((r) => r.toString())).toEqual(["one", "one"]);
    expect(findRanges(root, "TWO")).toHaveLength(1);
  });
});
