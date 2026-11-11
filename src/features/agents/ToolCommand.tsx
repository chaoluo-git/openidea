import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import type { AgentToolCommand } from "@/bindings";
import { highlightInto } from "@/editor/lsp/markdown";
import { useTx } from "@/platform/i18n";
import { IconButton, T } from "@/ui";
import styles from "./Session.module.css";

export function ToolCommand({
  command,
  cwd,
  output,
  running,
}: {
  command: AgentToolCommand;
  cwd: string;
  output: string;
  running: boolean;
}) {
  const tx = useTx();
  const code = useRef<HTMLElement>(null);
  const [wrap, setWrap] = useState(true);
  useEffect(() => {
    let active = true;
    const highlighted = document.createElement("code");
    highlighted.textContent = command.text;
    // Plain text remains readable if the shell grammar cannot be loaded.
    void highlightInto(highlighted, command.text, "bash")
      .then(() => {
        if (active) code.current?.replaceChildren(...highlighted.childNodes);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [command.text]);
  const directory = command.cwd ?? cwd;
  return (
    <div className={styles.shellCard}>
      <div className={styles.shellBlock}>
        <div className={styles.shellLabel} title={directory}>
          {tx("Command in {path}").replace("{path}", directory)}
        </div>
        <div className={styles.shellActions}>
          <IconButton
            icon="soft-wrap"
            action="agents.toggleCodeWrap"
            title="Wrap Lines"
            pressed={wrap}
            size="small"
            actionArg={{ toggle: () => setWrap(!wrap) }}
          />
          <IconButton
            icon="copy"
            action="agents.copyCode"
            title="Copy Command"
            size="small"
            actionArg={{ text: command.text }}
          />
        </div>
        <pre className={styles.shellCommand} data-wrap={wrap}>
          <code key={command.text} ref={code}>
            {command.text}
          </code>
        </pre>
      </div>
      <ToolOutput text={output} running={running} />
    </div>
  );
}

/** Copy the retained source text, regardless of syntax spans or visual wrapping. */
export function ToolOutput({
  text,
  running = false,
  framed = false,
}: {
  text: string;
  running?: boolean;
  framed?: boolean;
}) {
  const tx = useTx();
  const [wrap, setWrap] = useState(true);
  return (
    <div className={clsx(styles.shellOutput, framed && styles.toolOutput)}>
      {!framed && (
        <div className={styles.shellLabel}>
          <T>Output</T>
        </div>
      )}
      <div className={styles.shellActions}>
        <IconButton
          icon="soft-wrap"
          action="agents.toggleCodeWrap"
          title="Wrap Lines"
          pressed={wrap}
          size="small"
          disabled={!text}
          actionArg={{ toggle: () => setWrap(!wrap) }}
        />
        <IconButton
          icon="copy"
          action="agents.copyCode"
          title="Copy Output"
          size="small"
          disabled={!text}
          actionArg={{ text }}
        />
      </div>
      {text ? (
        <pre className={clsx(styles.shellCommand, framed && styles.output)} data-wrap={wrap}>
          {text}
        </pre>
      ) : (
        <span className={styles.muted}>{tx(running ? "Waiting for output…" : "No output")}</span>
      )}
    </div>
  );
}
