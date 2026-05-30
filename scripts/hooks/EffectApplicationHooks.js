import { Constants } from "../constants/Constants.js";
import { ActiveEffectFormulaChangeService } from "../services/ActiveEffectFormulaChangeService.js";
import { ActiveEffectTransferMetadataService } from "../services/ActiveEffectTransferMetadataService.js";
import { ModuleSettings } from "../settings/ModuleSettings.js";

export class EffectApplicationHooks {
  static #PATCH_MARKER = Symbol(`${Constants.MODULE_ID}.effectApplicationPatched`);
  static #ORIGINAL_APPLY = Symbol(`${Constants.MODULE_ID}.originalApplyEffectToActor`);
  static #hooksRegistered = false;

  static activate() {
    if (!Constants.isDnd5eActive()) {
      return;
    }

    if (!EffectApplicationHooks.#hooksRegistered) {
      EffectApplicationHooks.#hooksRegistered = true;
      Hooks.once("ready", () => {
        EffectApplicationHooks.#patchEffectApplication();
      });
      Hooks.on("renderChatMessage", () => {
        EffectApplicationHooks.#patchEffectApplication();
      });
    }

    EffectApplicationHooks.#patchEffectApplication();
  }

  static #patchEffectApplication() {
    const elementClass = globalThis.window?.customElements?.get?.("effect-application");
    const currentApply = elementClass?.prototype?._applyEffectToActor;
    if (currentApply?.[EffectApplicationHooks.#PATCH_MARKER] === true) {
      return;
    }

    const originalApply = currentApply?.[EffectApplicationHooks.#ORIGINAL_APPLY] ?? currentApply;
    if (typeof originalApply !== "function") {
      console.warn(`[${Constants.MODULE_ID}] EffectApplicationHooks: could not patch _applyEffectToActor — element or method not found`, { elementClass, originalApply });
      return;
    }

    EffectApplicationHooks.#debug("patching effect-application _applyEffectToActor", {
      elementClass: elementClass?.name ?? null
    });

