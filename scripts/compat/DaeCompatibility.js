import { Constants } from "../constants/Constants.js";
import { ActiveEffectContextBuilder } from "../helpers/ActiveEffectContextBuilder.js";

export class DaeCompatibility {
  static #registered = false;

  static activate() {
    if (DaeCompatibility.#registered) {
      return;
    }

    DaeCompatibility.#registered = true;
    Hooks.on("dae.modifySpecials", DaeCompatibility.#onDaeModifySpecials);
  }

  static #onDaeModifySpecials(_actorType, specials) {
    const StringField = foundry.data.fields.StringField;
    specials[Constants.MACRO_EXECUTE_CHANGE_KEY] = [
      new StringField({
        label: Constants.localize("SCConditionalAE.MacroChange.Name", "Macro to Execute"),
        hint: Constants.localize(
          "SCConditionalAE.MacroChange.Description",
          "Execute a world macro when this Active Effect is applied or removed."
        )
      }),
      CONST.ACTIVE_EFFECT_MODES.CUSTOM
    ];
  }

  static getCondition(effect) {
    const enableCondition = String(foundry.utils.getProperty(effect ?? {}, Constants.DAE_CONDITION_FLAG_PATH) ?? "");
    if (enableCondition.trim().length > 0) {
      return DaeCompatibility.toCompatibilityCondition(enableCondition);
    }

    const disableCondition = String(foundry.utils.getProperty(effect ?? {}, Constants.DAE_DISABLE_CONDITION_FLAG_PATH) ?? "");
    if (disableCondition.trim().length > 0) {
      return DaeCompatibility.toCompatibilityCondition(disableCondition, "disable");
    }

    return "";
  }

  static hasCondition(effect) {
    return DaeCompatibility.getCondition(effect).trim().length > 0;
  }

  static getCompatibilityMode(condition) {
    const trimmed = String(condition ?? "").trimStart();
    if (trimmed.startsWith(Constants.DAE_DISABLE_CONDITION_PREFIX)) {
      return "disable";
    }

    if (trimmed.startsWith(Constants.DAE_CONDITION_PREFIX)) {
      return "enable";
    }

    return null;
  }

  static isCompatibilityCondition(condition) {
    return DaeCompatibility.getCompatibilityMode(condition) !== null;
  }

  static toCompatibilityCondition(condition, mode = "enable") {
    const trimmed = String(condition ?? "").trim();
    if (!trimmed.length) {
      return "";
    }

    const prefix = mode === "disable"
      ? Constants.DAE_DISABLE_CONDITION_PREFIX
      : Constants.DAE_CONDITION_PREFIX;
    return `${prefix} ${trimmed}`;
  }

  static toDisplayCondition(condition) {
    return DaeCompatibility.unwrapCompatibilityCondition(condition).expression.trim();
  }

  static normalizeSubmittedCondition(condition, fallbackMode = null) {
    const { mode: explicitMode, expression } = DaeCompatibility.unwrapCompatibilityCondition(condition);
    const trimmedExpression = expression.trim();
    if (!trimmedExpression.length) {
      return "";
    }

    const mode = DaeCompatibility.getCompatibilityMode(condition)
      ?? fallbackMode
      ?? (DaeCompatibility.looksLikeCompatibilityExpression(trimmedExpression) ? "enable" : null);

    return mode
      ? DaeCompatibility.toCompatibilityCondition(trimmedExpression, mode)
      : trimmedExpression;
  }

  static looksLikeCompatibilityExpression(condition) {
    const source = String(condition ?? "");
    return source.includes("@")
      || source.includes("dae.eval(")
      || source.includes("dae.roll(");
  }

  static unwrapCompatibilityCondition(condition) {
    const source = String(condition ?? "");
    const trimmed = source.trimStart();

    if (trimmed.startsWith(Constants.DAE_DISABLE_CONDITION_PREFIX)) {
      return {
        mode: "disable",
        expression: trimmed.slice(Constants.DAE_DISABLE_CONDITION_PREFIX.length).trimStart()
      };
    }

    if (trimmed.startsWith(Constants.DAE_CONDITION_PREFIX)) {
      return {
        mode: "enable",
        expression: trimmed.slice(Constants.DAE_CONDITION_PREFIX.length).trimStart()
      };
    }

    return {
      mode: "enable",
      expression: source
    };
  }

  static validateCondition(condition) {
    const { expression } = DaeCompatibility.unwrapCompatibilityCondition(condition);
    const trimmedExpression = expression.trim();
    if (!trimmedExpression.length) {
      return { valid: true, error: null };
    }

    try {
      const preparedExpression = Roll.replaceFormulaData(trimmedExpression, {}, { missing: "0", warn: false });
      DaeCompatibility.#evaluateExpression(preparedExpression, {});
      return { valid: true, error: null };
    } catch (error) {
      return { valid: false, error };
    }
  }

  static evaluateCondition(condition, effect, options = {}) {
    const { mode, expression } = DaeCompatibility.unwrapCompatibilityCondition(condition);
    const trimmedExpression = expression.trim();
    if (!trimmedExpression.length) {
      return { available: true, error: null };
    }

    try {
      const context = DaeCompatibility.#buildEvaluationContext(effect, options);
      const preparedExpression = Roll.replaceFormulaData(trimmedExpression, context, { missing: "0", warn: false });
      const result = Boolean(DaeCompatibility.#evaluateExpression(preparedExpression, context));
      return { available: mode === "disable" ? !result : result, error: null };
    } catch (error) {
      console.warn(`[${Constants.MODULE_ID}] DAE condition evaluation failed`, error);
      return { available: false, error };
    }
  }

  static #evaluateExpression(expression, context) {
    const evaluator = new Function("sandbox", `with (sandbox) { return ${expression}; }`);
    const sandbox = new Proxy({
      ...context,
      Roll,
      fromUuidSync: globalThis.fromUuidSync,
      game
    }, {
      has: () => true,
      get: (target, key) => key === Symbol.unscopables ? undefined : (target[key] ?? Math[key]),
      set: () => false
    });

    return evaluator(sandbox);
  }

  static #buildEvaluationContext(effect, options) {
    const actor = options.actor ?? ActiveEffectContextBuilder.getAffectedActor(effect);
    const origin = options.origin ?? ActiveEffectContextBuilder.getOrigin(effect);
    const item = options.item ?? ActiveEffectContextBuilder.getItem(effect, origin);
    const rollData = actor?.getRollData?.() ?? {};

    return foundry.utils.mergeObject(rollData, {
      actor,
      combat: game.combat ?? null,
      deepClone: foundry.utils.deepClone.bind(foundry.utils),
      effect: typeof effect?.toObject === "function" ? effect.toObject(false) : foundry.utils.deepClone(effect ?? null),
      game,
      getProperty: foundry.utils.getProperty.bind(foundry.utils),
      hasProperty: foundry.utils.hasProperty.bind(foundry.utils),
      item,
      origin,
      originActor: ActiveEffectContextBuilder.getOriginActor(origin),
      rollData: foundry.utils.deepClone(rollData),
      source: typeof effect?.toObject === "function" ? foundry.utils.deepClone(effect.toObject(false)) : foundry.utils.deepClone(effect ?? null),
      targetActor: actor,
      time: game.time ?? null,
      user: game.user ?? null
    }, { inplace: false });
  }
}
