import { Constants } from "../constants/Constants.js";
import { DebugLog } from "../helpers/DebugLog.js";
import { ActiveEffectContextBuilder } from "../helpers/ActiveEffectContextBuilder.js";
import { ActiveEffectFormulaChatCardService } from "../services/ActiveEffectFormulaChatCardService.js";
import { ActiveEffectFormulaChangeService } from "../services/ActiveEffectFormulaChangeService.js";
import { ActiveEffectMacroChangeService } from "../services/ActiveEffectMacroChangeService.js";
import { ActiveEffectConditionService } from "../services/ActiveEffectConditionService.js";
import { Dnd5e6ChangeConditionService } from "../services/Dnd5e6ChangeConditionService.js";
import { TokenLightingService } from "../services/TokenLightingService.js";
import { ActiveEffectTransferHooks } from "./ActiveEffectTransferHooks.js";
import { ActiveEffectMacroChangeHooks } from "./ActiveEffectMacroChangeHooks.js";
import { ModuleSettings } from "../settings/ModuleSettings.js";

export class ActiveEffectConditionHooks {
  static #effectApplicationPatched = false;
  static #effectSuppressionPatched = false;
  static #effectRefreshHooksRegistered = false;
  static #pendingActorRefreshes = new Map();
  static #cachedConditionAvailability = new Map();
  static #cachedActorLightLevels = new Map();
  static #actorsInTransitionForceRefresh = new Set();
  static #conditionDisableSyncsInFlight = new Set();
  static #refreshFlushScheduled = false;
  static #lightingDependencyRefreshScheduled = false;
  static #lightingDependencyRefreshForce = false;
  static #readyRefreshScheduled = false;
  static #LIGHTING_REFRESH_THROTTLE_MS = 50;
  static #CONDITION_DISABLE_SYNC_OPTION = "conditionDisableSync";
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
          if (ActiveEffectConditionHooks.#shouldSkipChangeApplication(change?.effect, change, model)) {
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
          if (ActiveEffectConditionHooks.#shouldSkipChangeApplication(change?.effect ?? this, change, model)) {
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
        if (ActiveEffectConditionHooks.#shouldSkipChangeApplication(change?.effect, change, model)) {
          return {};
        }

        return originalApplyChange.call(this, model, change, options);
      };
    }