    const patchedApply = async function(effect, actor) {
      if (!(effect instanceof CONFIG.ActiveEffect.documentClass)) {
        return originalApply.call(this, effect, actor);
      }

      EffectApplicationHooks.#debug("apply effect to actor invoked", {
        actor: actor?.uuid ?? actor?.id ?? null,
        effect: effect?.uuid ?? effect?.id ?? null,
        effectName: effect?.name ?? null,
        effectApplyBehavior: foundry.utils.getProperty(effect ?? {}, Constants.APPLY_BEHAVIOR_FLAG_PATH) ?? null
      });
      const activity = this.chatMessage?.getAssociatedActivity?.() ?? null;
      const sourceEffect = EffectApplicationHooks.#resolveSourceEffect(effect, activity);
      const concentration = this.chatMessage?.getAssociatedActor?.()?.effects?.get?.(this.chatMessage?.system?.concentration);
      const origin = concentration ?? sourceEffect ?? effect;
      if (!game.user.isGM && !actor?.isOwner) {
        throw new Error(game.i18n.localize("DND5E.EffectApplyWarningOwnership"));
      }

      const effectFlags = {
        flags: {
          dnd5e: {
            dependentOn: origin.uuid,
            scaling: this.chatMessage?.system?.scaling,
            spellLevel: this.chatMessage?.system?.spellLevel
          }
        }
      };

      const existingEffect = actor.effects.find(candidate => candidate.origin === origin.uuid);
      const shouldCreateDuplicate = EffectApplicationHooks.#shouldCreateDuplicateEffect(
        sourceEffect,
        effect,
        origin,
        existingEffect
      );
      EffectApplicationHooks.#debug("resolved target effect application behavior", {
        actor: actor?.uuid ?? actor?.id ?? null,
        sourceEffect: sourceEffect?.uuid ?? sourceEffect?.id ?? null,
        sourceEffectApplyBehavior: foundry.utils.getProperty(sourceEffect ?? {}, Constants.APPLY_BEHAVIOR_FLAG_PATH) ?? null,
        origin: origin?.uuid ?? origin?.id ?? null,
        existingEffect: existingEffect?.uuid ?? existingEffect?.id ?? null,
        shouldCreateDuplicate
      });
      if (existingEffect && !shouldCreateDuplicate) {
        const updateData = foundry.utils.mergeObject({
          ...EffectApplicationHooks.#getInitialDurationData(effect.constructor),
          disabled: false
        }, effectFlags);
        ActiveEffectTransferMetadataService.mergeModuleFlags(sourceEffect ?? effect, updateData, { activity });
        EffectApplicationHooks.#debug("updating existing target effect", {
          actor: actor?.uuid ?? actor?.id ?? null,
          existingEffect: existingEffect?.uuid ?? existingEffect?.id ?? null,
          origin: origin?.uuid ?? origin?.id ?? null
        });
        return existingEffect.update(updateData, {
          [Constants.MODULE_ID]: {
            [ActiveEffectFormulaChangeService.REAPPLY_UPDATE_OPTION]: true
          }
        });
      }

      if (!game.user.isGM && concentration && !concentration.isOwner) {
        throw new Error(game.i18n.localize("DND5E.EffectApplyWarningConcentration"));
      }

      const effectData = (sourceEffect ?? effect).toObject();
      delete effectData._id;

      foundry.utils.mergeObject(effectData, {
        disabled: false,
        transfer: false,
        origin: origin.uuid
      }, { inplace: true });
      foundry.utils.mergeObject(effectData, effectFlags, { inplace: true });
      const flagsMerged = ActiveEffectTransferMetadataService.mergeModuleFlags(sourceEffect ?? effect, effectData, { activity });
      EffectApplicationHooks.#enforceDuplicateDaeStacking(sourceEffect ?? effect, effectData);
      EffectApplicationHooks.#debug("creating duplicated target effect", {
        actor: actor?.uuid ?? actor?.id ?? null,
        origin: origin?.uuid ?? origin?.id ?? null,
        flagsMerged,
        moduleFlags: foundry.utils.getProperty(effectData, `flags.${Constants.MODULE_ID}`),
        daeStackable: foundry.utils.getProperty(effectData, "flags.dae.stackable") ?? null
      });
      return ActiveEffect.implementation.create(effectData, { parent: actor });
    };

    patchedApply[EffectApplicationHooks.#PATCH_MARKER] = true;
    patchedApply[EffectApplicationHooks.#ORIGINAL_APPLY] = originalApply;
    elementClass.prototype._applyEffectToActor = patchedApply;
  }

  static #getInitialDurationData(effectClass) {
    if (typeof effectClass?.getEffectStart === "function") {
      return effectClass.getEffectStart();
    }

    if (typeof effectClass?.getInitialDuration === "function") {
      return effectClass.getInitialDuration();
    }

    return {};
  }

  static #resolveSourceEffect(effect, activity) {
    const resolvedEffect = EffectApplicationHooks.#resolveEffectByUuid(effect?.uuid);
    if (resolvedEffect) {
      return resolvedEffect;
    }

    const activityEffect = EffectApplicationHooks.#resolveActivityEffect(effect, activity);
    if (activityEffect) {
      return activityEffect;
    }

    return effect;
  }

  static #resolveActivityEffect(effect, activity) {
    const item = activity?.item ?? activity?.parent;
    if (!(item instanceof CONFIG.Item.documentClass)) {
      return null;
    }

    if (effect?.id) {
      const matchedById = item.effects?.get?.(effect.id) ?? null;
      if (matchedById instanceof CONFIG.ActiveEffect.documentClass) {
        return matchedById;
      }
    }

    const linkedEffects = (Array.isArray(activity?.effects) ? activity.effects : [...(activity?.effects ?? [])])
      .map(entry => EffectApplicationHooks.#resolveLinkedItemEffect(item, entry))
      .filter(candidate => candidate instanceof CONFIG.ActiveEffect.documentClass);

    if (linkedEffects.length === 1) {
      return linkedEffects[0];
    }

    return linkedEffects.find(candidate => EffectApplicationHooks.#hasMatchingSignature(candidate, effect)) ?? null;
  }

  static #resolveEffectByUuid(uuid) {
    if (!uuid || typeof fromUuidSync !== "function") {
      return null;
    }

    try {
      const resolved = fromUuidSync(uuid);
      return resolved instanceof CONFIG.ActiveEffect.documentClass ? resolved : null;
    } catch {
      return null;
    }
  }

  static #resolveLinkedItemEffect(item, reference) {
    if (!(item instanceof CONFIG.Item.documentClass) || !reference) {
      return null;
    }

    if (reference instanceof CONFIG.ActiveEffect.documentClass) {
      return reference;
    }

    const directId = String(
      reference?.effect?.id
      ?? reference?._id
      ?? reference?.id
      ?? ""
    ).trim();
    if (directId.length) {
      const matchedById = item.effects?.get?.(directId) ?? null;
      if (matchedById instanceof CONFIG.ActiveEffect.documentClass) {
        return matchedById;
      }
    }

    const uuid = String(reference?.uuid ?? reference ?? "").trim();
    if (!uuid.length) {
      return null;
    }

    const parsedId = EffectApplicationHooks.#extractEffectId(uuid);
    if (parsedId) {
      const matchedByParsedId = item.effects?.get?.(parsedId) ?? null;
      if (matchedByParsedId instanceof CONFIG.ActiveEffect.documentClass) {
        return matchedByParsedId;
      }
    }

    if (typeof fromUuidSync !== "function") {
      return null;
    }

    try {
      const resolved = fromUuidSync(uuid, { relative: item, strict: false });
      return resolved instanceof CONFIG.ActiveEffect.documentClass ? resolved : null;
    } catch {
      return null;
    }
  }

  static #extractEffectId(reference) {
    const match = String(reference ?? "").trim().match(/(?:^|\.)ActiveEffect\.([A-Za-z0-9]+)$/);
    return match?.[1] ?? null;
  }

  static #hasMatchingSignature(candidate, effect) {
    const candidateName = String(candidate?.name ?? "").trim();
    const effectName = String(effect?.name ?? "").trim();
    if (!candidateName.length || candidateName !== effectName) {
      return false;
    }

    const candidateChanges = EffectApplicationHooks.#getChangeSignature(candidate?.changes ?? []);
    const effectChanges = EffectApplicationHooks.#getChangeSignature(effect?.changes ?? []);
    if (candidateChanges.length !== effectChanges.length) {
      return false;
    }

    return candidateChanges.every((change, index) => (
      change.key === effectChanges[index]?.key
      && change.mode === effectChanges[index]?.mode
    ));
  }

  static #getChangeSignature(changes) {
    if (!Array.isArray(changes)) {
      return [];
    }

    return changes.map(change => ({
      key: String(change?.key ?? "").trim(),
      mode: Number(change?.mode ?? 0)
    }));
  }

  static #shouldCreateDuplicateEffect(...effects) {
    const candidates = effects.filter(effect => effect instanceof CONFIG.ActiveEffect.documentClass);
    for (const effect of candidates) {
      const applyBehavior = EffectApplicationHooks.#normalizeApplyBehavior(
        foundry.utils.getProperty(effect ?? {}, Constants.APPLY_BEHAVIOR_FLAG_PATH)
      );

      if (applyBehavior === "duplicate") {
        return true;
      }

      if (applyBehavior === "dae") {
        return Constants.isDaeActive();
      }

      if (applyBehavior === "update") {
        return false;
      }
    }

    return false;
  }

  static #normalizeApplyBehavior(value) {
    const normalized = String(value ?? "").trim().toLowerCase();
    if (["duplicate", "stack"].includes(normalized)) {
      return "duplicate";
    }

    if (["dae", "same-as-dae", "sameasdae"].includes(normalized)) {
      return "dae";
    }

    if (["auto", "update", "default"].includes(normalized)) {
      return "update";
    }
    
    return "update";
  }

  static #enforceDuplicateDaeStacking(sourceEffect, effectData) {
    if (!Constants.isDaeActive()) {
      return;
    }

    const applyBehavior = EffectApplicationHooks.#normalizeApplyBehavior(
      foundry.utils.getProperty(sourceEffect ?? effectData, Constants.APPLY_BEHAVIOR_FLAG_PATH)
    );
    if (applyBehavior !== "duplicate") {
      return;
    }

    foundry.utils.setProperty(effectData, "flags.dae.stackable", "multi");
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
