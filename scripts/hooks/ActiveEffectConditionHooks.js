import { Constants } from "../constants/Constants.js";
import { ActiveEffectContextBuilder } from "../helpers/ActiveEffectContextBuilder.js";
import { ActiveEffectFormulaChatCardService } from "../services/ActiveEffectFormulaChatCardService.js";
import { ActiveEffectFormulaChangeService } from "../services/ActiveEffectFormulaChangeService.js";
import { ActiveEffectMacroChangeService } from "../services/ActiveEffectMacroChangeService.js";
import { ActiveEffectConditionService } from "../services/ActiveEffectConditionService.js";
import { ActiveEffectTransferHooks } from "./ActiveEffectTransferHooks.js";
import { ActiveEffectMacroChangeHooks } from "./ActiveEffectMacroChangeHooks.js";
import { ModuleSettings } from "../settings/ModuleSettings.js";

export class ActiveEffectConditionHooks {
  static #effectApplicationPatched = false;
  static #effectSuppressionPatched = false;
  static #effectRefreshHooksRegistered = false;
  static #pendingActorRefreshes = new Map();
  static #cachedConditionAvailability = new Map();
  static #actorsInTransitionForceRefresh = new Set();
  static #refreshFlushScheduled = false;
  static #readyRefreshScheduled = false;
  static #SUPPRESSION_GETTER_PATCH_MARKER = Symbol(`${Constants.MODULE_ID}.isSuppressedPatched`);
  static #SUPPRESSION_METHOD_PATCH_MARKER = Symbol(`${Constants.MODULE_ID}.determineSuppressionPatched`);

  static activate() {
    if (!Constants.isDnd5eActive()) {
      return;
    }

    ActiveEffectConditionHooks.#patchEffectSuppression();
    ActiveEffectConditionHooks.#patchEffectApplication();
    ActiveEffectConditionHooks.#registerEffectRefreshHooks();
    ActiveEffectConditionHooks.#scheduleReadyRefresh();
  }

  static #patchEffectSuppression() {
    if (ActiveEffectConditionHooks.#effectSuppressionPatched) {
      return;
    }

    ActiveEffectConditionHooks.#effectSuppressionPatched = true;

    if (ActiveEffectConditionHooks.#registerEffectSuppressionLibWrapper()) {
      return;
    }

    if (game.modules?.get("lib-wrapper")?.active) {
      Hooks.once("libWrapper.Ready", () => {
        if (!ActiveEffectConditionHooks.#registerEffectSuppressionLibWrapper()) {
          ActiveEffectConditionHooks.#patchEffectSuppressionFallback();
        }
      });
      return;
    }

