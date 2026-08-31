const CONDITION_VARIABLES = Object.freeze([
  { name: "effect", kind: "object", description: "The Active Effect being evaluated." },
  { name: "actor", kind: "object", description: "The actor that owns the Active Effect." },
  { name: "targetActor", kind: "object", description: "Alias of the affected actor." },
  { name: "token", kind: "object", description: "The affected actor's canvas token, or null when unavailable." },
  { name: "lightLevel", kind: "string", description: "Light under the token: bright, dim, dark, or null when unavailable." },
  { name: "item", kind: "object", description: "The item that owns the Active Effect, when there is one." },
  { name: "origin", kind: "object", description: "The document the Active Effect originated from." },
  { name: "originActor", kind: "object", description: "The actor that originated the Active Effect." },
  { name: "user", kind: "object", description: "The user evaluating the condition." },
  { name: "rollData", kind: "object", description: "Roll data resolved from the owning actor." },
  { name: "source", kind: "object", description: "The source data of the Active Effect." },
  { name: "getProperty", kind: "function", description: "Reads a nested property from an object by path." },
  { name: "hasProperty", kind: "function", description: "Checks whether a nested property path exists." },
  { name: "deepClone", kind: "function", description: "Returns a deep copy of a value." },
  { name: "game", kind: "object", description: "The Foundry game instance." }
].map(variable => Object.freeze({
  ...variable,
  descriptionKey: `SCConditionalAE.ConditionTab.VariableDescription.${variable.name}`,
  kindKey: `SCConditionalAE.ConditionTab.VariableKind.${variable.kind}`
})));

const CONDITION_VARIABLE_NAMES = Object.freeze(CONDITION_VARIABLES.map(variable => variable.name));

const CONDITION_VARIABLE_NAME_SET = new Set(CONDITION_VARIABLE_NAMES);

export class ConditionVariableRegistry {
  static get names() {
    return CONDITION_VARIABLE_NAMES;
  }

  static get variables() {
    return CONDITION_VARIABLES;
  }

  static has(name) {
    return CONDITION_VARIABLE_NAME_SET.has(name);
  }

  static get(name) {
    return CONDITION_VARIABLES.find(variable => variable.name === name) ?? null;
  }
}
