import assert from "node:assert/strict";
import test from "node:test";

import { ConditionVariableInserter } from "../scripts/applications/ConditionVariableInserter.js";
import { ConditionVariablePopover } from "../scripts/applications/ConditionVariablePopover.js";
import { ConditionVariableRegistry } from "../scripts/helpers/ConditionVariableRegistry.js";

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

test("exposes every documented condition variable once", () => {
  assert.deepEqual(ConditionVariableInserter.variables, [
    "effect",
    "change",
    "changeId",
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

test("every variable carries a kind and a description for the search popover", () => {
  for (const variable of ConditionVariableRegistry.variables) {
    assert.ok(variable.description.length > 0, `${variable.name} is missing a description`);
    assert.ok(["object", "function", "string"].includes(variable.kind), `${variable.name} has an unknown kind`);
    assert.equal(variable.descriptionKey, `SCConditionalAE.ConditionTab.VariableDescription.${variable.name}`);
    assert.equal(variable.kindKey, `SCConditionalAE.ConditionTab.VariableKind.${variable.kind}`);
  }

  assert.equal(ConditionVariableRegistry.variables.length, ConditionVariableRegistry.names.length);
  assert.equal(ConditionVariableRegistry.get("lightLevel")?.kind, "string");
  assert.equal(ConditionVariableRegistry.get("nope"), null);
});

test("the popover search matches names and descriptions, and keeps everything on an empty query", () => {
  const haystack = "lightLevel string Light level under the token: bright, dim or dark.";

  assert.equal(ConditionVariablePopover.matches(haystack, ""), true);
  assert.equal(ConditionVariablePopover.matches(haystack, "lightlevel"), true);
  assert.equal(ConditionVariablePopover.matches(haystack, "bright"), true);
  assert.equal(ConditionVariablePopover.matches(haystack, "token"), true);
  assert.equal(ConditionVariablePopover.matches(haystack, "macro"), false);
});

test("the popover binds outside-click cleanup to its owner document", () => {
  const calls = { add: 0, remove: 0 };
  const ownerDocument = {
    addEventListener(type, _listener, capture) {
      assert.equal(type, "pointerdown");
      assert.equal(capture, true);
      calls.add += 1;
    },
    removeEventListener(type, _listener, capture) {
      assert.equal(type, "pointerdown");
      assert.equal(capture, true);
      calls.remove += 1;
    }
  };
  const classes = new Set();
  const popover = {
    dataset: {},
    ownerDocument,
    classList: {
      add(name) {
        classes.add(name);
      },
      remove(name) {
        classes.delete(name);
      }
    },
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    }
  };
  const controller = ConditionVariablePopover.activate({
    querySelector() {
      return popover;
    }
  }, "flags.sc-conditional-ae.condition");

  controller.open();
  assert.equal(calls.add, 1);
  assert.equal(classes.has("sc-cae-variable-popover--open"), true);

  controller.destroy();
  assert.equal(calls.remove, 1);
});
