import assert from "node:assert/strict";
import test from "node:test";

const hookCallbacks = new Map();
const timerQueue = [];
let nextId = 1;

class FakeActor {
  constructor() {
    this.id = `actor-${nextId++}`;
    this.uuid = `Actor.${this.id}`;
    this.effects = [];
    this.items = [];
    this.apps = {};
    this.activeTokens = [];
    this.conditionAvailable = true;
    this.resetCount = 0;
  }

  getActiveTokens() {
    return this.activeTokens;
  }

  getRollData() {
    return {};
  }

  reset() {
    this.resetCount += 1;
  }

  testUserPermission(user, permission) {
    return permission === "OWNER" && user?.id === "owner";
  }
}

class FakeItem {}

class FakeActiveEffect {
  constructor(actor, {
    behavior = "suppress",
    condition = "return true;",
    changeCondition = "",
    disabled = false
  } = {}) {
    this.id = `effect-${nextId++}`;
    this.uuid = `${actor.uuid}.ActiveEffect.${this.id}`;
    this.name = "Light Condition Test";
    this.parent = actor;
    this.condition = condition;
    this.disabled = disabled;
    this.active = !disabled;
    this.system = {
      changes: [{ _id: "change-1", key: "system.test" }]
    };
    this.updateCalls = [];
    this.flags = {
      dae: { disableCondition: "", enableCondition: "" },
      "sc-conditional-ae": {
        conditionBehavior: behavior,
        changeConditions: changeCondition ? { "change-1": changeCondition } : {}
      }
    };
    actor.effects.push(this);
  }

  getFlag(moduleId, key) {
    if (moduleId !== "sc-conditional-ae") {
      return null;
    }

    if (key === "condition") {
      return this.condition;
    }

    return this.flags[moduleId]?.[key] ?? null;
  }

  toObject() {
    return {
      _id: this.id,
      disabled: this.disabled,
      flags: structuredClone(this.flags),
      name: this.name
    };
  }

  determineSuppression() {}

  get isSuppressed() {
    return false;
  }

  apply() {
    return { applied: true };
  }

  async update(updates, options = {}) {
    this.updateCalls.push({
      options: structuredClone(options),
      updates: structuredClone(updates)
    });
    if (Object.hasOwn(updates, "disabled")) {
      this.disabled = updates.disabled;
      this.active = updates.disabled !== true;
    }
    return this;
  }

  static applyChange() {
    return { applied: true };
  }
}

function getProperty(object, path) {
  return String(path ?? "")
    .split(".")
    .filter(Boolean)
    .reduce((value, key) => value?.[key], object);
}

function setProperty(object, path, value) {
  const keys = String(path ?? "").split(".").filter(Boolean);
  let target = object;
  for (const key of keys.slice(0, -1)) {
    target[key] ??= {};
    target = target[key];
  }
  target[keys.at(-1)] = value;
  return true;
}

function deleteProperty(object, path) {
  const keys = String(path ?? "").split(".").filter(Boolean);
  const parent = keys.slice(0, -1).reduce((value, key) => value?.[key], object);
  return parent ? delete parent[keys.at(-1)] : false;
}

function mergeObject(original, other, { inplace = true } = {}) {
  const target = inplace ? original : structuredClone(original ?? {});
  for (const [key, value] of Object.entries(other ?? {})) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      target[key] = mergeObject(target[key] ?? {}, value, { inplace: true });
    } else {
      target[key] = value;
    }
  }
  return target;
}

const users = [
  { active: true, id: "owner", isGM: false },
  { active: true, id: "gm", isGM: true }
];
users.activeGM = users[1];

globalThis.CONFIG = {
  Actor: { documentClass: FakeActor },
  Item: { documentClass: FakeItem },
  ActiveEffect: { documentClass: FakeActiveEffect },
  Macro: { documentClass: class FakeMacro {} }
};
globalThis.CONST = { ACTIVE_EFFECT_MODES: { CUSTOM: 0 } };
globalThis.foundry = {
  utils: {
    deepClone: value => structuredClone(value),
    deleteProperty,
    diffObject: (left, right) => Object.fromEntries(
      Object.entries(left ?? {}).filter(([key, value]) => (
        JSON.stringify(value) !== JSON.stringify(right?.[key])
      ))
    ),
    getProperty,
    hasProperty: (object, path) => getProperty(object, path) !== undefined,
    isEmpty: value => !value || Object.keys(value).length === 0,
    mergeObject,
    setProperty
  }
};
globalThis.game = {
  actors: { contents: [] },
  combat: null,
  modules: new Map([
    ["dae", { active: false }],
    ["lib-wrapper", { active: false }]
  ]),
  release: { generation: 13 },
  macros: { get: () => null, getName: () => null },
  settings: { get: () => false },
  system: { id: "dnd5e", version: "6.0.0" },
  time: null,
  user: users[0],
  users
};
globalThis.Hooks = {
  on(name, callback) {
    const callbacks = hookCallbacks.get(name) ?? [];
    callbacks.push(callback);
    hookCallbacks.set(name, callbacks);
  },
  once(name, callback) {
    const callbacks = hookCallbacks.get(name) ?? [];
    callbacks.push(callback);
    hookCallbacks.set(name, callbacks);
  }
};
globalThis.ChatMessage = { getSpeaker: () => ({}) };
globalThis.window = {
  setTimeout(callback) {
    timerQueue.push(callback);
    return timerQueue.length;
  }
};

