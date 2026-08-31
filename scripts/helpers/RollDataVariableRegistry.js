/** Paths worth offering first on a dnd5e actor, in the order the editor shows them. */
const SUGGESTED_PATHS = Object.freeze([
  "abilities.str.mod",
  "abilities.dex.mod",
  "abilities.con.mod",
  "attributes.prof",
  "details.level",
  "attributes.hp.max"
]);

const SUGGESTION_LIMIT = 6;

export class RollDataVariableRegistry {
  /**
   * Flattens an actor's roll data into `@path` entries the formula editor can insert.
   * Only numeric leaves are offered: they are the ones a roll formula can consume.
   */
  static build(actor) {
    const rollData = RollDataVariableRegistry.getRollData(actor);
    const all = RollDataVariableRegistry.#flatten(rollData);
    return { rollData, all, suggested: RollDataVariableRegistry.#suggest(all) };
  }

  static getRollData(actor) {
    try {
      return actor?.getRollData?.() ?? {};
    } catch (_error) {
      return {};
    }
  }

  static #flatten(rollData) {
    let flattened = {};
    try {
      flattened = foundry.utils.flattenObject(rollData ?? {});
    } catch (_error) {
      return [];
    }

    return Object.entries(flattened)
      .filter(([path, value]) => Number.isFinite(value) && !path.includes("-="))
      .map(([path, value]) => ({ path, name: `@${path}`, value: Number(value) }))
      .sort((left, right) => left.path.localeCompare(right.path));
  }

  static #suggest(all) {
    const byPath = new Map(all.map(variable => [variable.path, variable]));
    const suggested = SUGGESTED_PATHS
      .map(path => byPath.get(path))
      .filter(Boolean);

    if (suggested.length) {
      return suggested;
    }

    return all.slice(0, SUGGESTION_LIMIT);
  }
}
