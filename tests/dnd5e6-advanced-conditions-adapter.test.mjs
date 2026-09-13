import assert from "node:assert/strict";
import test from "node:test";

class FakeApplication {
  static DEFAULT_OPTIONS = {};
  constructor(options) { this.options = options; }
  render() {}
}

function getProperty(object, path) {
  return path.split(".").reduce((value, key) => value?.[key], object);
}

function setProperty(object, path, value) {
  const parts = path.split(".");
  const key = parts.pop();
  let target = object;
  for (const part of parts) target = target[part] ??= {};
  if (key.startsWith("-=")) delete target[key.slice(2)];
  else target[key] = value;
}

globalThis.foundry = {
  applications: { api: { ApplicationV2: FakeApplication, HandlebarsApplicationMixin: Base => Base } },
  utils: {
    deepClone: structuredClone,
    getProperty,
    setProperty,
    mergeObject: (left, right) => ({ ...left, ...right })
  }
};
globalThis.game = {
  system: { id: "dnd5e", version: "6.0.0" },
  release: { generation: 14 },
  modules: new Map()
};

const { Dnd5e6AdvancedConditionsAdapter: Adapter } = await import(
  "../scripts/applications/Dnd5e6AdvancedConditionsAdapter.js"
);

const ORIGINAL = '{"k":"attributes.hp.value","o":"lt","v":10}';
const EDITED = '{"k":"attributes.hp.value","o":"lt","v":20}';
const ADVANCED_PATH = "flags.sc-conditional-ae.changeConditions.first";

function createEffect() {
  const source = { conditions: ORIGINAL, changes: [
    { _id: "first", key: "system.a", value: "1", conditions: ORIGINAL },
    { _id: "second", key: "system.b", value: "2", conditions: ORIGINAL }
  ] };
  return {
    system: { ...structuredClone(source), _source: source },
    flags: { "sc-conditional-ae": { changeConditions: { first: "return true;" } } },
    updates: [],
    getFlag(moduleId, key) { return this.flags[moduleId]?.[key]; },
    async update(update) {
      this.updates.push(structuredClone(update));
      for (const [path, value] of Object.entries(update)) {
        setProperty(this, path, value);
        if (path.startsWith("system.")) setProperty(this.system._source, path.slice(7), structuredClone(value));
      }
    }
  };
}

test("saving from a change dialog persists both layers and preserves other drafts and sibling filters", async () => {
  const effect = createEffect();
  const input = { value: ORIGINAL };
  const otherDrafts = { key: "system.unsaved", value: "99" };
  const dialog = { conditions: input, ...otherDrafts };
  const editor = Adapter.openEditor({ effect, changeId: "first", input });

  await editor.options.onSave({ nativeValue: EDITED, advancedValue: "return false;" });

  assert.equal(effect.updates.length, 1);
  assert.equal(effect.system._source.changes[0].conditions, EDITED);
  assert.equal(getProperty(effect, ADVANCED_PATH), "return false;");
  assert.equal(effect.system._source.changes[1].conditions, ORIGINAL);
  assert.equal(effect.system._source.changes[0].key, "system.a");
  assert.equal(effect.system._source.changes[0].value, "1");
  assert.equal(dialog.key, otherDrafts.key);
  assert.equal(dialog.value, otherDrafts.value);
  assert.equal(input.value, EDITED);

  // Reopening from the summary reads the persisted native filter immediately,
  // without depending on a second submit from the change dialog.
  const reopened = Adapter.openEditor({ effect, changeId: "first" });
  assert.equal(reopened.options.nativeValue, EDITED);
  assert.equal(reopened.options.advancedValue, "return false;");

  // The native dialog's later merge must not restore the previous filter.
  const changes = structuredClone(effect.system._source.changes);
  Object.assign(changes[0], otherDrafts, { conditions: input.value });
  await effect.update({ "system.changes": changes });
  assert.equal(effect.system._source.changes[0].conditions, EDITED);
});

test("saving from the summary persists both layers and supports clearing them", async () => {
  const effect = createEffect();
  const editor = Adapter.openEditor({ effect, changeId: "first" });
  await editor.options.onSave({ nativeValue: "{}", advancedValue: "" });
  assert.equal(effect.system._source.changes[0].conditions, "{}");
  assert.equal(getProperty(effect, ADVANCED_PATH), undefined);
  assert.equal(effect.system._source.changes[1].conditions, ORIGINAL);
});

test("failed saves leave the parent dialog and stored conditions unchanged", async () => {
  const effect = createEffect();
  effect.update = async () => { throw new Error("Update rejected"); };
  const input = { value: ORIGINAL };
  const editor = Adapter.openEditor({ effect, changeId: "first", input });
  await assert.rejects(editor.options.onSave({ nativeValue: EDITED, advancedValue: "" }), /Update rejected/);
  assert.equal(input.value, ORIGINAL);
  assert.equal(effect.system._source.changes[0].conditions, ORIGINAL);
  assert.equal(getProperty(effect, ADVANCED_PATH), "return true;");
});

test("a deleted change cannot be recreated by a conditions editor left open", async () => {
  const effect = createEffect();
  const editor = Adapter.openEditor({ effect, changeId: "first" });
  effect.system._source.changes.shift();
  await assert.rejects(editor.options.onSave({ nativeValue: EDITED, advancedValue: "" }), /stable ID/);
  assert.equal(effect.updates.length, 0);
});
