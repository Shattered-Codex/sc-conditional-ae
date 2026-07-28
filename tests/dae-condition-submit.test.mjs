import assert from "node:assert/strict";
import test from "node:test";

class FakeHTMLElement {
  constructor(elements = []) {
    this.elements = elements;
  }

  querySelectorAll(selector) {
    if (selector === ".sc-cae-formula-input") {
      return [];
    }

    return this.elements;
  }
}

class FakeActor {
  constructor() {
    this.uuid = "Actor.test";
    this.effects = [];
    this.items = [];
  }

  getRollData() {
    return {};
  }
}

class FakeItem {}

class FakeActiveEffect {
  constructor(condition = "", {
    disabled = false,
    daeEnableCondition = "",
    daeDisableCondition = ""
  } = {}) {
    this.uuid = "Actor.test.ActiveEffect.test";
    this.id = "test";
    this.name = "Test Effect";
    this.disabled = disabled;
    this.parent = new FakeActor();
    this.condition = condition;
    this.flags = {
      dae: {
        enableCondition: daeEnableCondition,
        disableCondition: daeDisableCondition
      }
    };
  }

  getFlag(moduleId, key) {
    if (moduleId === "sc-conditional-ae" && key === "condition") {
      return this.condition;
    }

    return null;
  }

  toObject() {
    return {
      _id: this.id,
      name: this.name,
      disabled: this.disabled,
      flags: {
        dae: structuredClone(this.flags.dae),
        "sc-conditional-ae": {
          condition: this.condition
        }
      }
    };
  }

  determineSuppression() {}

  get isSuppressed() {
    return false;
  }

  apply() {
    return { applied: true };
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

globalThis.HTMLElement = FakeHTMLElement;
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
    getProperty,
    hasProperty: (object, path) => getProperty(object, path) !== undefined,
    mergeObject: (original, other) => ({ ...original, ...other }),
    setProperty
  }
};
globalThis.game = {
  combat: null,
  modules: new Map([
    ["dae", { active: true }],
    ["lib-wrapper", { active: false }]
  ]),
  release: { generation: 13 },
  settings: {
    get: () => false
  },
  system: { id: "dnd5e" },
  time: null,
  user: null
};
globalThis.Hooks = {
  on() {},
  once() {}
};
globalThis.window = {
  setTimeout() {}
};

const { EffectSheetSubmitDataHandler } = await import(
  "../scripts/applications/EffectSheetSubmitDataHandler.js"
);
const { ActiveEffectConditionHooks } = await import(
  "../scripts/hooks/ActiveEffectConditionHooks.js"
);

function buildSheet(conditionInputValue, document = new FakeActiveEffect()) {
  return {
    document,
    element: new FakeHTMLElement([
      {
        name: "flags.sc-conditional-ae.condition",
        value: conditionInputValue
      }
    ])
  };
}

test("saving a DAE enable condition does not let an empty SC field erase it", () => {
  const submitData = {
    flags: {
      dae: {
        enableCondition: "@attributes.hp.value > 0",
        disableCondition: ""
      }
    }
  };

  EffectSheetSubmitDataHandler.clean(buildSheet(""), submitData);

  assert.equal(getProperty(submitData, "flags.dae.enableCondition"), "@attributes.hp.value > 0");
  assert.equal(getProperty(submitData, "flags.dae.disableCondition"), "");
});

test("saving a DAE disable condition does not let an empty SC field erase it", () => {
  const submitData = {
    flags: {
      dae: {
        enableCondition: "",
        disableCondition: "dae.eval('actor.system.attributes.hp.value > 0')"
      }
    }
  };

  EffectSheetSubmitDataHandler.clean(buildSheet(""), submitData);

  assert.equal(getProperty(submitData, "flags.dae.enableCondition"), "");
  assert.equal(
    getProperty(submitData, "flags.dae.disableCondition"),
    "dae.eval('actor.system.attributes.hp.value > 0')"
  );
});

