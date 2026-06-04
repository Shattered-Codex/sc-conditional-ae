import { Constants } from "../constants/Constants.js";
import { ActiveEffectFormulaChatCardService } from "../services/ActiveEffectFormulaChatCardService.js";
import { ActiveEffectFormulaChangeService } from "../services/ActiveEffectFormulaChangeService.js";
import { ActiveEffectConditionService } from "../services/ActiveEffectConditionService.js";
import { ActiveEffectTransferHooks } from "./ActiveEffectTransferHooks.js";
import { ModuleSettings } from "../settings/ModuleSettings.js";

export class ActiveEffectFormulaChangeHooks {
  static #registered = false;
  static #UPDATE_ACTIVATION_OPTION = "formulaActivationTransition";
  static #itemTransferActiveStates = new Map();

  static activate() {
    if (
      ActiveEffectFormulaChangeHooks.#registered
      || !Constants.isDnd5eActive()
      || !ModuleSettings.isFormulaChangesEnabled()
    ) {
      return;
    }

    ActiveEffectFormulaChangeHooks.#registered = true;
    Hooks.on("preCreateActiveEffect", ActiveEffectFormulaChangeHooks.#onPreCreateActiveEffect);
    Hooks.on("preUpdateActiveEffect", ActiveEffectFormulaChangeHooks.#onPreUpdateActiveEffect);
    Hooks.on("createActiveEffect", ActiveEffectFormulaChangeHooks.#onCreateActiveEffect);
    Hooks.on("updateActiveEffect", ActiveEffectFormulaChangeHooks.#onUpdateActiveEffect);
    Hooks.on("createItem", ActiveEffectFormulaChangeHooks.#onItemChanged);
    Hooks.on("updateItem", ActiveEffectFormulaChangeHooks.#onItemChanged);
    Hooks.on("deleteItem", ActiveEffectFormulaChangeHooks.#onItemDeleted);
    Hooks.once("ready", ActiveEffectFormulaChangeHooks.#primeTransferredItemStates);
  }

  static #onPreCreateActiveEffect(effect, data) {
    ActiveEffectFormulaChangeService.prepareCreateSource(effect, data);
  }

  static #onPreUpdateActiveEffect(effect, updates, options) {
    ActiveEffectFormulaChangeService.prepareUpdateSource(effect, updates, options);
    ActiveEffectFormulaChangeHooks.#storeActivationTransition(effect, updates, options);
  }

  static #onCreateActiveEffect(effect) {
    if (!ActiveEffectFormulaChangeHooks.#shouldRoll(effect) || !ActiveEffectFormulaChangeHooks.#isActive(effect)) {
      return;
    }

    ActiveEffectFormulaChangeHooks.#roll(effect);
  }

  static #onUpdateActiveEffect(effect, updates, options) {
    if (options?.[Constants.MODULE_ID]?.[ActiveEffectFormulaChangeService.ROLL_UPDATE_OPTION]) {
      return;
    }

    const moduleOptions = options?.[Constants.MODULE_ID] ?? {};
    if (
      !moduleOptions[ActiveEffectFormulaChangeHooks.#UPDATE_ACTIVATION_OPTION]
      && !moduleOptions[ActiveEffectFormulaChangeService.REAPPLY_UPDATE_OPTION]
    ) {
      return;
    }

    if (!ActiveEffectFormulaChangeHooks.#shouldRoll(effect) || !ActiveEffectFormulaChangeHooks.#isActive(effect)) {
      return;
    }

    ActiveEffectFormulaChangeHooks.#roll(effect);
  }

  static #shouldRoll(effect) {
    return ActiveEffectFormulaChangeService.hasFormulaChanges(effect)
      && ActiveEffectFormulaChangeService.shouldPromptForCurrentUser(effect);
  }

  static #isActive(effect) {
    const conditionEvaluation = ActiveEffectConditionService.evaluate(effect);
    return effect?.active !== false
      && effect?.disabled !== true
      && !conditionEvaluation.error
      && conditionEvaluation.available;
  }

  static #roll(effect) {
    ActiveEffectFormulaChatCardService.requestRoll(effect, { reason: "activation" })
      .catch(error => console.warn(`[${Constants.MODULE_ID}] active effect formula change hook failed`, error));
  }

  static #onItemChanged(item) {
    if (!(item?.parent instanceof CONFIG.Actor.documentClass || item?.actor instanceof CONFIG.Actor.documentClass)) {
      return;
    }

    for (const effect of item.effects ?? []) {
      if (!ActiveEffectFormulaChangeHooks.#isTransferredOwnedItemEffect(effect)) {
        ActiveEffectFormulaChangeHooks.#itemTransferActiveStates.delete(effect.uuid);
        continue;
      }

      const actor = item.actor ?? item.parent ?? null;
      const wasActive = ActiveEffectFormulaChangeHooks.#itemTransferActiveStates.get(effect.uuid) === true;
      const isActive = ActiveEffectFormulaChangeHooks.#isActive(effect);
      ActiveEffectFormulaChangeHooks.#itemTransferActiveStates.set(effect.uuid, isActive);

      if (ActiveEffectTransferHooks.shouldSkipTransferredItemApplication(effect, actor)) {
        continue;
      }

      if (!wasActive && isActive && ActiveEffectFormulaChangeHooks.#shouldRoll(effect)) {
        ActiveEffectFormulaChangeHooks.#roll(effect);
      }
    }
  }

  static #onItemDeleted(item) {
    for (const effect of item?.effects ?? []) {
      if (effect?.uuid) {
        ActiveEffectFormulaChangeHooks.#itemTransferActiveStates.delete(effect.uuid);
      }
    }
  }

  static #primeTransferredItemStates() {
    ActiveEffectFormulaChangeHooks.#itemTransferActiveStates.clear();

    for (const actor of game.actors?.contents ?? []) {
      for (const item of actor.items ?? []) {
        for (const effect of item.effects ?? []) {
          if (!ActiveEffectFormulaChangeHooks.#isTransferredOwnedItemEffect(effect)) {
            continue;
          }

          ActiveEffectFormulaChangeHooks.#itemTransferActiveStates.set(effect.uuid, ActiveEffectFormulaChangeHooks.#isActive(effect));
        }
      }
    }
  }

  static #storeActivationTransition(effect, updates, options) {
    if (!options || !("disabled" in (updates ?? {}))) {
      return;
    }

    const moduleOptions = options[Constants.MODULE_ID] ?? {};
    moduleOptions[ActiveEffectFormulaChangeHooks.#UPDATE_ACTIVATION_OPTION] = (
      updates.disabled === false
      && !ActiveEffectFormulaChangeHooks.#isActive(effect)
    );
    options[Constants.MODULE_ID] = moduleOptions;
  }

  static #isTransferredOwnedItemEffect(effect) {
    return effect?.parent instanceof CONFIG.Item.documentClass
      && effect.parent.actor instanceof CONFIG.Actor.documentClass
      && effect.transfer !== false
      && effect.transfer !== 0
      && effect.transfer !== null
      && effect.transfer !== undefined
      && ActiveEffectFormulaChangeService.hasFormulaChanges(effect);
  }
}
