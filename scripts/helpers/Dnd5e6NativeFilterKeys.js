import { Dnd5e6AttributeLabel } from "./Dnd5e6AttributeLabel.js";
import { Dnd5e6NativeFilterKeyTree } from "../models/Dnd5e6NativeFilterKeyTree.js";

/** Keys offered first when the data has them, in the order the picker lists them. */
const COMMON_KEYS = Object.freeze([
  "attributes.hp.value",
  "attributes.hp.max",
  "attributes.ac.value",
  "attributes.prof",
  "details.level",
  "details.cr"
]);

const STATUS_ID = /^[A-Za-z0-9_-]+$/;

/**
 * The keys a dnd5e 6 native filter can read for an effect.
 *
 * dnd5e checks a filter against the target's roll data merged with the effect's
 * replacement data, so the tree reads that same object. Keys that only exist
 * while a roll is being made are not in it and stay free text.
 */
export class Dnd5e6NativeFilterKeys {
  static buildTree({ effect = null, actor = null } = {}) {
    const data = Dnd5e6NativeFilterKeys.#filterData(effect, actor);
    const entries = [];
    for (const key of COMMON_KEYS) {
      // Without an actor nothing can be checked, so the usual keys are offered as they are.
      if (!actor || foundry.utils.hasProperty(data, key)) entries.push({ key, common: true });
    }
    // Roll data only holds the statuses the actor has now; a filter may test any of them.
    const statuses = Dnd5e6NativeFilterKeys.#statuses();
    if (statuses.length) entries.push({ key: "statuses", common: true, branch: true });
    for (const { id, label } of statuses) entries.push({ key: `statuses.${id}`, label });

    return new Dnd5e6NativeFilterKeyTree({
      entries,
      data,
      skipRoots: ["flags"],
      labelOf: key => Dnd5e6AttributeLabel.resolve(key, { actor }) ?? ""
    });
  }

  /** Same data Dnd5e6ConditionEvaluationService checks the filter against. */
  static #filterData(effect, actor) {
    try {
      const baseData = actor?.getRollData?.() ?? {};
      return effect?.getReplacementData?.(baseData) ?? baseData;
    } catch {
      return {};
    }
  }

  static #statuses() {
    const list = Array.isArray(globalThis.CONFIG?.statusEffects) ? CONFIG.statusEffects : [];
    return list
      .filter(status => typeof status?.id === "string" && STATUS_ID.test(status.id))
      .map(status => ({ id: status.id, label: Dnd5e6NativeFilterKeys.#localize(status.name ?? status.label) }));
  }

  static #localize(text) {
    return typeof text === "string" && text ? (globalThis.game?.i18n?.localize?.(text) ?? text) : "";
  }
}
