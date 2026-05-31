import { Constants } from "../constants/Constants.js";
import { ActiveEffectContextBuilder } from "../helpers/ActiveEffectContextBuilder.js";

export class ActiveEffectTransferMetadataService {
  static mergeModuleFlags(sourceEffect, targetData, options = {}) {
    if (!(sourceEffect instanceof CONFIG.ActiveEffect.documentClass) || !targetData || (typeof targetData !== "object")) {
      return false;
    }

    const sourceFlags = ActiveEffectTransferMetadataService.#getModuleFlags(sourceEffect);
    const targetFlags = ActiveEffectTransferMetadataService.#getModuleFlags(targetData);
    const activityFlags = ActiveEffectTransferMetadataService.#buildContextualFormulaFlags(sourceEffect, targetData, options);
    const baseFlags = foundry.utils.mergeObject(sourceFlags, activityFlags, {
      inplace: false,
      insertKeys: true,
      insertValues: true,
      overwrite: false,
      recursive: true
    });

    if (foundry.utils.isEmpty(baseFlags)) {
      return false;
    }

    const mergedFlags = foundry.utils.mergeObject(baseFlags, targetFlags, {
      inplace: false,
      insertKeys: true,
      insertValues: true,
      overwrite: true,
      recursive: true
    });

    if (foundry.utils.isEmpty(foundry.utils.diffObject(mergedFlags, targetFlags))) {
      return false;
    }

    foundry.utils.setProperty(targetData, `flags.${Constants.MODULE_ID}`, mergedFlags);
    return true;
  }

  static syncModuleFlagsFromOrigin(effect, data) {
    if (!(effect?.parent instanceof CONFIG.Actor.documentClass)) {
      return;
    }

    const sourceEffect = ActiveEffectTransferMetadataService.#resolveSourceEffect(effect, data);
    ActiveEffectTransferMetadataService.mergeModuleFlags(sourceEffect, data, { allowActivityFormulaInference: true });

    const moduleFlags = foundry.utils.deepClone(
      foundry.utils.getProperty(data, `flags.${Constants.MODULE_ID}`) ?? {}
    );
    Constants.debug("ActiveEffectTransferMetadataService.syncModuleFlagsFromOrigin", { sourceEffect, moduleFlags });
    if (!foundry.utils.isEmpty(moduleFlags)) {
      effect.updateSource({ flags: { [Constants.MODULE_ID]: moduleFlags } });
    }
  }

  static #resolveSourceEffect(effect, data) {
    const origin = ActiveEffectContextBuilder.getOrigin(effect);
    if (origin instanceof CONFIG.ActiveEffect.documentClass) {
      return ActiveEffectTransferMetadataService.#isLikelySourceEffect(origin, effect, data) ? origin : null;
    }

    if (origin instanceof CONFIG.Item.documentClass) {
      return ActiveEffectTransferMetadataService.#findMatchingItemEffect(origin, effect, data);
    }

