import assert from "node:assert/strict";
import test from "node:test";

import { ConditionVariableInserter } from "../scripts/applications/ConditionVariableInserter.js";

function createEditor({ value = "", cursor = null } = {}) {
  const calls = {
    focus: 0,
    scrollTo: []
  };
  const editor = {
    value,
    cursor,
    scrollTo(position) {
      calls.scrollTo.push(position);
    },
    querySelector(selector) {
      assert.equal(selector, '[contenteditable="true"]');
      return {
        focus() {
          calls.focus += 1;
        }
      };
    }
  };

  return { calls, editor };
}

test("inserts an available variable at the current cursor", () => {
  const { calls, editor } = createEditor({
    value: "return  === \"bright\";",
    cursor: 7
  });

  assert.equal(ConditionVariableInserter.insert(editor, "lightLevel"), true);
  assert.equal(editor.value, "return lightLevel === \"bright\";");
  assert.deepEqual(calls.scrollTo, [{ top: 17 }]);
  assert.equal(calls.focus, 1);
});

test("appends at the end when the editor has no cursor", () => {
  const { editor } = createEditor({ value: "return ", cursor: null });

  ConditionVariableInserter.insert(editor, "actor");

  assert.equal(editor.value, "return actor");
});

test("rejects unknown variables without changing the editor", () => {
  const { editor } = createEditor({ value: "return true;", cursor: 0 });

  assert.equal(ConditionVariableInserter.insert(editor, "window"), false);
  assert.equal(editor.value, "return true;");
});

test("does not change a readonly editor", () => {
  const { editor } = createEditor({ value: "return true;", cursor: 0 });
  editor.editable = false;

  assert.equal(ConditionVariableInserter.insert(editor, "actor"), false);
  assert.equal(editor.value, "return true;");
});

test("binds one delegated click listener and prevents form submission", () => {
  const { editor } = createEditor({ value: "return ;", cursor: 7 });
  const listeners = [];
  const toolbar = {
    dataset: {},
    addEventListener(type, listener) {
      assert.equal(type, "click");
      listeners.push(listener);
    }
  };
  const root = {
    querySelector(selector) {
      if (selector === "[data-sc-cae-variable-toolbar]") {
        return toolbar;
      }

      assert.equal(selector, 'code-mirror[name="flags.sc-conditional-ae.condition"]');
      return editor;
    }
  };

  ConditionVariableInserter.activate(root, "flags.sc-conditional-ae.condition");
  ConditionVariableInserter.activate(root, "flags.sc-conditional-ae.condition");
  assert.equal(listeners.length, 1);

  let defaultPrevented = false;
  listeners[0]({
    preventDefault() {
      defaultPrevented = true;
    },
    target: {
      closest() {
        return { dataset: { scCaeInsertVariable: "actor" } };
      }
    }
  });

  assert.equal(defaultPrevented, true);
  assert.equal(editor.value, "return actor;");
});

test("exposes every documented condition variable once", () => {
  assert.deepEqual(ConditionVariableInserter.variables, [
    "effect",
    "actor",
    "targetActor",
    "token",
    "lightLevel",
    "item",
    "origin",
    "originActor",
    "user",
    "rollData",
    "source",
    "getProperty",
    "hasProperty",
    "deepClone",
    "game"
  ]);
  assert.equal(new Set(ConditionVariableInserter.variables).size, ConditionVariableInserter.variables.length);
});
