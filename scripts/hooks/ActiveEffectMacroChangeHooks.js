import { Constants } from "../constants/Constants.js";
import { ActiveEffectMacroChangeService } from "../services/ActiveEffectMacroChangeService.js";
import { ActiveEffectConditionService } from "../services/ActiveEffectConditionService.js";

export class ActiveEffectMacroChangeHooks {
  static #registered = false;
  static #effectActiveStates = new Map();

  static activate() {
    if (ActiveEffectMacroChangeHooks.#registered || !Constants.isDnd5eActive()) {
      return;
    }

    ActiveEffectMacroChangeHooks.#registered = true;
    Hooks.on("preCreateActiveEffect", ActiveEffectMacroChangeHooks.#onPreCreateActiveEffect);
    Hooks.on("preUpdateActiveEffect", ActiveEffectMacroChangeHooks.#onPreUpdateActiveEffect);
    Hooks.on("createActiveEffect", ActiveEffectMacroChangeHooks.#onCreateActiveEffect);
    Hooks.on("updateActiveEffect", ActiveEffectMacroChangeHooks.#onUpdateActiveEffect);
    Hooks.on("deleteActiveEffect", ActiveEffectMacroChangeHooks.#onDeleteActiveEffect);
    Hooks.once("ready", ActiveEffectMacroChangeHooks.#primeTrackedStates);
  }

  static syncEvaluatedState(effect, isActive, { execute = true } = {}) {
    if (!ActiveEffectMacroChangeService.hasExecutableMacro(effect)) {
      ActiveEffectMacroChangeHooks.#forgetTrackedState(effect);
      return;
    }

    const stateKey = ActiveEffectMacroChangeHooks.#getEffectStateKey(effect);
    if (!stateKey) {
      return;
    }

    const wasActive = ActiveEffectMacroChangeHooks.#effectActiveStates.get(stateKey) === true;
    const nextActive = isActive === true;
    ActiveEffectMacroChangeHooks.#effectActiveStates.set(stateKey, nextActive);

    if (!execute) {
      return;
    }

    if (!wasActive && nextActive) {
      ActiveEffectMacroChangeHooks.#execute(effect, "on");
      return;
    }

    if (wasActive && !nextActive) {
      ActiveEffectMacroChangeHooks.#execute(effect, "off");
    }
  }

  static #onPreCreateActiveEffect(effect, data) {
    if (ActiveEffectMacroChangeService.normalizeChanges(data)) {
      effect.updateSource({ changes: data.changes });
    }
  }

  static #onPreUpdateActiveEffect(_effect, updates) {
    ActiveEffectMacroChangeService.normalizeChanges(updates);
  }

  static #onCreateActiveEffect(effect, _options, userId) {
    if (!ActiveEffectMacroChangeService.hasExecutableMacro(effect)) {
      ActiveEffectMacroChangeHooks.#forgetTrackedState(effect);
      return;
    }

    ActiveEffectMacroChangeHooks.syncEvaluatedState(
      effect,
      ActiveEffectMacroChangeHooks.#isActive(effect),
      { execute: ActiveEffectMacroChangeHooks.#shouldExecuteForUser(userId) }
    );
  }

  static #onUpdateActiveEffect(effect, _updates, _options, userId) {
    if (!ActiveEffectMacroChangeService.hasExecutableMacro(effect)) {
      ActiveEffectMacroChangeHooks.#forgetTrackedState(effect);
      return;
    }

    ActiveEffectMacroChangeHooks.syncEvaluatedState(
      effect,
      ActiveEffectMacroChangeHooks.#isActive(effect),
      { execute: ActiveEffectMacroChangeHooks.#shouldExecuteForUser(userId) }
    );
  }

  static #onDeleteActiveEffect(effect, _options, userId) {
    const stateKey = ActiveEffectMacroChangeHooks.#getEffectStateKey(effect);
    const wasActive = stateKey
      ? ActiveEffectMacroChangeHooks.#effectActiveStates.get(stateKey) === true
      : false;
    if (stateKey) {
      ActiveEffectMacroChangeHooks.#effectActiveStates.delete(stateKey);
    }

    if (
      !wasActive
      || !ActiveEffectMacroChangeHooks.#shouldExecuteForUser(userId)
      || !ActiveEffectMacroChangeService.hasExecutableMacro(effect)
    ) {
      return;
    }

    ActiveEffectMacroChangeHooks.#execute(effect, "off");
  }

  static #primeTrackedStates() {
    ActiveEffectMacroChangeHooks.#effectActiveStates.clear();

    for (const actor of ActiveEffectMacroChangeHooks.#collectActors().values()) {
      ActiveEffectMacroChangeHooks.#primeEffects(actor.effects ?? []);

      for (const item of actor.items ?? []) {
        ActiveEffectMacroChangeHooks.#primeEffects(item.effects ?? []);
      }
    }
  }

  static #collectActors() {
    const actors = new Map();

    for (const actor of game.actors?.contents ?? []) {
      if (actor?.uuid) {
        actors.set(actor.uuid, actor);
      }
    }

    for (const token of canvas?.tokens?.placeables ?? []) {
      const actor = token?.actor;
      if (actor?.uuid && !actors.has(actor.uuid)) {
        actors.set(actor.uuid, actor);
      }
    }

    return actors;
  }

  static #primeEffects(effects) {
    for (const effect of effects ?? []) {
      if (!ActiveEffectMacroChangeService.hasExecutableMacro(effect)) {
        continue;
      }

      ActiveEffectMacroChangeHooks.syncEvaluatedState(
        effect,
        ActiveEffectMacroChangeHooks.#isActive(effect),
        { execute: false }
      );
    }
  }

  static #forgetTrackedState(effect) {
    const stateKey = ActiveEffectMacroChangeHooks.#getEffectStateKey(effect);
    if (stateKey) {
      ActiveEffectMacroChangeHooks.#effectActiveStates.delete(stateKey);
    }
  }

  static #getEffectStateKey(effect) {
    const uuid = String(effect?.uuid ?? "").trim();
    if (uuid.length) {
      return uuid;
    }

    const parentUuid = String(effect?.parent?.uuid ?? "").trim();
    const effectId = String(effect?.id ?? effect?._id ?? "").trim();
    if (parentUuid.length && effectId.length) {
      return `${parentUuid}.ActiveEffect.${effectId}`;
    }

    return null;
  }

  static #shouldExecuteForUser(userId) {
    return userId === game.user?.id;
  }

  static #isActive(effect) {
    const conditionEvaluation = ActiveEffectConditionService.evaluate(effect);
    return effect?.active !== false
      && effect?.disabled !== true
      && !conditionEvaluation.error
      && conditionEvaluation.available;
  }

  static #execute(effect, action) {
    ActiveEffectMacroChangeService.execute(effect, action)
      .catch(error => console.warn(`[${Constants.MODULE_ID}] active effect macro change hook failed`, error));
  }
}