    if (typeof prototype.apply === "function") {
      const originalApply = prototype.apply;
      prototype.apply = function(model, change, ...args) {
        if (ActiveEffectConditionHooks.#shouldSkipChangeApplication(change?.effect ?? this, change, model)) {
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
    Hooks.on("createToken", ActiveEffectConditionHooks.#onTokenCreatedOrDeleted);
    Hooks.on("moveToken", ActiveEffectConditionHooks.#onTokenMoved);
    Hooks.on("updateToken", ActiveEffectConditionHooks.#onTokenUpdated);
    Hooks.on("deleteToken", ActiveEffectConditionHooks.#onTokenCreatedOrDeleted);
    Hooks.on("lightingRefresh", ActiveEffectConditionHooks.#onLightingRefresh);
    Hooks.on("canvasReady", ActiveEffectConditionHooks.#onCanvasReady);
    Hooks.on("canvasTearDown", ActiveEffectConditionHooks.#onCanvasTearDown);
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

  static #onActiveEffectChanged(effect, ...args) {
    const isConditionDisableSync = args.some(value => (
      value?.[Constants.MODULE_ID]?.[ActiveEffectConditionHooks.#CONDITION_DISABLE_SYNC_OPTION] === true
    ));
    if (isConditionDisableSync) {
      ActiveEffectConditionHooks.#debug("ignoring condition-managed disabled state update", {
        effect: effect?.uuid ?? effect?.id ?? null,
        disabled: effect?.disabled ?? null
      });
      return;
    }

    const actor = ActiveEffectContextBuilder.getAffectedActor(effect);
    if (!(actor instanceof CONFIG.Actor.documentClass)) {
      return;
    }

    if (
      !ActiveEffectConditionService.hasCondition(effect)
      && !ActiveEffectConditionService.isConditionManagedDisabled(effect)
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

  static #onTokenMoved(tokenDocument) {
    if (!ActiveEffectConditionHooks.#isTokenOnCurrentCanvasScene(tokenDocument)) {
      return;
    }

    const actor = tokenDocument?.actor ?? tokenDocument?.object?.actor ?? null;
    const isSelectedToken = actor instanceof CONFIG.Actor.documentClass
      && ActiveEffectConditionHooks.#isSelectedActorToken(actor, tokenDocument);
    if (
      isSelectedToken
      && ActiveEffectConditionHooks.#actorHasDirectTokenConditionedEffects(actor)
    ) {
      ActiveEffectConditionHooks.#debug("token changed; scheduling token-dependent condition refresh", {
        actor: actor.uuid,
        token: tokenDocument?.uuid ?? tokenDocument?.id ?? null
      });
      ActiveEffectConditionHooks.#scheduleActorRefresh(actor);
    }

    if (
      (
        isSelectedToken
        && ActiveEffectConditionHooks.#actorHasLightingConditionedEffects(actor)
      )
      || ActiveEffectConditionHooks.#tokenEmitsLight(tokenDocument)
    ) {
      ActiveEffectConditionHooks.#scheduleLightingDependencyRefresh();
    }
  }

  static #onTokenUpdated(tokenDocument, changes = {}) {
    if (!ActiveEffectConditionHooks.#isTokenOnCurrentCanvasScene(tokenDocument)) {
      return;
    }

    const changedKeys = Object.keys(changes ?? {});
    const isMovementOnly = changedKeys.length > 0
      && changedKeys.every(key => ["x", "y", "elevation"].includes(key));
    if (isMovementOnly) {
      return;
    }

    const actor = tokenDocument?.actor ?? tokenDocument?.object?.actor ?? null;
    if (
      actor instanceof CONFIG.Actor.documentClass
      && ActiveEffectConditionHooks.#isSelectedActorToken(actor, tokenDocument)
      && ActiveEffectConditionHooks.#actorHasDirectTokenConditionedEffects(actor)
    ) {
      ActiveEffectConditionHooks.#scheduleActorRefresh(actor);
    }

    if (changedKeys.some(key => ["width", "height", "rotation", "hidden", "light"].includes(key))) {
      TokenLightingService.invalidateCache();
      ActiveEffectConditionHooks.#scheduleLightingDependencyRefresh();
    }
  }

  static #onTokenCreatedOrDeleted(tokenDocument) {
    if (!ActiveEffectConditionHooks.#isTokenOnCurrentCanvasScene(tokenDocument)) {
      return;
    }

    const actor = tokenDocument?.actor ?? tokenDocument?.object?.actor ?? null;
    if (
      actor instanceof CONFIG.Actor.documentClass
      && ActiveEffectConditionHooks.#actorHasTokenConditionedEffects(actor)
    ) {
      ActiveEffectConditionHooks.#scheduleActorRefresh(actor);
    }
    TokenLightingService.invalidateCache();
    ActiveEffectConditionHooks.#scheduleLightingDependencyRefresh();
  }

  static #onLightingRefresh() {
    TokenLightingService.invalidateCache();
    ActiveEffectConditionHooks.#scheduleLightingDependencyRefresh();
  }

  static #onCanvasReady() {
    TokenLightingService.clearCache();
    ActiveEffectConditionHooks.#cachedActorLightLevels.clear();
    ActiveEffectConditionHooks.#scheduleLightingDependencyRefresh({ force: true });
  }

  static #onCanvasTearDown() {
    TokenLightingService.clearCache();
    ActiveEffectConditionHooks.#cachedActorLightLevels.clear();
  }

  static #scheduleLightingDependencyRefresh({ force = false } = {}) {
    ActiveEffectConditionHooks.#lightingDependencyRefreshForce ||= force;
    if (ActiveEffectConditionHooks.#lightingDependencyRefreshScheduled) {
      return;
    }

    ActiveEffectConditionHooks.#lightingDependencyRefreshScheduled = true;
    window.setTimeout(() => {
      const shouldForce = ActiveEffectConditionHooks.#lightingDependencyRefreshForce;
      ActiveEffectConditionHooks.#lightingDependencyRefreshScheduled = false;
      ActiveEffectConditionHooks.#lightingDependencyRefreshForce = false;
      ActiveEffectConditionHooks.#refreshLightingDependencies({ force: shouldForce });
    }, ActiveEffectConditionHooks.#LIGHTING_REFRESH_THROTTLE_MS);
  }

  static #refreshLightingDependencies({ force = false } = {}) {
    const actors = new Map();
    for (const token of canvas?.tokens?.placeables ?? []) {
      const actor = token?.actor;
      if (
        actor instanceof CONFIG.Actor.documentClass
        && !actors.has(actor.uuid)
        && ActiveEffectConditionHooks.#actorHasLightingConditionedEffects(actor)
      ) {
        actors.set(actor.uuid, actor);
      }
    }

    const activeActorUuids = new Set(actors.keys());
    for (const actorUuid of ActiveEffectConditionHooks.#cachedActorLightLevels.keys()) {
      if (!activeActorUuids.has(actorUuid)) {
        ActiveEffectConditionHooks.#cachedActorLightLevels.delete(actorUuid);
      }
    }

    for (const actor of actors.values()) {
      const token = TokenLightingService.getToken(actor);
      const lightLevel = TokenLightingService.getLightLevel(token);
      const previousLightLevel = ActiveEffectConditionHooks.#cachedActorLightLevels.get(actor.uuid);
      ActiveEffectConditionHooks.#cachedActorLightLevels.set(actor.uuid, lightLevel);

      if (!force && previousLightLevel === lightLevel) {
        continue;
      }

      const conditionState = ActiveEffectConditionHooks.#getLightingConditionState(actor, token, lightLevel);
      if (!force && !conditionState.changed) {
        continue;
      }

      ActiveEffectConditionHooks.#debug("lighting changed; scheduling lighting-dependent condition refresh", {
        actor: actor.uuid,
        token: token?.document?.uuid ?? token?.id ?? null,
        previousLightLevel: previousLightLevel ?? null,
        lightLevel
      });
      ActiveEffectConditionHooks.#scheduleActorRefresh(actor, {
        precomputedConditionState: conditionState.state
      });
    }
  }

  static #getLightingConditionState(actor, token, lightLevel) {
    const cachedState = ActiveEffectConditionHooks.#cachedConditionAvailability.get(actor.uuid);
    const state = new Map();
    let changed = !cachedState;

    for (const effect of ActiveEffectConditionHooks.#getConditionalEffects(actor)) {
      const usesGlobalLighting = ActiveEffectConditionService.usesLightingContext(effect);
      const usesChangeLighting = Dnd5e6ChangeConditionService.usesLightingContext(effect);
      if (!usesGlobalLighting && !usesChangeLighting) {
        continue;
      }

      let globalAvailable = cachedState?.get(effect.uuid);
      if (usesGlobalLighting || globalAvailable === undefined) {
        const evaluation = ActiveEffectConditionService.evaluate(effect, { actor, token, lightLevel });
        globalAvailable = !evaluation.error && evaluation.available;
        if (usesGlobalLighting) {
          state.set(effect.uuid, globalAvailable);
          if (cachedState?.get(effect.uuid) !== globalAvailable) changed = true;
        }
      }

      if (usesChangeLighting) {
        for (const { change, changeId } of Dnd5e6ChangeConditionService.getConditionedChanges(effect)) {
          if (!Dnd5e6ChangeConditionService.usesLightingContext(effect, change)) continue;
          const key = ActiveEffectConditionHooks.#getChangeConditionStateKey(effect, changeId);
          const evaluation = Dnd5e6ChangeConditionService.evaluate(effect, change, {
            actor,
            token,
            lightLevel
          });
          // Same contract as the cache it is compared against: the change's own layer.
          const available = Boolean(!evaluation.error && evaluation.available);
          state.set(key, available);
          if (cachedState?.get(key) !== available) changed = true;
        }
      }
    }

    return { changed, state };
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

  static #scheduleActorRefresh(actor, { precomputedConditionState = null } = {}) {
    const existing = ActiveEffectConditionHooks.#pendingActorRefreshes.get(actor.uuid);
    let mergedPrecomputedState = precomputedConditionState instanceof Map
      ? new Map(precomputedConditionState)
      : null;
    if (existing) {
      if (existing.precomputedConditionState instanceof Map && mergedPrecomputedState) {
        mergedPrecomputedState = new Map([
          ...existing.precomputedConditionState,
          ...mergedPrecomputedState
        ]);
      } else {
        // A general Actor/Item/Effect update may change data used alongside lightLevel,
        // so a lighting-only preflight is not authoritative for that combined refresh.
        mergedPrecomputedState = null;
      }
    }
    ActiveEffectConditionHooks.#pendingActorRefreshes.set(actor.uuid, {
      actor,
      triggerConditionalActivation: existing?.triggerConditionalActivation ?? true,
      precomputedConditionState: mergedPrecomputedState
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
          {
            triggerConditionalActivation: pendingActor.triggerConditionalActivation,
            precomputedConditionState: pendingActor.precomputedConditionState
          }
        );
      }
    }, 0);
  }

  static async #refreshActor(actor, {
    triggerConditionalActivation = false,
    handleTransitions = true,
    renderApplications = true,
    precomputedConditionState = null
  } = {}) {
    if (!(actor instanceof CONFIG.Actor.documentClass)) {
      return;
    }

    const previousConditionState = ActiveEffectConditionHooks.#getCachedConditionalEffectState(actor);
    const conditionalEffects = ActiveEffectConditionHooks.#getConditionalEffects(actor);
    let stateUsedForReset = previousConditionState;
    if (previousConditionState && precomputedConditionState instanceof Map) {
      stateUsedForReset = new Map(previousConditionState);
      for (const [effectUuid, available] of precomputedConditionState) {
        stateUsedForReset.set(effectUuid, available);
      }
      ActiveEffectConditionHooks.#cacheConditionalEffectState(actor, conditionalEffects, stateUsedForReset);
    }
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
      if (previousConditionState) {
        ActiveEffectConditionHooks.#cacheConditionalEffectState(actor, conditionalEffects, previousConditionState);
      }
      ActiveEffectConditionHooks.#cachedActorLightLevels.delete(actor.uuid);
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
      const gateStateChanged = !stateUsedForReset
        || ActiveEffectConditionHooks.#didConditionStateChange(stateUsedForReset, currentConditionState);
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

      const disableSync = await ActiveEffectConditionHooks.#syncConditionDisabledStates(
        actor,
        conditionalEffects,
        currentConditionState
      );

      if (handleTransitions && previousConditionState) {
        ActiveEffectConditionHooks.#handleConditionalTransitions(
          actor,
          previousConditionState,
          conditionalEffects,
          {
            currentState: currentConditionState,
            triggerConditionalActivation,
            autoReactivatedEffectUuids: disableSync.reactivatedEffectUuids
          }
        );
      }

      ActiveEffectConditionHooks.#pruneCachedConditionState(actor);

      if (
        renderApplications
        && (
          !previousConditionState
          || ActiveEffectConditionHooks.#didConditionStateChange(previousConditionState, currentConditionState)
          || disableSync.changed
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

  static #actorHasLightingConditionedEffects(actor) {
    return ActiveEffectConditionHooks.#getConditionalEffects(actor).some(effect => (
      ActiveEffectConditionService.usesLightingContext(effect)
      || Dnd5e6ChangeConditionService.usesLightingContext(effect)
    ));
  }

  static #actorHasDirectTokenConditionedEffects(actor) {
    return ActiveEffectConditionHooks.#getConditionalEffects(actor).some(effect => (
      ActiveEffectConditionService.usesDirectTokenContext(effect)
      || Dnd5e6ChangeConditionService.usesDirectTokenContext(effect)
    ));
  }

  static #actorHasTokenConditionedEffects(actor) {
    return ActiveEffectConditionHooks.#getConditionalEffects(actor).some(effect => (
      ActiveEffectConditionService.usesTokenContext(effect)
      || Dnd5e6ChangeConditionService.usesTokenContext(effect)
    ));
  }

  static #isSelectedActorToken(actor, tokenDocument) {
    const selectedToken = TokenLightingService.getToken(actor);
    const selectedDocument = selectedToken?.document ?? selectedToken;
    return selectedDocument === tokenDocument
      || (
        selectedDocument?.id
        && selectedDocument.id === tokenDocument?.id
        && selectedDocument?.parent?.id === tokenDocument?.parent?.id
      );
  }

  static #isTokenOnCurrentCanvasScene(tokenDocument) {
    const currentSceneId = globalThis.canvas?.scene?.id;
    if (!currentSceneId) {
      return false;
    }

    let parent = tokenDocument?.parent ?? null;
    if (parent?.id === currentSceneId) {
      return true;
    }
    while (parent && parent.documentName !== "Scene" && parent.constructor?.metadata?.name !== "Scene") {
      parent = parent.parent ?? null;
    }
    const sceneId = parent?.id ?? tokenDocument?.object?.scene?.id ?? null;
    return sceneId === currentSceneId;
  }

  static #tokenEmitsLight(tokenDocument) {
    const light = tokenDocument?.light ?? tokenDocument?.object?.document?.light ?? null;
    return Math.max(
      Math.abs(Number(light?.dim ?? 0)),
      Math.abs(Number(light?.bright ?? 0))
    ) > 0;
  }

  static #itemHasConditionedEffects(item) {
    if (!(item instanceof CONFIG.Item.documentClass)) {
      return false;
    }

    const actor = item.actor ?? item.parent ?? null;
    return (item.effects ?? []).some(effect => (
      (
        ActiveEffectConditionService.hasCondition(effect)
        || ActiveEffectConditionService.isConditionManagedDisabled(effect)
        || Dnd5e6ChangeConditionService.hasAnyCondition(effect)
      )
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
      const globalAvailable = ActiveEffectConditionHooks.#isConditionAvailable(effect, actor);
      state.set(effect.uuid, globalAvailable);
      // Unconditioned changes are recorded too. A key that is missing then means
      // the change did not exist, which is what separates "a condition was just
      // added" from "this change is brand new".
      //
      // The value is the change's OWN layer, never folded with the effect-wide
      // one: folding it would report a per-change transition every time the
      // effect itself flipped, on top of the effect transition already raised.
      for (const change of Dnd5e6ChangeConditionService.getChanges(effect)) {
        const changeId = Dnd5e6ChangeConditionService.getChangeId(change);
        if (!changeId) continue;
        state.set(
          ActiveEffectConditionHooks.#getChangeConditionStateKey(effect, changeId),
          ActiveEffectConditionHooks.#isChangeConditionAvailable(effect, change, actor)
        );
      }
    }

    return state;
  }

  /** A change's own condition layer. Unconditioned changes always allow. */
  static #isChangeConditionAvailable(effect, change, actor) {
    if (!Dnd5e6ChangeConditionService.hasCondition(effect, change)) {
      return true;
    }

    const evaluation = Dnd5e6ChangeConditionService.evaluate(effect, change, { actor });
    return Boolean(!evaluation.error && evaluation.available);
  }

  static #cacheConditionalEffectState(actor, conditionalEffects = null, state = null) {
    const nextState = state ?? ActiveEffectConditionHooks.#getConditionalEffectState(actor, conditionalEffects);

    if (!nextState.size) {
      ActiveEffectConditionHooks.#cachedConditionAvailability.delete(actor.uuid);
      return;
    }

    ActiveEffectConditionHooks.#cachedConditionAvailability.set(actor.uuid, new Map(nextState));
  }

  static #pruneCachedConditionState(actor) {
    const cachedState = ActiveEffectConditionHooks.#cachedConditionAvailability.get(actor.uuid);
    if (!cachedState) {
      return;
    }

    const currentEffectUuids = new Set();
    for (const effect of ActiveEffectConditionHooks.#getConditionalEffects(actor)) {
      currentEffectUuids.add(effect.uuid);
      for (const change of Dnd5e6ChangeConditionService.getChanges(effect)) {
        const changeId = Dnd5e6ChangeConditionService.getChangeId(change);
        if (changeId) {
          currentEffectUuids.add(ActiveEffectConditionHooks.#getChangeConditionStateKey(effect, changeId));
        }
      }
    }
    for (const effectUuid of cachedState.keys()) {
      if (!currentEffectUuids.has(effectUuid)) {
        cachedState.delete(effectUuid);
      }
    }

    if (!cachedState.size) {
      ActiveEffectConditionHooks.#cachedConditionAvailability.delete(actor.uuid);
    }
  }

  static #summarizeConditionalTransitions(previousState, currentState, conditionalEffects = null) {
    const summary = {
      activated: [],
      deactivated: [],
      hasTransitions: false
    };

    for (const effect of conditionalEffects ?? []) {
      if (!ActiveEffectConditionHooks.#isEligibleForConditionTransition(effect)) {
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
    triggerConditionalActivation = false,
    autoReactivatedEffectUuids = new Set()
  } = {}) {
    const nextState = currentState ?? ActiveEffectConditionHooks.#getConditionalEffectState(actor, conditionalEffects);

    for (const effect of conditionalEffects ?? ActiveEffectConditionHooks.#getConditionalEffects(actor)) {
      const wasAvailable = previousState.get(effect.uuid);
      const isAvailable = nextState.get(effect.uuid);
      if (!ActiveEffectConditionHooks.#isEligibleForConditionTransition(effect)) {
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
          && !autoReactivatedEffectUuids.has(effect.uuid)
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

      // A global transition already executes all currently relevant operations.
      // Only inspect individual transitions while the global layer stayed available.
      if (wasAvailable === true && isAvailable === true) {
        ActiveEffectConditionHooks.#handleChangeConditionTransitions(
          effect,
          previousState,
          nextState,
          { triggerConditionalActivation }
        );
      }
    }
  }

  static #handleChangeConditionTransitions(effect, previousState, currentState, {
    triggerConditionalActivation = false
  } = {}) {
    const activatedIds = [];
    const deactivatedIds = [];
    const activatedFormulaIndexes = [];
    const indexesById = new Map();
    const changes = Dnd5e6ChangeConditionService.getChanges(effect);
    for (let index = 0; index < changes.length; index += 1) {
      const changeId = Dnd5e6ChangeConditionService.getChangeId(changes[index]);
      if (changeId) indexesById.set(changeId, index);
    }

    // Walking only the currently conditioned changes missed three transitions:
    // adding a condition that reads false (the change was applying until now),
    // removing a false condition (it starts applying again), and deleting a
    // change outright (its cleanup still has to run).
    const prefix = `${effect.uuid}::change::`;
    const trackedIds = new Set(indexesById.keys());
    for (const key of previousState.keys()) {
      if (key.startsWith(prefix)) trackedIds.add(key.slice(prefix.length));
    }

    for (const changeId of trackedIds) {
      const key = ActiveEffectConditionHooks.#getChangeConditionStateKey(effect, changeId);
      const wasAvailable = previousState.get(key);
      // A change the previous pass never saw is new, not a transition.
      if (wasAvailable === undefined) continue;

      const index = indexesById.get(changeId);
      const isAvailable = index === undefined ? false : currentState.get(key) === true;
      if (!wasAvailable && isAvailable) {
        activatedIds.push(changeId);
        if (index !== undefined && ActiveEffectFormulaChangeService.getFormulaForChange(effect, index)) {
          activatedFormulaIndexes.push(index);
        }
      } else if (wasAvailable && !isAvailable) {
        deactivatedIds.push(changeId);
      }
    }

    if (ActiveEffectMacroChangeService.isResponsibleForExecution(effect)) {
      if (activatedIds.length) {
        void ActiveEffectMacroChangeService.execute(effect, "on", { changeIds: activatedIds });
      }
      if (deactivatedIds.length) {
        void ActiveEffectMacroChangeService.execute(effect, "off", { changeIds: deactivatedIds });
      }
    }

    if (triggerConditionalActivation && activatedFormulaIndexes.length) {
      ActiveEffectConditionHooks.#rollActivatedEffectFormula(effect, activatedFormulaIndexes);
    }
  }

  static #rollActivatedEffectFormula(effect, changeIndexes = null) {
    if (
      !ModuleSettings.isFormulaChangesEnabled()
      || !ActiveEffectFormulaChangeService.canPromptForRoll(effect)
    ) {
      return;
    }

    ActiveEffectFormulaChatCardService.requestRoll(effect, { reason: "condition", changeIndexes })
      .catch(error => console.warn(`[${Constants.MODULE_ID}] active effect condition formula activation failed`, error));
  }

  static #getConditionalEffects(actor) {
    const effects = [];

    for (const effect of actor.effects ?? []) {
      if (
        ActiveEffectConditionService.hasCondition(effect)
        || ActiveEffectConditionService.isConditionManagedDisabled(effect)
        || Dnd5e6ChangeConditionService.hasAnyCondition(effect)
      ) {
        effects.push(effect);
      }
    }

    for (const item of actor.items ?? []) {
      for (const effect of item.effects ?? []) {
        if (
          (
            ActiveEffectConditionService.hasCondition(effect)
            || ActiveEffectConditionService.isConditionManagedDisabled(effect)
            || Dnd5e6ChangeConditionService.hasAnyCondition(effect)
          )
          && !ActiveEffectTransferHooks.shouldSkipTransferredItemApplication(effect, actor)
        ) {
          effects.push(effect);
        }
      }
    }

    return effects;
  }

  static #shouldSkipChangeApplication(effect, change, model) {
    if (ActiveEffectTransferHooks.shouldSkipTransferredItemApplication(effect, model)) {
      return true;
    }

    const hasGlobalCondition = ActiveEffectConditionService.hasCondition(effect);
    const hasChangeCondition = Dnd5e6ChangeConditionService.hasCondition(effect, change);
    if (!hasGlobalCondition && !hasChangeCondition) {
      return false;
    }

    if (!ActiveEffectConditionHooks.#isEffectDocumentEnabled(effect)) {
      return false;
    }

    const actor = model instanceof CONFIG.Actor.documentClass
      ? model
      : ActiveEffectContextBuilder.getAffectedActor(effect);
    const globalAvailable = !hasGlobalCondition
      || ActiveEffectConditionHooks.#resolveConditionAvailability(effect, actor);

    // #getConditionalEffectState caches the combined effect-and-change verdict
    // under the change key. Prefer it for the same reason the effect-wide gate
    // does — this runs before derived data exists — and so a sheet with many
    // conditioned changes does not recompile every condition on each pass.
    let changeEvaluation = { available: true, error: null };
    let available = globalAvailable;
    if (hasChangeCondition) {
      const changeId = Dnd5e6ChangeConditionService.getChangeId(change);
      const cached = ActiveEffectConditionHooks.#getCachedConditionAvailability(actor, effect, changeId);
      if (cached === undefined) {
        changeEvaluation = Dnd5e6ChangeConditionService.evaluate(effect, change, { actor });
      } else {
        changeEvaluation = { available: cached, error: null };
      }
      available = Boolean(globalAvailable && changeEvaluation.available);
    }

    ActiveEffectConditionHooks.#debug("evaluated change application gate", {
      effect: effect?.uuid ?? effect?.id ?? null,
      model: model?.uuid ?? model?.id ?? null,
      actor: actor?.uuid ?? actor?.id ?? null,
      actorBonuses: ActiveEffectConditionHooks.#describeActorBonuses(actor),
      changeId: Dnd5e6ChangeConditionService.getChangeId(change) || null,
      globalAvailable,
      changeAvailable: changeEvaluation.available,
      changeError: changeEvaluation.error?.message ?? null,
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

  static #getCachedConditionAvailability(actor, effect, changeId = null) {
    const actorUuid = actor?.uuid;
    const effectUuid = effect?.uuid;
    if (!actorUuid || !effectUuid) {
      return undefined;
    }

    const key = changeId
      ? ActiveEffectConditionHooks.#getChangeConditionStateKey(effect, changeId)
      : effectUuid;
    return ActiveEffectConditionHooks.#cachedConditionAvailability.get(actorUuid)?.get(key);
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

  static #getChangeConditionStateKey(effect, changeId) {
    return `${effect.uuid}::change::${changeId}`;
  }

  static #isEffectDocumentEnabled(effect) {
    return effect?.disabled !== true;
  }

  static #isEligibleForConditionTransition(effect) {
    return ActiveEffectConditionHooks.#isEffectDocumentEnabled(effect)
      || ActiveEffectConditionService.isConditionManagedDisabled(effect);
  }

  static async #syncConditionDisabledStates(actor, conditionalEffects, currentConditionState) {
    const result = {
      changed: false,
      reactivatedEffectUuids: new Set()
    };

    if (!ActiveEffectConditionHooks.#isResponsibleForConditionDisableSync(actor)) {
      return result;
    }

    for (const effect of conditionalEffects ?? []) {
      const effectUuid = effect?.uuid;
      if (!effectUuid || ActiveEffectConditionHooks.#conditionDisableSyncsInFlight.has(effectUuid)) {
        continue;
      }

      const hasCondition = ActiveEffectConditionService.hasCondition(effect);
      // Spatial context is local to a rendered token. Persisting disabled for it can create
      // cross-client races or disable a linked Actor shared by tokens in different locations.
      const usesDisableBehavior = ActiveEffectConditionService.usesDisableBehavior(effect)
        && !ActiveEffectConditionService.usesTokenContext(effect);
      const managedDisabled = ActiveEffectConditionService.isConditionManagedDisabled(effect);
      const available = currentConditionState.get(effectUuid) ?? true;
      let updateData = null;
      let action = null;

      if (managedDisabled && (!hasCondition || !usesDisableBehavior || available)) {
        updateData = {
          disabled: false,
          [`flags.${Constants.MODULE_ID}.-=${Constants.FLAG_CONDITION_MANAGED_DISABLED}`]: null
        };
        action = "reenable";
      } else if (
        hasCondition
        && usesDisableBehavior
        && !available
        && effect.disabled !== true
      ) {
        updateData = {
          disabled: true,
          [Constants.CONDITION_MANAGED_DISABLED_FLAG_PATH]: true
        };
        action = "disable";
      }

      // A disabled effect without our marker is user-managed. Never claim it,
      // and therefore never re-enable it when the condition later changes.
      if (!updateData || (effect.disabled === true && !managedDisabled)) {
        continue;
      }

      ActiveEffectConditionHooks.#conditionDisableSyncsInFlight.add(effectUuid);
      try {
        ActiveEffectConditionHooks.#debug("synchronizing condition-managed disabled state", {
          actor: actor?.uuid ?? actor?.id ?? null,
          effect: effectUuid,
          action,
          available,
          hasCondition,
          usesDisableBehavior
        });
        await effect.update(updateData, {
          [Constants.MODULE_ID]: {
            [ActiveEffectConditionHooks.#CONDITION_DISABLE_SYNC_OPTION]: true
          }
        });
        result.changed = true;
        if (action === "reenable") {
          result.reactivatedEffectUuids.add(effectUuid);
        }
      } catch (error) {
        console.warn(`[${Constants.MODULE_ID}] could not synchronize condition-managed disabled state`, {
          actor: actor?.uuid ?? actor?.id ?? null,
          effect: effectUuid,
          action,
          error
        });
      } finally {
        ActiveEffectConditionHooks.#conditionDisableSyncsInFlight.delete(effectUuid);
      }
    }

    return result;
  }

  static #isResponsibleForConditionDisableSync(actor) {
    if (!(actor instanceof CONFIG.Actor.documentClass)) {
      return false;
    }

    const activeUsers = game.users?.filter(user => user.active) ?? [];
    const owner = activeUsers.find(user => (
      !user.isGM
      && actor.testUserPermission?.(user, "OWNER")
    ));
    const responsibleUser = owner
      ?? game.users?.activeGM
      ?? activeUsers.find(user => user.isGM)
      ?? null;

    return responsibleUser?.id === game.user?.id;
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
    DebugLog.write(message, data);
  }
}
