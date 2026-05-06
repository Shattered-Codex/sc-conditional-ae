import { Constants } from "../constants/Constants.js";
import { ActiveEffectConditionService } from "../services/ActiveEffectConditionService.js";

export class ActiveEffectConditionHooks {
  static #suppressionPatched = false;
  static #preCreateHookRegistered = false;

  static activate() {
    if (!Constants.isDnd5eActive()) {
      return;
    }

    ActiveEffectConditionHooks.#patchSuppression();
    ActiveEffectConditionHooks.#registerPreCreateHook();
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
