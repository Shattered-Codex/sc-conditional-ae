import assert from "node:assert/strict";
import test from "node:test";

function getProperty(object, path) {
  return String(path ?? "").split(".").filter(Boolean).reduce((value, key) => value?.[key], object);
}
function setProperty(object, path, value) {
  const parts = String(path).split(".");
  const property = parts.pop();
  let target = object;
  for (const part of parts) target = target[part] ??= {};
  target[property] = value;
  return true;
}
function expandObject(object) {
  const expanded = {};
  for (const [path, value] of Object.entries(object ?? {})) setProperty(expanded, path, value);
  return expanded;
}
const isPlainObject = v => v && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype;
// Same semantics as foundry.utils.deepClone: class instances are returned as-is.
function deepClone(value) {
  if (typeof value !== "object" || value === null) return value;
  if (Array.isArray(value)) return value.map(deepClone);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, deepClone(v)]));
}

class FakeActor { getRollData() { return {}; } }
globalThis.CONFIG = {
  Actor: { documentClass: FakeActor },
  Item: { documentClass: class {} },
  ActiveEffect: { documentClass: class {}, changeTypes: {} },
  Macro: { documentClass: class {} }
};
globalThis.CONST = { ACTIVE_EFFECT_MODES: { CUSTOM: 0 } };
globalThis.foundry = {
  utils: { deepClone, expandObject, getProperty, setProperty, isPlainObject,
    hasProperty: (o, p) => getProperty(o, p) !== undefined,
    isEmpty: o => !o || Object.keys(o).length === 0 }
};
globalThis.game = {
  system: { id: "dnd5e", version: "6.0.0" },
  modules: new Map([["dae", { active: false }]]),
  macros: { get: () => null, getName: () => null },
  settings: { get: () => false },
  user: { id: "user" }
};
globalThis.canvas = { tokens: { placeables: [] } };
globalThis.ChatMessage = { getSpeaker: () => ({}) };
globalThis.ui = { notifications: { warn() {} } };

const { ActiveEffectFormulaChangeService } = await import("../scripts/services/ActiveEffectFormulaChangeService.js");

/** dnd5e 6 FiltersField.initialize() result: definition lives in a private field. */
class Filter { #definition; constructor(d) { this.#definition = d; } check() { return true; } }
/** foundry JSONField._cast */
const castJson = value => (typeof value === "string" ? value : JSON.stringify(value));

const STORED = '{"o":"AND","v":[{"k":"attributes.hp.value","o":"gte","v":5}]}';

function createEffect() {
  const source = [
    { _id: "aaaaaaaaaaaaaaaa", key: "system.attributes.ac.bonus", type: "add", value: "1d4", conditions: STORED },
    { _id: "bbbbbbbbbbbbbbbb", key: "system.bonuses.mwak.damage", type: "add", value: "2", conditions: STORED }
  ];
  return {
    id: "effect",
    disabled: true,
    parent: new FakeActor(),
    _source: { system: { changes: structuredClone(source) } },
    // Prepared data: FiltersField initializes conditions into Filter instances.
    system: { changes: source.map(c => ({ ...c, conditions: new Filter(JSON.parse(c.conditions)) })) },
    flags: { "sc-conditional-ae": { formulaChanges: { 0: { formula: "1d4", key: "system.attributes.ac.bonus", changeId: "aaaaaaaaaaaaaaaa" } } } },
    getFlag(moduleId, key) { return this.flags[moduleId]?.[key]; }
  };
}

const persistedConditions = updates => (getProperty(updates, "system.changes") ?? updates["system.changes"])
  .map(change => castJson(change.conditions));

test("sheet submit on an effect with a formula keeps every per-change native filter", () => {
  const effect = createEffect();
  // What EffectSheetSubmitDataHandler collects from the formula column inputs.
  const submitData = { flags: { "sc-conditional-ae": { formulaChanges: { 0: { formula: "1d4" } } } } };
  ActiveEffectFormulaChangeService.prepareSubmitData(effect, submitData);
  assert.deepEqual(persistedConditions(submitData), [STORED, STORED]);
});

test("formula reapplication keeps every per-change native filter", () => {
  const effect = createEffect();
  const updates = { disabled: false };
  ActiveEffectFormulaChangeService.prepareUpdateSource(effect, updates, { "sc-conditional-ae": { formulaReapplyUpdate: true } });
  assert.deepEqual(persistedConditions(updates), [STORED, STORED]);
});

test("indexed system.changes submit (core/DAE sheet rows) keeps per-change native filters", () => {
  const effect = createEffect();
  const submitData = {
    system: { changes: { 0: { key: "system.attributes.ac.bonus", type: "add", value: "1d4" }, 1: { key: "system.bonuses.mwak.damage", type: "add", value: "3" } } },
    flags: { "sc-conditional-ae": { formulaChanges: { 0: { formula: "1d4" } } } }
  };
  ActiveEffectFormulaChangeService.prepareSubmitData(effect, submitData);
  assert.deepEqual(persistedConditions(submitData), [STORED, STORED]);
});
