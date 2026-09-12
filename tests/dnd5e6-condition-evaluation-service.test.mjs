import assert from "node:assert/strict";
import test from "node:test";

function getProperty(object, path) {
  return String(path ?? "").split(".").filter(Boolean).reduce((value, key) => value?.[key], object);
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
class FakeFilter {
  constructor(definition) {
    this.definition = definition;
  }
  check(data) {
    if (!Object.keys(this.definition).length) return true;
    if ((this.definition.o ?? "exact") === "exact") {
      return getProperty(data, this.definition.k) === this.definition.v;
    }
    return getProperty(data, this.definition.k) > this.definition.v;
  }
  some(callback) {
    return Object.keys(this.definition).length ? callback(this.definition) : false;
  }
}

globalThis.CONFIG = {
  Actor: { documentClass: FakeActor },
  Item: { documentClass: FakeItem },
  ActiveEffect: { documentClass: FakeActiveEffect, changeTypes: {} }
};
globalThis.CONST = { ACTIVE_EFFECT_MODES: { CUSTOM: 0 } };
globalThis.foundry = {
  utils: {
    deepClone: value => structuredClone(value),
    getProperty,
    hasProperty: (object, path) => getProperty(object, path) !== undefined
  }
};
globalThis.game = {
  system: { id: "dnd5e", version: "6.0.0" },
  modules: new Map([["dae", { active: false }]]),
  settings: { get: () => false },
  user: { id: "user" }
};
globalThis.canvas = { tokens: { placeables: [] } };
globalThis.dnd5e = { Filter: { Filter: FakeFilter } };

const { Dnd5e6ConditionEvaluationService: Service } = await import(
  "../scripts/applications/Dnd5e6ConditionEvaluationService.js"
);

function createEffect() {
  const actor = new FakeActor();
  return {
    parent: actor,
    system: {
      changes: [{ _id: "first", key: "system.test", conditions: new FakeFilter({}) }],
      conditions: new FakeFilter({})
    },
    flags: { "sc-conditional-ae": { changeConditions: {} } },
    getFlag(moduleId, key) { return this.flags[moduleId]?.[key]; },
    getReplacementData(data) { return data; },
    toObject() { return { flags: this.flags }; }
  };
}

test("combines native and advanced draft conditions with AND", () => {
  const evaluation = Service.evaluate({
    effect: createEffect(),
    nativeCode: JSON.stringify({ k: "attributes.hp.value", o: "gt", v: 4 }),
    advancedCode: "return actor.system.attributes.hp.value < 10;"
  });
  assert.equal(evaluation.native.state, "pass");
  assert.equal(evaluation.advanced.state, "pass");
  assert.equal(evaluation.combined.state, "pass");
});

test("marks native roll conditions as contextual outside a roll", () => {
  const evaluation = Service.evaluate({
    effect: createEffect(),
    nativeCode: JSON.stringify({ k: "roll.type", o: "exact", v: "attack" }),
    advancedCode: "return true;"
  });
  assert.equal(evaluation.native.state, "contextual");
  assert.equal(evaluation.combined.state, "contextual");
});

test("evaluates native roll conditions when explicit roll context is supplied", async () => {
  const { Dnd5e6ChangeConditionService } = await import(
    "../scripts/services/Dnd5e6ChangeConditionService.js"
  );
  const effect = createEffect();
  effect.system.changes[0].conditions = new FakeFilter({
    k: "roll.type",
    o: "exact",
    v: "attack"
  });

  const passing = Dnd5e6ChangeConditionService.summarize(effect, {
    nativeData: { roll: { type: "attack" } }
  });
  const failing = Dnd5e6ChangeConditionService.summarize(effect, {
    nativeData: { roll: { type: "save" } }
  });

  assert.equal(passing.changes[0].native.state, "pass");
  assert.equal(passing.changes[0].state, "pass");
  assert.equal(failing.changes[0].native.state, "fail");
  assert.equal(failing.changes[0].state, "fail");
});

test("a definite advanced failure wins over contextual native data", () => {
  const evaluation = Service.evaluate({
    effect: createEffect(),
    nativeCode: JSON.stringify({ k: "roll.type", o: "exact", v: "attack" }),
    advancedCode: "return false;"
  });
  assert.equal(evaluation.advanced.state, "fail");
  assert.equal(evaluation.combined.state, "fail");
});

test("individual drafts use the composed dnd5e 6 change evaluator", () => {
  const evaluation = Service.evaluate({
    effect: createEffect(),
    changeId: "first",
    nativeCode: JSON.stringify({ k: "attributes.hp.value", o: "gt", v: 4 }),
    advancedCode: "return changeId === 'first' && change.key === 'system.test';"
  });
  assert.equal(evaluation.nativeGlobal.state, "pass");
  assert.equal(evaluation.advancedGlobal.state, "pass");
  assert.equal(evaluation.native.state, "pass");
  assert.equal(evaluation.advanced.state, "pass");
  assert.equal(evaluation.combined.state, "pass");
});
