import { render, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MessageText } from "./MessageText";

describe("sent message code", () => {
  it.each(["SELECT 1;", "SELECT now();", "SET lock_timeout = '10s';", "CREATE UNIQUE INDEX idx ON users(id);"])(
    "recognizes standalone SQL: %s",
    async (text) => {
      const { container } = render(<MessageText text={text} />);
      await waitFor(() => expect(container.querySelector(".tok-keyword")).not.toBeNull());
      expect(container.textContent).toBe(text);
    },
  );

  it("highlights pasted SQL while preserving comments, whitespace and literal markup", async () => {
    const text = "-- 检查事务\nSELECT pid, state FROM pg_stat_activity\nWHERE query = '<script>alert(1)</script>';\n";
    const { container } = render(<MessageText text={text} />);
    await waitFor(() => expect(container.querySelector(".tok-keyword")).not.toBeNull());
    expect(container.textContent).toBe(text);
    expect(container.querySelector(".tok-comment")?.textContent).toBe("-- 检查事务");
    expect(container.querySelector(".tok-string")?.textContent).toContain("<script>");
    expect(container.querySelector("script")).toBeNull();
  });

  it("highlights explicit fences without interpreting the surrounding prose as Markdown or HTML", async () => {
    const text =
      "**Please inspect** <img src=x onerror=alert(1)>\n\n```sql\nSELECT * FROM users;\n```\n\nKeep this text.";
    const { container } = render(<MessageText text={text} />);
    await waitFor(() => expect(container.querySelector("code .tok-keyword")).not.toBeNull());
    expect(container.querySelector("code")?.textContent).toBe("SELECT * FROM users;");
    expect(container.textContent).toContain("**Please inspect** <img src=x onerror=alert(1)>");
    expect(container.textContent).toContain("Keep this text.");
    expect(container.querySelector("img, strong")).toBeNull();
  });

  it.each(["Select an item from the menu.", "Update the settings;", "**literal** <script>x</script>"])(
    "keeps ordinary prose literal: %s",
    (text) => {
      const { container } = render(<MessageText text={text} />);
      expect(container.textContent).toBe(text);
      expect(container.querySelector("pre, script, strong")).toBeNull();
    },
  );

  it("updates highlighted source when the sent message changes", async () => {
    const { container, rerender } = render(<MessageText text={"```sql\nSELECT * FROM old_table;\n```"} />);
    rerender(<MessageText text={"```sql\nDELETE FROM new_table;\n```"} />);
    await waitFor(() => expect(container.querySelector(".tok-keyword")?.textContent).toBe("DELETE"));
    expect(container.querySelector("code")?.textContent).toBe("DELETE FROM new_table;");
  });
});
