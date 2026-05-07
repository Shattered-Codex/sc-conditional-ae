import { Constants } from "../constants/Constants.js";
import { ActiveEffectConditionService } from "../services/ActiveEffectConditionService.js";

export class ActiveEffectConditionHooks {
  static #suppressionPatched = false;
  static #preCreateHookRegistered = false;
  static #readyRefreshScheduled = false;

  static activate() {
    if (!Constants.isDnd5eActive()) {
      return;
    }

    ActiveEffectConditionHooks.#patchSuppression();
    ActiveEffectConditionHooks.#registerPreCreateHook();
    ActiveEffectConditionHooks.#scheduleReadyRefresh();
  }

  static #patchSuppression() {
    if (ActiveEffectConditionHooks.#suppressionPatched) {
      return;
    }

    ActiveEffectConditionHooks.#suppressionPatched = true;
    if (globalThis.libWrapper) {
      ActiveEffectConditionHooks.#patchSuppressionWithLibWrapper();
      return;
    }

    ActiveEffectConditionHooks.#patchSuppressionFallback();
  }

  static #patchSuppressionWithLibWrapper() {
    const libWrapper = globalThis.libWrapper;
    const prototype = CONFIG.ActiveEffect.documentClass.prototype;

    if (ActiveEffectConditionHooks.#hasPrototypeMember(prototype, "isSuppressed")) {
      try {
        libWrapper.register(
          Constants.MODULE_ID,
          "CONFIG.ActiveEffect.documentClass.prototype.isSuppressed",
          function(wrapped, ...args) {
            const suppressed = typeof wrapped === "function" ? wrapped(...args) : Boolean(wrapped);
            return suppressed || ActiveEffectConditionService.shouldSuppress(this);
          },
          "WRAPPER"
        );
      } catch (error) {
        console.warn(`[${Constants.MODULE_ID}] could not wrap ActiveEffect.isSuppressed`, error);
      }
    }

    if (typeof prototype.determineSuppression === "function") {
      try {
        libWrapper.register(
          Constants.MODULE_ID,
          "CONFIG.ActiveEffect.documentClass.prototype.determineSuppression",
          function(wrapped, ...args) {
            const result = wrapped(...args);
            if (ActiveEffectConditionService.shouldSuppress(this)) {
              this.isSuppressed = true;
            }
            return result;
          },
          "WRAPPER"
        );
      } catch (error) {
        console.warn(`[${Constants.MODULE_ID}] could not wrap ActiveEffect.determineSuppression`, error);
      }
    }
  }

  static #patchSuppressionFallback() {
    const prototype = CONFIG.ActiveEffect.documentClass.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "isSuppressed");

    if (descriptor?.get) {
      Object.defineProperty(prototype, "isSuppressed", {
        ...descriptor,
        get() {
          return descriptor.get.call(this) || ActiveEffectConditionService.shouldSuppress(this);
        }
      });
    } else if (typeof prototype.isSuppressed === "function") {
      const original = prototype.isSuppressed;
      prototype.isSuppressed = function(...args) {
        return original.apply(this, args) || ActiveEffectConditionService.shouldSuppress(this);
      };
    }

    if (typeof prototype.determineSuppression === "function") {
      const original = prototype.determineSuppression;
      prototype.determineSuppression = function(...args) {
        const result = original.apply(this, args);
        if (ActiveEffectConditionService.shouldSuppress(this)) {
          this.isSuppressed = true;
        }
        return result;
      };
    }
  }

  static #registerPreCreateHook() {
    if (ActiveEffectConditionHooks.#preCreateHookRegistered) {
      return;
    }

    ActiveEffectConditionHooks.#preCreateHookRegistered = true;
    Hooks.on("preCreateActiveEffect", ActiveEffectConditionHooks.#onPreCreateActiveEffect);
  }

  static #scheduleReadyRefresh() {
    if (ActiveEffectConditionHooks.#readyRefreshScheduled) {
      return;
    }

    ActiveEffectConditionHooks.#readyRefreshScheduled = true;
    Hooks.once("ready", () => {
      window.setTimeout(() => {
        ActiveEffectConditionHooks.#refreshConditionedActors();
      }, 0);
    });
  }

  static #onPreCreateActiveEffect(effect, data) {
    const parent = effect?.parent;
    if (!(parent instanceof CONFIG.Actor.documentClass)) {
      return true;
    }

    const conditionSource = ActiveEffectConditionHooks.#getConditionSource(effect, data);
    if (!conditionSource) {
      return true;
    }

    const evaluation = ActiveEffectConditionService.evaluate(conditionSource, { actor: parent });
    return evaluation.available;
  }

  static #getConditionSource(effect, data) {
    if (ActiveEffectConditionService.hasCondition(effect)) {
      return effect;
    }

    if (ActiveEffectConditionService.hasCondition(data)) {
      return data;
    }

    return null;
  }

  static #refreshConditionedActors() {
    const actors = new Map();

    for (const actor of game.actors?.contents ?? []) {
      if (ActiveEffectConditionHooks.#actorHasConditionedEffects(actor)) {
        actors.set(actor.uuid, actor);
      }
    }

    for (const token of canvas?.tokens?.placeables ?? []) {
      const actor = token?.actor;
      if (!actor || actors.has(actor.uuid)) {
        continue;
      }

      if (ActiveEffectConditionHooks.#actorHasConditionedEffects(actor)) {
        actors.set(actor.uuid, actor);
      }
    }

    for (const actor of actors.values()) {
      try {
        actor.reset();
      } catch (error) {
        console.warn(`[${Constants.MODULE_ID}] could not refresh actor condition state`, {
          actor: actor?.uuid ?? actor?.name ?? actor,
          error
        });
      }
    }
  }

  static #actorHasConditionedEffects(actor) {
    if (!(actor instanceof CONFIG.Actor.documentClass)) {
      return false;
    }

    for (const effect of actor.effects ?? []) {
      if (ActiveEffectConditionService.hasCondition(effect)) {
        return true;
      }
    }

    for (const item of actor.items ?? []) {
      for (const effect of item.effects ?? []) {
        if (ActiveEffectConditionService.hasCondition(effect)) {
          return true;
        }
      }
    }

    return false;
  }

  static #hasPrototypeMember(prototype, propertyName) {
    let current = prototype;
    while (current) {
      if (Object.prototype.hasOwnProperty.call(current, propertyName)) {
        return true;
      }
      current = Object.getPrototypeOf(current);
    }
    return false;
  }
}
