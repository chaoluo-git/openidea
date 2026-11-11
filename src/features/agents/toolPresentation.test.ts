import { describe, expect, it } from "vitest";
import type { AgentEntry } from "@/bindings";
import { activityTitle, commandOutput, diffPreview, patchPreview, isFileAcknowledgement } from "./toolPresentation";

const path = "/Users/example/.copilot/session-state/long-id/files/p0pom/adddeps.py";
const tool: Extract<AgentEntry, { type: "tool" }> = {
  type: "tool",
  id: "edit",
  title: `Creating ${path}`,
  kind: "edit",
  status: "completed",
  locations: [path],
  output: null,
  diffs: [{ path, added: 4, removed: 0 }],
};

describe("activity presentation", () => {
  it("keeps the action and file name without exposing transport directories in the label", () => {
    expect(activityTitle(tool, "/project")).toBe("Creating adddeps.py");
    expect(
      activityTitle({ ...tool, title: "Run /project/scripts/check.sh", diffs: [], locations: [] }, "/project"),
    ).toBe("Run scripts/check.sh");
    expect(tool.title).toContain(path);
  });
  it("folds only an exact file acknowledgement, preserving explanatory text and failed actions", () => {
    const info: AgentEntry = { type: "agent", text: `Info: ${path}` };
    expect(isFileAcknowledgement(info, tool)).toBe(true);
    expect(isFileAcknowledgement({ type: "agent", text: `Info: ${path}\nPlease review the result.` }, tool)).toBe(
      false,
    );
    expect(isFileAcknowledgement({ type: "agent", text: "Info: /other/file.py" }, tool)).toBe(false);
    expect(isFileAcknowledgement(info, { ...tool, status: "failed" })).toBe(false);
    expect(isFileAcknowledgement(info, undefined)).toBe(false);
  });
  it("separates only a complete trailing shell footer and retains failure status", () => {
    expect(commandOutput("problem\n<shellId: 301 completed with exit code 1>")).toEqual({
      text: "problem",
      shell: "301",
      exit: 1,
    });
    expect(commandOutput("<shellId: 300 completed with exit code 0>")).toEqual({ text: "", shell: "300", exit: 0 });
    const ordinary = "Example: <shellId: 1 completed with exit code 0>\nMore output";
    expect(commandOutput(ordinary)).toEqual({ text: ordinary, shell: null, exit: null });
  });
});

describe("tool diff snapshots", () => {
  it("keeps ACP v2 patch offsets across separate hunks", () => {
    expect(
      patchPreview("@@ -100,2 +100,3 @@\n context\n-old\n+new\n+extra\n@@ -300 +301 @@\n-later\n+changed\n").lines,
    ).toEqual([
      { kind: "context", before: 100, after: 100, text: "context" },
      { kind: "removed", before: 101, after: null, text: "old" },
      { kind: "added", before: null, after: 101, text: "new" },
      { kind: "added", before: null, after: 102, text: "extra" },
      { kind: "gap", before: null, after: null, text: "…" },
      { kind: "removed", before: 300, after: null, text: "later" },
      { kind: "added", before: null, after: 301, text: "changed" },
    ]);
  });
  it("shows newly created and deleted files without a phantom trailing line", () => {
    expect(diffPreview("", "a\nb\n").lines).toEqual([
      { kind: "added", before: null, after: 1, text: "a" },
      { kind: "added", before: null, after: 2, text: "b" },
    ]);
    expect(diffPreview("a\n", "").lines).toEqual([{ kind: "removed", before: 1, after: null, text: "a" }]);
    expect(diffPreview("", "").lines).toEqual([]);
  });
  it("preserves both line numbers across replacements and disjoint changes", () => {
    const before = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join("\n");
    const after = before.replace("line 2\n", "new 2\nextra\n").replace("line 28", "new 28");
    const rows = diffPreview(before, after).lines;
    expect(rows).toContainEqual({ kind: "removed", before: 2, after: null, text: "line 2" });
    expect(rows).toContainEqual({ kind: "added", before: null, after: 3, text: "extra" });
    expect(rows).toContainEqual({ kind: "added", before: null, after: 29, text: "new 28" });
    expect(rows).toContainEqual({ kind: "context", before: 30, after: 31, text: "line 30" });
    expect(rows.some((r) => r.kind === "gap")).toBe(true);
  });
  it("bounds large previews and treats non-ASCII and HTML-looking code as plain text", () => {
    const rows = diffPreview("", "<script>你好🙂</script>\n".repeat(1000));
    expect(rows.truncated).toBe(true);
    expect(rows.lines).toHaveLength(160);
    expect(rows.lines[0]!.text).toBe("<script>你好🙂</script>");
  });
});
