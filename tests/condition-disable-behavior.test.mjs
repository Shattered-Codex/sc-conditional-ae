import assert from "node:assert/strict";
import test from "node:test";

const hookCallbacks = new Map();
const timerQueue = [];
let nextId = 1;

class FakeActor {
  constructor({ conditionAvailable = false, ownerId = "owner" } = {}) {
    this.id = `actor-${nextId++}`;
    this.uuid = `Actor.${this.id}`;
    this.conditionAvailable = conditionAvailable;
    this.ownerId = ownerId;
    this.effects = [];
    this.items = [];
    this.apps = {};
    this.resetCount = 0;
  }

  getRollData() {
    return {};
  }

  reset() {
    this.resetCount += 1;
  }

  testUserPermission(user, permission) {
    return permission === "OWNER" && user?.id === this.ownerId;
  }
}

class FakeItem {}

class FakeActiveEffect {
  constructor(actor, {
    behavior,
    condition = "return actor.conditionAvailable;",
    disabled = false,
    managedDisabled = false
  } = {}) {
    this.id = `effect-${nextId++}`;
    this.uuid = `${actor.uuid}.ActiveEffect.${this.id}`;
    this.name = "Condition Test";
    this.parent = actor;
    this.active = !disabled;
    this.disabled = disabled;
    this.condition = condition;
    this.updateCalls = [];
    this.flags = {
      dae: {
        enableCondition: "",
        disableCondition: ""
      },
      "sc-conditional-ae": {}
    };

    if (behavior !== undefined) {
      this.flags["sc-conditional-ae"].conditionBehavior = behavior;
    }
    if (managedDisabled) {
      this.flags["sc-conditional-ae"].conditionManagedDisabled = true;
    }

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
      name: this.name,
      active: this.active,
      disabled: this.disabled,
      flags: structuredClone(this.flags)
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
      updates: structuredClone(updates),
      options: structuredClone(options)
    });

    for (const [path, value] of Object.entries(updates)) {
      if (path === "disabled") {
        this.disabled = value;
        this.active = value !== true;
        continue;
      }

      const deletion = path.match(/^(.*)\.-=([^.]+)$/);
      if (deletion) {
        deleteProperty(this, `${deletion[1]}.${deletion[2]}`);
        continue;
      }

      setProperty(this, path, value);
    }

    for (const callback of hookCallbacks.get("updateActiveEffect") ?? []) {
      callback(this, updates, options, game.user?.id);
    }

    return this;
  }

  updateSource(updates) {
    for (const [path, value] of Object.entries(updates ?? {})) {
      const deletion = path.match(/^(.*)\.-=([^.]+)$/);
      if (deletion) {
        deleteProperty(this, `${deletion[1]}.${deletion[2]}`);
        continue;
      }

      setProperty(this, path, value);
    }
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
  { id: "owner", active: true, isGM: false },
  { id: "gm", active: true, isGM: true }
];
users.activeGM = users[1];