test("clearing an existing DAE condition is not undone by SC's stale displayed value", () => {
  const document = new FakeActiveEffect("", {
    daeEnableCondition: "@attributes.hp.value > 0"
  });
  const submitData = {
    flags: {
      dae: {
        enableCondition: "",
        disableCondition: ""
      }
    }
  };

  EffectSheetSubmitDataHandler.clean(
    buildSheet("@attributes.hp.value > 0", document),
    submitData
  );

  assert.equal(getProperty(submitData, "flags.sc-conditional-ae.condition"), null);
  assert.equal(getProperty(submitData, "flags.dae.enableCondition"), "");
  assert.equal(getProperty(submitData, "flags.dae.disableCondition"), "");
});

test("an unrelated save preserves DAE enable and disable conditions together", () => {
  const document = new FakeActiveEffect("", {
    daeEnableCondition: "@attributes.hp.value > 0",
    daeDisableCondition: "@attributes.hp.value <= 0"
  });
  const submitData = {
    flags: {
      dae: {
        enableCondition: "@attributes.hp.value > 0",
        disableCondition: "@attributes.hp.value <= 0"
      }
    }
  };

  EffectSheetSubmitDataHandler.clean(
    buildSheet("@attributes.hp.value > 0", document),
    submitData
  );

  assert.equal(
    getProperty(submitData, "flags.dae.enableCondition"),
    "@attributes.hp.value > 0"
  );
  assert.equal(
    getProperty(submitData, "flags.dae.disableCondition"),
    "@attributes.hp.value <= 0"
  );
});

test("explicitly clearing the SC condition clears the displayed DAE condition", () => {
  const document = new FakeActiveEffect("", {
    daeEnableCondition: "@attributes.hp.value > 0"
  });
  const submitData = {
    flags: {
      dae: {
        enableCondition: "@attributes.hp.value > 0",
        disableCondition: ""
      }
    }
  };

  EffectSheetSubmitDataHandler.clean(buildSheet("", document), submitData);

  assert.equal(getProperty(submitData, "flags.sc-conditional-ae.condition"), null);
  assert.equal(getProperty(submitData, "flags.dae.enableCondition"), null);
  assert.equal(getProperty(submitData, "flags.dae.disableCondition"), "");
});

test("editing the SC field preserves an independent DAE disable condition", () => {
  const document = new FakeActiveEffect("", {
    daeEnableCondition: "@attributes.hp.value > 0",
    daeDisableCondition: "@attributes.hp.value <= 0"
  });
  const submitData = {
    flags: {
      dae: {
        enableCondition: "@attributes.hp.value > 0",
        disableCondition: "@attributes.hp.value <= 0"
      }
    }
  };

  EffectSheetSubmitDataHandler.clean(
    buildSheet("@attributes.hp.value > 5", document),
    submitData
  );

  assert.equal(getProperty(submitData, "flags.sc-conditional-ae.condition"), null);
  assert.equal(getProperty(submitData, "flags.dae.enableCondition"), "@attributes.hp.value > 5");
  assert.equal(
    getProperty(submitData, "flags.dae.disableCondition"),
    "@attributes.hp.value <= 0"
  );
});

test("clearing the SC field clears only the DAE condition it displayed", () => {
  const document = new FakeActiveEffect("", {
    daeEnableCondition: "@attributes.hp.value > 0",
    daeDisableCondition: "@attributes.hp.value <= 0"
  });
  const submitData = {
    flags: {
      dae: {
        enableCondition: "@attributes.hp.value > 0",
        disableCondition: "@attributes.hp.value <= 0"
      }
    }
  };

  EffectSheetSubmitDataHandler.clean(buildSheet("", document), submitData);

  assert.equal(getProperty(submitData, "flags.sc-conditional-ae.condition"), null);
  assert.equal(getProperty(submitData, "flags.dae.enableCondition"), null);
  assert.equal(
    getProperty(submitData, "flags.dae.disableCondition"),
    "@attributes.hp.value <= 0"
  );
});

test("an explicit mode prefix moves the condition and clears the stale field", () => {
  const document = new FakeActiveEffect("", {
    daeEnableCondition: "@attributes.hp.value > 0"
  });
  const submitData = {
    flags: {
      dae: {
        enableCondition: "@attributes.hp.value > 0",
        disableCondition: ""
      }
    }
  };

  EffectSheetSubmitDataHandler.clean(
    buildSheet("dae-disable: @attributes.hp.value <= 0", document),
    submitData
  );

  assert.equal(getProperty(submitData, "flags.dae.enableCondition"), null);
  assert.equal(
    getProperty(submitData, "flags.dae.disableCondition"),
    "@attributes.hp.value <= 0"
  );
});