function makeToken(actor, id, { x = 5, elevation = 0 } = {}) {
  const parent = { id: "scene" };
  const document = {
    actor,
    elevation,
    id,
    parent,
    uuid: `Scene.scene.Token.${id}`,
    getCenterPoint: () => ({ elevation, x, y: 0 })
  };
  const token = {
    actor,
    center: { x, y: 0 },
    document,
    id
  };
  document.object = token;
  return token;
}

let lightingMode = "bright";
const brightSource = {
  active: true,
  data: { bright: 10, elevation: 0, priority: 0 },
  isPreview: false,
  origin: { elevation: 0, x: 0, y: 0 },
  priority: 0,
  testPoint: () => true
};

function resetCanvas(tokens = []) {
  globalThis.canvas = {
    dimensions: { distancePixels: 1 },
    effects: {
      get lightSources() {
        if (!["bright", "dim"].includes(lightingMode)) {
          return [];
        }
        brightSource.data.bright = lightingMode === "bright" ? 10 : 1;
        return [brightSource];
      },
      testInsideDarkness: () => lightingMode === "darkness",
      testInsideLight: () => false
    },
    environment: { globalLightSource: null },
    scene: { id: "scene" },
    tokens: { placeables: tokens }
  };
}

async function callHook(name, ...args) {
  for (const callback of hookCallbacks.get(name) ?? []) {
    await callback(...args);
  }
}

async function flushTimers() {
  while (timerQueue.length) {
    await timerQueue.shift()();
  }
}

const { Constants } = await import("../scripts/constants/Constants.js");
const { ActiveEffectConditionHooks } = await import(
  "../scripts/hooks/ActiveEffectConditionHooks.js"
);
const { ActiveEffectConditionService } = await import(
  "../scripts/services/ActiveEffectConditionService.js"
);

const { ActiveEffectMacroChangeHooks } = await import(
  "../scripts/hooks/ActiveEffectMacroChangeHooks.js"
);

ActiveEffectConditionHooks.activate();
ActiveEffectMacroChangeHooks.activate();

test("a common condition evaluates without reading canvas", () => {
  const actor = new FakeActor();
  const effect = new FakeActiveEffect(actor, {
    condition: "return actor.conditionAvailable;"
  });
  const textOnlyEffect = new FakeActiveEffect(actor, {
    condition: "/* token */ return actor.conditionAvailable && 'lightLevel' !== '';"
  });
  const previousCanvas = globalThis.canvas;
  globalThis.canvas = new Proxy({}, {
    get() {
      throw new Error("ordinary conditions must not touch canvas");
    }
  });

  try {
    const evaluation = ActiveEffectConditionService.evaluate(effect);
    assert.equal(evaluation.available, true);
    assert.equal(evaluation.error, null);
    assert.equal(ActiveEffectConditionService.evaluate(textOnlyEffect).available, true);
    assert.equal(ActiveEffectConditionService.usesTokenContext(textOnlyEffect), false);
  } finally {
    globalThis.canvas = previousCanvas;
  }
});

test("lightingRefresh skips unchanged light and coalesces an availability transition", async () => {
  lightingMode = "bright";
  const actor = new FakeActor();
  const token = makeToken(actor, "light-token");
  actor.activeTokens = [token];
  new FakeActiveEffect(actor, {
    condition: "return lightLevel === 'bright';"
  });
  resetCanvas([token]);

  await callHook("updateActor", actor, {}, {}, game.user.id);
  await flushTimers();
  await callHook("lightingRefresh", canvas.effects);
  await flushTimers();
  const stableResetCount = actor.resetCount;

  await callHook("lightingRefresh", canvas.effects);
  await flushTimers();
  assert.equal(actor.resetCount, stableResetCount);

  lightingMode = "dark";
  await callHook("lightingRefresh", canvas.effects);
  await callHook("lightingRefresh", canvas.effects);
  await callHook("lightingRefresh", canvas.effects);
  assert.equal(timerQueue.length, 1);

  await flushTimers();
  assert.equal(actor.resetCount, stableResetCount + 1);
});

