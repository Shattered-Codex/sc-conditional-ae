import { Constants } from "../constants/Constants.js";

export class ActiveEffectContextBuilder {
  static getAffectedActor(effect) {
    const parent = effect?.parent;
    if (parent instanceof CONFIG.Actor.documentClass) {
      return parent;
    }

    if (parent instanceof CONFIG.Item.documentClass) {
      return parent.actor ?? parent.parent ?? null;
    }

    return null;
  }

  /**
   * An item effect that actually reaches its owning actor. `transfer` has been
   * spelled several ways across dnd5e versions, so every falsy-but-not-false
   * shape is treated as "not configured", i.e. transferring.
   */
  static isTransferredOwnedItemEffect(effect) {
    return effect?.parent instanceof CONFIG.Item.documentClass
      && effect.parent.actor instanceof CONFIG.Actor.documentClass
      && effect.transfer !== false
      && effect.transfer !== 0
      && effect.transfer !== null
      && effect.transfer !== undefined;
  }

  static getOrigin(effect) {
    const originUuid = effect?.origin ?? foundry.utils.getProperty(effect ?? {}, "origin");
    if (!originUuid || typeof fromUuidSync !== "function") {
      return null;
    }

    try {
      return fromUuidSync(originUuid) ?? null;
    } catch {
      return null;
    }
  }

  static getItem(effect, origin) {
    if (effect?.parent instanceof CONFIG.Item.documentClass) {
      return effect.parent;
    }

    if (origin instanceof CONFIG.Item.documentClass) {
      return origin;
    }

    if (origin instanceof CONFIG.ActiveEffect.documentClass && origin.parent instanceof CONFIG.Item.documentClass) {
      return origin.parent;
    }

    return null;
  }

  static getOriginActor(origin) {
    if (origin instanceof CONFIG.Actor.documentClass) {
      return origin;
    }

    if (origin instanceof CONFIG.Item.documentClass) {
      return origin.actor ?? null;
    }

    if (origin instanceof CONFIG.ActiveEffect.documentClass) {
      const parent = origin.parent;
      if (parent instanceof CONFIG.Actor.documentClass) {
        return parent;
      }
      if (parent instanceof CONFIG.Item.documentClass) {
        return parent.actor ?? null;
      }
    }

    return null;
  }

  static normalizeApplyBehavior(value) {
    const normalized = String(value ?? "").trim().toLowerCase();
    if (["duplicate", "stack"].includes(normalized)) {
      return "duplicate";
    }

    if (["dae", "same-as-dae", "sameasdae"].includes(normalized)) {
      return "dae";
    }

    return "update";
  }

  static shouldDuplicateApplication(source) {
    const applyBehavior = ActiveEffectContextBuilder.normalizeApplyBehavior(
      foundry.utils.getProperty(source ?? {}, Constants.APPLY_BEHAVIOR_FLAG_PATH)
    );
    if (applyBehavior === "duplicate") {
      return true;
    }

    if (applyBehavior !== "dae" || !Constants.isDaeActive()) {
      return false;
    }

    const stackable = String(foundry.utils.getProperty(source ?? {}, "flags.dae.stackable") ?? "")
      .trim()
      .toLowerCase();
    return stackable === "multi";
  }

  static getChangeSignature(changes) {
    if (!Array.isArray(changes)) {
      return [];
    }

    return changes.map(change => ({
      key: String(change?.key ?? "").trim(),
      mode: ActiveEffectContextBuilder.#normalizeChangeMode(change)
    }));
  }

  /**
   * Signatures are compared across shapes: raw source data from a compendium or
   * socket payload still carries the numeric `mode`, while a live dnd5e 6
   * document carries the string `type`. Both are reduced to the same name, or a
   * legacy payload would never match the document it describes.
   */
  static #normalizeChangeMode(change) {
    const type = String(change?.type ?? "").trim().toLowerCase();
    if (type) {
      return type;
    }

    const mode = change?.mode;
    if (mode === undefined || mode === null || mode === "") {
      return "";
    }

    const numeric = Number(mode);
    if (Number.isFinite(numeric)) {
      const name = Object.entries(globalThis.CONST?.ACTIVE_EFFECT_MODES ?? {})
        .find(([, value]) => value === numeric)?.[0];
      if (name) {
        return name.toLowerCase();
      }
    }

    return String(mode).trim().toLowerCase();
  }

  static extractEffectId(reference) {
    const match = String(reference ?? "").trim().match(/(?:^|\.)ActiveEffect\.([A-Za-z0-9]+)$/);
    return match?.[1] ?? null;
  }

  static isCustomChange(change) {
    return Number(change.mode) === CONST.ACTIVE_EFFECT_MODES.CUSTOM
      || String(change.mode ?? "").toLowerCase() === "custom"
      || String(change.type ?? "").toLowerCase() === "custom";
  }

  static isFormulaEligibleChange(change) {
    if (!change?.key || ActiveEffectContextBuilder.isCustomChange(change)) {
      return false;
    }

    return ![
      Constants.MACRO_EXECUTE_CHANGE_KEY,
      Constants.LEGACY_MACRO_EXECUTE_CHANGE_KEY,
      Constants.DAE_MACRO_EXECUTE_CHANGE_KEY
    ].includes(change.key);
  }
}
