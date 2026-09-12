import { Constants } from "../constants/Constants.js";
import { ActiveEffectChangesCompatibility } from "../compat/ActiveEffectChangesCompatibility.js";
import { ActiveEffectMacroChangeService } from "../services/ActiveEffectMacroChangeService.js";
import { ActiveEffectConditionService } from "../services/ActiveEffectConditionService.js";
import { Dnd5e6ChangeConditionService } from "../services/Dnd5e6ChangeConditionService.js";

export class ActiveEffectMacroChangeHooks {
  static #registered = false;
  static #effectActiveStates = new Map();
  static #executableChangeSnapshots = new Map();

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
      effect.updateSource(ActiveEffectChangesCompatibility.buildUpdate(
        ActiveEffectChangesCompatibility.get(data),
        data,
        effect
      ));
    }
  }

  static #onPreUpdateActiveEffect(effect, updates) {
    // Once the update lands the removed change is unreadable, so keep what is
    // needed to run its `off` macro.
    ActiveEffectMacroChangeHooks.#snapshotExecutableChanges(effect);
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
    ActiveEffectMacroChangeHooks.#cleanUpRemovedChanges(
      effect,
      ActiveEffectMacroChangeHooks.#shouldExecuteForUser(userId)
    );
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

  static #snapshotExecutableChanges(effect) {
    const stateKey = ActiveEffectMacroChangeHooks.#getEffectStateKey(effect);
    if (!stateKey) return;

    const changes = ActiveEffectChangesCompatibility.get(effect)
      .filter(change => ActiveEffectMacroChangeService.isExecutableChange(change));
    if (!changes.length) {
      ActiveEffectMacroChangeHooks.#executableChangeSnapshots.delete(stateKey);
      return;
    }

    ActiveEffectMacroChangeHooks.#executableChangeSnapshots.set(stateKey, {
      changes: foundry.utils.deepClone(changes),
      wasConditional: ActiveEffectMacroChangeHooks.#isConditional(effect),
      availability: new Map(changes.map(change => [
        ActiveEffectMacroChangeHooks.#changeKey(change),
        Dnd5e6ChangeConditionService.isChangeAllowed(effect, change)
      ]))
    });
  }

  /**
   * Transitions that only the edit itself can see.
   *
   * The availability cache compares whole passes, so it cannot report a change
   * that stopped existing, nor the moment an effect first becomes conditional —
   * there is no earlier entry to compare against. Both are read from the
   * snapshot taken before this update.
   */
  static #cleanUpRemovedChanges(effect, execute) {
    const stateKey = ActiveEffectMacroChangeHooks.#getEffectStateKey(effect);
    const snapshot = stateKey ? ActiveEffectMacroChangeHooks.#executableChangeSnapshots.get(stateKey) : null;
    if (stateKey) ActiveEffectMacroChangeHooks.#executableChangeSnapshots.delete(stateKey);
    if (!snapshot || !execute) return;

    const current = ActiveEffectChangesCompatibility.get(effect)
      .filter(change => ActiveEffectMacroChangeService.isExecutableChange(change));
    const surviving = new Set(current.map(change => ActiveEffectMacroChangeHooks.#changeKey(change)));

    // A deleted change is unreadable now, so its cleanup runs from the snapshot.
    // Only changes which were actually available can have prior `on` work to undo.
    const removed = snapshot.changes.filter(change => {
      const key = ActiveEffectMacroChangeHooks.#changeKey(change);
      return !surviving.has(key) && snapshot.availability.get(key) === true;
    });
    if (removed.length) {
      void ActiveEffectMacroChangeService.executeForChanges(effect, "off", removed);
    }

    // Only the moment an effect *becomes* conditional is invisible to the
    // availability cache, because there is no earlier entry for its changes.
    // Every other direction is already tracked there, and acting here too would
    // run the macro twice.
    if (snapshot.wasConditional || !ActiveEffectMacroChangeHooks.#isConditional(effect)) return;

    const activated = [];
    const deactivated = [];
    for (const change of current) {
      const key = ActiveEffectMacroChangeHooks.#changeKey(change);
      const wasAvailable = snapshot.availability.get(key) ?? true;
      const isAvailable = Dnd5e6ChangeConditionService.isChangeAllowed(effect, change);
      if (wasAvailable && !isAvailable) deactivated.push(change);
      else if (!wasAvailable && isAvailable) activated.push(change);
    }

    if (deactivated.length) void ActiveEffectMacroChangeService.executeForChanges(effect, "off", deactivated);
    if (activated.length) void ActiveEffectMacroChangeService.executeForChanges(effect, "on", activated);
  }

  static #isConditional(effect) {
    return ActiveEffectConditionService.hasCondition(effect)
      || Dnd5e6ChangeConditionService.hasAnyCondition(effect);
  }

  static #changeKey(change) {
    return String(change?._id ?? change?.key ?? "");
  }

  static #isActive(effect) {
    return ActiveEffectConditionService.isEffectActive(effect);
  }

  static #execute(effect, action) {
    ActiveEffectMacroChangeService.execute(effect, action)
      .catch(error => console.warn(`[${Constants.MODULE_ID}] active effect macro change hook failed`, error));
  }
}
