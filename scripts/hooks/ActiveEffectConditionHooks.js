import { Constants } from "../constants/Constants.js";
import { ActiveEffectContextBuilder } from "../helpers/ActiveEffectContextBuilder.js";
import { ActiveEffectFormulaChatCardService } from "../services/ActiveEffectFormulaChatCardService.js";
import { ActiveEffectFormulaChangeService } from "../services/ActiveEffectFormulaChangeService.js";
import { ActiveEffectMacroChangeService } from "../services/ActiveEffectMacroChangeService.js";
import { ActiveEffectConditionService } from "../services/ActiveEffectConditionService.js";
import { ModuleSettings } from "../settings/ModuleSettings.js";

export class ActiveEffectConditionHooks {
  static #effectApplicationPatched = false;
  static #effectRefreshHooksRegistered = false;
  static #pendingActorRefreshes = new Map();
  static #refreshFlushScheduled = false;
  static #readyRefreshScheduled = false;

  static activate() {
    if (!Constants.isDnd5eActive()) {
      return;
    }

    ActiveEffectConditionHooks.#patchEffectApplication();
    ActiveEffectConditionHooks.#registerEffectRefreshHooks();
    ActiveEffectConditionHooks.#scheduleReadyRefresh();
  }

  static #patchEffectApplication() {
    if (ActiveEffectConditionHooks.#effectApplicationPatched) {
      return;
    }

