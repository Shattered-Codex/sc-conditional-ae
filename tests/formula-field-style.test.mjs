import assert from "node:assert/strict";
import test from "node:test";

globalThis.foundry = {
  utils: {
    flattenObject(object, prefix = "") {
      const flattened = {};
      for (const [key, value] of Object.entries(object ?? {})) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (value && typeof value === "object" && !Array.isArray(value)) {
          Object.assign(flattened, foundry.utils.flattenObject(value, path));
        } else {
          flattened[path] = value;
        }
      }
      return flattened;
    }
  }
};

const { ModuleSettings } = await import("../scripts/settings/ModuleSettings.js");
const { RollDataVariableRegistry } = await import("../scripts/helpers/RollDataVariableRegistry.js");
const { FormulaEditorDialog } = await import("../scripts/applications/FormulaEditorDialog.js");

function stubSetting(value) {
  globalThis.game = {
    settings: {
      get(_module, _key) {
        if (value === undefined) {
          throw new Error("unregistered");
        }
        return value;
      }
    }
  };
}

function createTextarea({ value = "", selectionStart = null } = {}) {
  const start = selectionStart ?? value.length;
  return {
    value,
    selectionStart: start,
    selectionEnd: start,
    setSelectionRange(from, to) {
      this.selectionStart = from;
      this.selectionEnd = to;
    },
    focus() {}
  };
}

test("offers the three design treatments plus the original column", () => {
  assert.deepEqual([...ModuleSettings.FORMULA_FIELD_STYLES], ["expand", "popup", "single", "column"]);
});

test("defaults to the expanding row", () => {
  stubSetting(undefined);
  assert.equal(ModuleSettings.getFormulaFieldStyle(), "expand");
  assert.equal(ModuleSettings.isFormulaFieldExpandable(), true);
});

test("maps the retired inline choice onto the formula column", () => {
  stubSetting("inline");
  assert.equal(ModuleSettings.getFormulaFieldStyle(), "column");
  assert.equal(ModuleSettings.isFormulaFieldColumn(), true);
});

test("falls back to the default treatment for an unknown stored style", () => {
  stubSetting("chart");
  assert.equal(ModuleSettings.getFormulaFieldStyle(), "expand");
});

test("resolves each treatment to exactly one predicate", () => {
  for (const style of ModuleSettings.FORMULA_FIELD_STYLES) {
    stubSetting(style);
    const active = [
      ModuleSettings.isFormulaFieldExpandable(),
      ModuleSettings.isFormulaFieldPopup(),
      ModuleSettings.isFormulaFieldSingle(),
      ModuleSettings.isFormulaFieldColumn()
    ].filter(Boolean);
    assert.equal(active.length, 1, `${style} should match a single predicate`);
  }
});

test("offers only the numeric roll-data leaves as formula variables", () => {
  const actor = {
    getRollData: () => ({
      abilities: { str: { mod: 3, label: "Strength" } },
      attributes: { prof: 2, hp: { max: 24, formula: "1d8" } },
      details: { level: 5 }
    })
  };

  const { all, suggested } = RollDataVariableRegistry.build(actor);

  assert.deepEqual(all.map(variable => variable.name), [
    "@abilities.str.mod",
    "@attributes.hp.max",
    "@attributes.prof",
    "@details.level"
  ]);
  assert.deepEqual(suggested.map(variable => variable.name), [
    "@abilities.str.mod",
    "@attributes.prof",
    "@details.level",
    "@attributes.hp.max"
  ]);
});

test("survives an effect that has no actor", () => {
  const { all, suggested, rollData } = RollDataVariableRegistry.build(null);

  assert.deepEqual(all, []);
  assert.deepEqual(suggested, []);
  assert.deepEqual(rollData, {});
});

test("inserts a variable at the cursor and spaces it from the previous token", () => {
  const textarea = createTextarea({ value: "2d6 +", selectionStart: 5 });

  FormulaEditorDialog.insertAtCursor(textarea, "@abilities.str.mod");

  assert.equal(textarea.value, "2d6 +@abilities.str.mod");
});

test("adds a separating space when the cursor follows a bare token", () => {
  const textarea = createTextarea({ value: "2d6", selectionStart: 3 });

  FormulaEditorDialog.insertAtCursor(textarea, "@details.level");

  assert.equal(textarea.value, "2d6 @details.level");
  assert.equal(textarea.selectionStart, 18);
});

test("replaces the current selection", () => {
  const textarea = createTextarea({ value: "2d6 + @wrong", selectionStart: 6 });
  textarea.selectionEnd = 12;

  FormulaEditorDialog.insertAtCursor(textarea, "@attributes.prof");

  assert.equal(textarea.value, "2d6 + @attributes.prof");
});
