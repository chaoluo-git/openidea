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

export const codeBlockActions: Action[] = [
  {
    id: "agents.copyCode",
    title: "Copy Code",
    category: "Agents",
    icon: "copy",
    hidden: true,
    run: async ({ arg }) => {
      const code = arg as CopyCode | undefined;
      if (!code || typeof code.text !== "string") return;
      try {
        await writeClipboardText(code.text);
        code.onCopied?.();
      } catch (error) {
        notifications().notify({ level: "error", title: "Couldn't copy code", body: String(error) });
      }
    },
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
