import { Constants } from "../constants/Constants.js";

/**
 * Isolates the Active Effect changes data-path migration introduced by dnd5e 6.
 */
export class ActiveEffectChangesCompatibility {
  static get(source) {
    if (Array.isArray(source?.["system.changes"])) return source["system.changes"];
    if (Array.isArray(source?.system?.changes)) return source.system.changes;
    if (Array.isArray(source?.changes)) return source.changes;
    return [];
  }

  static clone(source) {
    // Clones are written back to the document. A Document's prepared changes
    // hold dnd5e 6 Filter instances in `conditions`, which serialize to "{}",
    // so start from the stored source or every per-change native filter is lost.
    return foundry.utils.deepClone(ActiveEffectChangesCompatibility.get(source?._source ?? source));
  }

  static hasExplicitChanges(source) {
    return Array.isArray(source?.["system.changes"])
      || Array.isArray(source?.system?.changes)
      || Array.isArray(source?.changes);
  }

  static usesSystemPath(source = null, fallback = null) {
    if (Array.isArray(source?.["system.changes"])) return true;
    if (Array.isArray(source?.system?.changes)) return true;
    if (Array.isArray(source?.changes)) return false;
    if (Array.isArray(fallback?.["system.changes"])) return true;
    if (Array.isArray(fallback?.system?.changes)) return true;
    if (Array.isArray(fallback?.changes)) return false;
    return Constants.isDnd5eAtLeast(6);
  }

  static buildUpdate(changes, source = null, fallback = null) {
    return ActiveEffectChangesCompatibility.usesSystemPath(source, fallback)
      ? { "system.changes": changes }
      : { changes };
  }

  static setUpdate(target, changes, source = null) {
    const update = ActiveEffectChangesCompatibility.buildUpdate(changes, target, source);
    Object.assign(target, update);
    return target;
  }
}