globalThis.CONFIG = {
  Actor: { documentClass: FakeActor },
  Item: { documentClass: FakeItem },
  ActiveEffect: { documentClass: FakeActiveEffect }
};
globalThis.CONST = {
  ACTIVE_EFFECT_MODES: {
    CUSTOM: 0
  }
};
globalThis.foundry = {
  utils: {
    deepClone: value => structuredClone(value),
    diffObject: (left, right) => Object.fromEntries(
      Object.entries(left ?? {}).filter(([key, value]) => (
        JSON.stringify(value) !== JSON.stringify(right?.[key])
      ))
    ),
    getProperty,
    hasProperty: (object, path) => getProperty(object, path) !== undefined,
    isEmpty: value => !value || Object.keys(value).length === 0,
    mergeObject,
    setProperty,
    unsetProperty: deleteProperty
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
  settings: {
    get: () => false
  },
  system: { id: "dnd5e" },
  time: null,
  user: users[0],
  users
};
globalThis.canvas = {
  tokens: {
    placeables: []
  }
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
globalThis.window = {
  setTimeout(callback) {
    timerQueue.push(callback);
    return timerQueue.length;
  }
};

const { Constants } = await import("../scripts/constants/Constants.js");
const { ActiveEffectConditionHooks } = await import(
  "../scripts/hooks/ActiveEffectConditionHooks.js"
);
const { ActiveEffectConditionService } = await import(
  "../scripts/services/ActiveEffectConditionService.js"
);
const { ActiveEffectFormulaChangeService } = await import(
  "../scripts/services/ActiveEffectFormulaChangeService.js"
);
const { ActiveEffectFormulaChatCardService } = await import(
  "../scripts/services/ActiveEffectFormulaChatCardService.js"
);
const { ActiveEffectTransferMetadataService } = await import(
  "../scripts/services/ActiveEffectTransferMetadataService.js"
);
const { ActiveEffectTransferHooks } = await import(
  "../scripts/hooks/ActiveEffectTransferHooks.js"
);

ActiveEffectConditionHooks.activate();

async function refresh(actor) {
  for (const callback of hookCallbacks.get("updateActor") ?? []) {
    callback(actor, {}, {}, game.user?.id);
  }

  while (timerQueue.length) {
    await timerQueue.shift()();
  }
}

test("suppress remains the default and does not persist disabled state", async () => {
  const actor = new FakeActor({ conditionAvailable: false });
  const effect = new FakeActiveEffect(actor);
  const unknownBehaviorEffect = new FakeActiveEffect(actor, {
    behavior: "unsupported-behavior"
  });

  await refresh(actor);

  assert.equal(ActiveEffectConditionService.getBehavior(effect), Constants.CONDITION_BEHAVIOR_SUPPRESS);
  assert.equal(
    ActiveEffectConditionService.getBehavior(unknownBehaviorEffect),
    Constants.CONDITION_BEHAVIOR_SUPPRESS
  );
  assert.equal(effect.disabled, false);
  assert.equal(effect.isSuppressed, true);
  assert.equal(effect.updateCalls.length, 0);
  assert.equal(unknownBehaviorEffect.disabled, false);
  assert.equal(unknownBehaviorEffect.updateCalls.length, 0);
});

test("disable behavior disables on false and re-enables on true", async () => {
  const actor = new FakeActor({ conditionAvailable: false });
  const effect = new FakeActiveEffect(actor, {
    behavior: Constants.CONDITION_BEHAVIOR_DISABLE
  });

  await refresh(actor);

  assert.equal(effect.disabled, true);
  assert.equal(ActiveEffectConditionService.isConditionManagedDisabled(effect), true);
  assert.equal(effect.updateCalls.length, 1);

  actor.conditionAvailable = true;
  await refresh(actor);

  assert.equal(effect.disabled, false);
  assert.equal(ActiveEffectConditionService.isConditionManagedDisabled(effect), false);
  assert.equal(effect.updateCalls.length, 2);
});

test("a manually disabled effect is never claimed or re-enabled", async () => {
  const actor = new FakeActor({ conditionAvailable: false });
  const effect = new FakeActiveEffect(actor, {
    behavior: Constants.CONDITION_BEHAVIOR_DISABLE,
    disabled: true
  });

  await refresh(actor);
  actor.conditionAvailable = true;
  await refresh(actor);

  assert.equal(effect.disabled, true);
  assert.equal(ActiveEffectConditionService.isConditionManagedDisabled(effect), false);
  assert.equal(effect.updateCalls.length, 0);
});

test("only the responsible active owner persists condition state", async () => {
  const actor = new FakeActor({ conditionAvailable: false });
  const effect = new FakeActiveEffect(actor, {
    behavior: Constants.CONDITION_BEHAVIOR_DISABLE
  });

  game.user = users[1];
  await refresh(actor);
  assert.equal(effect.disabled, false);
  assert.equal(effect.updateCalls.length, 0);

  game.user = users[0];
  await refresh(actor);
  assert.equal(effect.disabled, true);
  assert.equal(effect.updateCalls.length, 1);
});

test("the active GM is responsible when no active owner is available", async () => {
  const actor = new FakeActor({ conditionAvailable: false });
  const effect = new FakeActiveEffect(actor, {
    behavior: Constants.CONDITION_BEHAVIOR_DISABLE
  });
  const previousUser = game.user;
  users[0].active = false;
  game.user = users[1];

  try {
    await refresh(actor);
    assert.equal(effect.disabled, true);
    assert.equal(effect.updateCalls.length, 1);
  } finally {
    users[0].active = true;
    game.user = previousUser;
  }
});

test("condition errors fail closed and recover after the condition is fixed", async () => {
  const actor = new FakeActor({ conditionAvailable: true });
  const effect = new FakeActiveEffect(actor, {
    behavior: Constants.CONDITION_BEHAVIOR_DISABLE,
    condition: "throw new Error('broken condition');"
  });
  const originalWarn = console.warn;
  console.warn = () => {};

  try {
    await refresh(actor);
    assert.equal(effect.disabled, true);
    assert.equal(ActiveEffectConditionService.isConditionManagedDisabled(effect), true);

    effect.condition = "return true;";
    await refresh(actor);
    assert.equal(effect.disabled, false);
    assert.equal(ActiveEffectConditionService.isConditionManagedDisabled(effect), false);
  } finally {
    console.warn = originalWarn;
  }
});

test("removing a condition releases an effect disabled by the condition", async () => {
  const actor = new FakeActor({ conditionAvailable: false });
  const effect = new FakeActiveEffect(actor, {
    behavior: Constants.CONDITION_BEHAVIOR_DISABLE,
    disabled: true,
    managedDisabled: true
  });

  effect.condition = "";
  await refresh(actor);

  assert.equal(effect.disabled, false);
  assert.equal(ActiveEffectConditionService.isConditionManagedDisabled(effect), false);
  assert.equal(effect.updateCalls.length, 1);
});

test("switching back to suppress releases managed disabled state", async () => {
  const actor = new FakeActor({ conditionAvailable: false });
  const effect = new FakeActiveEffect(actor, {
    behavior: Constants.CONDITION_BEHAVIOR_SUPPRESS,
    disabled: true,
    managedDisabled: true
  });

  await refresh(actor);

  assert.equal(effect.disabled, false);
  assert.equal(ActiveEffectConditionService.isConditionManagedDisabled(effect), false);
  assert.equal(effect.isSuppressed, true);
  assert.equal(effect.updateCalls.length, 1);
});

test("ready reconciliation includes managed effects after their condition was removed", async () => {
  const actor = new FakeActor({ conditionAvailable: true });
  const effect = new FakeActiveEffect(actor, {
    behavior: Constants.CONDITION_BEHAVIOR_DISABLE,
    condition: "",
    disabled: true,
    managedDisabled: true
  });
  game.actors.contents = [actor];

  try {
    for (const callback of hookCallbacks.get("ready") ?? []) {
      callback();
    }
    while (timerQueue.length) {
      await timerQueue.shift()();
    }

    assert.equal(effect.disabled, false);
    assert.equal(ActiveEffectConditionService.isConditionManagedDisabled(effect), false);
    assert.equal(effect.updateCalls.length, 1);
  } finally {
    game.actors.contents = [];
  }
});

test("managed reactivation does not also trigger the direct condition formula roll", async () => {
  const actor = new FakeActor({ conditionAvailable: false });
  const effect = new FakeActiveEffect(actor, {
    behavior: Constants.CONDITION_BEHAVIOR_DISABLE
  });
  const originalGetSetting = game.settings.get;
  const originalHasFormulaChanges = ActiveEffectFormulaChangeService.hasFormulaChanges;
  const originalRequestRoll = ActiveEffectFormulaChatCardService.requestRoll;
  let directRollRequests = 0;

  game.settings.get = (_moduleId, key) => key === "enableFormulaChanges";
  ActiveEffectFormulaChangeService.hasFormulaChanges = () => true;
  ActiveEffectFormulaChatCardService.requestRoll = async () => {
    directRollRequests += 1;
  };

  try {
    await refresh(actor);
    assert.equal(effect.disabled, true);

    actor.conditionAvailable = true;
    await refresh(actor);

    assert.equal(effect.disabled, false);
    assert.equal(directRollRequests, 0);
    assert.equal(effect.updateCalls.length, 2);
  } finally {
    game.settings.get = originalGetSetting;
    ActiveEffectFormulaChangeService.hasFormulaChanges = originalHasFormulaChanges;
    ActiveEffectFormulaChatCardService.requestRoll = originalRequestRoll;
  }
});

test("transferred metadata keeps behavior but never copies managed runtime state", () => {
  const actor = new FakeActor({ conditionAvailable: false });
  const effect = new FakeActiveEffect(actor, {
    behavior: Constants.CONDITION_BEHAVIOR_DISABLE,
    disabled: true,
    managedDisabled: true
  });
  const targetData = {};

  const changed = ActiveEffectTransferMetadataService.mergeModuleFlags(effect, targetData);

  assert.equal(changed, true);
  assert.equal(
    getProperty(targetData, Constants.CONDITION_BEHAVIOR_FLAG_PATH),
    Constants.CONDITION_BEHAVIOR_DISABLE
  );
  assert.equal(
    getProperty(targetData, Constants.CONDITION_MANAGED_DISABLED_FLAG_PATH),
    undefined
  );

  const existingTargetData = {
    flags: {
      [Constants.MODULE_ID]: {
        conditionManagedDisabled: true
      }
    }
  };

  ActiveEffectTransferMetadataService.mergeModuleFlags(effect, existingTargetData);

  assert.equal(
    getProperty(existingTargetData, Constants.CONDITION_MANAGED_DISABLED_FLAG_PATH),
    true
  );
});

test("actor-embedded preCreate strips a managed marker from a pre-populated clone", () => {
  const actor = new FakeActor({ conditionAvailable: false });
  const effect = new FakeActiveEffect(actor, {
    behavior: Constants.CONDITION_BEHAVIOR_DISABLE,
    managedDisabled: true
  });
  const createData = effect.toObject();

  ActiveEffectTransferHooks.activate();
  for (const callback of hookCallbacks.get("preCreateActiveEffect") ?? []) {
    callback(effect, createData, {}, game.user?.id);
  }

  assert.equal(
    getProperty(createData, Constants.CONDITION_MANAGED_DISABLED_FLAG_PATH),
    undefined
  );
  assert.equal(
    ActiveEffectConditionService.isConditionManagedDisabled(effect),
    false
  );
});
