import type { Action } from "@/platform/actions";
import { writeClipboardText } from "@/platform/clipboard";
import { notifications } from "@/workbench/contributions";

export interface CopyCode {
  text: string;
  onCopied?: () => void;
}

export interface WrapCode {
  toggle: () => void;
}

async function copyText(arg: unknown, title: string) {
  const target = arg as CopyCode | undefined;
  if (!target || typeof target.text !== "string") return;
  try {
    await writeClipboardText(target.text);
    target.onCopied?.();
  } catch (error) {
    notifications().notify({ level: "error", title, body: String(error) });
  }
}

export const codeBlockActions: Action[] = [
  {
    id: "agents.toggleOutputPreview",
    title: "Show full output",
    category: "Agents",
    hidden: true,
    run: ({ arg }) => {
      const target = arg as { toggle?: () => void } | undefined;
      if (typeof target?.toggle === "function") target.toggle();
    },
  },
  {
    id: "agents.copyCode",
    title: "Copy Code",
    category: "Agents",
    icon: "copy",
    hidden: true,
    run: ({ arg }) => copyText(arg, "Couldn't copy code"),
  },
  {
    id: "agents.copyTable",
    title: "Copy Table",
    category: "Agents",
    icon: "copy",
    hidden: true,
    run: ({ arg }) => copyText(arg, "Couldn't copy table"),
  },
  {
    id: "agents.toggleCodeWrap",
    title: "Use Soft Wraps",
    category: "Agents",
    icon: "soft-wrap",
    hidden: true,
    run: ({ arg }) => {
      const target = arg as WrapCode | undefined;
      if (typeof target?.toggle === "function") target.toggle();
    },
  },
];
