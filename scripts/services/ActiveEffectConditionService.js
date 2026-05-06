import { Constants } from "../constants/Constants.js";

export class ActiveEffectConditionService {
  static #compiledConditionCache = new Map();
  static #CONDITION_CACHE_LIMIT = 100;

  static getCondition(effect) {
    return String(
      effect?.getFlag?.(Constants.MODULE_ID, Constants.FLAG_CONDITION)
      ?? foundry.utils.getProperty(effect ?? {}, Constants.CONDITION_FLAG_PATH)
      ?? ""
    );
  }

  static hasCondition(effect) {
    return ActiveEffectConditionService.getCondition(effect).trim().length > 0;
  }

  static validateCondition(code) {
    const source = String(code ?? "");
    if (!source.trim().length) {
      return { valid: true, error: null };
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
    const affectedActor = options.actor ?? ActiveEffectConditionService.#getAffectedActor(effect);
    const origin = options.origin ?? ActiveEffectConditionService.#getOrigin(effect);
    const item = options.item ?? ActiveEffectConditionService.#getItem(effect, origin);

    return {
      actor: affectedActor,
      deepClone: foundry.utils.deepClone.bind(foundry.utils),
      effect: effect ?? null,
      game,
      getProperty: foundry.utils.getProperty.bind(foundry.utils),
      hasProperty: foundry.utils.hasProperty.bind(foundry.utils),
      item,
      origin,
      originActor: ActiveEffectConditionService.#getOriginActor(origin),
      rollData: affectedActor?.getRollData?.() ?? null,
      source: ActiveEffectConditionService.#getSourceData(effect),
      targetActor: affectedActor,
      user: game.user ?? null
    };
  }

  static #getAffectedActor(effect) {
    const parent = effect?.parent;
    if (parent instanceof CONFIG.Actor.documentClass) {
      return parent;
    }

    if (parent instanceof CONFIG.Item.documentClass) {
      return parent.actor ?? parent.parent ?? null;
    }

    return null;
  }

  static #getOrigin(effect) {
    const originUuid = effect?.origin ?? foundry.utils.getProperty(effect ?? {}, "origin");
    if (!originUuid || typeof fromUuidSync !== "function") {
      return null;
    }

    try {
      return fromUuidSync(originUuid) ?? null;
    } catch {
      return null;
    }
  }

  static #getItem(effect, origin) {
    if (effect?.parent instanceof CONFIG.Item.documentClass) {
      return effect.parent;
    }

    if (origin instanceof CONFIG.Item.documentClass) {
      return origin;
    }

    if (origin instanceof CONFIG.ActiveEffect.documentClass && origin.parent instanceof CONFIG.Item.documentClass) {
      return origin.parent;
    }

    return null;
  }

  static #getOriginActor(origin) {
    if (origin instanceof CONFIG.Actor.documentClass) {
      return origin;
    }

    if (origin instanceof CONFIG.Item.documentClass) {
      return origin.actor ?? null;
    }

    if (origin instanceof CONFIG.ActiveEffect.documentClass) {
      const parent = origin.parent;
      if (parent instanceof CONFIG.Actor.documentClass) {
        return parent;
      }
      if (parent instanceof CONFIG.Item.documentClass) {
        return parent.actor ?? null;
      }
    }

    return null;
  }

  static #getSourceData(effect) {
    if (typeof effect?.toObject === "function") {
      return foundry.utils.deepClone(effect.toObject(false));
    }

    return foundry.utils.deepClone(effect ?? null);
  }
}
