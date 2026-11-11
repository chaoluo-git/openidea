import { useMemo } from "react";
import type { AgentDiffPreview } from "@/bindings";
import { T } from "@/ui";
import { diffPreview, patchPreview } from "./toolPresentation";
import styles from "./Session.module.css";

/** An immutable snapshot supplied by this tool call; the full diff opens separately. */
export function ToolDiffPreview({ diff }: { diff: AgentDiffPreview }) {
  const preview = useMemo(
    () => (diff.type === "patch" ? patchPreview(diff.text) : diffPreview(diff.before, diff.after)),
    [diff],
  );
  return (
    <div className={styles.toolDiffPreview} data-excerpt={diff.type === "snippet"}>
      {diff.type === "snippet" && (
        <div className={styles.toolPreviewNote}>
          <T>Changed excerpt</T>
        </div>
      )}
      <table>
        <tbody>
          {preview.lines.map((line, index) => (
            <tr key={index} data-change={line.kind}>
              <td className={styles.toolLineNumber}>{line.before ?? ""}</td>
              <td className={styles.toolLineNumber}>{line.after ?? ""}</td>
              <td className={styles.toolLineText}>{line.text || " "}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {preview.truncated && (
        <div className={styles.toolPreviewNote}>
          <T>This preview is limited to 160 lines.</T>
        </div>
      )}
    </div>
  );
}
