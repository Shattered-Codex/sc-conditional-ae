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

function deleteProperty(object, path) {
  const parts = String(path).split(".");
  const property = parts.pop();
  const target = parts.reduce((value, key) => value?.[key], object);
  return target ? delete target[property] : false;
}

function mergeObject(original, other, { inplace = true, overwrite = true } = {}) {
  const target = inplace ? original : structuredClone(original);
  for (const [key, value] of Object.entries(other ?? {})) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const base = target[key] && typeof target[key] === "object" && !Array.isArray(target[key])
        ? target[key]
        : {};
      target[key] = mergeObject(base, value, { inplace: true, overwrite });
    } else if (overwrite || !(key in target)) {
      target[key] = structuredClone(value);
    }
  }
  return target;
}

class FakeActor {}
class FakeItem {}
class FakeEffect {
  constructor({ applyBehavior = "update", formula = false } = {}) {
    this.id = "source-effect";
    this.uuid = "Item.source.ActiveEffect.source-effect";
    this.name = "Source Effect";
    this.inCompendium = false;
    this.flags = {
      "sc-conditional-ae": {
        applyBehavior,
        condition: "return true;",
        ...(formula ? { formulaChanges: { 0: { formula: "1d6", key: "system.test" } } } : {})
      }
    };
    this.system = {
      changes: [{ _id: "change-1", key: "system.test", type: "add", value: "1" }]
    };
  }

  getFlag(moduleId, key) {
    return this.flags[moduleId]?.[key];
  }

  toObject() {
    return structuredClone({
      _id: this.id,
      name: this.name,
      flags: this.flags,
      system: this.system
    });
  }
}

const hookListeners = new Map();
globalThis.Hooks = {
  once(name, callback) { hookListeners.set(name, callback); },
  on(name, callback) { hookListeners.set(name, callback); }
};
globalThis.CONFIG = {
  Actor: { documentClass: FakeActor },
  Item: { documentClass: FakeItem },
  ActiveEffect: { documentClass: FakeEffect },
  Macro: { documentClass: class FakeMacro {} }
};
globalThis.CONST = { ACTIVE_EFFECT_MODES: { CUSTOM: 0 } };
globalThis.foundry = {
  utils: {
    deepClone: value => structuredClone(value),
    deleteProperty,
    diffObject: (left, right) => JSON.stringify(left) === JSON.stringify(right) ? {} : left,
    getProperty,
    isEmpty: value => !value || Object.keys(value).length === 0,
    mergeObject,
    setProperty
  }
};
globalThis.game = {
  system: { id: "dnd5e", version: "6.0.0" },
  modules: new Map([["dae", { active: false }]]),
  settings: { get: () => false },
  user: { isGM: true }
};
globalThis.ActiveEffect = {
  implementation: {
    async forApplication(changes) {
      return changes.map(change => ({ ...change, prepared: true }));
    }
  }
};
globalThis.fromUuidSync = uuid => currentSourceEffect?.uuid === uuid ? currentSourceEffect : null;

let currentElementClass;
let currentSourceEffect = null;
globalThis.window = {
  customElements: {
    get: name => name === "effect-application" ? currentElementClass : undefined
  }
};

const { EffectApplicationHooks } = await import("../scripts/hooks/EffectApplicationHooks.js");
const { ActiveEffectFormulaChangeService } = await import(
  "../scripts/services/ActiveEffectFormulaChangeService.js"
);

function createApplicationClass() {
  return class FakeEffectApplication {
    constructor(effect, actor, operation) {
      this.effect = effect;
      this.actor = actor;
      this.operation = operation;
      this.prepareCalls = 0;
      this.chatMessage = {
        getAssociatedActivity: () => null,
        getAssociatedActor: () => null,
        getAssociatedItem: () => null
      };
    }

    async _prepareEffectData() {
      this.prepareCalls += 1;
      return structuredClone(this.operation);
    }

    async _onApplyEffects() {
      return this._prepareEffectData(this.effect, this.actor);
    }

    async _applyEffectToActor() {
      throw new Error("The dnd5e 6 batch path must not need this method.");
    }
  };
}

test("adapts the dnd5e 6 normal batch preparation path and preserves native data", async () => {
  const source = currentSourceEffect = new FakeEffect({ applyBehavior: "duplicate" });
  const actor = new FakeActor();
  actor.uuid = "Actor.target";
  const ElementClass = currentElementClass = createApplicationClass();
  const originalPrepare = ElementClass.prototype._prepareEffectData;

  EffectApplicationHooks.activate();

  assert.notEqual(ElementClass.prototype._prepareEffectData, originalPrepare);
  const app = new ElementClass(source, actor, {
    action: "update",
    data: {
      _id: "existing-effect",
      flags: { dnd5e: { dependentOn: "Actor.origin.ActiveEffect.concentration" } },
      system: { origin: { message: "ChatMessage.message" } }
    }
  });
  const operation = await app._onApplyEffects();

  assert.equal(app.prepareCalls, 1);
  assert.equal(operation.action, "create");
  assert.equal(operation.data._id, undefined);
  assert.equal(operation.data.flags.dnd5e.dependentOn, "Actor.origin.ActiveEffect.concentration");
  assert.equal(operation.data.system.origin.message, "ChatMessage.message");
  assert.equal(operation.data.flags["sc-conditional-ae"].condition, "return true;");
  assert.equal(operation.data.system.changes[0].prepared, true);
});

test("marks a v6 native update for formula reapplication", async () => {
  const source = currentSourceEffect = new FakeEffect({ formula: true });
  const actor = new FakeActor();
  const ElementClass = currentElementClass = createApplicationClass();
  const marked = [];
  const originalMark = ActiveEffectFormulaChangeService.markReapplication;
  ActiveEffectFormulaChangeService.markReapplication = id => marked.push(id);

  try {
    EffectApplicationHooks.activate();
    const app = new ElementClass(source, actor, {
      action: "update",
      data: { _id: "existing-effect", disabled: false }
    });
    const operation = await app._onApplyEffects();

    assert.equal(operation.action, "update");
    assert.deepEqual(marked, ["existing-effect"]);
    assert.equal(operation.data.flags["sc-conditional-ae"].formulaChanges[0].formula, "1d6");
  } finally {
    ActiveEffectFormulaChangeService.markReapplication = originalMark;
  }
});

test("does not select the v6 preparation adapter on dnd5e 5.3", () => {
  game.system.version = "5.3.3";
  currentSourceEffect = new FakeEffect();
  const ElementClass = currentElementClass = createApplicationClass();
  const originalPrepare = ElementClass.prototype._prepareEffectData;

  EffectApplicationHooks.activate();

  assert.equal(ElementClass.prototype._prepareEffectData, originalPrepare);
  game.system.version = "6.0.0";
});
