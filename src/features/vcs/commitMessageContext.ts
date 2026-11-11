import type { CommitSelection, FileStatus, LineHunk } from "@/bindings";
import type { CommitMessageContext } from "@/workbench/contributions";
import { call, commands } from "@/platform/ipc";
import { tx } from "@/platform/i18n";
import { workflowSettings } from "@/platform/workflowSettings";
import type { CommitPlan } from "./changes";
import { renamedFromPath } from "./changes";
import { currentHunkText } from "./hunks";
import { isSameOrInside } from "@/platform/paths";

const repositoryFor = (selection: CommitSelection, path: string) =>
  selection.repositories.filter((r) => isSameOrInside(path, r.root)).sort((a, b) => b.root.length - a.root.length)[0];

const MAX_CONTEXT = 160_000;
const MAX_RULES = 16_000;
const block = (text: string, prefix: string) => {
  const lines = text.split(/\r\n|\n|\r/);
  if (/\r?\n$|\r$/.test(text)) lines.pop();
  return lines.map((line) => `${prefix}${line}`).join("\n");
};
const range = (start: number, lines: number) => `${lines ? start + 1 : start},${lines}`;

async function describeFile(file: FileStatus, selection: CommitSelection): Promise<string> {
  const path = file.path.replace(/\/$/, "");
  const repo = repositoryFor(selection, path);
  if (!repo) throw new Error(tx("The commit selection changed. Generate the message again."));
  const partial = (repo.options.partial ?? []).find((f) => f.path === path);
  const working = (repo.options.stage ?? []).includes(path) || !!partial;
  const kind = working ? (file.unstaged ?? file.staged) : file.staged;
  const name = file.relPath;
  if (working && kind !== "deleted") {
    const probe = await call(commands.fsProbe(path));
    if (probe.binary) return `File: ${name} (${kind}; binary content omitted)`;
    if (probe.tooLarge || probe.size > MAX_CONTEXT)
      throw new Error(tx("The selected changes are too large. Select fewer files."));
  }
  const before = (await call(commands.vcsFileAt(renamedFromPath(file) ?? path, "HEAD"))) ?? "";
  const after =
    kind === "deleted"
      ? ""
      : working
        ? await call(commands.fsReadText(path))
        : ((await call(commands.vcsFileAt(path, ":0"))) ?? "");
  if (before.length > MAX_CONTEXT || after.length > MAX_CONTEXT)
    throw new Error(tx("The selected changes are too large. Select fewer files."));
  if (before.includes("\0") || after.includes("\0")) return `File: ${name} (${kind}; binary content omitted)`;
  const hunks = await commands.vcsDiffHunks(before, after);
  const chosen = partial
    ? partial.hunks.map((wanted) => {
        const found = hunks.find(
          (h) =>
            h.start === wanted.start &&
            h.lines === wanted.lines &&
            h.oldStart === wanted.oldStart &&
            h.oldLines === wanted.oldLines,
        );
        if (!found) throw new Error(tx("The commit selection changed. Generate the message again."));
        return found;
      })
    : hunks;
  const patch = chosen
    .map((h: LineHunk) =>
      [
        `@@ -${range(h.oldStart, h.oldLines)} +${range(h.start, h.lines)} @@`,
        ...(h.oldLines ? [block(h.oldText, "-")] : []),
        ...(h.lines ? [block(currentHunkText(after, h), "+")] : []),
      ].join("\n"),
    )
    .join("\n");
  return `File: ${name} (${kind}${file.renamedFrom ? `; renamed from ${file.renamedFrom}` : ""})\n${patch}`;
}

/** Uses the same included files, index side and partial hunks as Commit; never changes the index. */
export async function commitMessageContext(
  selection: CommitSelection,
  plan: CommitPlan,
): Promise<CommitMessageContext> {
  if (!plan.included.length && !selection.amend) throw new Error(tx("Select changes to generate a commit message."));
  if (plan.included.length > 100) throw new Error(tx("The selected changes are too large. Select fewer files."));
  let used = 0;
  const repositories: CommitMessageContext["repositories"] = [];
  for (const repo of selection.repositories) {
    const files = plan.included.filter((file) => repositoryFor(selection, file.path) === repo);
    const parts: string[] = [];
    if (selection.amend) {
      const previous = await call(
        commands.vcsCreatePatch(repo.root, { from: "commits", commits: ["HEAD"], reverse: false }),
      );
      used += previous.length;
      if (used > MAX_CONTEXT) throw new Error(tx("The selected changes are too large. Select fewer files."));
      parts.push(`Previous commit being amended:\n${previous}\n\nIncluded changes relative to that commit:`);
    }
    for (const file of files) {
      const description = await describeFile(file, selection);
      used += description.length;
      if (used > MAX_CONTEXT) throw new Error(tx("The selected changes are too large. Select fewer files."));
      parts.push(description);
    }
    const rules: string[] = [];
    for (const name of ["AGENTS.md", "CONTRIBUTING.md", ".github/copilot-instructions.md"]) {
      const path = `${repo.root.replace(/\/$/, "")}/${name}`;
      try {
        const probe = await call(commands.fsProbe(path));
        if (probe.binary || probe.tooLarge || probe.size > MAX_RULES) continue;
        rules.push(`${name}:\n${(await call(commands.fsReadText(path))).slice(0, MAX_RULES)}`);
      } catch {
        // Repository instruction files are optional.
      }
    }
    const recent = await call(
      commands.vcsLog(repo.root, { branch: "HEAD", path: null, author: null, text: null, skip: 0, limit: 8 }),
    ).catch(() => []);
    used += rules.join("\n\n").length + recent.reduce((n, c) => n + c.summary.length, 0);
    if (used > MAX_CONTEXT) throw new Error(tx("The selected changes are too large. Select fewer files."));
    repositories.push({
      root: repo.root,
      changes: parts.join("\n\n"),
      instructions: rules.join("\n\n"),
      recentMessages: recent.map((c) => c.summary),
    });
  }
  const config = workflowSettings().vcs.commit;
  return {
    revision: selection.revision,
    message: selection.message,
    amend: selection.amend,
    repositories,
    limits: {
      subject: config.limitSubject ? config.subjectLimit : null,
      body: config.limitBody ? config.bodyLimit : null,
    },
  };
}
