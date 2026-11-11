/** User prose stays literal; explicit code fences and standalone SQL get syntax colours. */
import { Fragment, memo, useLayoutEffect, useRef } from "react";
import { Lexer } from "marked";
import { highlightInto } from "@/editor/lsp/markdown";
import { InlineTag } from "@/ui";
import { messageTokens } from "./composerModel";
import styles from "./Session.module.css";

function isSql(text: string): boolean {
  const statement = text.replace(/^(?:\s|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)+/, "");
  // Require SQL structure so ordinary requests beginning with "Select" stay prose.
  if (!statement.includes("\n") && !/;\s*$/.test(statement)) return false;
  return (
    /^SELECT\b[\s\S]*?\bFROM\b/i.test(statement) ||
    /^SELECT\s+(?:\d|['"(]|[\w.]+\s*\()/i.test(statement) ||
    /^WITH\b[\s\S]*?\bAS\s*\(/i.test(statement) ||
    /^(?:INSERT\s+INTO\b|UPDATE\b[\s\S]*?\bSET\b|DELETE\s+FROM\b)/i.test(statement) ||
    /^(?:CREATE|ALTER|DROP)\s+(?:UNIQUE\s+)?(?:TABLE|INDEX|VIEW|SCHEMA)\b/i.test(statement) ||
    /^SET\s+[\w."]+\s*(?:=|TO\b)/i.test(statement) ||
    /^(?:EXPLAIN|VACUUM|REINDEX|TRUNCATE|BEGIN|COMMIT|ROLLBACK)\b[\s\S]*;\s*$/i.test(statement)
  );
}

function Code({ text, language }: { text: string; language: string | null }) {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    let alive = true;
    const target = ref.current!;
    // Highlight off-DOM so an older async language load cannot overwrite an edited message.
    const code = document.createElement("code");
    code.textContent = text;
    void highlightInto(code, text, language).then(() => {
      if (alive) target.replaceChildren(...code.childNodes);
    });
    return () => {
      alive = false;
    };
  }, [text, language]);
  return (
    <pre className={styles.messageCode}>
      <code ref={ref}>{text}</code>
    </pre>
  );
}

function Prose({ text }: { text: string }) {
  return messageTokens(text).map((token, i) =>
    token.kind === "text" ? (
      <Fragment key={i}>{token.value}</Fragment>
    ) : (
      <InlineTag key={i} accent={token.kind === "command"}>
        {token.value}
      </InlineTag>
    ),
  );
}

export const MessageText = memo(function MessageText({ text }: { text: string }) {
  if (isSql(text)) return <Code text={text} language="sql" />;
  if (/^\s{0,3}(?:`{3,}|~{3,})/m.test(text)) {
    const tokens = Lexer.lex(text);
    // Do not change literal user text if the lexer normalized any source outside a fence.
    if (tokens.map((token) => token.raw).join("") === text) {
      return tokens.map((token, i) =>
        token.type === "code" ? (
          <Code key={i} text={token.text} language={token.lang?.trim().split(/\s+/)[0] ?? null} />
        ) : (
          <Prose key={i} text={token.raw} />
        ),
      );
    }
  }
  return <Prose text={text} />;
});
