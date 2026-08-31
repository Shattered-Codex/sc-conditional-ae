import { ConditionVariableRegistry } from "../helpers/ConditionVariableRegistry.js";

export class ConditionVariableInserter {
  static get variables() {
    return ConditionVariableRegistry.names;
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
    if (typeof editor.click === "function") {
      editor.click();
    } else {
      editor.querySelector?.('[contenteditable="true"]')?.focus?.();
    }
    return true;
  }
}