    ActiveEffectConditionHooks.#patchEffectSuppressionFallback();
  }

  static #registerEffectSuppressionLibWrapper() {
    const libWrapper = globalThis.libWrapper;
    if (typeof libWrapper?.register !== "function") {
      return false;
    }

    let registered = false;

    if (ActiveEffectConditionHooks.#hasTargetMethod("CONFIG.ActiveEffect.documentClass.prototype.determineSuppression")) {
      libWrapper.register(
        Constants.MODULE_ID,
        "CONFIG.ActiveEffect.documentClass.prototype.determineSuppression",
        function(wrapped, ...args) {
          const result = wrapped.call(this, ...args);
          ActiveEffectConditionHooks.#applyConditionSuppression(this);
          return result;
        },
        "WRAPPER"
      );
      registered = true;
    }

    const suppressionDescriptor = Object.getOwnPropertyDescriptor(
      CONFIG.ActiveEffect.documentClass.prototype,
      "isSuppressed"
    );
    if (typeof suppressionDescriptor?.get === "function") {
      libWrapper.register(
        Constants.MODULE_ID,
        "CONFIG.ActiveEffect.documentClass.prototype.isSuppressed",
        function(wrapped, ...args) {
          const suppressed = wrapped.call(this, ...args);
          return suppressed || ActiveEffectConditionHooks.#isConditionSuppressed(this);
        },
        "WRAPPER"
      );
      registered = true;
    }

    if (registered) {
      ActiveEffectConditionHooks.#debug("registered Active Effect suppression wrappers with libWrapper");
    }

    return registered;
  }

  static #patchEffectSuppressionFallback() {
    const prototype = CONFIG.ActiveEffect.documentClass.prototype;

    if (
      typeof prototype.determineSuppression === "function"
      && prototype.determineSuppression[ActiveEffectConditionHooks.#SUPPRESSION_METHOD_PATCH_MARKER] !== true
    ) {
      const originalDetermineSuppression = prototype.determineSuppression;
      const patchedDetermineSuppression = function(...args) {
        const result = originalDetermineSuppression.call(this, ...args);
        ActiveEffectConditionHooks.#applyConditionSuppression(this);
        return result;
      };
      patchedDetermineSuppression[ActiveEffectConditionHooks.#SUPPRESSION_METHOD_PATCH_MARKER] = true;
      prototype.determineSuppression = patchedDetermineSuppression;
    }

    const suppressionDescriptor = Object.getOwnPropertyDescriptor(prototype, "isSuppressed");
    if (
      typeof suppressionDescriptor?.get === "function"
      && suppressionDescriptor.get[ActiveEffectConditionHooks.#SUPPRESSION_GETTER_PATCH_MARKER] !== true
    ) {
      const originalGetter = suppressionDescriptor.get;
      const patchedGetter = function() {
        return originalGetter.call(this) || ActiveEffectConditionHooks.#isConditionSuppressed(this);
      };
      patchedGetter[ActiveEffectConditionHooks.#SUPPRESSION_GETTER_PATCH_MARKER] = true;
      Object.defineProperty(prototype, "isSuppressed", {
        configurable: suppressionDescriptor.configurable ?? true,
        enumerable: suppressionDescriptor.enumerable ?? false,
        get: patchedGetter
      });
    }

    ActiveEffectConditionHooks.#debug("registered Active Effect suppression wrappers with fallback patching");
  }

  static #patchEffectApplication() {
    if (ActiveEffectConditionHooks.#effectApplicationPatched) {
      return;
    }

    ActiveEffectConditionHooks.#effectApplicationPatched = true;

    if (ActiveEffectConditionHooks.#registerEffectApplicationLibWrapper()) {
      return;
    }

    if (game.modules?.get("lib-wrapper")?.active) {
      Hooks.once("libWrapper.Ready", () => {
        if (!ActiveEffectConditionHooks.#registerEffectApplicationLibWrapper()) {
          ActiveEffectConditionHooks.#patchEffectApplicationFallback();
        }
      });
      return;
    }

    ActiveEffectConditionHooks.#patchEffectApplicationFallback();
  }

  static #registerEffectApplicationLibWrapper() {
    const libWrapper = globalThis.libWrapper;
    if (typeof libWrapper?.register !== "function") {
      return false;
    }

    let registered = false;

    if (ActiveEffectConditionHooks.#hasTargetMethod("CONFIG.ActiveEffect.documentClass.applyChange")) {
      libWrapper.register(
        Constants.MODULE_ID,
        "CONFIG.ActiveEffect.documentClass.applyChange",
        function(wrapped, model, change, options) {
          if (ActiveEffectConditionHooks.#shouldSkipChangeApplication(change?.effect, model)) {
            return {};
          }

          return wrapped(model, change, options);
        },
        "MIXED"
      );
      registered = true;
    }

    if (ActiveEffectConditionHooks.#hasTargetMethod("CONFIG.ActiveEffect.documentClass.prototype.apply")) {
      libWrapper.register(
        Constants.MODULE_ID,
        "CONFIG.ActiveEffect.documentClass.prototype.apply",
        function(wrapped, model, change, ...args) {
          if (ActiveEffectConditionHooks.#shouldSkipChangeApplication(change?.effect ?? this, model)) {
            return {};
          }

          return wrapped.call(this, model, change, ...args);
        },
        "MIXED"
      );
      registered = true;
    }

    if (registered) {
      ActiveEffectConditionHooks.#debug("registered Active Effect wrappers with libWrapper");
    }

    return registered;
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

    ActiveEffectConditionHooks.#debug("registered Active Effect wrappers with fallback patching");
  }

  static #registerEffectRefreshHooks() {
    if (ActiveEffectConditionHooks.#effectRefreshHooksRegistered) {
      return;
    }

    ActiveEffectConditionHooks.#effectRefreshHooksRegistered = true;
    Hooks.on("createActiveEffect", ActiveEffectConditionHooks.#onActiveEffectChanged);
    Hooks.on("updateActiveEffect", ActiveEffectConditionHooks.#onActiveEffectChanged);
    Hooks.on("deleteActiveEffect", ActiveEffectConditionHooks.#onActiveEffectChanged);
    Hooks.on("updateActor", ActiveEffectConditionHooks.#onActorChanged);
    Hooks.on("createItem", ActiveEffectConditionHooks.#onItemChanged);
    Hooks.on("updateItem", ActiveEffectConditionHooks.#onItemChanged);
    Hooks.on("deleteItem", ActiveEffectConditionHooks.#onItemChanged);
  }

  static #scheduleReadyRefresh() {
    if (ActiveEffectConditionHooks.#readyRefreshScheduled) {
      return;
    }

    ActiveEffectConditionHooks.#readyRefreshScheduled = true;
    Hooks.once("ready", () => {
      window.setTimeout(() => {
        void ActiveEffectConditionHooks.#primeConditionState();
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

  static #onActorChanged(actor) {
    if (
      !(actor instanceof CONFIG.Actor.documentClass)
      || !ActiveEffectConditionHooks.#actorHasConditionedEffects(actor)
    ) {
      return;
    }

    ActiveEffectConditionHooks.#debug("actor changed; scheduling conditional refresh", {
      actor: actor.uuid
    });
    ActiveEffectConditionHooks.#scheduleActorRefresh(actor);
  }

  static #onItemChanged(item) {
    const actor = item?.actor ?? item?.parent;
    if (
      !(actor instanceof CONFIG.Actor.documentClass)
      || (
        !ActiveEffectConditionHooks.#itemHasConditionedEffects(item)
        && !ActiveEffectConditionHooks.#actorHasConditionedEffects(actor)
      )
    ) {
      return;
    }

    ActiveEffectConditionHooks.#debug("owned item changed; scheduling conditional refresh", {
      actor: actor.uuid,
      item: item?.uuid ?? item?.id ?? null
    });
    ActiveEffectConditionHooks.#scheduleActorRefresh(actor);
  }

  static async #primeConditionState() {
    for (const actor of ActiveEffectConditionHooks.#collectConditionedActors().values()) {
      await ActiveEffectConditionHooks.#refreshActor(actor, {
        triggerConditionalActivation: false,
        handleTransitions: false,
        renderApplications: false
      });
    }
  }

  static #collectConditionedActors() {
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

    return actors;
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

  static async #refreshActor(actor, {
    triggerConditionalActivation = false,
    handleTransitions = true,
    renderApplications = true
  } = {}) {
    if (!(actor instanceof CONFIG.Actor.documentClass)) {
      return;
    }

    const previousConditionState = ActiveEffectConditionHooks.#getCachedConditionalEffectState(actor);
    const conditionalEffects = ActiveEffectConditionHooks.#getConditionalEffects(actor);
    let refreshed = false;
    try {
      ActiveEffectConditionHooks.#refreshEffectSuppressionState(actor, conditionalEffects, { phase: "pre-reset" });
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
      let currentConditionState = ActiveEffectConditionHooks.#getConditionalEffectState(actor, conditionalEffects);

      // The gate consults the cached availability (see #resolveConditionAvailability), so the
      // reset above gated changes using the state cached from the previous pass. Update the
      // cache to the freshly derived truth before doing anything else.
      const transitionSummary = previousConditionState
        ? ActiveEffectConditionHooks.#summarizeConditionalTransitions(
          previousConditionState,
          currentConditionState,
          conditionalEffects
        )
        : null;
      const gateStateChanged = !previousConditionState
        || ActiveEffectConditionHooks.#didConditionStateChange(previousConditionState, currentConditionState);
      ActiveEffectConditionHooks.#cacheConditionalEffectState(actor, conditionalEffects, currentConditionState);

      // Re-prepare once with the corrected cache so the gate applies/suppresses changes using
      // the derived-data availability instead of the stale value it saw mid-preparation.
      if (gateStateChanged) {
        const forced = ActiveEffectConditionHooks.#forceTransitionReprepare(actor, conditionalEffects, transitionSummary);
        if (forced) {
          currentConditionState = ActiveEffectConditionHooks.#getConditionalEffectState(actor, conditionalEffects);
          ActiveEffectConditionHooks.#cacheConditionalEffectState(actor, conditionalEffects, currentConditionState);
        }
      }

      if (handleTransitions && previousConditionState) {
        ActiveEffectConditionHooks.#handleConditionalTransitions(
          actor,
          previousConditionState,
          conditionalEffects,
          {
            currentState: currentConditionState,
            triggerConditionalActivation
          }
        );
      }

      if (
        renderApplications
        && (
          !previousConditionState
          || ActiveEffectConditionHooks.#didConditionStateChange(previousConditionState, currentConditionState)
        )
      ) {
        ActiveEffectConditionHooks.#renderActorApplications(actor);
      }
    }
  }

  static #actorHasConditionedEffects(actor) {
    if (!(actor instanceof CONFIG.Actor.documentClass)) {
      return false;
    }

    return ActiveEffectConditionHooks.#getConditionalEffects(actor).length > 0;
  }

  static #itemHasConditionedEffects(item) {
    if (!(item instanceof CONFIG.Item.documentClass)) {
      return false;
    }

    const actor = item.actor ?? item.parent ?? null;
    return (item.effects ?? []).some(effect => (
      ActiveEffectConditionService.hasCondition(effect)
      && !ActiveEffectTransferHooks.shouldSkipTransferredItemApplication(effect, actor)
    ));
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

    // v14 changed the render signature: named options object with parts for targeted re-renders.
    // render(true) still works in v14 but re-renders all parts; parts:["effects"] avoids that.
    if (game.release?.generation > 13) {
      application.render({ force: true, focus: false, parts: ["effects"] });
      return;
    }

    application.render(true, { focus: false });
  }

  static #getCachedConditionalEffectState(actor) {
    const cachedState = ActiveEffectConditionHooks.#cachedConditionAvailability.get(actor.uuid);
    return cachedState ? new Map(cachedState) : null;
  }

  static #getConditionalEffectState(actor, conditionalEffects = null) {
    const state = new Map();

    for (const effect of conditionalEffects ?? ActiveEffectConditionHooks.#getConditionalEffects(actor)) {
      state.set(effect.uuid, ActiveEffectConditionHooks.#isConditionAvailable(effect, actor));
    }

    return state;
  }

  static #cacheConditionalEffectState(actor, conditionalEffects = null, state = null) {
    const nextState = state ?? ActiveEffectConditionHooks.#getConditionalEffectState(actor, conditionalEffects);

    if (!nextState.size) {
      ActiveEffectConditionHooks.#cachedConditionAvailability.delete(actor.uuid);
      return;
    }

    ActiveEffectConditionHooks.#cachedConditionAvailability.set(actor.uuid, new Map(nextState));
  }

  static #summarizeConditionalTransitions(previousState, currentState, conditionalEffects = null) {
    const summary = {
      activated: [],
      deactivated: [],
      hasTransitions: false
    };

    for (const effect of conditionalEffects ?? []) {
      if (!ActiveEffectConditionHooks.#isEffectDocumentEnabled(effect)) {
        continue;
      }

      const wasAvailable = previousState.get(effect.uuid);
      const isAvailable = currentState.get(effect.uuid);

      if (wasAvailable === false && isAvailable) {
        summary.activated.push(effect);
        continue;
      }

      if (wasAvailable === true && !isAvailable) {
        summary.deactivated.push(effect);
      }
    }

    summary.hasTransitions = summary.activated.length > 0 || summary.deactivated.length > 0;
    return summary;
  }

  static #forceTransitionReprepare(actor, conditionalEffects = null, transitionSummary = null) {
    if (!(actor instanceof CONFIG.Actor.documentClass)) {
      return false;
    }

    if (ActiveEffectConditionHooks.#actorsInTransitionForceRefresh.has(actor.uuid)) {
      ActiveEffectConditionHooks.#debug("skipping recursive transition force refresh", {
        actor: actor.uuid
      });
      return false;
    }

    ActiveEffectConditionHooks.#actorsInTransitionForceRefresh.add(actor.uuid);

    try {
      ActiveEffectConditionHooks.#debug("forcing actor reprepare after conditional transition", {
        actor: actor.uuid,
        activatedEffects: transitionSummary?.activated?.map(effect => effect.uuid) ?? [],
        deactivatedEffects: transitionSummary?.deactivated?.map(effect => effect.uuid) ?? []
      });

      // One extra reset gives newly unsuppressed/suppressed changes an immediate runtime pass
      // without risking an unbounded loop on self-referential or oscillating conditions.
      ActiveEffectConditionHooks.#refreshEffectSuppressionState(actor, conditionalEffects, { phase: "transition-force" });
      actor.reset();
      return true;
    } catch (error) {
      try {
        console.warn(`[${Constants.MODULE_ID}] could not force actor refresh after condition transition`, {
          actor: actor?.uuid ?? actor?.name ?? actor,
          error
        });
      } catch {
        // Ignore logging failures caused by stale document state while the world is updating.
      }
    } finally {
      ActiveEffectConditionHooks.#actorsInTransitionForceRefresh.delete(actor.uuid);
    }

    return false;
  }

  static #handleConditionalTransitions(actor, previousState, conditionalEffects = null, {
    currentState = null,
    triggerConditionalActivation = false
  } = {}) {
    const nextState = currentState ?? ActiveEffectConditionHooks.#getConditionalEffectState(actor, conditionalEffects);

    for (const effect of conditionalEffects ?? ActiveEffectConditionHooks.#getConditionalEffects(actor)) {
      const wasAvailable = previousState.get(effect.uuid);
      const isAvailable = nextState.get(effect.uuid);
      if (!ActiveEffectConditionHooks.#isEffectDocumentEnabled(effect)) {
        continue;
      }

      if (wasAvailable === false && isAvailable) {
        ActiveEffectConditionHooks.#debug("conditional effect became active", {
          actor: actor.uuid,
          effect: effect.uuid,
          hasFormulaChanges: ModuleSettings.isFormulaChangesEnabled()
            && ActiveEffectFormulaChangeService.hasFormulaChanges(effect),
          hasExecutableMacro: ActiveEffectMacroChangeService.hasExecutableMacro(effect)
        });
        if (ActiveEffectMacroChangeService.hasExecutableMacro(effect)) {
          // Every client tracks the new state, but only the responsible user executes the
          // macro — this handler runs on all clients via the actor/effect update hooks.
          ActiveEffectMacroChangeHooks.syncEvaluatedState(effect, true, {
            execute: ActiveEffectMacroChangeService.isResponsibleForExecution(effect)
          });
        }

        if (
          triggerConditionalActivation
          && ModuleSettings.isFormulaChangesEnabled()
          && ActiveEffectFormulaChangeService.hasFormulaChanges(effect)
        ) {
          ActiveEffectConditionHooks.#rollActivatedEffectFormula(effect);
        }
        continue;
      }

      if (wasAvailable === true && !isAvailable && ActiveEffectMacroChangeService.hasExecutableMacro(effect)) {
        ActiveEffectConditionHooks.#debug("conditional effect became inactive", {
          actor: actor.uuid,
          effect: effect.uuid
        });
        ActiveEffectMacroChangeHooks.syncEvaluatedState(effect, false, {
          execute: ActiveEffectMacroChangeService.isResponsibleForExecution(effect)
        });
      }
    }
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
        if (
          ActiveEffectConditionService.hasCondition(effect)
          && !ActiveEffectTransferHooks.shouldSkipTransferredItemApplication(effect, actor)
        ) {
          effects.push(effect);
        }
      }
    }

    return effects;
  }

  static #shouldSkipChangeApplication(effect, model) {
    if (ActiveEffectTransferHooks.shouldSkipTransferredItemApplication(effect, model)) {
      return true;
    }

    if (!ActiveEffectConditionService.hasCondition(effect)) {
      return false;
    }

    if (!ActiveEffectConditionHooks.#isEffectDocumentEnabled(effect)) {
      return false;
    }

    const actor = model instanceof CONFIG.Actor.documentClass
      ? model
      : ActiveEffectContextBuilder.getAffectedActor(effect);
    const available = ActiveEffectConditionHooks.#resolveConditionAvailability(effect, actor);

    ActiveEffectConditionHooks.#debug("evaluated change application gate", {
      effect: effect?.uuid ?? effect?.id ?? null,
      model: model?.uuid ?? model?.id ?? null,
      actor: actor?.uuid ?? actor?.id ?? null,
      actorBonuses: ActiveEffectConditionHooks.#describeActorBonuses(actor),
      available,
      effectDisabled: effect?.disabled ?? null
    });

    if (!available) {
      ActiveEffectConditionHooks.#debug("skipping change application for conditional effect", {
        effect: effect?.uuid ?? effect?.id ?? null,
        actor: actor?.uuid ?? actor?.id ?? null,
        model: model?.uuid ?? model?.id ?? null
      });
    }

    return !available;
  }

  static #applyConditionSuppression(effect) {
    if (!effect || !ActiveEffectConditionHooks.#hasConditionSuppressionState(effect)) {
      return;
    }

    const conditionSuppressed = ActiveEffectConditionHooks.#isConditionSuppressed(effect);
    ActiveEffectConditionHooks.#debug("determineSuppression wrapper evaluated conditional state", {
      effect: effect?.uuid ?? effect?.id ?? null,
      parent: effect?.parent?.uuid ?? effect?.parent?.id ?? null,
      disabled: effect?.disabled ?? null,
      conditionSuppressed
    });
  }

  static #isConditionSuppressed(effect, actor = null) {
    if (!ActiveEffectConditionHooks.#hasConditionSuppressionState(effect)) {
      return false;
    }

    return !ActiveEffectConditionHooks.#resolveConditionAvailability(
      effect,
      actor ?? ActiveEffectContextBuilder.getAffectedActor(effect)
    );
  }

  static #hasConditionSuppressionState(effect) {
    return ActiveEffectConditionService.hasCondition(effect)
      && ActiveEffectConditionHooks.#isEffectDocumentEnabled(effect);
  }

  static #resolveConditionAvailability(effect, actor) {
    // The change-application gate runs during applyActiveEffects, before dnd5e computes
    // derived data such as hp.max or ac. Conditions that read those fields would evaluate
    // against half-prepared data here, so prefer the availability cached from the last
    // fully prepared pass and only evaluate live when no cached value exists yet.
    const cached = ActiveEffectConditionHooks.#getCachedConditionAvailability(actor, effect);
    if (cached !== undefined) {
      return cached;
    }

    return ActiveEffectConditionHooks.#isConditionAvailable(effect, actor);
  }

  static #getCachedConditionAvailability(actor, effect) {
    const actorUuid = actor?.uuid;
    const effectUuid = effect?.uuid;
    if (!actorUuid || !effectUuid) {
      return undefined;
    }

    return ActiveEffectConditionHooks.#cachedConditionAvailability.get(actorUuid)?.get(effectUuid);
  }

  static #isConditionAvailable(effect, actor = null) {
    const evaluation = ActiveEffectConditionService.evaluate(effect, {
      actor: actor ?? ActiveEffectContextBuilder.getAffectedActor(effect)
    });
    ActiveEffectConditionHooks.#debug("evaluated condition availability", {
      effect: effect?.uuid ?? effect?.id ?? null,
      actor: actor?.uuid ?? actor?.id ?? null,
      actorBonuses: ActiveEffectConditionHooks.#describeActorBonuses(actor),
      result: evaluation.result,
      available: evaluation.available,
      error: evaluation.error?.message ?? null,
      effectDisabled: effect?.disabled ?? null
    });
    return !evaluation.error && evaluation.available;
  }

  static #didConditionStateChange(previousState, currentState) {
    if (previousState.size !== currentState.size) {
      return true;
    }

    for (const [effectUuid, available] of currentState.entries()) {
      if (previousState.get(effectUuid) !== available) {
        return true;
      }
    }

    return false;
  }

  static #isEffectDocumentEnabled(effect) {
    return effect?.disabled !== true;
  }

  static #refreshEffectSuppressionState(actor, conditionalEffects = null, { phase = "unknown" } = {}) {
    for (const effect of conditionalEffects ?? ActiveEffectConditionHooks.#getConditionalEffects(actor)) {
      if (!ActiveEffectConditionHooks.#hasConditionSuppressionState(effect)) {
        continue;
      }

      if (typeof effect?.determineSuppression === "function") {
        try {
          effect.determineSuppression();
        } catch (error) {
          ActiveEffectConditionHooks.#debug("determineSuppression threw during refresh", {
            phase,
            actor: actor?.uuid ?? actor?.id ?? null,
            effect: effect?.uuid ?? effect?.id ?? null,
            error: error?.message ?? String(error)
          });
        }
      }

      ActiveEffectConditionHooks.#debug("refreshed conditional effect suppression state", {
        phase,
        actor: actor?.uuid ?? actor?.id ?? null,
        effect: effect?.uuid ?? effect?.id ?? null,
        disabled: effect?.disabled ?? null,
        actorBonuses: ActiveEffectConditionHooks.#describeActorBonuses(actor)
      });
    }
  }

  static #describeActorBonuses(actor) {
    return {
      mwak: foundry.utils.getProperty(actor ?? {}, "system.bonuses.mwak.damage") ?? null,
      rwak: foundry.utils.getProperty(actor ?? {}, "system.bonuses.rwak.damage") ?? null,
      msak: foundry.utils.getProperty(actor ?? {}, "system.bonuses.msak.damage") ?? null,
      rsak: foundry.utils.getProperty(actor ?? {}, "system.bonuses.rsak.damage") ?? null
    };
  }

  static #hasTargetMethod(path) {
    let current = globalThis;

    for (const segment of path.split(".")) {
      current = current?.[segment];
      if (current === undefined || current === null) {
        return false;
      }
    }

    return typeof current === "function";
  }

  static #debug(message, data = undefined) {
    if (!ModuleSettings.isDebugLoggingEnabled() && !globalThis[Constants.DEBUG_GLOBAL]) {
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
