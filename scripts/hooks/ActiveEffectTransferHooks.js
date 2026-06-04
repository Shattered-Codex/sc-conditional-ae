import { Constants } from "../constants/Constants.js";
import { ActiveEffectContextBuilder } from "../helpers/ActiveEffectContextBuilder.js";
import { ActiveEffectTransferContextService } from "../services/ActiveEffectTransferContextService.js";
import { ActiveEffectTransferMetadataService } from "../services/ActiveEffectTransferMetadataService.js";
import { ModuleSettings } from "../settings/ModuleSettings.js";

export class ActiveEffectTransferHooks {
  static #registered = false;
  static #PRECREATE_PATCH_MARKER = Symbol(`${Constants.MODULE_ID}.preCreateStackPatch`);
  static #pendingActorSyncs = new Map();
  static #syncFlushScheduled = false;
  static #MIRROR_SOURCE_FLAG = "transferMirrorSourceEffectUuid";
  static #MIRROR_SYNC_OPTION = "transferMirrorSync";

  static activate() {
    if (ActiveEffectTransferHooks.#registered || !Constants.isDnd5eActive()) {
      return;
    }

    ActiveEffectTransferHooks.#registered = true;
    ActiveEffectTransferHooks.#patchActiveEffectPreCreate();
    Hooks.on("preCreateActiveEffect", ActiveEffectTransferHooks.#onPreCreateActiveEffect);
    Hooks.on("createActiveEffect", ActiveEffectTransferHooks.#onActiveEffectChanged);
    Hooks.on("updateActiveEffect", ActiveEffectTransferHooks.#onActiveEffectChanged);
    Hooks.on("deleteActiveEffect", ActiveEffectTransferHooks.#onActiveEffectChanged);
    Hooks.on("updateActor", ActiveEffectTransferHooks.#onActorChanged);
    Hooks.on("createItem", ActiveEffectTransferHooks.#onItemChanged);
    Hooks.on("updateItem", ActiveEffectTransferHooks.#onItemChanged);
    Hooks.on("deleteItem", ActiveEffectTransferHooks.#onItemChanged);
    Hooks.once("ready", ActiveEffectTransferHooks.#scheduleInitialSync);
  }

  static #patchActiveEffectPreCreate() {
    if (ActiveEffectTransferHooks.#registerPreCreateLibWrapper()) {
      return;
    }

    const prototype = CONFIG.ActiveEffect.documentClass.prototype;
    const originalPreCreate = prototype?._preCreate;
    if (typeof originalPreCreate !== "function" || originalPreCreate[ActiveEffectTransferHooks.#PRECREATE_PATCH_MARKER] === true) {
      return;
    }

    const patchedPreCreate = async function(data, options, user) {
      ActiveEffectTransferHooks.#enforceDuplicateStacking(this, data);
      return originalPreCreate.call(this, data, options, user);
    };

    patchedPreCreate[ActiveEffectTransferHooks.#PRECREATE_PATCH_MARKER] = true;
    prototype._preCreate = patchedPreCreate;
  }

  static #registerPreCreateLibWrapper() {
    const libWrapper = globalThis.libWrapper;
    if (typeof libWrapper?.register !== "function") {
      return false;
    }

    libWrapper.register(
      Constants.MODULE_ID,
      "CONFIG.ActiveEffect.documentClass.prototype._preCreate",
      async function(wrapped, data, options, user) {
        ActiveEffectTransferHooks.#enforceDuplicateStacking(this, data);
        return wrapped.call(this, data, options, user);
      },
      "WRAPPER"
    );

    return true;
  }

  static #onPreCreateActiveEffect(effect, data, _options, userId) {
    const handledTidyTransfer = ActiveEffectTransferHooks.#syncModuleFlagsFromTidyTransfer(effect, data, userId);
    if (!handledTidyTransfer) {
      ActiveEffectTransferMetadataService.syncModuleFlagsFromOrigin(effect, data);
    }

    ActiveEffectTransferHooks.#debug("preCreateActiveEffect transfer sync", {
      actor: effect?.parent?.uuid ?? null,
      effect: effect?.uuid ?? effect?.id ?? null,
      name: data?.name ?? effect?.name ?? null,
      origin: data?.origin ?? effect?.origin ?? null,
      applyBehavior: foundry.utils.getProperty(data ?? effect, Constants.APPLY_BEHAVIOR_FLAG_PATH) ?? null,
      handledTidyTransfer
    });
    ActiveEffectTransferHooks.#prepareStackedTransfer(effect, data);
  }

  static #syncModuleFlagsFromTidyTransfer(effect, data, userId) {
    const actor = effect?.parent;
    if (!(actor instanceof CONFIG.Actor.documentClass)) {
      return false;
    }

    const sourceEffect = ActiveEffectTransferContextService.consumeMatchingDrop({
      actorUuid: actor.uuid,
      effectData: data,
      userId: userId ?? game.user?.id
    });
    if (!sourceEffect || !ActiveEffectTransferMetadataService.mergeModuleFlags(sourceEffect, data, {
      allowActivityFormulaInference: true
    })) {
      return false;
    }

    effect.updateSource({ flags: { [Constants.MODULE_ID]: data.flags?.[Constants.MODULE_ID] ?? {} } });
    ActiveEffectTransferHooks.#debug("synced module flags from tidy transfer", {
      actor: actor.uuid,
      sourceEffect: sourceEffect.uuid,
      targetName: data?.name ?? effect?.name ?? null,
      applyBehavior: foundry.utils.getProperty(data, Constants.APPLY_BEHAVIOR_FLAG_PATH) ?? null
    });
    return true;
  }

  static #prepareStackedTransfer(effect, data) {
    if (!(effect?.parent instanceof CONFIG.Actor.documentClass)) {
      return;
    }

    if (!ActiveEffectContextBuilder.shouldDuplicateApplication(data ?? effect)) {
      return;
    }

    const newEffectId = foundry.utils.randomID();
    effect.updateSource({ _id: newEffectId });
    data._id = newEffectId;
    ActiveEffectTransferHooks.#debug("prepared stacked transfer effect with fresh id", {
      actor: effect.parent.uuid,
      effect: effect?.uuid ?? effect?.id ?? null,
      newEffectId,
      origin: data?.origin ?? effect?.origin ?? null
    });
  }