test("lightingRefresh also resets for an individual advanced light condition", async () => {
  lightingMode = "bright";
  const actor = new FakeActor();
  const token = makeToken(actor, "individual-light-token");
  actor.activeTokens = [token];
  new FakeActiveEffect(actor, {
    condition: "",
    changeCondition: "return lightLevel === 'bright';"
  });
  resetCanvas([token]);

  await callHook("updateActor", actor, {}, {}, game.user.id);
  await flushTimers();
  await callHook("lightingRefresh", canvas.effects);
  await flushTimers();
  const stableResetCount = actor.resetCount;

  lightingMode = "dark";
  await callHook("lightingRefresh", canvas.effects);
  await flushTimers();

  assert.equal(actor.resetCount, stableResetCount + 1);
});

test("an individual advanced light condition gates only its own change", async () => {
  lightingMode = "bright";
  const actor = new FakeActor();
  const token = makeToken(actor, "individual-change-token");
  actor.activeTokens = [token];
  const effect = new FakeActiveEffect(actor, {
    condition: "",
    changeCondition: "return lightLevel === 'bright';"
  });
  resetCanvas([token]);

  const change = { ...effect.system.changes[0], effect };
  assert.deepEqual(FakeActiveEffect.applyChange(actor, change), { applied: true });

  lightingMode = "dark";
  await callHook("lightingRefresh", canvas.effects);
  await flushTimers();
  assert.deepEqual(FakeActiveEffect.applyChange(actor, change), {});
});

test("individual light transitions execute only their macro change", async () => {
  lightingMode = "dark";
  const actor = new FakeActor();
  const token = makeToken(actor, "individual-macro-token");
  actor.activeTokens = [token];
  const effect = new FakeActiveEffect(actor, {
    condition: "",
    changeCondition: "return lightLevel === 'bright';"
  });
  effect.system.changes[0].key = "cae.macro.execute";
  effect.system.changes[0].value = "lightingMacro";
  const calls = [];
  game.macros = {
    get: reference => reference === "lightingMacro"
      ? { execute: async scope => calls.push(scope.action) }
      : null,
    getName: () => null
  };
  resetCanvas([token]);

  await callHook("updateActor", actor, {}, {}, game.user.id);
  await flushTimers();
  lightingMode = "bright";
  await callHook("lightingRefresh", canvas.effects);
  await flushTimers();
  await Promise.resolve();

  lightingMode = "dark";
  await callHook("lightingRefresh", canvas.effects);
  await flushTimers();
  await Promise.resolve();

  assert.deepEqual(calls, ["on", "off"]);
});

test("dnd5e 5.3 keeps the legacy effect-wide light condition behavior", async () => {
  game.system.version = "5.3.3";
  try {
    lightingMode = "bright";
    const actor = new FakeActor();
    const token = makeToken(actor, "legacy-light-token");
    actor.activeTokens = [token];
    const effect = new FakeActiveEffect(actor, {
      condition: "return lightLevel === 'bright';"
    });
    resetCanvas([token]);

    assert.deepEqual(FakeActiveEffect.applyChange(actor, { effect }), { applied: true });

    lightingMode = "dark";
    await callHook("lightingRefresh", canvas.effects);
    await flushTimers();
    assert.deepEqual(FakeActiveEffect.applyChange(actor, { effect }), {});
  } finally {
    game.system.version = "6.0.0";
  }
});

test("moveToken refreshes only the selected token and coalesces repeated events", async () => {
  lightingMode = "dark";
  const actor = new FakeActor();
  const selected = makeToken(actor, "selected");
  const other = makeToken(actor, "other");
  actor.activeTokens = [selected, other];
  new FakeActiveEffect(actor, {
    condition: "return token?.id === 'selected';"
  });
  resetCanvas([selected, other]);

  await callHook("updateActor", actor, {}, {}, game.user.id);
  await flushTimers();
  const initialResetCount = actor.resetCount;

  await callHook("moveToken", other.document, {}, {}, game.user);
  assert.equal(timerQueue.length, 0);
  assert.equal(actor.resetCount, initialResetCount);

  await callHook("moveToken", selected.document, {}, {}, game.user);
  await callHook("moveToken", selected.document, {}, {}, game.user);
  assert.equal(timerQueue.length, 1);
  await flushTimers();
  assert.equal(actor.resetCount, initialResetCount + 1);
});

