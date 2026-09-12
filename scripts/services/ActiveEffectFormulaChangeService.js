import { ResponsibleUser } from "../helpers/ResponsibleUser.js";
import { Constants } from "../constants/Constants.js";
import { ActiveEffectChangesCompatibility } from "../compat/ActiveEffectChangesCompatibility.js";
import { ActiveEffectContextBuilder } from "../helpers/ActiveEffectContextBuilder.js";
import { FormulaRollCardRenderer } from "../helpers/FormulaRollCardRenderer.js";
import { HtmlHelpers } from "../helpers/HtmlHelpers.js";
import { Dnd5e6ChangeConditionService } from "./Dnd5e6ChangeConditionService.js";

const ROLL_UPDATE_OPTION = "formulaRollUpdate";
const REAPPLY_UPDATE_OPTION = "formulaReapplyUpdate";

export class ActiveEffectFormulaChangeService {
  static get ROLL_UPDATE_OPTION() {
    return ROLL_UPDATE_OPTION;
  }

  /**
   * Effects the chat application is re-applying in the current batch.
   *
   * modifyBatch carries no operation options, so the flag that prepareUpdateSource
   * normally reads cannot ride along. The id is announced here instead and is
   * consumed by the update that follows in the same tick.
   */
  static #PENDING_REAPPLICATION_TTL_MS = 10000;
  static #pendingReapplications = new Map();

  static markReapplication(effectId) {
    if (!effectId) return;
    const id = String(effectId);
    const previous = ActiveEffectFormulaChangeService.#pendingReapplications.get(id);
    if (previous?.timeout) globalThis.clearTimeout(previous.timeout);
    const pending = {
      // Embedded ids can be equal on different target Actors in the same batch.
      count: (previous?.count ?? 0) + 1,
      timeout: null
    };
    pending.timeout = globalThis.setTimeout(() => {
      if (ActiveEffectFormulaChangeService.#pendingReapplications.get(id) === pending) {
        ActiveEffectFormulaChangeService.#pendingReapplications.delete(id);
      }
    }, ActiveEffectFormulaChangeService.#PENDING_REAPPLICATION_TTL_MS);
    ActiveEffectFormulaChangeService.#pendingReapplications.set(id, pending);
  }

  static #consumeReapplication(effect) {
    const id = String(effect?.id ?? "");
    const pending = ActiveEffectFormulaChangeService.#pendingReapplications.get(id);
    if (!pending) return false;
    if (pending.count > 1) {
      pending.count -= 1;
    } else {
      globalThis.clearTimeout(pending.timeout);
      ActiveEffectFormulaChangeService.#pendingReapplications.delete(id);
    }
    return true;
  }

  static get REAPPLY_UPDATE_OPTION() {
    return REAPPLY_UPDATE_OPTION;
  }