  static #enforceDuplicateStacking(effect, data) {
    if (!(effect?.parent instanceof CONFIG.Actor.documentClass)) {
      return;
    }

    const source = data ?? effect;
    if (!ActiveEffectContextBuilder.shouldDuplicateApplication(source)) {
      return;
    }

    const applyBehavior = ActiveEffectContextBuilder.normalizeApplyBehavior(
      foundry.utils.getProperty(source, Constants.APPLY_BEHAVIOR_FLAG_PATH)
    );
    if (applyBehavior === "duplicate") {
      effect.updateSource({ flags: { dae: { stackable: "multi" } } });
      foundry.utils.setProperty(data, "flags.dae.stackable", "multi");
    }
    ActiveEffectTransferHooks.#debug("enforced dae multi stacking for duplicate applyBehavior", {
      actor: effect.parent.uuid,
      effect: effect?.uuid ?? effect?.id ?? null,
      origin: data?.origin ?? effect?.origin ?? null
    });
  }

  static shouldSkipTransferredItemApplication(effect, model) {
    if (!(model instanceof CONFIG.Actor.documentClass)) {
      return false;
    }

    const shouldSkip = ActiveEffectTransferHooks.#shouldMirrorTransferredEffect(effect, model);
    if (shouldSkip) {
      ActiveEffectTransferHooks.#debug("skipping direct transferred item application in favor of mirrored actor effect", {
        actor: model.uuid,
        sourceEffect: effect?.uuid ?? effect?.id ?? null,
        item: effect?.parent?.uuid ?? effect?.parent?.id ?? null
      });
    }

    return shouldSkip;
  }

  static #onActiveEffectChanged(effect, ...args) {
    const options = ActiveEffectTransferHooks.#getHookOptions(args);
    if (options?.[Constants.MODULE_ID]?.[ActiveEffectTransferHooks.#MIRROR_SYNC_OPTION] === true) {
      return;
    }

    const actor = ActiveEffectTransferHooks.#getActorFromDocument(effect);
    if (!(actor instanceof CONFIG.Actor.documentClass)) {
      return;
    }

    if (
      !ActiveEffectTransferHooks.#isMirroredTransferEffect(effect)
      && !ActiveEffectTransferHooks.#isStackedTransferSource(effect)
      && !ActiveEffectTransferHooks.#actorHasMirroredTransferEffects(actor)
    ) {
      return;
    }

    ActiveEffectTransferHooks.#debug("active effect changed; scheduling transfer mirror sync", {
      actor: actor.uuid,
      effect: effect?.uuid ?? effect?.id ?? null,
      mirrored: ActiveEffectTransferHooks.#isMirroredTransferEffect(effect),
      stackedTransferSource: ActiveEffectTransferHooks.#isStackedTransferSource(effect)
    });
    ActiveEffectTransferHooks.#scheduleActorSync(actor);
  }

  static #onActorChanged(actor, ...args) {
    const options = ActiveEffectTransferHooks.#getHookOptions(args);
    if (options?.[Constants.MODULE_ID]?.[ActiveEffectTransferHooks.#MIRROR_SYNC_OPTION] === true) {
      return;
    }

    if (!(actor instanceof CONFIG.Actor.documentClass) || !ActiveEffectTransferHooks.#actorNeedsTransferSync(actor)) {
      return;
    }

    ActiveEffectTransferHooks.#debug("actor changed; scheduling transfer mirror sync", {
      actor: actor.uuid
    });
    ActiveEffectTransferHooks.#scheduleActorSync(actor);
  }

  static #onItemChanged(item, ...args) {
    const options = ActiveEffectTransferHooks.#getHookOptions(args);
    if (options?.[Constants.MODULE_ID]?.[ActiveEffectTransferHooks.#MIRROR_SYNC_OPTION] === true) {
      return;
    }

    const actor = item?.actor ?? item?.parent;
    if (!(actor instanceof CONFIG.Actor.documentClass)) {
      return;
    }

    if (
      !(item.effects ?? []).some(effect => ActiveEffectTransferHooks.#isPotentialStackedTransferSource(effect))
      && !ActiveEffectTransferHooks.#actorHasMirroredTransferEffects(actor)
    ) {
      return;
    }

    ActiveEffectTransferHooks.#debug("item changed; scheduling transfer mirror sync", {
      actor: actor.uuid,
      item: item?.uuid ?? item?.id ?? null
    });
    ActiveEffectTransferHooks.#scheduleActorSync(actor);
  }

  static #scheduleInitialSync() {
    for (const actor of game.actors?.contents ?? []) {
      if (ActiveEffectTransferHooks.#actorNeedsTransferSync(actor)) {
        ActiveEffectTransferHooks.#scheduleActorSync(actor);
      }
    }
  }

  static #actorNeedsTransferSync(actor) {
    if (!(actor instanceof CONFIG.Actor.documentClass)) {
      return false;
    }

    return ActiveEffectTransferHooks.#actorHasMirroredTransferEffects(actor)
      || (actor.items ?? []).some(item => (
        (item.effects ?? []).some(effect => ActiveEffectTransferHooks.#isPotentialStackedTransferSource(effect))
      ));
  }

  static #actorHasMirroredTransferEffects(actor) {
    return (actor?.effects ?? []).some(effect => ActiveEffectTransferHooks.#isMirroredTransferEffect(effect));
  }

  static #scheduleActorSync(actor) {
    ActiveEffectTransferHooks.#pendingActorSyncs.set(actor.uuid, actor);
    ActiveEffectTransferHooks.#debug("queued actor for transfer mirror sync", {
      actor: actor.uuid,
      pending: ActiveEffectTransferHooks.#pendingActorSyncs.size
    });
    if (ActiveEffectTransferHooks.#syncFlushScheduled) {
      return;
    }

    ActiveEffectTransferHooks.#syncFlushScheduled = true;
    window.setTimeout(async () => {
      ActiveEffectTransferHooks.#syncFlushScheduled = false;
      const pendingActors = Array.from(ActiveEffectTransferHooks.#pendingActorSyncs.values());
      ActiveEffectTransferHooks.#pendingActorSyncs.clear();

      for (const pendingActor of pendingActors) {
        await ActiveEffectTransferHooks.#syncActorMirrors(pendingActor);
      }
    }, 0);
  }

  static async #syncActorMirrors(actor) {
    if (!(actor instanceof CONFIG.Actor.documentClass)) {
      return;
    }

    const desiredSources = [];
    for (const item of actor.items ?? []) {
      for (const effect of item.effects ?? []) {
        if (ActiveEffectTransferHooks.#isStackedTransferSource(effect)) {
          desiredSources.push(effect);
        }
      }
    }

    const desiredBySourceUuid = new Map(desiredSources.map(effect => [effect.uuid, effect]));
    const existingMirrors = (actor.effects ?? []).filter(effect => ActiveEffectTransferHooks.#isMirroredTransferEffect(effect));
    const deleteIds = existingMirrors
      .filter(effect => !desiredBySourceUuid.has(ActiveEffectTransferHooks.#getMirroredSourceUuid(effect)))
      .map(effect => effect.id)
      .filter(Boolean);

    if (deleteIds.length) {
      ActiveEffectTransferHooks.#debug("deleting stale mirrored transfer effects", {
        actor: actor.uuid,
        deleteIds
      });
      await actor.deleteEmbeddedDocuments("ActiveEffect", deleteIds, {
        [Constants.MODULE_ID]: {
          [ActiveEffectTransferHooks.#MIRROR_SYNC_OPTION]: true
        }
      });
    }

    const mirrorsBySourceUuid = new Map();
    for (const effect of actor.effects ?? []) {
      if (!ActiveEffectTransferHooks.#isMirroredTransferEffect(effect)) {
        continue;
      }

      mirrorsBySourceUuid.set(ActiveEffectTransferHooks.#getMirroredSourceUuid(effect), effect);
    }

    const createPayload = [];
    const updatePayload = [];
    for (const sourceEffect of desiredSources) {
      const existingMirror = mirrorsBySourceUuid.get(sourceEffect.uuid) ?? null;
      const mirrorData = ActiveEffectTransferHooks.#buildMirrorEffectData(sourceEffect);
      if (!existingMirror) {
        createPayload.push(mirrorData);
        continue;
      }

      const currentMirrorData = existingMirror.toObject();
      delete currentMirrorData._id;
      if (foundry.utils.isEmpty(foundry.utils.diffObject(mirrorData, currentMirrorData))) {
        continue;
      }

      updatePayload.push({
        _id: existingMirror.id,
        ...mirrorData
      });
    }

    ActiveEffectTransferHooks.#debug("resolved transfer mirror sync payload", {
      actor: actor.uuid,
      desiredSources: desiredSources.map(effect => effect.uuid),
      existingMirrors: existingMirrors.map(effect => effect.uuid),
      createCount: createPayload.length,
      updateCount: updatePayload.length
    });

    if (createPayload.length) {
      await actor.createEmbeddedDocuments("ActiveEffect", createPayload, {
        [Constants.MODULE_ID]: {
          [ActiveEffectTransferHooks.#MIRROR_SYNC_OPTION]: true
        }
      });
    }

    if (updatePayload.length) {
      await actor.updateEmbeddedDocuments("ActiveEffect", updatePayload, {
        [Constants.MODULE_ID]: {
          [ActiveEffectTransferHooks.#MIRROR_SYNC_OPTION]: true
        }
      });
    }
  }

  static #buildMirrorEffectData(sourceEffect) {
    const mirrorData = sourceEffect.toObject();
    delete mirrorData._id;

    foundry.utils.mergeObject(mirrorData, {
      disabled: false,
      transfer: false,
      origin: sourceEffect.uuid
    }, { inplace: true });
    foundry.utils.setProperty(
      mirrorData,
      `flags.${Constants.MODULE_ID}.${ActiveEffectTransferHooks.#MIRROR_SOURCE_FLAG}`,
      sourceEffect.uuid
    );

    return mirrorData;
  }

  static #isTransferSourceEffect(effect) {
    return effect?.parent instanceof CONFIG.Item.documentClass
      && effect.parent.actor instanceof CONFIG.Actor.documentClass
      && effect.transfer !== false
      && effect.transfer !== 0
      && effect.transfer !== null
      && effect.transfer !== undefined;
  }

  static #isStackedTransferSource(effect) {
    return ActiveEffectTransferHooks.#isPotentialStackedTransferSource(effect)
      && effect.isSuppressed !== true;
  }

  static #isPotentialStackedTransferSource(effect) {
    return ActiveEffectTransferHooks.#isTransferSourceEffect(effect)
      && ActiveEffectContextBuilder.shouldDuplicateApplication(effect)
      && effect.disabled !== true;
  }

  static #shouldMirrorTransferredEffect(effect, actor = null) {
    if (!ActiveEffectTransferHooks.#isTransferSourceEffect(effect)) {
      return false;
    }

    if (actor && effect.parent.actor !== actor) {
      return false;
    }

    return ActiveEffectContextBuilder.shouldDuplicateApplication(effect);
  }

  static #isMirroredTransferEffect(effect) {
    return effect?.parent instanceof CONFIG.Actor.documentClass
      && ActiveEffectTransferHooks.#getMirroredSourceUuid(effect).length > 0;
  }

  static #getMirroredSourceUuid(effect) {
    return String(
      foundry.utils.getProperty(
        effect ?? {},
        `flags.${Constants.MODULE_ID}.${ActiveEffectTransferHooks.#MIRROR_SOURCE_FLAG}`
      ) ?? ""
    ).trim();
  }

  static #getActorFromDocument(document) {
    const parent = document?.parent;
    if (parent instanceof CONFIG.Actor.documentClass) {
      return parent;
    }

    if (parent instanceof CONFIG.Item.documentClass) {
      return parent.actor ?? parent.parent ?? null;
    }

    return null;
  }

  static #getHookOptions(args) {
    for (let index = args.length - 1; index >= 0; index -= 1) {
      const candidate = args[index];
      if (candidate && (typeof candidate === "object") && !Array.isArray(candidate)) {
        return candidate;
      }
    }

    return null;
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
