import assert from "node:assert/strict";
import test from "node:test";

function getProperty(object, path) {
  return String(path ?? "").split(".").filter(Boolean)
    .reduce((value, key) => value?.[key], object);
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

class FakeActor {
  constructor() {
    this.system = { attributes: { hp: { value: 8 } } };
  }

  getRollData() {
    return { attributes: this.system.attributes };
  }
}

class FakeItem {}
class FakeActiveEffect {}

globalThis.CONFIG = {
  Actor: { documentClass: FakeActor },
  Item: { documentClass: FakeItem },
  ActiveEffect: { documentClass: FakeActiveEffect, changeTypes: {} },
  Macro: { documentClass: class FakeMacro {} }
};
globalThis.CONST = { ACTIVE_EFFECT_MODES: { CUSTOM: 0 } };
globalThis.foundry = {
  utils: {
    deepClone: value => structuredClone(value),
    expandObject,
    getProperty,
    hasProperty: (object, path) => getProperty(object, path) !== undefined,
    isEmpty: object => !object || Object.keys(object).length === 0,
    setProperty
  }
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

const { Dnd5e6ChangeConditionService: Service } = await import(
  "../scripts/services/Dnd5e6ChangeConditionService.js"
);
const { ActiveEffectMacroChangeService } = await import(
  "../scripts/services/ActiveEffectMacroChangeService.js"
);
const { ActiveEffectFormulaChangeService } = await import(
  "../scripts/services/ActiveEffectFormulaChangeService.js"
);

function createEffect({ globalCode = "", changeConditions = {} } = {}) {
  const actor = new FakeActor();
  const changes = [
    { _id: "first", key: "system.first", conditions: null },
    { _id: "second", key: "system.second", conditions: null }
  ];
  const effect = {
    id: "effect",
    uuid: "Actor.actor.ActiveEffect.effect",
    parent: actor,
    system: { changes, conditions: null },
    flags: { "sc-conditional-ae": { condition: globalCode, changeConditions } },
    getFlag(moduleId, key) {
      return this.flags[moduleId]?.[key];
    },
    getReplacementData(data) {
      return data;
    },
    toObject() {
      return structuredClone({
        system: {
          changes: this.system.changes.map(({ _id, key }) => ({ _id, key }))
        },
        flags: this.flags
      });
    }
  };
  effect.changes = changes;
  return effect;
}

test("stores advanced change conditions by stable change ID", () => {
  const effect = createEffect({
    changeConditions: { first: "return true;", second: "return false;", orphan: "return true;" }
  });

  effect.system.changes.reverse();
  assert.equal(Service.getCondition(effect, effect.system.changes[1]), "return true;");
  assert.equal(Service.getCondition(effect, "second"), "return false;");
  assert.deepEqual(Service.pruneOrphanedConditions(effect), {
    first: "return true;",
    second: "return false;"
  });
  // Foundry merges flag objects, so a cleared or orphaned entry has to be an
  // explicit deletion key; writing the pruned map alone would leave both behind.
  assert.deepEqual(Service.buildUpdate(effect, "first", ""), {
    "flags.sc-conditional-ae.changeConditions.-=first": null,
    "flags.sc-conditional-ae.changeConditions.-=orphan": null,
    "flags.sc-conditional-ae.changeConditions.second": "return false;"
  });
  assert.deepEqual(Service.buildUpdate(effect, "first", "return true;"), {
    "flags.sc-conditional-ae.changeConditions.-=orphan": null,
    "flags.sc-conditional-ae.changeConditions.first": "return true;",
    "flags.sc-conditional-ae.changeConditions.second": "return false;"
  });
});

test("ignores orphaned condition flags after a native change is deleted", () => {
  const effect = createEffect({
    changeConditions: { orphan: "return lightLevel === 'dark';" }
  });

  assert.equal(Service.hasAnyCondition(effect), false);
  assert.equal(Service.usesLightingContext(effect), false);
});

test("evaluates individual code with change, changeId, token, and lightLevel context", () => {
  const effect = createEffect({
    changeConditions: {
      first: "return change.key === 'system.first' && changeId === 'first' && token.id === 't1' && lightLevel === 'dim';"
    }
  });

  const evaluation = Service.evaluate(effect, "first", {
    token: { id: "t1" },
    lightLevel: "dim"
  });
  assert.equal(evaluation.available, true);
  assert.equal(evaluation.state, "pass");
  assert.equal(Service.usesLightingContext(effect), true);
  assert.equal(Service.usesTokenContext(effect), true);
});

test("composes native and SC global/change diagnostics with AND", () => {
  const effect = createEffect({
    globalCode: "return actor.system.attributes.hp.value > 0;",
    changeConditions: { first: "return false;" }
  });
  effect.system.conditions = { check: () => true };
  effect.system.changes[0].conditions = { check: () => true };

  const summary = Service.summarize(effect);
  assert.equal(summary.effect.native.state, "pass");
  assert.equal(summary.effect.advanced.state, "pass");
  assert.equal(summary.changes[0].native.state, "pass");
  assert.equal(summary.changes[0].advanced.state, "fail");
  assert.equal(summary.changes[0].state, "fail");
  assert.equal(summary.combined.state, "fail");
  assert.equal(summary.combined.available, false);
});

test("reports roll-dependent native filters as indeterminate without roll context", () => {
  const effect = createEffect();
  effect.system.changes[0].conditions = {
    toJSON: () => ({ k: "roll.type", o: "exact", v: "attack" }),
    check: () => false
  };

  const pending = Service.summarize(effect);
  assert.equal(pending.changes[0].native.state, "contextual");
  assert.equal(pending.changes[0].state, "contextual");
  assert.equal(pending.combined.available, null);

  const contextual = Service.summarize(effect, { nativeData: { roll: { type: "attack" } } });
  assert.equal(contextual.changes[0].native.state, "fail");
  assert.equal(contextual.combined.available, false);
});

test("diagnostics ignore native filters for dnd5e change types that skip conditions", () => {
  class NativeFilter {
    constructor(definition) {
      this.definition = definition;
    }
    check() { return false; }
    toJSON() { return this.definition; }
  }
  const effect = createEffect({ changeConditions: { first: "return true;" } });
  effect.system.changes[0].type = "dnd5e.bonus";
  effect.system.changes[0].conditions = new NativeFilter({ k: "attributes.hp.value", o: "gt", v: 100 });
  CONFIG.ActiveEffect.changeTypes["dnd5e.bonus"] = { skipConditions: true };

  try {
    const summary = Service.summarize(effect);
    assert.equal(summary.changes[0].native.configured, false);
    assert.equal(summary.changes[0].native.state, "pass");
    assert.equal(summary.changes[0].state, "pass");

    const draft = Service.evaluateCombinedCode(effect, "first", {
      nativeChangeCode: JSON.stringify({ k: "attributes.hp.value", o: "gt", v: 100 }),
      scChangeCode: "return true;"
    });
    assert.equal(draft.nativeChange.state, "pass");
    assert.equal(draft.combined.state, "pass");
  } finally {
    delete CONFIG.ActiveEffect.changeTypes["dnd5e.bonus"];
  }
});

test("does not enable per-change storage or evaluation on dnd5e 5.3", () => {
  const effect = createEffect({ changeConditions: { first: "return false;" } });
  game.system.version = "5.3.3";
  try {
    assert.equal(Service.isSupported(), false);
    assert.equal(Service.getCondition(effect, "first"), "");
    assert.equal(Service.hasAnyCondition(effect), false);
    assert.equal(Service.evaluate(effect, "first").available, true);
  } finally {
    game.system.version = "6.0.0";
  }
});

test("a blanket sweep skips a false individual condition, which owns its own off", async () => {
  const calls = [];
  const macro = { execute: async scope => calls.push(scope.action) };
  game.macros = {
    get: reference => reference === "cleanup" ? macro : null,
    getName: () => null
  };
  const effect = createEffect({ changeConditions: { first: "return false;" } });
  delete effect.changes;
  effect.system.changes[0].key = "cae.macro.execute";
  effect.system.changes[0].value = "cleanup";

  // Neither sweep may fire: the change's own transition already ran its off, so
  // an effect-wide off here would clean up a second time.
  await ActiveEffectMacroChangeService.execute(effect, "on");
  await ActiveEffectMacroChangeService.execute(effect, "off");
  assert.deepEqual(calls, []);

  // Naming the change is how the transition handler asks for that cleanup, and
  // it still runs even though the condition now reads false.
  await ActiveEffectMacroChangeService.execute(effect, "off", { changeIds: ["first"] });
  assert.deepEqual(calls, ["off"]);
});

test("macro normalization uses the dnd5e 6 string change type", () => {
  const source = {
    system: { changes: [{ _id: "macro", key: "cae.macro.execute", type: "add", value: "test" }] }
  };

  assert.equal(ActiveEffectMacroChangeService.normalizeChanges(source), true);
  assert.equal(source.system.changes[0].type, "custom");
  assert.equal(source.system.changes[0].mode, undefined);
});

test("macro execution can target only changes whose individual state transitioned", async () => {
  const calls = [];
  game.macros = {
    get: reference => ({ execute: async () => calls.push(reference) }),
    getName: () => null
  };
  const effect = createEffect({
    changeConditions: { first: "return true;", second: "return true;" }
  });
  effect.system.changes[0].key = "cae.macro.execute";
  effect.system.changes[0].value = "firstMacro";
  effect.system.changes[1].key = "cae.macro.execute";
  effect.system.changes[1].value = "secondMacro";

  await ActiveEffectMacroChangeService.execute(effect, "on", { changeIds: ["second"] });

  assert.deepEqual(calls, ["secondMacro"]);
});

test("dnd5e 5.3 macro execution ignores v6-only individual condition flags", async () => {
  const calls = [];
  game.macros = {
    get: reference => reference === "legacy" ? { execute: async scope => calls.push(scope.action) } : null,
    getName: () => null
  };
  const effect = createEffect({ changeConditions: { first: "return false;" } });
  effect.changes[0].key = "cae.macro.execute";
  effect.changes[0].value = "legacy";
  game.system.version = "5.3.3";
  try {
    await ActiveEffectMacroChangeService.execute(effect, "on");
  } finally {
    game.system.version = "6.0.0";
  }

  assert.deepEqual(calls, ["on"]);
});

test("formula rolling skips entries whose individual condition is false", async () => {
  const effect = createEffect({ changeConditions: { first: "return false;" } });
  effect.flags["sc-conditional-ae"].formulaChanges = {
    0: { key: "system.first", formula: "1d6" }
  };

  const changed = await ActiveEffectFormulaChangeService.rollFormulaChanges(effect);

  assert.equal(changed, false);
});

test("formula metadata reads change keys and values from system.changes on dnd5e 6", () => {
  const effect = createEffect();
  delete effect.changes;
  effect.system.changes[0].value = "3";
  effect.flags["sc-conditional-ae"].formulaChanges = {
    0: { formula: "1d6" }
  };

  assert.deepEqual(ActiveEffectFormulaChangeService.getFormulaChangeEntries(effect), [{
    index: 0,
    storageKey: "0",
    storedIndex: 0,
    changeId: "",
    key: "system.first",
    formula: "1d6",
    currentValue: "3",
    drifted: false
  }]);
});

test("reordering the changes keeps each formula on its own change", () => {
  const effect = createEffect();
  delete effect.changes;
  effect.system.changes[0].value = "3";
  effect.system.changes[1].value = "9";
  effect.flags["sc-conditional-ae"].formulaChanges = {
    0: { formula: "1d6", key: "system.first" },
    1: { formula: "2d8", key: "system.second" }
  };

  // The stored position is only a hint; the key is what binds.
  effect.system.changes.reverse();
  const entries = ActiveEffectFormulaChangeService.getFormulaChangeEntries(effect);

  assert.deepEqual(entries.map(entry => [entry.key, entry.formula, entry.index, entry.drifted]), [
    ["system.second", "2d8", 0, true],
    ["system.first", "1d6", 1, true]
  ]);
  assert.equal(entries[0].currentValue, "9");
  assert.equal(entries[1].currentValue, "3");
});

test("stable change ids disambiguate reordered formulas with duplicate keys", () => {
  const effect = createEffect();
  delete effect.changes;
  effect.system.changes[0].key = "system.shared";
  effect.system.changes[0].value = "first-value";
  effect.system.changes[1].key = "system.shared";
  effect.system.changes[1].value = "second-value";
  effect.flags["sc-conditional-ae"].formulaChanges = {
    0: { formula: "1d6", key: "system.shared", changeId: "first" },
    1: { formula: "2d8", key: "system.shared", changeId: "second" }
  };

  effect.system.changes.reverse();
  const entries = ActiveEffectFormulaChangeService.getFormulaChangeEntries(effect);

  assert.deepEqual(entries.map(entry => [entry.changeId, entry.formula, entry.index, entry.currentValue]), [
    ["second", "2d8", 0, "second-value"],
    ["first", "1d6", 1, "first-value"]
  ]);
  assert.equal(ActiveEffectFormulaChangeService.getFormulaForChange(effect, "first"), "1d6");
  assert.equal(ActiveEffectFormulaChangeService.getFormulaForChange(effect, "second"), "2d8");
});

test("deleting one of two same-key changes only orphans its own id-bound formula", () => {
  const effect = createEffect();
  delete effect.changes;
  effect.system.changes[0].key = "system.shared";
  effect.system.changes[1].key = "system.shared";
  effect.flags["sc-conditional-ae"].formulaChanges = {
    0: { formula: "1d6", key: "system.shared", changeId: "first" },
    1: { formula: "2d8", key: "system.shared", changeId: "second" }
  };

  effect.system.changes.splice(0, 1);

  assert.deepEqual(
    ActiveEffectFormulaChangeService.getFormulaChangeEntries(effect)
      .map(entry => [entry.changeId, entry.formula, entry.index]),
    [["second", "2d8", 0]]
  );
  assert.deepEqual(
    ActiveEffectFormulaChangeService.getOrphanedFormulaChanges(effect)
      .map(entry => [entry.changeId, entry.formula]),
    [["first", "1d6"]]
  );
});

test("preparing reordered v6 changes persists each formula with its stable change id", () => {
  const effect = createEffect();
  delete effect.changes;
  effect.system.changes[0].key = "system.shared";
  effect.system.changes[1].key = "system.shared";
  effect.flags["sc-conditional-ae"].formulaChanges = {
    0: { formula: "1d6", key: "system.shared", changeId: "first" },
    1: { formula: "2d8", key: "system.shared", changeId: "second" }
  };
  const reversed = structuredClone(effect.system.changes).reverse();
  const updates = { "system.changes": reversed };

  ActiveEffectFormulaChangeService.prepareUpdateSource(effect, updates, {});

  assert.deepEqual(getProperty(updates, "flags.sc-conditional-ae.formulaChanges"), {
    0: { formula: "2d8", key: "system.shared", changeId: "second" },
    1: { formula: "1d6", key: "system.shared", changeId: "first" }
  });
});

test("deleting a change orphans its formula instead of moving it onto a neighbour", () => {
  const effect = createEffect();
  delete effect.changes;
  effect.flags["sc-conditional-ae"].formulaChanges = {
    0: { formula: "1d6", key: "system.first" },
    1: { formula: "2d8", key: "system.second" }
  };

  effect.system.changes.splice(0, 1);

  assert.deepEqual(
    ActiveEffectFormulaChangeService.getFormulaChangeEntries(effect)
      .map(entry => [entry.key, entry.index]),
    [["system.second", 0]]
  );
  assert.deepEqual(
    ActiveEffectFormulaChangeService.getOrphanedFormulaChanges(effect).map(entry => entry.key),
    ["system.first"]
  );
});

test("a formula stored without a key still binds to its position", () => {
  const effect = createEffect();
  delete effect.changes;
  effect.flags["sc-conditional-ae"].formulaChanges = { 1: { formula: "1d4" } };

  const [entry] = ActiveEffectFormulaChangeService.getFormulaChangeEntries(effect);
  assert.equal(entry.index, 1);
  assert.equal(entry.key, "system.second");
  assert.equal(entry.drifted, false);
});

test("formula reapplication writes rolled values back through system.changes on dnd5e 6", () => {
  const effect = createEffect();
  delete effect.changes;
  effect.disabled = true;
  effect.system.changes[0].value = "9";
  effect.flags["sc-conditional-ae"].formulaChanges = {
    0: { key: "system.first", formula: "1d6" }
  };
  const updates = { disabled: false };

  ActiveEffectFormulaChangeService.prepareUpdateSource(effect, updates, {
    "sc-conditional-ae": { formulaReapplyUpdate: true }
  });

  assert.equal(updates["system.changes"][0].value, "0");
  assert.equal(updates.changes, undefined);
});

test("pending formula reapplication survives microtasks until preUpdate consumes it", async () => {
  const effect = createEffect();
  delete effect.changes;
  effect.disabled = false;
  effect.system.changes[0].value = "9";
  effect.flags["sc-conditional-ae"].formulaChanges = {
    0: { key: "system.first", formula: "1d6", changeId: "first" }
  };

  ActiveEffectFormulaChangeService.markReapplication(effect.id);
  await Promise.resolve();
  await Promise.resolve();
  const updates = { disabled: false };
  ActiveEffectFormulaChangeService.prepareUpdateSource(effect, updates, {});

  assert.equal(updates["system.changes"][0].value, "0");

  const secondUpdates = { disabled: false };
  ActiveEffectFormulaChangeService.prepareUpdateSource(effect, secondUpdates, {});
  assert.equal(secondUpdates["system.changes"], undefined);
});

test("summarize reports the effect and every conditioned change layer by layer", () => {
  const effect = createEffect({
    globalCode: "return actor.system.attributes.hp.value > 0;",
    changeConditions: { second: "return false;" }
  });
  effect.system.conditions = { check: () => true };
  effect.system.changes[0].conditions = { check: () => false };

  const summary = Service.summarize(effect);

  assert.equal(summary.supported, true);
  assert.equal(summary.effect.state, "pass");
  assert.equal(summary.effect.native.state, "pass");
  assert.equal(summary.effect.advanced.state, "pass");

  const [first, second] = summary.changes;
  assert.equal(first.changeId, "first");
  assert.equal(first.key, "system.first");
  assert.equal(first.native.state, "fail");
  assert.equal(first.advanced.configured, false);
  assert.equal(first.state, "fail");

  assert.equal(second.changeId, "second");
  assert.equal(second.native.configured, false);
  assert.equal(second.advanced.state, "fail");
  assert.equal(second.state, "fail");

  assert.equal(summary.combined.state, "fail");
  assert.deepEqual(summary.totals, {
    total: 3, pass: 1, fail: 2, error: 0, contextual: 0, configured: 3, syntaxError: 0
  });
});

test("summarize flags a change condition that does not compile as a syntax error", () => {
  const effect = createEffect({ changeConditions: { first: "return (" } });

  const summary = Service.summarize(effect);
  const [first, second] = summary.changes;

  assert.equal(first.syntaxError, true);
  assert.equal(first.state, "error");
  assert.ok(first.message.length > 0);
  assert.equal(second.configured, false);
  assert.equal(second.syntaxError, false);
  assert.equal(summary.totals.syntaxError, 1);
  assert.equal(summary.combined.state, "error");
});

test("summarize leaves an unconditioned effect entirely passing", () => {
  const summary = Service.summarize(createEffect());

  assert.equal(summary.effect.configured, false);
  assert.equal(summary.changes.every(entry => !entry.configured), true);
  assert.equal(summary.combined.state, "pass");
  assert.equal(summary.totals.configured, 0);
});

test("summarize reports nothing on dnd5e 5.3, where per-change conditions do not exist", () => {
  const effect = createEffect({ changeConditions: { first: "return false;" } });
  game.system.version = "5.3.3";
  try {
    const summary = Service.summarize(effect);
    assert.equal(summary.supported, false);
    assert.deepEqual(summary.changes, []);
    assert.equal(summary.combined, null);
  } finally {
    game.system.version = "6.0.0";
  }
});

test("per-change conditions stay enabled on a dnd5e major after 6", () => {
  const effect = createEffect({ changeConditions: { first: "return false;" } });
  game.system.version = "7.0.0";
  try {
    // A gate spelled `=== 6` here while the changes-path helper used `>= 6`
    // would silently stop gating every conditioned change on the next major.
    assert.equal(Service.isSupported(), true);
    assert.equal(Service.hasAnyCondition(effect), true);
    assert.equal(Service.evaluate(effect, "first").available, false);
  } finally {
    game.system.version = "6.0.0";
  }
});

test("a native filter only counts as roll-dependent when a key reads roll.*", () => {
  assert.equal(Service.usesRollData({ k: "roll.type", o: "exact", v: "attack" }), true);
  assert.equal(Service.usesRollData({ o: "AND", v: [{ k: "attributes.hp.value", o: "gt", v: 0 }] }), false);
  // A literal value that merely looks like a roll path is not roll context.
  assert.equal(Service.usesRollData({ k: "flags.module.path", o: "exact", v: "roll.type" }), false);
  assert.equal(Service.usesRollData({ toJSON: () => ({ o: "NOT", v: { k: "roll.d20", o: "gte", v: 10 } }) }), true);
});

test("a false native filter blocks the change, not only the SC condition", () => {
  const effect = createEffect();
  effect.system.changes[0].conditions = { check: () => false };

  // dnd5e enforces its own filter when it applies a change, but macros and
  // formulas are ours to run, so the gate has to see the native layer too.
  assert.equal(Service.isChangeAllowed(effect, "first"), false);
  assert.equal(Service.isChangeAllowed(effect, "second"), true);
});

test("a false native effect filter blocks every change of the effect", () => {
  const effect = createEffect();
  effect.system.conditions = { check: () => false };

  assert.equal(Service.isEffectAllowed(effect), false);
  assert.equal(Service.isChangeAllowed(effect, "first"), false);
});

test("a roll-context native filter fails closed until roll data is supplied", () => {
  const effect = createEffect();
  effect.system.conditions = {
    toJSON: () => ({ k: "roll.type", o: "exact", v: "attack" }),
    check: data => data.roll?.type === "attack"
  };
  effect.system.changes[0].conditions = {
    toJSON: () => ({ k: "roll.critical", o: "exact", v: true }),
    check: data => data.roll?.critical === true
  };

  assert.equal(Service.isEffectAllowed(effect), false);
  assert.equal(Service.isChangeAllowed(effect, "first"), false);
  assert.equal(Service.isEffectAllowed(effect, { nativeData: { roll: { type: "attack" } } }), true);
  assert.equal(Service.isChangeAllowed(effect, "first", {
    nativeData: { roll: { type: "attack", critical: true } }
  }), true);
});

test("an erroring SC condition blocks its change without blocking its siblings", () => {
  const effect = createEffect({ changeConditions: { first: "return (" } });

  assert.equal(Service.isEffectAllowed(effect), true);
  assert.equal(Service.isChangeAllowed(effect, "first"), false);
  assert.equal(Service.isChangeAllowed(effect, "second"), true);
});

test("an in-place save writes where the formula is stored, not where the change moved to", () => {
  const effect = createEffect();
  delete effect.changes;
  effect.flags["sc-conditional-ae"].formulaChanges = {
    0: { formula: "1d6", key: "system.first" },
    1: { formula: "2d8", key: "system.second" }
  };
  effect.system.changes.reverse();

  // "system.first" now sits at position 1 but is still stored under 0. Writing
  // at its current position would leave the old entry behind as a second copy.
  assert.equal(ActiveEffectFormulaChangeService.getFormulaStorageIndex(effect, 1), 0);
  assert.equal(ActiveEffectFormulaChangeService.getFormulaStorageIndex(effect, 0), 1);
  assert.equal(ActiveEffectFormulaChangeService.getFormulaForChange(effect, 1), "1d6");
});

test("an unbound position keeps its own index as the storage slot", () => {
  const effect = createEffect();
  delete effect.changes;

  assert.equal(ActiveEffectFormulaChangeService.getFormulaStorageIndex(effect, 1), 1);
  assert.equal(ActiveEffectFormulaChangeService.getFormulaForChange(effect, 1), "");
});

test("the editor reads the stored native filter text for the effect and for a change", () => {
  const effect = createEffect();
  effect.system._source = {
    conditions: '{"k":"attributes.hp.value","o":"gt","v":0}',
    changes: [
      { _id: "first", conditions: '{"k":"statuses","o":"has","v":"prone"}' },
      { _id: "second", conditions: "" }
    ]
  };

  assert.equal(Service.getNativeConditionSource(effect), '{"k":"attributes.hp.value","o":"gt","v":0}');
  assert.equal(Service.getNativeConditionSource(effect, "first"), '{"k":"statuses","o":"has","v":"prone"}');
  // An empty filter opens as the empty object the builder understands.
  assert.equal(Service.getNativeConditionSource(effect, "second"), "{}");
  assert.equal(Service.getNativeConditionSource(effect, "missing"), "{}");
});

test("saving from the Condition tab writes both layers of a change in one update", () => {
  const effect = createEffect({ changeConditions: { first: "return true;" } });
  delete effect.changes;
  effect.system._source = {
    changes: effect.system.changes.map(change => ({
      ...structuredClone(change),
      conditions: change._id === "first"
        ? '{"k":"attributes.hp.value","o":"gt","v":0}'
        : "{}"
    }))
  };

  const update = Service.buildChangeConditionsUpdate(effect, "second", {
    nativeValue: '{"k":"statuses","o":"has","v":"prone"}',
    advancedValue: "return false;"
  });

  // No change dialog holds the native field here, so it goes to the document
  // alongside the SC condition instead of waiting for a submit that never comes.
  assert.equal(update["system.changes"][1].conditions, '{"k":"statuses","o":"has","v":"prone"}');
  assert.equal(
    update["system.changes"][0].conditions,
    '{"k":"attributes.hp.value","o":"gt","v":0}',
    "a sibling's serialized filter is left as it was"
  );
  assert.equal(update["flags.sc-conditional-ae.changeConditions.second"], "return false;");
  assert.equal(update["flags.sc-conditional-ae.changeConditions.first"], "return true;");
});

test("saving a change that no longer exists fails loudly instead of writing nothing", () => {
  const effect = createEffect();
  assert.throws(
    () => Service.buildChangeConditionsUpdate(effect, "missing", { nativeValue: "{}", advancedValue: "" }),
    /could not be resolved/
  );
});
