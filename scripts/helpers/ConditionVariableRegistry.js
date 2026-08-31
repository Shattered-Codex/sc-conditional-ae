const CONDITION_VARIABLE_NAMES = Object.freeze([
  "effect",
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

const CONDITION_VARIABLE_NAME_SET = new Set(CONDITION_VARIABLE_NAMES);

export class ConditionVariableRegistry {
  static get names() {
    return CONDITION_VARIABLE_NAMES;
  }

  static has(name) {
    return CONDITION_VARIABLE_NAME_SET.has(name);
  }
}