test("moving a native SC condition to DAE disable clears a stale DAE enable condition", () => {
  const nativeCondition = "return actor?.system?.attributes?.hp?.value > 0;";
  const document = new FakeActiveEffect(nativeCondition, {
    daeEnableCondition: "@attributes.hp.value > 0"
  });
  const submitData = {
    flags: {
      dae: {
        enableCondition: "@attributes.hp.value > 0",
        disableCondition: ""
      }
    }
  };

  EffectSheetSubmitDataHandler.clean(
    buildSheet("dae-disable: @attributes.hp.value <= 0", document),
    submitData
  );

  assert.equal(getProperty(submitData, "flags.sc-conditional-ae.condition"), null);
  assert.equal(getProperty(submitData, "flags.dae.enableCondition"), null);
  assert.equal(
    getProperty(submitData, "flags.dae.disableCondition"),
    "@attributes.hp.value <= 0"
  );
});

test("a DAE-side edit never erases an unedited SC-native condition", () => {
  const script = "return actor?.system?.attributes?.hp?.value > 0;";
  const document = new FakeActiveEffect(script);
  const submitData = {
    flags: {
      dae: {
        enableCondition: "@attributes.hp.value > 0",
        disableCondition: ""
      }
    }
  };

  EffectSheetSubmitDataHandler.clean(buildSheet(script, document), submitData);

  assert.equal(getProperty(submitData, "flags.sc-conditional-ae.condition"), script);
  assert.equal(getProperty(submitData, "flags.dae.enableCondition"), "@attributes.hp.value > 0");
});

test("an explicit SC condition remains authoritative over DAE fields", () => {
  const submitData = {
    flags: {
      dae: {
        enableCondition: "@attributes.hp.value > 0",
        disableCondition: ""
      }
    }
  };

  EffectSheetSubmitDataHandler.clean(
    buildSheet("return actor?.system?.attributes?.hp?.value > 0;"),
    submitData
  );

  assert.equal(
    getProperty(submitData, "flags.sc-conditional-ae.condition"),
    "return actor?.system?.attributes?.hp?.value > 0;"
  );
  assert.equal(getProperty(submitData, "flags.dae.enableCondition"), null);
  assert.equal(getProperty(submitData, "flags.dae.disableCondition"), null);
});

test("a wrapped DAE edit cannot be overwritten by a second submit target", () => {
  const document = new FakeActiveEffect("return actor?.system?.attributes?.hp?.value > 0;");
  const submitData = {
    object: {
      flags: {
        dae: {
          enableCondition: "@attributes.hp.value > 0",
          disableCondition: ""
        }
      }
    },
    updateData: {
      name: "Updated Effect"
    }
  };

  EffectSheetSubmitDataHandler.clean(
    buildSheet("return actor?.system?.attributes?.hp?.value > 0;", document),
    submitData
  );

  assert.equal(
    getProperty(submitData.object, "flags.dae.enableCondition"),
    "@attributes.hp.value > 0"
  );
  assert.equal(
    getProperty(submitData.object, "flags.sc-conditional-ae.condition"),
    "return actor?.system?.attributes?.hp?.value > 0;"
  );
  assert.equal(
    getProperty(submitData.updateData, "flags.sc-conditional-ae.condition"),
    "return actor?.system?.attributes?.hp?.value > 0;"
  );
  assert.equal(
    getProperty(submitData.updateData, "flags.dae.enableCondition"),
    undefined
  );
  assert.equal(
    getProperty(submitData.updateData, "flags.dae.disableCondition"),
    undefined
  );
});

test("conditional suppression does not mutate the document disabled state", () => {
  const effect = new FakeActiveEffect("return false;");

  ActiveEffectConditionHooks.activate();

  assert.equal(effect.disabled, false);
  assert.equal(effect.isSuppressed, true);
  assert.equal(effect.disabled, false);
});
