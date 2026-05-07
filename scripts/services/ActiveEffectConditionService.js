import { Constants } from "../constants/Constants.js";
import { ActiveEffectContextBuilder } from "../helpers/ActiveEffectContextBuilder.js";
import { DaeCompatibility } from "../compat/DaeCompatibility.js";

export class ActiveEffectConditionService {
  static #compiledConditionCache = new Map();
  static #CONDITION_CACHE_LIMIT = 100;

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
      return { available: true, error: null };
    }

    if (DaeCompatibility.isCompatibilityCondition(rawCode)) {
      return DaeCompatibility.evaluateCondition(rawCode, effect, options);
    }

    try {
      const runner = ActiveEffectConditionService.#compileCondition(rawCode);
      const result = runner(ActiveEffectConditionService.#buildContext(effect, options));
      if (result && typeof result.then === "function") {
        throw new Error("Active Effect conditions must be synchronous.");
      }
      return { available: Boolean(result), error: null };
    } catch (error) {
      console.warn(`[${Constants.MODULE_ID}] active effect condition evaluation failed`, error);
      return { available: false, error };
    }
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

    return {
      actor: affectedActor,
      deepClone: foundry.utils.deepClone.bind(foundry.utils),
      effect: effect ?? null,
      game,
      getProperty: foundry.utils.getProperty.bind(foundry.utils),
      hasProperty: foundry.utils.hasProperty.bind(foundry.utils),
      item,
      origin,
      originActor: ActiveEffectContextBuilder.getOriginActor(origin),
      rollData: affectedActor?.getRollData?.() ?? null,
      source: ActiveEffectConditionService.#getSourceData(effect),
      targetActor: affectedActor,
      user: game.user ?? null
    };
  }

  static #getSourceData(effect) {
    if (typeof effect?.toObject === "function") {
      return foundry.utils.deepClone(effect.toObject(false));
    }

    return foundry.utils.deepClone(effect ?? null);
  }
}
