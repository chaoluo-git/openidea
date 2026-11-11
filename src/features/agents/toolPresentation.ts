/** Presentation of provider activity; original output and paths remain on the entry. */
import { Chunk } from "@codemirror/merge";
import { Text } from "@codemirror/state";
import type { AgentEntry } from "@/bindings";
import { basename } from "@/platform/project";

type Tool = Extract<AgentEntry, { type: "tool" }>;

export function activityTitle(entry: Tool, cwd: string): string {
  let title = entry.title || entry.kind;
  const paths = [...new Set([...entry.diffs.map((d) => d.path), ...entry.locations])].sort(
    (a, b) => b.length - a.length,
  );
  for (const path of paths) title = title.replaceAll(path, basename(path));
  return title.replaceAll(`${cwd}/`, "");
}

/** Copilot's transport footer is shown as a status, rather than as command output. */
export function commandOutput(output: string): { text: string; exit: number | null; shell: string | null } {
  const footer = /(?:^|\r?\n)<shellId: ([^\r\n<>]+) completed with exit code (-?\d+)>\s*$/.exec(output);
  if (!footer) return { text: output, exit: null, shell: null };
  return { text: output.slice(0, footer.index), exit: Number(footer[2]), shell: footer[1]! };
}

/** Only a standalone acknowledgement of this exact tool's file is redundant. */
export function isFileAcknowledgement(entry: AgentEntry, previous: AgentEntry | undefined): boolean {
  if (entry.type !== "agent" || previous?.type !== "tool" || previous.status !== "completed") return false;
  const match = /^Info:\s+([^\r\n]+)\s*$/.exec(entry.text.trim());
  if (!match) return false;
  return previous.diffs.some((d) => match[1] === d.path);
}

export interface DiffLine {
  kind: "context" | "added" | "removed" | "gap";
  before: number | null;
  after: number | null;
  text: string;
}

/** ACP v2 supplies hunks rather than whole files: keep the patch's actual line numbers. */
export function patchPreview(text: string): { lines: DiffLine[]; truncated: boolean } {
  const lines: DiffLine[] = [];
  let before = 0,
    after = 0,
    inHunk = false;
  for (const line of text.split("\n")) {
    const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (header) {
      before = Number(header[1]);
      after = Number(header[2]);
      inHunk = true;
      if (lines.length) lines.push({ kind: "gap", before: null, after: null, text: "…" });
    } else if (inHunk && line.startsWith("+")) {
      lines.push({ kind: "added", before: null, after: after++, text: line.slice(1) });
    } else if (inHunk && line.startsWith("-")) {
      lines.push({ kind: "removed", before: before++, after: null, text: line.slice(1) });
    } else if (inHunk && line.startsWith(" ")) {
      lines.push({ kind: "context", before: before++, after: after++, text: line.slice(1) });
    }
    if (lines.length > 160) return { lines: lines.slice(0, 160), truncated: true };
  }
  return { lines, truncated: false };
}

/** Small unified previews with real line numbers and three unchanged lines of context. */
export function diffPreview(before: string, after: string): { lines: DiffLine[]; truncated: boolean } {
  const a = Text.of(before.split("\n"));
  const b = Text.of(after.split("\n"));
  const limitA = a.lines - (before.endsWith("\n") || !before ? 1 : 0);
  const limitB = b.lines - (after.endsWith("\n") || !after ? 1 : 0);
  const lines: DiffLine[] = [];
  const max = 160;
  let lineA = 1,
    lineB = 1,
    truncated = false;
  const add = (line: DiffLine) => {
    if (lines.length < max) lines.push(line);
    else truncated = true;
  };
  const context = (end: number) => {
    const remaining = end - lineB;
    if (remaining > 6) {
      for (let n = 0; n < 3 && lineB < end; n++, lineA++, lineB++)
        add({ kind: "context", before: lineA, after: lineB, text: b.line(lineB).text });
      const skip = end - lineB - 3;
      if (skip > 0) {
        add({ kind: "gap", before: null, after: null, text: "…" });
        lineA += skip;
        lineB += skip;
      }
    }
    for (; lineB < end && lineB <= limitB; lineA++, lineB++)
      add({ kind: "context", before: lineA, after: lineB, text: b.line(lineB).text });
  };
  for (const chunk of Chunk.build(a, b, { scanLimit: 500, timeout: 20 })) {
    const startB = b.lineAt(chunk.fromB).number;
    context(startB);
    const endA = chunk.toA === chunk.fromA ? lineA - 1 : a.lineAt(Math.min(a.length, chunk.toA - 1)).number;
    const endB = chunk.toB === chunk.fromB ? lineB - 1 : b.lineAt(Math.min(b.length, chunk.toB - 1)).number;
    for (; lineA <= endA && lineA <= limitA; lineA++)
      add({ kind: "removed", before: lineA, after: null, text: a.line(lineA).text });
    for (; lineB <= endB && lineB <= limitB; lineB++)
      add({ kind: "added", before: null, after: lineB, text: b.line(lineB).text });
    if (truncated) break;
  }
  context(Math.min(limitB + 1, lineB + 3));
  return { lines, truncated };
}
