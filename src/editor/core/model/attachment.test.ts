import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import { history, undo } from "@codemirror/commands";
import { editorsFor } from "@/editor/api";
import { createMemoryBackend } from "../backend";
import { _resetLanguages } from "../cm/languages";
import { attachDocument } from "./attachment";
import { DocumentManager, useDocMeta } from "./document";
import { EditorSlot, type SlotHost } from "./slot";

const host: SlotHost = {
  onFocus: () => {},
  onBlur: () => {},
  onSelection: () => {},
  onUserEdit: () => {},
  onContextMenu: () => {},
};

async function settle() {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
}

function setup(files: Record<string, string>, settings = {}) {
  _resetLanguages();
  const backend = createMemoryBackend(files);
  const scheduled: Array<() => void> = [];
  const notify = vi.fn();
  const manager = new DocumentManager(backend, { settings: () => settings, notify }, (fn) => scheduled.push(fn));
  manager.start();
  const frame = async () => {
    scheduled.splice(0).forEach((f) => f());
    await settle();
  };
  return { backend, manager, frame, notify };
}

afterEach(() => useDocMeta.setState({}, true));

describe("attached document views (editable diff side)", () => {
  it.each([false, true])("honors an explicit discard without saving (autosave: %s)", async (autoSave) => {
    const { backend, manager, frame } = setup({ "/p/a.txt": "original\n" }, { files: { autoSave } });
    const save = vi.spyOn(backend, "save");
    const attachment = await attachDocument(manager, "/p/a.txt");
    const view = new EditorView({ doc: attachment.text(), extensions: [attachment.extension] });
    try {
      view.dispatch({ changes: { from: 0, insert: "discarded " } });
      await frame();
      view.destroy();
      attachment.release({ discard: true });
      await settle();
      expect(backend.files.get("/p/a.txt")).toBe("original\n");
      expect(save).not.toHaveBeenCalled();
      expect(manager.get("/p/a.txt")).toBeUndefined();
    } finally {
      manager.stop();
    }
  });

  it("keeps another editor's unsaved buffer when a comparison view is discarded", async () => {
    const { backend, manager, frame } = setup({ "/p/a.txt": "original\n" }, { files: { autoSave: false } });
    const model = await manager.acquire("/p/a.txt");
    const slot = new EditorSlot(model, "text", host);
    const attachment = await attachDocument(manager, "/p/a.txt");
    const view = new EditorView({ doc: attachment.text(), extensions: [attachment.extension] });
    try {
      view.dispatch({ changes: { from: 0, insert: "shared " } });
      await frame();
      view.destroy();
      attachment.release({ discard: true });
      await settle();
      expect(slot.currentState().doc.toString()).toBe("shared original\n");
      expect(backend.files.get("/p/a.txt")).toBe("original\n");
      expect(manager.get("/p/a.txt")).toBe(model);
      slot.dispose();
      await settle();
      await manager.saveAll("explicit");
      await settle();
      expect(backend.files.get("/p/a.txt")).toBe("shared original\n");
    } finally {
      manager.stop();
    }
  });

  it("does not apply an earlier discard decision to newer edits", async () => {
    const { backend, manager, frame } = setup({ "/p/a.txt": "original\n" }, { files: { autoSave: false } });
    const attachment = await attachDocument(manager, "/p/a.txt");
    const view = new EditorView({ doc: attachment.text(), extensions: [attachment.extension] });
    view.dispatch({ changes: { from: 0, insert: "old " } });
    await frame();
    const model = manager.get("/p/a.txt")!;
    let resume!: () => void;
    vi.spyOn(model.sync, "whenIdle").mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resume = resolve;
      }),
    );
    view.destroy();
    attachment.release({ discard: true });
    await Promise.resolve();
    const reopened = await attachDocument(manager, "/p/a.txt");
    const next = new EditorView({ doc: reopened.text(), extensions: [reopened.extension] });
    try {
      next.dispatch({ changes: { from: 0, insert: "newer " } });
      await frame();
      next.destroy();
      reopened.release();
      resume();
      await settle();
      expect(manager.get("/p/a.txt")).toBe(model);
      expect(backend.files.get("/p/a.txt")).toBe("original\n");
      await manager.saveAll("explicit");
      await settle();
      expect(backend.files.get("/p/a.txt")).toBe("newer old original\n");
    } finally {
      resume();
      manager.stop();
    }
  });

  it("retains unsaved text after detaching the last view and releases it after Save All", async () => {
    const { backend, manager, frame } = setup({ "/p/a.txt": "original\n" }, { files: { autoSave: false } });
    const attachment = await attachDocument(manager, "/p/a.txt");
    const view = new EditorView({ doc: attachment.text(), extensions: [attachment.extension] });
    try {
      view.dispatch({ changes: { from: 0, insert: "unsaved " } });
      await frame();
      view.destroy();
      attachment.release();
      await settle();
      expect(backend.files.get("/p/a.txt")).toBe("original\n");
      const reopened = await attachDocument(manager, "/p/a.txt");
      expect(reopened.text()).toBe("unsaved original\n");
      reopened.release();
      await settle();
      await manager.saveAll("explicit");
      await settle();
      expect(backend.files.get("/p/a.txt")).toBe("unsaved original\n");
      expect(manager.get("/p/a.txt")).toBeUndefined();
      expect(backend.docs.size).toBe(0);
    } finally {
      manager.stop();
    }
  });

  it.each(["save", "sync"])("keeps edits and reports a %s failure after the last view closes", async (failure) => {
    const { backend, manager, frame, notify } = setup({ "/p/a.txt": "original\n" });
    const attachment = await attachDocument(manager, "/p/a.txt");
    const view = new EditorView({ doc: attachment.text(), extensions: [attachment.extension] });
    try {
      view.dispatch({ changes: { from: 0, insert: "pending " } });
      await frame();
      const cause = failure === "save" ? "disk full" : "connection lost";
      if (failure === "save") vi.spyOn(backend, "save").mockRejectedValueOnce(new Error(cause));
      else vi.spyOn(manager.get("/p/a.txt")!.sync, "whenIdle").mockRejectedValueOnce(new Error(cause));
      view.destroy();
      attachment.release();
      await settle();
      expect(notify).toHaveBeenCalledWith(
        expect.objectContaining({ level: "error", body: expect.stringContaining(cause) }),
      );
      expect(manager.get("/p/a.txt")?.getMeta().dirty).toBe(true);
      expect(backend.files.get("/p/a.txt")).toBe("original\n");
      await manager.saveAll("explicit");
      await settle();
      expect(backend.files.get("/p/a.txt")).toBe("pending original\n");
      expect(manager.get("/p/a.txt")).toBeUndefined();
    } finally {
      manager.stop();
    }
  });

  it("can save a confirmed merge result without trimming or adding a final newline", async () => {
    const { backend, manager } = setup({ "/p/merge.txt": "old\n" });
    const att = await attachDocument(manager, "/p/merge.txt");
    const view = new EditorView({ doc: att.text(), extensions: [att.extension] });
    const model = manager.get("/p/merge.txt")!;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "标题😀  \nexact result  " } });
    await att.save({ exact: true });
    expect(view.state.doc.toString()).toBe("标题😀  \nexact result  ");
    expect(backend.docs.get(model.doc)?.text).toBe("标题😀  \nexact result  ");
    expect(useDocMeta.getState()["/p/merge.txt"]?.dirty).toBe(false);
    view.destroy();
    att.release();
  });

  it("shares the document with editor tabs both ways and syncs to the backend", async () => {
    const { backend, manager, frame } = setup({ "/p/a.txt": "one\ntwo\n" });
    const model = await manager.acquire("/p/a.txt");
    const tab = new EditorSlot(model, "t1", host);
    const att = await attachDocument(manager, "/p/a.txt");
    expect(att.readOnly).toBe(false);
    const view = new EditorView({ doc: att.text(), extensions: [att.extension, history()] });
    expect(editorsFor("/p/a.txt").some((h) => h.view === view)).toBe(true);

    // Typing in the diff reaches the tab and the backend.
    view.dispatch({ changes: { from: 0, insert: ">" }, userEvent: "input.type" });
    expect(tab.currentState().doc.toString()).toBe(">one\ntwo\n");
    await frame();
    expect(backend.docs.get(model.doc)?.text).toBe(">one\ntwo\n");
    expect(useDocMeta.getState()["/p/a.txt"]?.dirty).toBe(true);

    // Typing in the tab is mirrored into the diff, without entering its undo history.
    tab.dispatchLocal({ changes: { from: 4, insert: "!" } });
    expect(view.state.doc.toString()).toBe(">one!\ntwo\n");
    undo(view);
    expect(view.state.doc.toString()).toBe("one!\ntwo\n");
    expect(tab.currentState().doc.toString()).toBe("one!\ntwo\n");

    // Save goes through the document (Save All saves it too).
    await att.save();
    expect(useDocMeta.getState()["/p/a.txt"]?.dirty).toBe(false);
    view.destroy();
    att.release();
    tab.dispose();
  });

  it("keeps the document open while attached and makes backend patches undoable without tabs", async () => {
    const { backend, manager } = setup({ "/p/b.txt": "abc" });
    const att = await attachDocument(manager, "/p/b.txt");
    const view = new EditorView({ doc: att.text(), extensions: [att.extension, history()] });
    const model = manager.get("/p/b.txt")!;
    backend.patch(model.doc, [{ from: 0, to: 1, insert: "X" }]);
    expect(view.state.doc.toString()).toBe("Xbc");
    undo(view);
    expect(view.state.doc.toString()).toBe("abc");
    view.destroy();
    att.release();
    await settle();
    expect(manager.get("/p/b.txt")).toBeUndefined();
  });

  it("catches up when the document changed before the view was created", async () => {
    const { manager } = setup({ "/p/c.txt": "old" });
    const model = await manager.acquire("/p/c.txt");
    const tab = new EditorSlot(model, "t1", host);
    const att = await attachDocument(manager, "/p/c.txt");
    const stale = att.text();
    tab.dispatchLocal({ changes: { from: 0, to: 3, insert: "new" } });
    const view = new EditorView({ doc: stale, extensions: [att.extension] });
    await settle();
    expect(view.state.doc.toString()).toBe("new");
    view.destroy();
    att.release();
    tab.dispose();
  });

  it("undoes backend edits in the document's history: the text tab's when one is open (custom editors)", async () => {
    const { backend, manager, frame } = setup({ "/p/c.csv": "a,b\n" });
    const att = await attachDocument(manager, "/p/c.csv");
    const view = new EditorView({ doc: att.text(), extensions: [att.extension, history()] });
    const model = manager.get("/p/c.csv")!;
    expect(att.doc).toBe(model.doc);

    // No tab: the attachment holds the history.
    backend.patch(model.doc, [{ from: 0, to: 1, insert: "X" }]);
    expect(att.undo()).toBe(true);
    expect(view.state.doc.toString()).toBe("a,b\n");
    expect(att.redo()).toBe(true);
    expect(view.state.doc.toString()).toBe("X,b\n");
    await frame();
    await att.synced();
    expect(backend.docs.get(model.doc)?.text).toBe("X,b\n");

    // With a text tab, backend edits are recorded there: undo from the custom editor reaches it.
    const tab = new EditorSlot(model, "t1", host);
    backend.patch(model.doc, [{ from: 2, to: 3, insert: "Y" }]);
    expect(tab.currentState().doc.toString()).toBe("X,Y\n");
    expect(att.undo()).toBe(true);
    expect(tab.currentState().doc.toString()).toBe("X,b\n");
    expect(view.state.doc.toString()).toBe("X,b\n");
    view.destroy();
    att.release();
    tab.dispose();
  });

  it("records an attachment's own edits in the document's history: the text tab's when one is open", async () => {
    const { manager } = setup({ "/p/d.excalidraw": "{}" });
    const att = await attachDocument(manager, "/p/d.excalidraw");
    const view = new EditorView({ doc: att.text(), extensions: [att.extension, history()] });
    const model = manager.get("/p/d.excalidraw")!;

    // No tab: the view's own history.
    att.edit({ from: 1, insert: "a" });
    expect(view.state.doc.toString()).toBe("{a}");
    expect(att.undo()).toBe(true);
    expect(view.state.doc.toString()).toBe("{}");

    // With a text tab: the edit is the tab's, so Undo there reverts it, and the view follows.
    const tab = new EditorSlot(model, "t1", host);
    att.edit({ from: 1, insert: "b" }, "input.plugin");
    expect(tab.currentState().doc.toString()).toBe("{b}");
    expect(view.state.doc.toString()).toBe("{b}");
    // `undo` runs where the history is: the tab's (what ⌘Z in the text editor runs).
    expect(att.undo()).toBe(true);
    expect(tab.currentState().doc.toString()).toBe("{}");
    expect(view.state.doc.toString()).toBe("{}");
    // The view's own history never had it.
    expect(undo(view)).toBe(false);
    view.destroy();
    att.release();
    tab.dispose();
  });
});
