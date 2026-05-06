import { Constants } from "../constants/Constants.js";
import { ActiveEffectMacroChangeService } from "../services/ActiveEffectMacroChangeService.js";

export class ActiveEffectMacroChangeHooks {
  static #registered = false;

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
    if (!ActiveEffectMacroChangeHooks.#shouldHandle(effect, userId) || !ActiveEffectMacroChangeHooks.#isActive(effect)) {
      return;
    }

    ActiveEffectMacroChangeHooks.#execute(effect, "on");
  }

  static #onUpdateActiveEffect(effect, updates, _options, userId) {
    if (!ActiveEffectMacroChangeHooks.#shouldHandle(effect, userId) || !("disabled" in (updates ?? {}))) {
      return;
    }

    const disabled = Boolean(updates.disabled);
    if (!disabled && !ActiveEffectMacroChangeHooks.#isActive(effect)) {
      return;
    }

    ActiveEffectMacroChangeHooks.#execute(effect, disabled ? "off" : "on");
  }

  static #onDeleteActiveEffect(effect, _options, userId) {
    if (!ActiveEffectMacroChangeHooks.#shouldHandle(effect, userId)) {
      return;
    }

    ActiveEffectMacroChangeHooks.#execute(effect, "off");
  }

  static #shouldHandle(effect, userId) {
    return userId === game.user?.id && ActiveEffectMacroChangeService.hasExecutableMacro(effect);
  }

  static #isActive(effect) {
    return effect?.active !== false && effect?.disabled !== true;
  }

  static #execute(effect, action) {
    ActiveEffectMacroChangeService.execute(effect, action)
      .catch(error => console.warn(`[${Constants.MODULE_ID}] active effect macro change hook failed`, error));
  }
}
