import { Constants } from "../constants/Constants.js";
import { ActiveEffectContextBuilder } from "../helpers/ActiveEffectContextBuilder.js";
import { FormulaRollCardRenderer } from "../helpers/FormulaRollCardRenderer.js";
import { HtmlHelpers } from "../helpers/HtmlHelpers.js";
import { ActiveEffectConditionService } from "./ActiveEffectConditionService.js";

const ROLL_UPDATE_OPTION = "formulaRollUpdate";
const REAPPLY_UPDATE_OPTION = "formulaReapplyUpdate";

export class ActiveEffectFormulaChangeService {
  static get ROLL_UPDATE_OPTION() {
    return ROLL_UPDATE_OPTION;
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

    const isFormulaReapplication = options?.[Constants.MODULE_ID]?.[REAPPLY_UPDATE_OPTION] === true;
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

      ActiveEffectFormulaChangeService.#setSubmittedChanges(updates, prepared.changes);
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
        updates.changes = flattenedChanges;
        if (
          ActiveEffectFormulaChangeService.hasFormulaChanges(effect)
          || ActiveEffectFormulaChangeService.#hasSubmittedFormulaChanges(submittedFormulaChanges)
        ) {
          ActiveEffectFormulaChangeService.#clearFlattenedFormulaChangeUpdates(updates);
          ActiveEffectFormulaChangeService.#clearFormulaChanges(updates);
        }
        return;
      }

      updates.changes = prepared.changes;
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
        updates.changes = prepared.changes;
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
        updates.changes = prepared.changes;
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
    updates.changes = ActiveEffectFormulaChangeService.#zeroFormulaChangeValues(effect);
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

  static getFormulaChangeEntries(effect) {
    const formulaChanges = ActiveEffectFormulaChangeService.#getFormulaChanges(effect);

    return Object.entries(formulaChanges)
      .map(([index, formulaChange]) => ({
        index: Number(index),
        key: String(formulaChange?.key ?? effect?.changes?.[Number(index)]?.key ?? "").trim(),
        formula: String(formulaChange?.formula ?? "").trim(),
        currentValue: String(effect?.changes?.[Number(index)]?.value ?? "").trim()
      }))
      .filter(formulaChange => Number.isInteger(formulaChange.index) && formulaChange.formula.length)
      .sort((left, right) => left.index - right.index);
  }

  static shouldPromptForCurrentUser(effect) {
    const actor = ActiveEffectFormulaChangeService.#getActor(effect);
    if (!actor) {
      return false;
    }

    return ActiveEffectFormulaChangeService.#getResponsibleUser(actor)?.id === game.user?.id;
  }

  static async rollFormulaChanges(effect) {
    return ActiveEffectFormulaChangeService.#rollFormulaEntries(
      effect,
      ActiveEffectFormulaChangeService.getFormulaChangeEntries(effect)
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
    const changes = foundry.utils.deepClone(source?.changes ?? []);
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
        key: change.key
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

    const changes = foundry.utils.deepClone(effect.changes ?? []);
    for (const index of indexes) {
      changes[Number(index)] = {
        ...(changes[Number(index)] ?? {}),
        ...indexedChanges[index]
      };
    }

    return changes;
  }

  static #getChangesArray(source) {
    if (Array.isArray(source?.changes)) {
      return foundry.utils.deepClone(source.changes);
    }

    if (Array.isArray(source?.system?.changes)) {
      return foundry.utils.deepClone(source.system.changes);
    }

    return null;
  }

  static #setSubmittedChanges(updates, changes) {
    if (
      updates?.system?.changes
      || Object.keys(updates ?? {}).some(key => key.startsWith("system.changes."))
    ) {
      foundry.utils.setProperty(updates, "system.changes", changes);
      ActiveEffectFormulaChangeService.#clearFlattenedChangeUpdates(updates, "system.changes.");
      return;
    }

    updates.changes = changes;
    ActiveEffectFormulaChangeService.#clearFlattenedChangeUpdates(updates, "changes.");
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

    const changes = foundry.utils.deepClone(effect.changes ?? []);
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
    const changes = foundry.utils.deepClone(effect.changes ?? []);
    const formulaChanges = ActiveEffectFormulaChangeService.#getFormulaChanges(effect);
    for (const index of Object.keys(formulaChanges)) {
      if (changes[Number(index)]) {
        changes[Number(index)].value = "0";
      }
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

    if (ActiveEffectConditionService.shouldSuppress(effect)) {
      return false;
    }

    const actor = ActiveEffectFormulaChangeService.#getActor(effect);
    if (!actor) {
      return false;
    }

    const changes = foundry.utils.deepClone(effect.changes ?? []);
    const formulaChanges = ActiveEffectFormulaChangeService.#getFormulaChanges(effect);
    let changed = false;

    for (const formulaEntry of formulaEntries) {
      const change = changes[formulaEntry.index];
      const formulaChange = formulaChanges[formulaEntry.index];
      if (!change || !formulaChange) {
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

    const updateData = { changes };
    ActiveEffectFormulaChangeService.#setFormulaChanges(updateData, formulaChanges);
    await effect.update(updateData, { [Constants.MODULE_ID]: { [ROLL_UPDATE_OPTION]: true } });
    return true;
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
    const normalizedFormula = ActiveEffectFormulaChangeService.#normalizeRollFormula(formula);
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

    const roll = new Roll(ActiveEffectFormulaChangeService.#normalizeRollFormula(proposedFormula), actor.getRollData?.() ?? {});
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

  static #normalizeRollFormula(formula) {
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
      window: { title },
      content,
      rejectClose: false,
      buttons: [
        {
          action: "roll",
          label: Constants.localize("SCConditionalAE.FormulaChange.RollButton", "Roll"),
          default: true,
          callback: (_event, _button, dialog) =>
            dialog.element?.querySelector("input[name='formula']")?.value?.trim() || null
        },
        {
          action: "cancel",
          label: Constants.localize("Cancel", "Cancel"),
          callback: () => null
        }
      ]
    });
  }

  static #getResponsibleUser(actor) {
    const activeUsers = game.users?.filter(user => user.active) ?? [];
    const owner = activeUsers.find(user => (
      !user.isGM && actor.testUserPermission(user, "OWNER")
    ));

    if (owner) {
      return owner;
    }

    return game.users?.activeGM ?? activeUsers.find(user => user.isGM) ?? null;
  }

  static #getActor(effect) {
    const parent = effect?.parent;
    if (parent instanceof CONFIG.Actor.documentClass) {
      return parent;
    }

    if (parent instanceof CONFIG.Item.documentClass) {
      return null;
    }

    return null;
  }
}
