import { ConditionVariableRegistry } from "../helpers/ConditionVariableRegistry.js";

export class ConditionVariableInserter {
  static get variables() {
    return ConditionVariableRegistry.names;
  }

  static activate(root, conditionFlagPath) {
    const toolbar = root?.querySelector?.("[data-sc-cae-variable-toolbar]");
    if (!toolbar || toolbar.dataset.scCaeVariableToolbarBound === "true") {
      return;
    }

    toolbar.dataset.scCaeVariableToolbarBound = "true";
    toolbar.addEventListener("click", event => {
      const button = event.target?.closest?.("[data-sc-cae-insert-variable]");
      if (!button) {
        return;
      }

      event.preventDefault();
      const editor = root.querySelector(`code-mirror[name="${conditionFlagPath}"]`);
      ConditionVariableInserter.insert(editor, button.dataset.scCaeInsertVariable);
    });
  }

  static insert(editor, variable) {
    if (!editor || editor.editable === false || !ConditionVariableRegistry.has(variable)) {
      return false;
    }

    const value = String(editor.value ?? "");
    const editorCursor = editor.cursor;
    const cursor = Number.isFinite(editorCursor)
      ? Math.max(0, Math.min(editorCursor, value.length))
      : value.length;
    const nextCursor = cursor + variable.length;

    editor.value = `${value.slice(0, cursor)}${variable}${value.slice(cursor)}`;
    editor.scrollTo?.({ top: nextCursor });
    editor.querySelector?.('[contenteditable="true"]')?.focus?.();
    return true;
  }
}
