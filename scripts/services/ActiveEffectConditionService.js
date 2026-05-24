import { Constants } from "../constants/Constants.js";
import { ActiveEffectContextBuilder } from "../helpers/ActiveEffectContextBuilder.js";
import { DaeCompatibility } from "../compat/DaeCompatibility.js";
import { ModuleSettings } from "../settings/ModuleSettings.js";

export class ActiveEffectConditionService {
  static #compiledConditionCache = new Map();
  static #CONDITION_CACHE_LIMIT = 100;
  static #evaluationStack = new Set();

  static getCondition(effect) {
    const nativeCondition = String(
      effect?.getFlag?.(Constants.MODULE_ID, Constants.FLAG_CONDITION)
      ?? foundry.utils.getProperty(effect ?? {}, Constants.CONDITION_FLAG_PATH)
      ?? ""
    );

    if (nativeCondition.trim().length > 0) {
      return nativeCondition;
    }

    return DaeCompatibility.getCondition(effect);
  }

  static hasCondition(effect) {
    return ActiveEffectConditionService.getCondition(effect).trim().length > 0;
  }

  static validateCondition(code) {
    const source = String(code ?? "");
    if (!source.trim().length) {
      return { valid: true, error: null };
    }

    if (DaeCompatibility.isCompatibilityCondition(source)) {
      return DaeCompatibility.validateCondition(source);
    }

    try {
      ActiveEffectConditionService.#compileCondition(source);
      return { valid: true, error: null };
    } catch (error) {
      return { valid: false, error };
    }
  }

  static shouldSuppress(effect) {
    const evaluation = ActiveEffectConditionService.evaluate(effect);
    return evaluation.error ? true : !evaluation.available;
  }

  static evaluate(effect, options = {}) {
    const rawCode = ActiveEffectConditionService.getCondition(effect);
    if (!rawCode.trim().length) {
      return { available: true, error: null, result: true };
    }

    if (ActiveEffectConditionService.#isEvaluating(effect)) {
      ActiveEffectConditionService.#debug("skipping recursive condition evaluation", {
        effect: ActiveEffectConditionService.#describeEffect(effect)
      });
      return { available: true, error: null, result: true };
    }

    if (DaeCompatibility.isCompatibilityCondition(rawCode)) {
      return ActiveEffectConditionService.#evaluateWithRecursionGuard(
        effect,
        () => {
          const evaluation = DaeCompatibility.evaluateCondition(rawCode, effect, options);
          ActiveEffectConditionService.#debug("evaluated DAE compatibility condition", {
            effect: ActiveEffectConditionService.#describeEffect(effect),
            available: evaluation.available,
            result: evaluation.result
          });
          return evaluation;
        }
      );
    }

    return ActiveEffectConditionService.#evaluateWithRecursionGuard(effect, () => {
      try {
        const runner = ActiveEffectConditionService.#compileCondition(rawCode);
        const result = runner(ActiveEffectConditionService.#buildContext(effect, options));
        if (result && typeof result.then === "function") {
          throw new Error("Active Effect conditions must be synchronous.");
        }
        const evaluation = { available: Boolean(result), error: null, result };
        ActiveEffectConditionService.#debug("evaluated active effect condition", {
          effect: ActiveEffectConditionService.#describeEffect(effect),
          available: evaluation.available,
          result: evaluation.result
        });
        return evaluation;
      } catch (error) {
        console.warn(`[${Constants.MODULE_ID}] active effect condition evaluation failed`, error);
        return { available: false, error, result: null };
      }
    });
  }

  static #compileCondition(code) {
    const source = String(code ?? "");
    const cached = ActiveEffectConditionService.#compiledConditionCache.get(source);
    if (cached) {
      return cached;
    }

    const trimmed = source.trim();
    const body = /\breturn\b/.test(trimmed)
      ? trimmed
      : `return (${trimmed});`;

    const compiled = new Function(
      "context",
      `"use strict";
const {
  actor,
  deepClone,
  effect,
  game,
  getProperty,
  hasProperty,
  item,
  origin,
  originActor,
  rollData,
  source,
  targetActor,
  user
} = context;
${body}`
    );

    if (ActiveEffectConditionService.#compiledConditionCache.size >= ActiveEffectConditionService.#CONDITION_CACHE_LIMIT) {
      ActiveEffectConditionService.#compiledConditionCache.delete(
        ActiveEffectConditionService.#compiledConditionCache.keys().next().value
      );
    }

    ActiveEffectConditionService.#compiledConditionCache.set(source, compiled);
    return compiled;
  }

  static #buildContext(effect, options) {
    const affectedActor = options.actor ?? ActiveEffectContextBuilder.getAffectedActor(effect);
    const origin = options.origin ?? ActiveEffectContextBuilder.getOrigin(effect);
    const item = options.item ?? ActiveEffectContextBuilder.getItem(effect, origin);
    const context = {
      actor: affectedActor,
      deepClone: foundry.utils.deepClone.bind(foundry.utils),
      effect: effect ?? null,
      game,
      getProperty: foundry.utils.getProperty.bind(foundry.utils),
      hasProperty: foundry.utils.hasProperty.bind(foundry.utils),
      item,
      origin,
      originActor: ActiveEffectContextBuilder.getOriginActor(origin),
      source: ActiveEffectConditionService.#getSourceData(effect),
      targetActor: affectedActor,
      user: game.user ?? null
    };

    Object.defineProperty(context, "rollData", {
      configurable: false,
      enumerable: true,
      get() {
        // Resolve roll data lazily so ordinary conditions do not trigger Actor preparation work.
        return options.rollData ?? affectedActor?.getRollData?.() ?? null;
      }
    });

    return context;
  }

  static #getSourceData(effect) {
    if (typeof effect?.toObject === "function") {
      return foundry.utils.deepClone(effect.toObject(false));
    }

    return foundry.utils.deepClone(effect ?? null);
  }

  static #evaluateWithRecursionGuard(effect, callback) {
    const key = ActiveEffectConditionService.#getEvaluationKey(effect);
    // Foundry may consult suppression while building actor data for the same effect.
    ActiveEffectConditionService.#evaluationStack.add(key);

    try {
      return callback();
    } finally {
      ActiveEffectConditionService.#evaluationStack.delete(key);
    }
  }

  static #isEvaluating(effect) {
    return ActiveEffectConditionService.#evaluationStack.has(
      ActiveEffectConditionService.#getEvaluationKey(effect)
    );
  }

  static #getEvaluationKey(effect) {
    return effect?.uuid
      ?? effect?.id
      ?? effect?._id
      ?? effect;
  }

  static #debug(message, data = undefined) {
    if (!ModuleSettings.isDebugLoggingEnabled()) {
      return;
    }

    const prefix = `[${Constants.MODULE_ID}] ${message}`;
    if (data === undefined) {
      console.debug(prefix);
      return;
    }

    console.debug(prefix, data);
  }

  static #describeEffect(effect) {
    return {
      uuid: effect?.uuid ?? null,
      id: effect?.id ?? effect?._id ?? null,
      name: effect?.name ?? effect?.label ?? null,
      parent: effect?.parent?.uuid ?? effect?.parent?.name ?? null
    };
  }
}
