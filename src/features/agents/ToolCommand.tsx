import { useContext, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import clsx from "clsx";
import type { AgentToolCommand } from "@/bindings";
import { executeAction } from "@/platform/actions";
import { highlightInto } from "@/editor/lsp/markdown";
import { useTx } from "@/platform/i18n";
import { Button, Icon, IconButton, T } from "@/ui";
import { ConversationScroll, FoldedContent, activityKey } from "./conversationDisclosure";
import styles from "./Session.module.css";

export function ToolCommand({
  command,
  cwd,
  output,
  outputId,
  running,
}: {
  command: AgentToolCommand;
  cwd: string;
  output: string;
  outputId: string;
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
      <ToolOutput id={outputId} text={output} running={running} />
    </div>
  );
}

/** Copy the retained source text, regardless of syntax spans or visual wrapping. */
export function ToolOutput({
  id,
  text,
  running = false,
  framed = false,
}: {
  id: string;
  text: string;
  running?: boolean;
  framed?: boolean;
}) {
  const tx = useTx();
  const scroll = useContext(ConversationScroll);
  const finding = useContext(FoldedContent);
  const key = activityKey(scroll, id);
  const viewportId = useId();
  const content = useRef<HTMLPreElement>(null);
  const [wrap, setWrap] = useState(true);
  const [expanded, setExpanded] = useState(() => scroll?.opened.get(key) ?? false);
  const [long, setLong] = useState(false);
  const hasText = !!text;
  useLayoutEffect(() => {
    const el = content.current;
    if (!el) return;
    const measure = () => {
      const style = getComputedStyle(el);
      const height = parseFloat(style.lineHeight) * Number(style.getPropertyValue("--output-preview-lines"));
      setLong(Number.isFinite(height) && height > 0 && el.scrollHeight > height + 1);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasText]);
  const toggle = () => {
    scroll?.opened.set(key, !expanded);
    scroll?.pause();
    setExpanded(!expanded);
  };
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
        <>
          <div
            id={viewportId}
            role="region"
            aria-label={tx("Output")}
            tabIndex={long && expanded ? 0 : undefined}
            className={clsx(
              styles.outputViewport,
              long && !finding && (expanded ? styles.outputExpanded : styles.outputPreview),
            )}
          >
            <pre ref={content} className={styles.shellCommand} data-wrap={wrap}>
              {text}
            </pre>
          </div>
          {long && !finding && (
            <Button
              className={styles.outputToggle}
              onClick={() => void executeAction("agents.toggleOutputPreview", { toggle })}
              aria-controls={viewportId}
              aria-expanded={expanded}
            >
              <T>{expanded ? "Collapse output" : "Show full output"}</T>
              <Icon name={expanded ? "chevron-up" : "chevron-down"} size={12} />
            </Button>
          )}
        </>
      ) : (
        <span className={styles.muted}>{tx(running ? "Waiting for output…" : "No output")}</span>
      )}
    </div>
  );
}
