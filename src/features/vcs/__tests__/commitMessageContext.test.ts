import { beforeEach, expect, it } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import type { CommitSelection, FileStatus, LineHunk } from "@/bindings";
import { commitMessageContext } from "../commitMessageContext";
import type { CommitPlan } from "../changes";

const file = (name: string, staged: FileStatus["staged"] = null): FileStatus => ({
  path: `/repo/${name}`,
  relPath: name,
  staged,
  unstaged: "modified",
  renamedFrom: null,
});
const hunks: LineHunk[] = [
  { start: 0, lines: 1, oldStart: 0, oldLines: 1, oldText: "old one\n", kind: "modified" },
  { start: 2, lines: 1, oldStart: 2, oldLines: 1, oldText: "old two\n", kind: "modified" },
];
let reads: string[];
let binary: boolean;
beforeEach(() => {
  reads = [];
  binary = false;
  clearMocks();
  mockIPC((cmd, args) => {
    const a = args as { path: string; rev: string };
    if (cmd === "fs_probe") {
      if (/AGENTS|CONTRIBUTING|copilot-instructions/.test(a.path)) throw new Error("Not found");
      return { size: 50, binary, tooLarge: false };
    }
    if (cmd === "fs_read_text") {
      reads.push(`disk:${a.path}`);
      return "new one\nkeep\nnew two\n";
    }
    if (cmd === "vcs_file_at") {
      reads.push(`${a.rev}:${a.path}`);
      return a.rev === "HEAD" ? "old one\nkeep\nold two\n" : "new one\nkeep\nnew two\n";
    }
    if (cmd === "vcs_diff_hunks") return hunks;
    if (cmd === "vcs_log") return [{ summary: "fix(api): preserve request cancellation" }];
    if (cmd === "vcs_create_patch") return "diff --git a/previous.ts b/previous.ts\n+previous behavior";
    throw new Error(`Unexpected command ${cmd}`);
  });
});
const selection = (stage: string[] = ["/repo/a.ts"]): CommitSelection => ({
  revision: 3,
  message: "",
  amend: false,
  repositories: [
    {
      root: "/repo",
      options: {
        amend: false,
        signOff: false,
        author: null,
        runHooks: true,
        stage,
        exclude: ["/repo/excluded.ts"],
        partial: [],
      },
    },
  ],
});
const plan = (files = [file("a.ts")]): CommitPlan => ({
  stage: ["/repo/a.ts"],
  exclude: ["/repo/excluded.ts"],
  included: files,
  partial: [],
});

it("describes included working changes and recent subjects without reading excluded files", async () => {
  const context = await commitMessageContext(selection(), plan());
  expect(context.repositories[0]!.changes).toContain("+new one");
  expect(context.repositories[0]!.recentMessages).toEqual(["fix(api): preserve request cancellation"]);
  expect(reads).toEqual(["HEAD:/repo/a.ts", "disk:/repo/a.ts"]);
});
it("reads only the index for a staged selection, leaving unstaged edits out", async () => {
  await commitMessageContext(selection([]), plan([file("a.ts", "modified")]));
  expect(reads).toEqual(["HEAD:/repo/a.ts", ":0:/repo/a.ts"]);
});
it("includes only the selected hunks of a partially committed file", async () => {
  const selected = selection([]);
  selected.repositories[0]!.options.partial = [
    { path: "/repo/a.ts", hunks: [{ start: 2, lines: 1, oldStart: 2, oldLines: 1 }] },
  ];
  const context = await commitMessageContext(selected, plan());
  expect(context.repositories[0]!.changes).toContain("+new two");
  expect(context.repositories[0]!.changes).not.toContain("new one");
});
it("fails explicitly when selected hunks no longer match", async () => {
  const selected = selection([]);
  selected.repositories[0]!.options.partial = [
    { path: "/repo/a.ts", hunks: [{ start: 99, lines: 1, oldStart: 99, oldLines: 1 }] },
  ];
  await expect(commitMessageContext(selected, plan())).rejects.toThrow("selection changed");
});
it("describes a binary change without sending its contents", async () => {
  binary = true;
  const context = await commitMessageContext(selection(), plan());
  expect(context.repositories[0]!.changes).toContain("binary content omitted");
  expect(reads).toEqual([]);
});
it("requires a selected change", async () => {
  await expect(commitMessageContext(selection(), plan([]))).rejects.toThrow("Select changes");
});

it("includes the prior commit when generating an amend message without additional changes", async () => {
  const selected = selection([]);
  selected.amend = true;
  const context = await commitMessageContext(selected, plan([]));
  expect(context.repositories[0]!.changes).toContain("previous behavior");
  expect(context.amend).toBe(true);
});

it("keeps nested repositories' included changes separate", async () => {
  const selected = selection();
  selected.repositories.push({
    root: "/repo/nested",
    options: {
      amend: false,
      author: null,
      signOff: false,
      runHooks: true,
      stage: ["/repo/nested/api.ts"],
      partial: [],
      exclude: [],
    },
  });
  const context = await commitMessageContext(selected, plan([file("a.ts"), file("nested/api.ts")]));
  expect(context.repositories[0]!.changes).not.toContain("nested/api.ts");
  expect(context.repositories[1]!.changes).toContain("nested/api.ts");
});
