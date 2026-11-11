import { call, commands } from "@/platform/ipc";
import { tx } from "@/platform/i18n";
import { pathHref, pathLink, type PathLink } from "./conversation";
import styles from "./Session.module.css";

const existing = new Map<string, Promise<boolean>>();
function fileExists(path: string): Promise<boolean> {
  let known = existing.get(path);
  if (!known) {
    known = call(commands.fsProbe(path)).then(
      () => true,
      () => {
        existing.delete(path);
        return false;
      },
    );
    if (existing.size >= 500) existing.delete(existing.keys().next().value!);
    existing.set(path, known);
  }
  return known;
}

/** Only existing references become links; fenced code and existing anchors stay untouched. */
export function enhanceFileLinks(root: HTMLElement, cwd: string): () => void {
  let alive = true;
  const links: HTMLAnchorElement[] = [];
  const anchor = (link: PathLink) => {
    const a = document.createElement("a");
    a.className = styles.fileLink!;
    a.href = pathHref(link);
    a.title = tx`Open ${link.path}`;
    links.push(a);
    return a;
  };
  root.querySelectorAll("code").forEach((code) => {
    if (code.closest("pre, a")) return;
    const link = pathLink(code.textContent ?? "", cwd);
    if (!link) return;
    void fileExists(link.path).then((exists) => {
      if (!alive || !exists) return;
      const a = anchor(link);
      code.replaceWith(a);
      a.append(code);
    });
  });
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement?.closest("pre, code, a, button, [data-mermaid]")
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  });
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  for (const node of nodes) {
    const text = node.data;
    // Whitespace and prose punctuation delimit unquoted paths; code spans support spaces.
    const candidates = [
      ...text.matchAll(
        /(?:^|[\s(（])((?:\.{1,2}\/|\/)?[\p{L}\p{N}_@.-]+(?:\/[\p{L}\p{N}_@.-]+)*(?::\d+(?::\d+)?|#L\d+(?:C\d+)?(?:-L?\d+(?:C\d+)?)?)?)(?=$|[\s,，。;；)）])/gu,
      ),
    ];
    if (!candidates.length) continue;
    void Promise.all(
      candidates.map(async (match) => {
        const value = match[1]!.replace(/\.$/, "");
        const link = pathLink(value, cwd);
        return {
          value,
          at: match.index! + match[0].length - match[1]!.length,
          link,
          exists: link && (await fileExists(link.path)),
        };
      }),
    ).then((matches) => {
      if (!alive) return;
      let offset = 0;
      const content = document.createDocumentFragment();
      for (const { value, at, link, exists } of matches) {
        if (!link || !exists) continue;
        content.append(text.slice(offset, at));
        const a = anchor(link);
        a.textContent = value;
        content.append(a);
        offset = at + value.length;
      }
      if (!offset) return;
      content.append(text.slice(offset));
      node.replaceWith(content);
    });
  }
  return () => {
    alive = false;
    links.forEach((a) => a.replaceWith(...a.childNodes));
  };
}