  static prepareCreateSource(effect, data) {
    const submittedFormulaChanges = ActiveEffectFormulaChangeService.#getSubmittedFormulaChanges(data);
    const existingFormulaChanges = ActiveEffectFormulaChangeService.#getFormulaChangesFromSource(data);
    const submittedChanges = ActiveEffectFormulaChangeService.#getSubmittedChanges(effect, data)
      ?? ActiveEffectFormulaChangeService.#getChangesArray(data)
      ?? ActiveEffectFormulaChangeService.#getChangesArray(effect)
      ?? [];
    const prepared = ActiveEffectFormulaChangeService.#prepareChanges({ changes: submittedChanges }, {
      existing: existingFormulaChanges,
      submitted: submittedFormulaChanges
    });
    if (!prepared.changed) {
      if (
        ActiveEffectFormulaChangeService.#hasExplicitBlankFormulaSubmission(submittedFormulaChanges)
        && !foundry.utils.isEmpty(existingFormulaChanges)
      ) {
        const sourceUpdate = {};
        ActiveEffectFormulaChangeService.#clearFormulaChanges(sourceUpdate);
        ActiveEffectFormulaChangeService.#clearFormulaChanges(data);
        effect.updateSource(sourceUpdate);
      }
      return;
    }

    const sourceUpdate = {};
    ActiveEffectFormulaChangeService.#setChangesForCreate(sourceUpdate, prepared.changes, data);
    ActiveEffectFormulaChangeService.#setChangesForCreate(data, prepared.changes, data);
    ActiveEffectFormulaChangeService.#setFormulaChanges(sourceUpdate, prepared.formulaChanges, existingFormulaChanges);
    ActiveEffectFormulaChangeService.#setFormulaChanges(data, prepared.formulaChanges, existingFormulaChanges);
    effect.updateSource(sourceUpdate);
  }

  static prepareUpdateSource(effect, updates, options) {
    if (options?.[Constants.MODULE_ID]?.[ROLL_UPDATE_OPTION]) {
      return;
    }

    const isFormulaReapplication = options?.[Constants.MODULE_ID]?.[REAPPLY_UPDATE_OPTION] === true
      || ActiveEffectFormulaChangeService.#consumeReapplication(effect);
    const isDisabledReactivation = updates?.disabled === false && effect?.disabled === true;
    const existingFormulaChanges = ActiveEffectFormulaChangeService.#getFormulaChanges(effect);
    const submittedFormulaChanges = ActiveEffectFormulaChangeService.#getSubmittedFormulaChanges(updates);
    const submittedChanges = ActiveEffectFormulaChangeService.#getSubmittedChanges(effect, updates);
    if (submittedChanges) {
      const prepared = ActiveEffectFormulaChangeService.#prepareChanges({ changes: submittedChanges }, {
        existing: existingFormulaChanges,
        submitted: submittedFormulaChanges
      });
      if (!prepared.changed) {
        if (
          ActiveEffectFormulaChangeService.hasFormulaChanges(effect)
          || ActiveEffectFormulaChangeService.#hasSubmittedFormulaChanges(submittedFormulaChanges)
        ) {
          ActiveEffectFormulaChangeService.#clearFlattenedFormulaChangeUpdates(updates);
          ActiveEffectFormulaChangeService.#clearFormulaChanges(updates);
        }
        return;
      }

      ActiveEffectFormulaChangeService.#setSubmittedChanges(effect, updates, prepared.changes);
      ActiveEffectFormulaChangeService.#clearFlattenedFormulaChangeUpdates(updates);
      ActiveEffectFormulaChangeService.#setFormulaChanges(updates, prepared.formulaChanges, existingFormulaChanges);
      return;
    }

    const flattenedChanges = ActiveEffectFormulaChangeService.#getFlattenedChangeUpdates(effect, updates);
    if (flattenedChanges) {
      const prepared = ActiveEffectFormulaChangeService.#prepareChanges({ changes: flattenedChanges }, {
        existing: existingFormulaChanges,
        submitted: submittedFormulaChanges
      });
      ActiveEffectFormulaChangeService.#clearFlattenedChangeUpdates(updates);

      if (!prepared.changed) {
        ActiveEffectChangesCompatibility.setUpdate(updates, flattenedChanges, effect);
        if (
          ActiveEffectFormulaChangeService.hasFormulaChanges(effect)
          || ActiveEffectFormulaChangeService.#hasSubmittedFormulaChanges(submittedFormulaChanges)
        ) {
          ActiveEffectFormulaChangeService.#clearFlattenedFormulaChangeUpdates(updates);
          ActiveEffectFormulaChangeService.#clearFormulaChanges(updates);
        }
        return;
      }

      ActiveEffectChangesCompatibility.setUpdate(updates, prepared.changes, effect);
      ActiveEffectFormulaChangeService.#clearFlattenedFormulaChangeUpdates(updates);
      ActiveEffectFormulaChangeService.#setFormulaChanges(updates, prepared.formulaChanges, existingFormulaChanges);
      return;
    }

    if (ActiveEffectFormulaChangeService.#hasSubmittedFormulaChanges(submittedFormulaChanges)) {
      const prepared = ActiveEffectFormulaChangeService.#prepareChanges(effect, {
        existing: existingFormulaChanges,
        submitted: submittedFormulaChanges
      });
      if (prepared.changed) {
        ActiveEffectChangesCompatibility.setUpdate(updates, prepared.changes, effect);
        ActiveEffectFormulaChangeService.#clearFlattenedFormulaChangeUpdates(updates);
        ActiveEffectFormulaChangeService.#setFormulaChanges(updates, prepared.formulaChanges, existingFormulaChanges);
      } else if (ActiveEffectFormulaChangeService.hasFormulaChanges(effect)) {
        ActiveEffectFormulaChangeService.#clearFlattenedFormulaChangeUpdates(updates);
        ActiveEffectFormulaChangeService.#clearFormulaChanges(updates);
      }
      return;
    }

    if (updates?.disabled === false && !ActiveEffectFormulaChangeService.hasFormulaChanges(effect)) {
      const prepared = ActiveEffectFormulaChangeService.#prepareChanges(effect);
      if (prepared.changed) {
        ActiveEffectChangesCompatibility.setUpdate(updates, prepared.changes, effect);
        ActiveEffectFormulaChangeService.#clearFlattenedFormulaChangeUpdates(updates);
        ActiveEffectFormulaChangeService.#setFormulaChanges(updates, prepared.formulaChanges);
        return;
      }
    }

    if (
      updates?.disabled !== false
      || !ActiveEffectFormulaChangeService.hasFormulaChanges(effect)
      || (!isDisabledReactivation && !isFormulaReapplication)
    ) {
      return;
    }

    // Reapplying an existing effect should clear formula-backed values so the update hook can request a fresh roll.
    ActiveEffectChangesCompatibility.setUpdate(
      updates,
      ActiveEffectFormulaChangeService.#zeroFormulaChangeValues(effect),
      effect
    );
  }

  static prepareSubmitData(effect, submitData) {
    ActiveEffectFormulaChangeService.prepareUpdateSource(effect, submitData, {});
  }

  static hasFormulaChanges(effect) {
    return Object.keys(ActiveEffectFormulaChangeService.#getFormulaChanges(effect)).length > 0;
  }

  static getFormulaChanges(effect) {
    return ActiveEffectFormulaChangeService.#getFormulaChanges(effect);
  }

  /** Bind stored formulas by stable v6 change id, with legacy index/key fallbacks. */
  static #resolveFormulaBindings(effect) {
    const formulaChanges = ActiveEffectFormulaChangeService.#getFormulaChanges(effect);
    const changes = ActiveEffectChangesCompatibility.get(effect);
    const entries = Object.entries(formulaChanges)
      .map(([index, formulaChange]) => ({
        storageKey: index,
        storedIndex: Number(index),
        changeId: String(formulaChange?.changeId ?? "").trim(),
        key: String(formulaChange?.key ?? "").trim(),
        formula: String(formulaChange?.formula ?? "").trim(),
        index: undefined,
        drifted: false
      }))
      .filter(entry => entry.formula.length)
      .sort((left, right) => (
        (Number.isInteger(left.storedIndex) ? left.storedIndex : Number.MAX_SAFE_INTEGER)
        - (Number.isInteger(right.storedIndex) ? right.storedIndex : Number.MAX_SAFE_INTEGER)
      ));

    const claimed = new Set();

    // New v6 data carries the change model's stable identity. It remains
    // unambiguous when multiple operations write the same key.
    for (const entry of entries) {
      if (!entry.changeId) continue;
      const index = changes.findIndex((change, position) => (
        !claimed.has(position)
        && Dnd5e6ChangeConditionService.getChangeId(change) === entry.changeId
      ));
      if (index < 0) continue;
      entry.index = index;
      entry.key ||= String(changes[index]?.key ?? "").trim();
      entry.drifted = entry.storedIndex !== index;
      claimed.add(index);
    }

    // Exact legacy hits next, so an untouched 5.3 effect binds as it always has
    // and can never be stolen by a later entry that shares the same key.
    for (const entry of entries) {
      if (entry.index !== undefined || entry.changeId) continue;
      const candidate = changes[entry.storedIndex];
      if (!candidate || claimed.has(entry.storedIndex)) continue;
      if (entry.key && candidate.key !== entry.key) continue;
      entry.index = entry.storedIndex;
      entry.key ||= String(candidate.key ?? "").trim();
      claimed.add(entry.storedIndex);
    }

    for (const entry of entries) {
      if (entry.index !== undefined || entry.changeId || !entry.key) continue;
      const index = changes.findIndex((change, position) => (
        !claimed.has(position) && String(change?.key ?? "").trim() === entry.key
      ));
      if (index < 0) continue;
      entry.index = index;
      entry.drifted = true;
      claimed.add(index);
    }

    for (const entry of entries) {
      entry.currentValue = entry.index === undefined
        ? ""
        : String(changes[entry.index]?.value ?? "").trim();
    }

    return entries;
  }

  static getFormulaChangeEntries(effect) {
    return ActiveEffectFormulaChangeService.#resolveFormulaBindings(effect)
      .filter(entry => entry.index !== undefined)
      .sort((left, right) => left.index - right.index);
  }

  /** Stored formulas whose change no longer exists under any position. */
  static getOrphanedFormulaChanges(effect) {
    return ActiveEffectFormulaChangeService.#resolveFormulaBindings(effect)
      .filter(entry => entry.index === undefined);
  }

  /**
   * Where a change's formula is stored, which is not necessarily where the
   * change now sits. Writing anywhere else would leave the drifted entry behind.
   */
  static getFormulaStorageIndex(effect, index) {
    const entry = ActiveEffectFormulaChangeService.#resolveFormulaBindings(effect)
      .find(candidate => candidate.index === index);
    if (!entry) return index;
    return Number.isInteger(entry.storedIndex) ? entry.storedIndex : entry.storageKey;
  }

  /** Formulas bound to a change that has since moved position. */
  static getDriftedFormulaChanges(effect) {
    return ActiveEffectFormulaChangeService.#resolveFormulaBindings(effect)
      .filter(entry => entry.drifted);
  }

  /** The formula bound to a change, resolved by key rather than by position. */
  static getFormulaForChange(effect, changeOrIndex) {
    const changes = ActiveEffectChangesCompatibility.get(effect);
    const index = typeof changeOrIndex === "number"
      ? changeOrIndex
      : (typeof changeOrIndex === "string"
        ? changes.findIndex(change => Dnd5e6ChangeConditionService.getChangeId(change) === changeOrIndex)
        : changes.indexOf(changeOrIndex));
    return ActiveEffectFormulaChangeService.#resolveFormulaBindings(effect)
      .find(entry => entry.index === index)?.formula ?? "";
  }

  /** The effect has something to roll and this client is the one that should ask. */
  static canPromptForRoll(effect) {
    return ActiveEffectFormulaChangeService.hasFormulaChanges(effect)
      && ActiveEffectFormulaChangeService.shouldPromptForCurrentUser(effect);
  }

  static shouldPromptForCurrentUser(effect) {
    const actor = ActiveEffectFormulaChangeService.getActor(effect);
    if (!actor) {
      return false;
    }

    return ResponsibleUser.isCurrentUser(actor);
  }

  static async rollFormulaChanges(effect, { changeIndexes = null } = {}) {
    const selectedIndexes = changeIndexes === null
      ? null
      : new Set(Array.from(changeIndexes, value => Number(value)));
    return ActiveEffectFormulaChangeService.#rollFormulaEntries(
      effect,
      ActiveEffectFormulaChangeService.getFormulaChangeEntries(effect)
        .filter(entry => !selectedIndexes || selectedIndexes.has(entry.index))
    );
  }

  static async rollFormulaChange(effect, changeIndex) {
    const normalizedIndex = Number(changeIndex);
    if (!Number.isInteger(normalizedIndex)) {
      return false;
    }

    return ActiveEffectFormulaChangeService.#rollFormulaEntries(
      effect,
      ActiveEffectFormulaChangeService.getFormulaChangeEntries(effect)
        .filter(formulaChange => formulaChange.index === normalizedIndex)
    );
  }

  static #prepareChanges(source, formulaChangeSources = {}) {
    const changes = ActiveEffectChangesCompatibility.clone(source);
    if (!Array.isArray(changes) || !changes.length) {
      return { changed: false, changes, formulaChanges: {} };
    }

    const existingFormulaChanges = formulaChangeSources.existing ?? {};
    const submittedFormulaChanges = formulaChangeSources.submitted ?? {};
    const formulaChanges = {};
    let changed = false;

    for (let index = 0; index < changes.length; index += 1) {
      const change = changes[index];
      const existingFormulaChange = ActiveEffectFormulaChangeService.#getExistingFormulaChange(index, change, existingFormulaChanges);
      const submittedFormulaChange = submittedFormulaChanges[index] ?? {};
      const formula = ActiveEffectFormulaChangeService.#getFormulaForPreparedChange(
        change,
        existingFormulaChange,
        submittedFormulaChange
      );
      if (!formula) {
        continue;
      }

      formulaChanges[index] = {
        formula,
        key: change.key,
        ...(Dnd5e6ChangeConditionService.getChangeId(change)
          ? { changeId: Dnd5e6ChangeConditionService.getChangeId(change) }
          : {})
      };
      if (ActiveEffectFormulaChangeService.#shouldResetFormulaBackedValue(change.value, formula, existingFormulaChange?.formula)) {
        change.value = "0";
      }
      changed = true;
    }

    return { changed, changes, formulaChanges };
  }

  static #getExistingFormulaChange(index, change, existingFormulaChanges) {
    const indexed = existingFormulaChanges[index] ?? {};
    if (ActiveEffectFormulaChangeService.#isCompatibleStoredFormula(change, indexed)) {
      return indexed;
    }

    const changeId = Dnd5e6ChangeConditionService.getChangeId(change);
    if (changeId) {
      const matched = Object.values(existingFormulaChanges).find(formulaChange => (
        String(formulaChange?.changeId ?? "").trim() === changeId
        && ActiveEffectFormulaChangeService.#isCompatibleStoredFormula(change, formulaChange)
      ));
      if (matched) return matched;
    }

    return {};
  }

  static #getFormulaForPreparedChange(change, existingFormulaChange, submittedFormulaChange) {
    if (!ActiveEffectContextBuilder.isFormulaEligibleChange(change)) {
      return null;
    }

    if (Object.prototype.hasOwnProperty.call(submittedFormulaChange ?? {}, "formula")) {
      const formula = String(submittedFormulaChange.formula ?? "").trim();
      return formula.length ? formula : null;
    }

    if (ActiveEffectFormulaChangeService.#isCompatibleStoredFormula(change, submittedFormulaChange)) {
      return String(submittedFormulaChange.formula).trim();
    }

    if (ActiveEffectFormulaChangeService.#isCompatibleStoredFormula(change, existingFormulaChange)) {
      return String(existingFormulaChange.formula).trim();
    }

    return null;
  }

  static #isCompatibleStoredFormula(change, formulaChange) {
    const formula = String(formulaChange?.formula ?? "").trim();
    if (!formula.length) {
      return false;
    }

    const storedChangeId = String(formulaChange?.changeId ?? "").trim();
    const changeId = Dnd5e6ChangeConditionService.getChangeId(change);
    if (storedChangeId && storedChangeId !== changeId) return false;
    return !formulaChange?.key || formulaChange.key === change.key;
  }

  static #getSubmittedFormulaChanges(updates) {
    const direct = foundry.utils.getProperty(updates ?? {}, Constants.FORMULA_CHANGES_FLAG_PATH);
    if (direct) {
      return direct;
    }

    return foundry.utils.getProperty(
      foundry.utils.expandObject(updates ?? {}),
      Constants.FORMULA_CHANGES_FLAG_PATH
    ) ?? {};
  }

  static #hasSubmittedFormulaChanges(formulaChanges) {
    return Object.values(formulaChanges ?? {}).some(formulaChange => (
      Object.prototype.hasOwnProperty.call(formulaChange ?? {}, "formula")
    ));
  }

  static #hasExplicitBlankFormulaSubmission(formulaChanges) {
    return Object.values(formulaChanges ?? {}).some(formulaChange => (
      Object.prototype.hasOwnProperty.call(formulaChange ?? {}, "formula")
      && !String(formulaChange?.formula ?? "").trim().length
    ));
  }

  static #getSubmittedChanges(effect, updates) {
    if (Array.isArray(updates?.changes)) {
      return foundry.utils.deepClone(updates.changes);
    }

    if (Array.isArray(updates?.system?.changes)) {
      return foundry.utils.deepClone(updates.system.changes);
    }

    const expanded = foundry.utils.expandObject(updates ?? {});
    if (Array.isArray(expanded?.changes)) {
      return foundry.utils.deepClone(expanded.changes);
    }

    if (Array.isArray(expanded?.system?.changes)) {
      return foundry.utils.deepClone(expanded.system.changes);
    }

    const objectChanges = expanded?.changes ?? expanded?.system?.changes;
    if (objectChanges && typeof objectChanges === "object") {
      return ActiveEffectFormulaChangeService.#mergeIndexedChanges(effect, objectChanges);
    }

    return null;
  }

  static #mergeIndexedChanges(effect, indexedChanges) {
    const indexes = Object.keys(indexedChanges).filter(index => /^\d+$/.test(index));
    if (!indexes.length) {
      return null;
    }

    const changes = ActiveEffectChangesCompatibility.clone(effect);
    for (const index of indexes) {
      changes[Number(index)] = {
        ...(changes[Number(index)] ?? {}),
        ...indexedChanges[index]
      };
    }

    return changes;
  }

  static #getChangesArray(source) {
    return ActiveEffectChangesCompatibility.hasExplicitChanges(source)
      ? ActiveEffectChangesCompatibility.clone(source)
      : null;
  }

  static #setSubmittedChanges(effect, updates, changes) {
    if (
      updates?.system?.changes
      || Object.keys(updates ?? {}).some(key => key.startsWith("system.changes."))
    ) {
      foundry.utils.setProperty(updates, "system.changes", changes);
      ActiveEffectFormulaChangeService.#clearFlattenedChangeUpdates(updates, "system.changes.");
      return;
    }

    ActiveEffectChangesCompatibility.setUpdate(updates, changes, effect);
    ActiveEffectFormulaChangeService.#clearFlattenedChangeUpdates(
      updates,
      ActiveEffectChangesCompatibility.usesSystemPath(updates, effect)
        ? "system.changes."
        : "changes."
    );
  }

  static #setChangesForCreate(target, changes, shapeSource) {
    if (!target || !Array.isArray(changes)) {
      return;
    }

    if (
      Array.isArray(shapeSource?.system?.changes)
      || Object.keys(shapeSource ?? {}).some(key => key.startsWith("system.changes."))
    ) {
      foundry.utils.setProperty(target, "system.changes", changes);
      ActiveEffectFormulaChangeService.#clearFlattenedChangeUpdates(target, "system.changes.");
      ActiveEffectFormulaChangeService.#deleteProperty(target, "changes");
      delete target.changes;
      ActiveEffectFormulaChangeService.#clearFlattenedChangeUpdates(target, "changes.");
      return;
    }

    target.changes = changes;
    ActiveEffectFormulaChangeService.#clearFlattenedChangeUpdates(target, "changes.");
    ActiveEffectFormulaChangeService.#deleteProperty(target, "system.changes");
    ActiveEffectFormulaChangeService.#clearFlattenedChangeUpdates(target, "system.changes.");
  }

  static #getFlattenedChangeUpdates(effect, updates) {
    const hasFlattenedKeys = updates && Object.keys(updates).some(key => key.startsWith("changes."));
    const hasObjectChanges = updates?.changes && typeof updates.changes === "object" && !Array.isArray(updates.changes);
    if (!hasFlattenedKeys && !hasObjectChanges) {
      return null;
    }

    const expandedChanges = hasObjectChanges ? updates.changes : foundry.utils.expandObject(updates).changes;
    if (!expandedChanges || Array.isArray(updates.changes)) {
      return null;
    }

    const changes = ActiveEffectChangesCompatibility.clone(effect);
    const indexes = Object.keys(expandedChanges).filter(index => /^\d+$/.test(index));
    if (!indexes.length) {
      return null;
    }

    for (const index of indexes) {
      const row = expandedChanges[index];
      changes[Number(index)] = {
        ...(changes[Number(index)] ?? {}),
        ...row
      };
    }

    return changes;
  }

  static #clearFlattenedChangeUpdates(updates, prefix = "changes.") {
    for (const key of Object.keys(updates)) {
      if (key.startsWith(prefix)) {
        delete updates[key];
      }
    }
  }

  static #clearFlattenedFormulaChangeUpdates(updates) {
    const prefix = `${Constants.FORMULA_CHANGES_FLAG_PATH}.`;
    for (const key of Object.keys(updates)) {
      if (key.startsWith(prefix)) {
        delete updates[key];
      }
    }
  }

  static #setFormulaChanges(updates, formulaChanges, existingFormulaChanges = {}) {
    ActiveEffectFormulaChangeService.#clearFormulaChangeUpdateValues(updates);

    for (const index of Object.keys(existingFormulaChanges)) {
      if (Object.prototype.hasOwnProperty.call(formulaChanges, index)) {
        continue;
      }

      updates[`${Constants.FORMULA_CHANGES_FLAG_PATH}.-=${index}`] = null;
    }

    for (const [index, formulaChange] of Object.entries(formulaChanges)) {
      foundry.utils.setProperty(updates, `${Constants.FORMULA_CHANGES_FLAG_PATH}.${index}`, formulaChange);
    }
  }

  static #clearFormulaChanges(updates) {
    ActiveEffectFormulaChangeService.#clearFormulaChangeUpdateValues(updates);
    updates[`flags.${Constants.MODULE_ID}.-=${Constants.FLAG_FORMULA_CHANGES}`] = null;
  }

  static #clearFormulaChangeUpdateValues(updates) {
    ActiveEffectFormulaChangeService.#deleteProperty(updates, Constants.FORMULA_CHANGES_FLAG_PATH);
    delete updates[Constants.FORMULA_CHANGES_FLAG_PATH];
    ActiveEffectFormulaChangeService.#clearFlattenedFormulaChangeUpdates(updates);
  }

  static #deleteProperty(source, path) {
    if (!source || !path) {
      return;
    }

    const parts = path.split(".");
    const property = parts.pop();
    let target = source;

    for (const part of parts) {
      target = target?.[part];
      if (!target || typeof target !== "object") {
        return;
      }
    }

    delete target[property];
  }

  static #shouldResetFormulaBackedValue(value, formula, existingFormula) {
    value = String(value ?? "").trim();
    if (!value.length) {
      return true;
    }

    formula = String(formula ?? "").trim();
    if (formula.length && value === formula) {
      return true;
    }

    existingFormula = String(existingFormula ?? "").trim();
    return existingFormula.length && value === existingFormula;
  }


  static #zeroFormulaChangeValues(effect) {
    const changes = ActiveEffectChangesCompatibility.clone(effect);
    for (const entry of ActiveEffectFormulaChangeService.getFormulaChangeEntries(effect)) {
      if (changes[entry.index]) changes[entry.index].value = "0";
    }
    return changes;
  }

  static #getFormulaChanges(effect) {
    const formulaChanges = foundry.utils.deepClone(effect?.getFlag?.(Constants.MODULE_ID, Constants.FLAG_FORMULA_CHANGES) ?? {});
    return Object.fromEntries(Object.entries(formulaChanges).filter(([_index, formulaChange]) => (
      String(formulaChange?.formula ?? "").trim().length
    )));
  }

  static #getFormulaChangesFromSource(source) {
    const formulaChanges = foundry.utils.deepClone(
      foundry.utils.getProperty(source ?? {}, Constants.FORMULA_CHANGES_FLAG_PATH)
      ?? source?.flags?.[Constants.MODULE_ID]?.[Constants.FLAG_FORMULA_CHANGES]
      ?? {}
    );

    return Object.fromEntries(Object.entries(formulaChanges).filter(([_index, formulaChange]) => (
      String(formulaChange?.formula ?? "").trim().length
    )));
  }

  static async #rollFormulaEntries(effect, formulaEntries) {
    if (!formulaEntries.length || !ActiveEffectFormulaChangeService.hasFormulaChanges(effect)) {
      return false;
    }

    if (!Dnd5e6ChangeConditionService.isEffectAllowed(effect)) {
      return false;
    }

    const actor = ActiveEffectFormulaChangeService.getActor(effect);
    if (!actor) {
      return false;
    }

    const changes = ActiveEffectChangesCompatibility.clone(effect);
    const formulaChanges = ActiveEffectFormulaChangeService.#getFormulaChanges(effect);
    let changed = false;

    ActiveEffectFormulaChangeService.#warnAboutOrphanedFormulas(effect);

    for (const formulaEntry of formulaEntries) {
      const change = changes[formulaEntry.index];
      const formulaChange = formulaChanges[formulaEntry.storageKey];
      if (!change || !formulaChange) {
        continue;
      }

      if (!Dnd5e6ChangeConditionService.isChangeAllowed(effect, change, { actor })) {
        continue;
      }

      const rollResult = await ActiveEffectFormulaChangeService.#promptAndRollFormula({
        actor,
        change,
        effect,
        formula: formulaChange.formula
      });

      if (!rollResult) {
        continue;
      }

      change.value = String(rollResult.total);
      changed = true;
    }

    if (!changed) {
      return false;
    }

    const updateData = ActiveEffectChangesCompatibility.buildUpdate(changes, effect);
    ActiveEffectFormulaChangeService.#setFormulaChanges(updateData, formulaChanges);
    await effect.update(updateData, { [Constants.MODULE_ID]: { [ROLL_UPDATE_OPTION]: true } });
    return true;
  }

  /**
   * A formula whose change is gone would otherwise be silently dropped, or
   * worse, rolled against whatever change inherited its position.
   */
  static #warnAboutOrphanedFormulas(effect) {
    const orphaned = ActiveEffectFormulaChangeService.getOrphanedFormulaChanges(effect);
    if (!orphaned.length) {
      return;
    }

    const keys = orphaned.map(entry => entry.key || `#${entry.storedIndex}`).join(", ");
    console.warn(`[${Constants.MODULE_ID}] formulas with no matching change on "${effect?.name ?? ""}"`, orphaned);
    ui.notifications?.warn?.(Constants.format(
      "SCConditionalAE.FormulaChange.OrphanedFormula",
      { effect: effect?.name ?? "", keys },
      'Formulas on "{effect}" no longer match a change and were skipped: {keys}.'
    ));
  }

  static async #promptAndRollFormula({ actor, change, effect, formula }) {
    try {
      return await ActiveEffectFormulaChangeService.#rollWithNativeDialog({ actor, change, effect, formula });
    } catch (error) {
      ui.notifications?.warn?.(
        Constants.localize("SCConditionalAE.FormulaChange.InvalidFormula", "Invalid Active Effect formula.")
      );
      console.warn(`[${Constants.MODULE_ID}] active effect formula roll failed`, error);
      return null;
    }
  }

  static async #rollWithNativeDialog({ actor, change, effect, formula }) {
    const normalizedFormula = ActiveEffectFormulaChangeService.normalizeRollFormula(formula);
    if (!normalizedFormula) {
      return null;
    }

    const rollData = actor.getRollData?.() ?? {};
    const title = ActiveEffectFormulaChangeService.#getFormulaRollTitle(effect);
    const windowTitle = change.key ? `${title} - ${change.key}` : title;
    const BasicRoll = CONFIG.Dice?.BasicRoll;

    if (!BasicRoll?.buildConfigure || !BasicRoll?.buildEvaluate || !BasicRoll?.buildPost) {
      return ActiveEffectFormulaChangeService.#rollWithFallbackDialog({ actor, change, effect, formula });
    }

    const rollConfig = {
      subject: effect,
      rolls: [{
        parts: [normalizedFormula],
        data: rollData,
        options: { activeEffect: effect.id, key: change.key }
      }]
    };
    const dialogConfig = {
      configure: false,
      options: {
        window: {
          title: windowTitle,
          subtitle: "DND5E.RollConfiguration.Title",
          icon: effect.img ?? effect.icon ?? "icons/svg/d20.svg"
        }
      }
    };
    const messageConfig = {
      rollMode: BasicRoll.getMessageMode?.(),
      data: {
        speaker: ChatMessage.getSpeaker({ actor }),
        title,
        flags: {
          [Constants.MODULE_ID]: {
            effectUuid: effect.uuid,
            changeKey: change.key,
            formula: String(formula ?? "")
          }
        }
      }
    };

    const rolls = await BasicRoll.buildConfigure(rollConfig, dialogConfig, messageConfig);
    await BasicRoll.buildEvaluate(rolls, rollConfig, messageConfig);

    const roll = rolls?.[0];
    if (!roll) {
      return null;
    }

    messageConfig.data.content = await FormulaRollCardRenderer.build({
      change,
      effect,
      roll,
      title: ActiveEffectFormulaChangeService.#getFormulaRollTitle(effect)
    });
    await BasicRoll.buildPost(rolls, rollConfig, messageConfig);

    return {
      total: roll.total
    };
  }

  static async #rollWithFallbackDialog({ actor, change, effect, formula }) {
    const proposedFormula = await ActiveEffectFormulaChangeService.#promptFormula({ actor, change, effect, formula });
    if (!proposedFormula) {
      return null;
    }

    const roll = new Roll(ActiveEffectFormulaChangeService.normalizeRollFormula(proposedFormula), actor.getRollData?.() ?? {});
    await roll.evaluate();
    await roll.toMessage({
      content: await FormulaRollCardRenderer.build({
        change,
        effect,
        roll,
        title: ActiveEffectFormulaChangeService.#getFormulaRollTitle(effect)
      }),
      speaker: ChatMessage.getSpeaker({ actor })
    });
    return {
      total: roll.total
    };
  }

  static normalizeRollFormula(formula) {
    const value = String(formula ?? "").trim();
    return value.startsWith("-") ? value.replace(/^-\s*/, "0 - ") : value;
  }

  static #getFormulaRollTitle(effect) {
    return String(
      effect.name
      ?? effect.label
      ?? Constants.localize("SCConditionalAE.FormulaChange.RollFlavor", "Active Effect formula roll")
    );
  }

  static async #promptFormula({ actor, change, effect, formula }) {
    const title = Constants.localize("SCConditionalAE.FormulaChange.DialogTitle", "Roll Active Effect Formula");
    const escapedFormula = HtmlHelpers.escape(String(formula ?? ""));
    const escapedEffectName = HtmlHelpers.escape(effect.name ?? "");
    const escapedActorName = HtmlHelpers.escape(actor.name ?? "");
    const escapedKey = HtmlHelpers.escape(change.key ?? "");
    const content = `
      <p>${Constants.localize("SCConditionalAE.FormulaChange.DialogHint", "Confirm or edit the formula to roll for this Active Effect.")}</p>
      <p><strong>${escapedEffectName}</strong> - ${escapedActorName}</p>
      <label>${escapedKey}</label>
      <input type="text" name="formula" value="${escapedFormula}" autofocus />
    `;

    return ActiveEffectFormulaChangeService.#promptFormulaV2(title, content);
  }

  static #promptFormulaV2(title, content) {
    return foundry.applications.api.DialogV2.wait({
      rejectClose: false,
      window: { title },
      content,
      buttons: [
        {
          action: "roll",
          label: Constants.localize("SCConditionalAE.FormulaChange.RollButton", "Roll"),
          default: true,
          callback: (_event, _button, dialog) => ({
            action: "roll",
            formula: dialog.element?.querySelector("input[name='formula']")?.value?.trim() ?? ""
          })
        },
        {
          action: "cancel",
          label: Constants.localize("Cancel", "Cancel"),
          callback: () => ({ action: "cancel" })
        }
      ]
    }).then(result => (
      result?.action === "roll" && result.formula ? result.formula : null
    ));
  }

  static getActor(effect) {
    return ActiveEffectContextBuilder.getAffectedActor(effect);
  }
}