    ActiveEffectConditionHooks.#effectApplicationPatched = true;
    ActiveEffectConditionHooks.#patchEffectApplicationFallback();
  }

  static #patchEffectApplicationFallback() {
    const prototype = CONFIG.ActiveEffect.documentClass.prototype;

    if (typeof CONFIG.ActiveEffect.documentClass.applyChange === "function") {
      const originalApplyChange = CONFIG.ActiveEffect.documentClass.applyChange;
      CONFIG.ActiveEffect.documentClass.applyChange = function(model, change, options) {
        if (ActiveEffectConditionHooks.#shouldSkipChangeApplication(change?.effect, model)) {
          return {};
        }

        return originalApplyChange.call(this, model, change, options);
      };
    }

    if (typeof prototype.apply === "function") {
      const originalApply = prototype.apply;
      prototype.apply = function(model, change, ...args) {
        if (ActiveEffectConditionHooks.#shouldSkipChangeApplication(change?.effect ?? this, model)) {
          return {};
        }

        return originalApply.call(this, model, change, ...args);
      };
    }
  }

  static #registerEffectRefreshHooks() {
    if (ActiveEffectConditionHooks.#effectRefreshHooksRegistered) {
      return;
    }

    ActiveEffectConditionHooks.#effectRefreshHooksRegistered = true;
    Hooks.on("createActiveEffect", ActiveEffectConditionHooks.#onActiveEffectChanged);
    Hooks.on("updateActiveEffect", ActiveEffectConditionHooks.#onActiveEffectChanged);
    Hooks.on("deleteActiveEffect", ActiveEffectConditionHooks.#onActiveEffectChanged);
  }

  static #scheduleReadyRefresh() {
    if (ActiveEffectConditionHooks.#readyRefreshScheduled) {
      return;
    }

    ActiveEffectConditionHooks.#readyRefreshScheduled = true;
    Hooks.once("ready", () => {
      window.setTimeout(() => {
        void ActiveEffectConditionHooks.#refreshConditionedActors();
      }, 0);
    });
  }

  static #onActiveEffectChanged(effect) {
    const actor = ActiveEffectContextBuilder.getAffectedActor(effect);
    if (!(actor instanceof CONFIG.Actor.documentClass)) {
      return;
    }

    if (
      !ActiveEffectConditionService.hasCondition(effect)
      && !ActiveEffectConditionHooks.#actorHasConditionedEffects(actor)
    ) {
      return;
    }

    ActiveEffectConditionHooks.#debug("active effect changed; scheduling conditional refresh", {
      actor: actor.uuid,
      effect: effect?.uuid ?? effect?.id ?? null
    });
    ActiveEffectConditionHooks.#scheduleActorRefresh(actor);
  }

  static async #refreshConditionedActors() {
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
      await ActiveEffectConditionHooks.#refreshActor(actor, { triggerConditionalActivation: false });
    }
  }

  static #scheduleActorRefresh(actor) {
    const existing = ActiveEffectConditionHooks.#pendingActorRefreshes.get(actor.uuid);
    ActiveEffectConditionHooks.#pendingActorRefreshes.set(actor.uuid, {
      actor,
      triggerConditionalActivation: existing?.triggerConditionalActivation ?? true
    });
    if (ActiveEffectConditionHooks.#refreshFlushScheduled) {
      return;
    }

    ActiveEffectConditionHooks.#refreshFlushScheduled = true;
    window.setTimeout(async () => {
      ActiveEffectConditionHooks.#refreshFlushScheduled = false;
      const pendingActors = Array.from(ActiveEffectConditionHooks.#pendingActorRefreshes.values());
      ActiveEffectConditionHooks.#pendingActorRefreshes.clear();

      for (const pendingActor of pendingActors) {
        await ActiveEffectConditionHooks.#refreshActor(
          pendingActor.actor,
          { triggerConditionalActivation: pendingActor.triggerConditionalActivation }
        );
      }
    }, 0);
  }

  static async #refreshActor(actor, { triggerConditionalActivation = false } = {}) {
    if (!(actor instanceof CONFIG.Actor.documentClass)) {
      return;
    }

    const previousConditionState = triggerConditionalActivation
      ? ActiveEffectConditionHooks.#snapshotConditionalEffectState(actor)
      : null;
    let refreshed = false;
    try {
      actor.reset();
      refreshed = true;
      ActiveEffectConditionHooks.#debug("refreshed actor condition state", {
        actor: actor.uuid,
        triggerConditionalActivation
      });
    } catch (error) {
      try {
        console.warn(`[${Constants.MODULE_ID}] could not refresh actor condition state`, {
          actor: actor?.uuid ?? actor?.name ?? actor,
          error
        });
      } catch {
        // Ignore logging failures caused by stale document state while the world is updating.
      }
    }

    if (refreshed) {
      if (previousConditionState) {
        ActiveEffectConditionHooks.#handleConditionalActivations(actor, previousConditionState);
      }
      ActiveEffectConditionHooks.#renderActorApplications(actor);
    }
  }

  static #actorHasConditionedEffects(actor) {
    if (!(actor instanceof CONFIG.Actor.documentClass)) {
      return false;
    }

    return ActiveEffectConditionHooks.#getConditionalEffects(actor).length > 0;
  }

  static #renderActorApplications(actor) {
    const applications = new Set();

    for (const app of Object.values(actor.apps ?? {})) {
      if (app?.rendered) {
        applications.add(app);
      }
    }

    const sheet = actor.sheet;
    if (sheet?.rendered) {
      applications.add(sheet);
    }

    for (const app of applications) {
      try {
        ActiveEffectConditionHooks.#renderApplication(app);
      } catch (error) {
        console.warn(`[${Constants.MODULE_ID}] could not rerender actor application after condition refresh`, {
          actor: actor?.uuid ?? actor?.name ?? actor,
          application: app,
          error
        });
      }
    }
  }

  static #renderApplication(application) {
    if (typeof application?.render !== "function") {
      return;
    }

    if (game.release?.generation > 13) {
      application.render({ force: true, parts: ["effects"] });
      return;
    }

    application.render(true);
  }

  static #snapshotConditionalEffectState(actor) {
    const state = new Map();

    for (const effect of ActiveEffectConditionHooks.#getConditionalEffects(actor)) {
      state.set(effect.uuid, {
        available: ActiveEffectConditionHooks.#isConditionAvailable(effect, actor),
        hasFormulaChanges: ModuleSettings.isFormulaChangesEnabled()
          && ActiveEffectFormulaChangeService.hasFormulaChanges(effect),
        hasExecutableMacro: ActiveEffectMacroChangeService.hasExecutableMacro(effect)
      });
    }

    return state;
  }

  static #handleConditionalActivations(actor, previousState) {
    for (const effect of ActiveEffectConditionHooks.#getConditionalEffects(actor)) {
      const prior = previousState.get(effect.uuid);
      if (!prior || prior.available || !ActiveEffectConditionHooks.#isConditionAvailable(effect, actor)) {
        continue;
      }

      if (!ActiveEffectConditionHooks.#isEffectDocumentEnabled(effect)) {
        continue;
      }

      ActiveEffectConditionHooks.#debug("conditional effect became active", {
        actor: actor.uuid,
        effect: effect.uuid,
        hasFormulaChanges: prior.hasFormulaChanges,
        hasExecutableMacro: prior.hasExecutableMacro
      });
      if (prior.hasExecutableMacro) {
        ActiveEffectConditionHooks.#executeActivatedEffectMacro(effect);
      }

      if (prior.hasFormulaChanges) {
        ActiveEffectConditionHooks.#rollActivatedEffectFormula(effect);
      }
    }
  }

  static #executeActivatedEffectMacro(effect) {
    if (!ActiveEffectMacroChangeService.hasExecutableMacro(effect)) {
      return;
    }

    ActiveEffectMacroChangeService.execute(effect, "on")
      .catch(error => console.warn(`[${Constants.MODULE_ID}] active effect condition macro activation failed`, error));
  }

  static #rollActivatedEffectFormula(effect) {
    if (
      !ModuleSettings.isFormulaChangesEnabled()
      || !ActiveEffectFormulaChangeService.hasFormulaChanges(effect)
      || !ActiveEffectFormulaChangeService.shouldPromptForCurrentUser(effect)
    ) {
      return;
    }

    ActiveEffectFormulaChatCardService.requestRoll(effect, { reason: "condition" })
      .catch(error => console.warn(`[${Constants.MODULE_ID}] active effect condition formula activation failed`, error));
  }

  static #getConditionalEffects(actor) {
    const effects = [];

    for (const effect of actor.effects ?? []) {
      if (ActiveEffectConditionService.hasCondition(effect)) {
        effects.push(effect);
      }
    }

    for (const item of actor.items ?? []) {
      for (const effect of item.effects ?? []) {
        if (ActiveEffectConditionService.hasCondition(effect)) {
          effects.push(effect);
        }
      }
    }

    return effects;
  }

  static #shouldSkipChangeApplication(effect, model) {
    if (!ActiveEffectConditionService.hasCondition(effect)) {
      return false;
    }

    if (!ActiveEffectConditionHooks.#isEffectDocumentEnabled(effect)) {
      return false;
    }

    const actor = model instanceof CONFIG.Actor.documentClass
      ? model
      : ActiveEffectContextBuilder.getAffectedActor(effect);
    const available = ActiveEffectConditionHooks.#isConditionAvailable(effect, actor);

    if (!available) {
      ActiveEffectConditionHooks.#debug("skipping change application for conditional effect", {
        effect: effect?.uuid ?? effect?.id ?? null,
        actor: actor?.uuid ?? actor?.id ?? null,
        model: model?.uuid ?? model?.id ?? null
      });
    }

    return !available;
  }

  static #isConditionAvailable(effect, actor = null) {
    const evaluation = ActiveEffectConditionService.evaluate(effect, {
      actor: ActiveEffectContextBuilder.getAffectedActor(effect) ?? actor
    });
    return !evaluation.error && evaluation.available;
  }

  static #isEffectDocumentEnabled(effect) {
    return effect?.active !== false && effect?.disabled !== true;
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
}