    return null;
  }

  static #findMatchingItemEffect(item, effect, data) {
    const matches = (item.effects ?? []).filter(candidate => (
      ActiveEffectTransferMetadataService.#isLikelySourceEffect(candidate, effect, data)
    ));

    if (matches.length !== 1) {
      return null;
    }

    return matches[0];
  }

  static #isLikelySourceEffect(candidate, effect, data) {
    const targetName = String(data?.name ?? effect?.name ?? "").trim();
    const candidateName = String(candidate?.name ?? "").trim();
    if (targetName !== candidateName) {
      return false;
    }

    const targetChanges = ActiveEffectContextBuilder.getChangeSignature(data?.changes ?? effect?.changes ?? []);
    const candidateChanges = ActiveEffectContextBuilder.getChangeSignature(candidate?.changes ?? []);

    if (targetChanges.length !== candidateChanges.length) {
      return false;
    }

    return targetChanges.every((change, index) => (
      change.key === candidateChanges[index]?.key
      && change.mode === candidateChanges[index]?.mode
    ));
  }

  static #getModuleFlags(source) {
    return foundry.utils.deepClone(
      foundry.utils.getProperty(source ?? {}, `flags.${Constants.MODULE_ID}`)
      ?? source?.flags?.[Constants.MODULE_ID]
      ?? {}
    );
  }

  static #buildContextualFormulaFlags(sourceEffect, targetData, options) {
    const explicitActivity = options?.activity ?? null;
    if (explicitActivity) {
      return ActiveEffectTransferMetadataService.#buildActivityFormulaFlags(explicitActivity, sourceEffect, targetData);
    }

    if (options?.allowActivityFormulaInference !== true) {
      return {};
    }

    const activity = ActiveEffectTransferMetadataService.#findLinkedFormulaActivity(sourceEffect);
    if (!activity) {
      return {};
    }

    return ActiveEffectTransferMetadataService.#buildActivityFormulaFlags(activity, sourceEffect, targetData);
  }

  static #buildActivityFormulaFlags(activity, sourceEffect, targetData) {
    if (!ActiveEffectTransferMetadataService.#isSourceEffectLinkedToActivity(activity, sourceEffect)) {
      return {};
    }

    const formula = String(activity?.roll?.formula ?? "").trim();
    if (!formula.length) {
      return {};
    }

    const existingFormulaChanges = ActiveEffectTransferMetadataService.#getModuleFlags(targetData)?.[Constants.FLAG_FORMULA_CHANGES] ?? {};
    if (!foundry.utils.isEmpty(existingFormulaChanges)) {
      return {};
    }

    const changes = ActiveEffectTransferMetadataService.#getChangesArray(targetData);
    const eligibleIndexes = changes
      .map((change, index) => ActiveEffectContextBuilder.isFormulaEligibleChange(change) ? index : null)
      .filter(index => Number.isInteger(index));

    if (eligibleIndexes.length !== 1) {
      return {};
    }

    const changeIndex = eligibleIndexes[0];
    const change = changes[changeIndex];
    if (change && ActiveEffectTransferMetadataService.#shouldResetTransferredChangeValue(change.value)) {
      change.value = "0";
    }

    return {
      [Constants.FLAG_FORMULA_CHANGES]: {
        [changeIndex]: {
          formula,
          key: change?.key ?? ""
        }
      }
    };
  }

  static #isSourceEffectLinkedToActivity(activity, sourceEffect) {
    if (!activity || !sourceEffect?.id) {
      return false;
    }

    const effects = Array.isArray(activity.effects) ? activity.effects : [...(activity.effects ?? [])];
    const sourceIdentifiers = new Set([
      String(sourceEffect.id ?? "").trim(),
      String(sourceEffect.uuid ?? "").trim(),
      `.ActiveEffect.${String(sourceEffect.id ?? "").trim()}`
    ].filter(Boolean));

    return effects.some(entry => {
      const references = ActiveEffectTransferMetadataService.#getActivityEffectReferences(entry);
      return references.some(reference => {
        if (sourceIdentifiers.has(reference)) {
          return true;
        }

        return ActiveEffectContextBuilder.extractEffectId(reference) === sourceEffect.id;
      });
    });
  }

  static #findLinkedFormulaActivity(sourceEffect) {
    const item = sourceEffect.parent instanceof CONFIG.Item.documentClass ? sourceEffect.parent : null;
    if (!item?.system?.activities) {
      return null;
    }

    const linkedActivities = item.system.activities.filter(activity => (
      ActiveEffectTransferMetadataService.#isSourceEffectLinkedToActivity(activity, sourceEffect)
      && String(activity?.roll?.formula ?? "").trim().length > 0
    ));

    if (linkedActivities.length !== 1) {
      return null;
    }

    return linkedActivities[0];
  }


  static #shouldResetTransferredChangeValue(value) {
    return String(value ?? "").trim().length === 0 || String(value ?? "").trim() === "0";
  }

  static #getChangesArray(source) {
    if (Array.isArray(source?.changes)) {
      return source.changes;
    }

    if (Array.isArray(source?.system?.changes)) {
      return source.system.changes;
    }

    return [];
  }

  static #getActivityEffectReferences(entry) {
    const references = [
      entry?.effect?.id,
      entry?.effect?.uuid,
      entry?._id,
      entry?.id,
      entry?.uuid
    ];

    if (typeof entry === "string") {
      references.push(entry);
    }

    return references
      .map(reference => String(reference ?? "").trim())
      .filter(reference => reference.length > 0);
  }

}