test("a light tier change with the same availability does not reset the Actor", async () => {
  lightingMode = "bright";
  const actor = new FakeActor();
  const token = makeToken(actor, "tier-token");
  actor.activeTokens = [token];
  new FakeActiveEffect(actor, {
    condition: "return lightLevel !== 'dark';"
  });
  resetCanvas([token]);

  await callHook("updateActor", actor, {}, {}, game.user.id);
  await flushTimers();
  await callHook("lightingRefresh", canvas.effects);
  await flushTimers();
  const stableResetCount = actor.resetCount;

  lightingMode = "dim";
  await callHook("lightingRefresh", canvas.effects);
  await flushTimers();
  assert.equal(actor.resetCount, stableResetCount);
});

test("an individual light condition does not reset when its result stays available", async () => {
  lightingMode = "bright";
  const actor = new FakeActor();
  const token = makeToken(actor, "individual-tier-token");
  actor.activeTokens = [token];
  new FakeActiveEffect(actor, {
    condition: "",
    changeCondition: "return lightLevel !== 'dark';"
  });
  resetCanvas([token]);

  await callHook("updateActor", actor, {}, {}, game.user.id);
  await flushTimers();
  await callHook("lightingRefresh", canvas.effects);
  await flushTimers();
  const stableResetCount = actor.resetCount;

  lightingMode = "dim";
  await callHook("lightingRefresh", canvas.effects);
  await flushTimers();
  assert.equal(actor.resetCount, stableResetCount);
});

test("token hooks ignore documents from another Scene", async () => {
  const actor = new FakeActor();
  const token = makeToken(actor, "remote-token");
  token.document.parent = { id: "other-scene" };
  actor.activeTokens = [token];
  new FakeActiveEffect(actor, {
    condition: "return Boolean(token);"
  });
  resetCanvas([]);

  await callHook("moveToken", token.document, {}, {}, game.user);
  assert.equal(timerQueue.length, 0);
  assert.equal(actor.resetCount, 0);
});

test("spatial disable behavior never persists disabled state", async () => {
  lightingMode = "dark";
  const actor = new FakeActor();
  const token = makeToken(actor, "disable-token");
  actor.activeTokens = [token];
  const effect = new FakeActiveEffect(actor, {
    behavior: Constants.CONDITION_BEHAVIOR_DISABLE,
    condition: "return lightLevel === 'bright';"
  });
  resetCanvas([token]);

  await callHook("updateActor", actor, {}, {}, game.user.id);
  await flushTimers();

  assert.equal(effect.disabled, false);
  assert.equal(effect.updateCalls.length, 0);
  assert.equal(ActiveEffectConditionService.isConditionManagedDisabled(effect), false);
});

test("adding a false condition to a live change turns its macro off", async () => {
  lightingMode = "dark";
  const actor = new FakeActor();
  const token = makeToken(actor, "added-condition-token");
  actor.activeTokens = [token];
  const effect = new FakeActiveEffect(actor, { condition: "" });
  effect.system.changes[0].key = "cae.macro.execute";
  effect.system.changes[0].value = "addedMacro";
  const calls = [];
  game.macros = {
    get: reference => reference === "addedMacro"
      ? { execute: async scope => calls.push(scope.action) }
      : null,
    getName: () => null
  };
  resetCanvas([token]);

  await callHook("updateActor", actor, {}, {}, game.user.id);
  await flushTimers();
  await Promise.resolve();
  calls.length = 0;

  // The change was applying until the condition existed, so it has to be told
  // to clean up now that the condition reads false.
  await callHook("preUpdateActiveEffect", effect, {});
  effect.flags["sc-conditional-ae"].changeConditions = { "change-1": "return lightLevel === 'bright';" };
  await callHook("updateActiveEffect", effect, {}, {}, game.user.id);
  await flushTimers();
  await Promise.resolve();

  assert.deepEqual(calls, ["off"]);
});

test("removing a false condition turns the change back on", async () => {
  lightingMode = "dark";
  const actor = new FakeActor();
  const token = makeToken(actor, "removed-condition-token");
  actor.activeTokens = [token];
  const effect = new FakeActiveEffect(actor, {
    condition: "",
    changeCondition: "return lightLevel === 'bright';"
  });
  effect.system.changes[0].key = "cae.macro.execute";
  effect.system.changes[0].value = "removedMacro";
  const calls = [];
  game.macros = {
    get: reference => reference === "removedMacro"
      ? { execute: async scope => calls.push(scope.action) }
      : null,
    getName: () => null
  };
  resetCanvas([token]);

  await callHook("updateActor", actor, {}, {}, game.user.id);
  await flushTimers();
  await Promise.resolve();
  calls.length = 0;

  await callHook("preUpdateActiveEffect", effect, {});
  effect.flags["sc-conditional-ae"].changeConditions = {};
  await callHook("updateActiveEffect", effect, {}, {}, game.user.id);
  await flushTimers();
  await Promise.resolve();

  assert.deepEqual(calls, ["on"]);
});
