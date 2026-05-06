import { Constants } from "../constants/Constants.js";
import { ActiveEffectConditionService } from "./ActiveEffectConditionService.js";

const DICE_FORMULA_PATTERN = /(?:^|[^a-zA-Z])(?:\d+)?d\d+/i;
const ROLL_UPDATE_OPTION = "formulaRollUpdate";

export class ActiveEffectFormulaChangeService {
  static get ROLL_UPDATE_OPTION() {
    return ROLL_UPDATE_OPTION;
  }

  static prepareCreateSource(effect, data) {
    const prepared = ActiveEffectFormulaChangeService.#prepareChanges(data);
    if (!prepared.changed) {
      return;
    }

    const sourceUpdate = { changes: prepared.changes };
    foundry.utils.setProperty(sourceUpdate, Constants.FORMULA_CHANGES_FLAG_PATH, prepared.formulaChanges);
    effect.updateSource(sourceUpdate);
  }

  static prepareUpdateSource(effect, updates, options) {
    if (options?.[Constants.MODULE_ID]?.[ROLL_UPDATE_OPTION]) {
      return;
    }

    if (Array.isArray(updates?.changes)) {
      const prepared = ActiveEffectFormulaChangeService.#prepareChanges(updates);
      if (!prepared.changed) {
        if (ActiveEffectFormulaChangeService.hasFormulaChanges(effect)) {
          foundry.utils.setProperty(updates, Constants.FORMULA_CHANGES_FLAG_PATH, null);
        }
        return;
      }

      updates.changes = prepared.changes;
      foundry.utils.setProperty(updates, Constants.FORMULA_CHANGES_FLAG_PATH, prepared.formulaChanges);
      return;
    }

    const flattenedChanges = ActiveEffectFormulaChangeService.#getFlattenedChangeUpdates(effect, updates);
    if (flattenedChanges) {
      const prepared = ActiveEffectFormulaChangeService.#prepareChanges({ changes: flattenedChanges });
      ActiveEffectFormulaChangeService.#clearFlattenedChangeUpdates(updates);

      if (!prepared.changed) {
        updates.changes = flattenedChanges;
        if (ActiveEffectFormulaChangeService.hasFormulaChanges(effect)) {
          foundry.utils.setProperty(updates, Constants.FORMULA_CHANGES_FLAG_PATH, null);
        }
        return;
      }

      updates.changes = prepared.changes;
      foundry.utils.setProperty(updates, Constants.FORMULA_CHANGES_FLAG_PATH, prepared.formulaChanges);
      return;
    }

    if (updates?.disabled === false && !ActiveEffectFormulaChangeService.hasFormulaChanges(effect)) {
      const prepared = ActiveEffectFormulaChangeService.#prepareChanges(effect);
      if (prepared.changed) {
        updates.changes = prepared.changes;
        foundry.utils.setProperty(updates, Constants.FORMULA_CHANGES_FLAG_PATH, prepared.formulaChanges);
        return;
      }
    }

    if (updates?.disabled !== false || !ActiveEffectFormulaChangeService.hasFormulaChanges(effect)) {
      return;
    }

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

  static shouldPromptForCurrentUser(effect) {
    const actor = ActiveEffectFormulaChangeService.#getActor(effect);
    if (!actor) {
      return false;
    }

    return ActiveEffectFormulaChangeService.#getResponsibleUser(actor)?.id === game.user?.id;
  }

  static async rollFormulaChanges(effect) {
    if (!ActiveEffectFormulaChangeService.hasFormulaChanges(effect)) {
      return;
    }

    if (ActiveEffectConditionService.shouldSuppress(effect)) {
      return;
    }

    const actor = ActiveEffectFormulaChangeService.#getActor(effect);
    if (!actor) {
      return;
    }

    const changes = foundry.utils.deepClone(effect.changes ?? []);
    const formulaChanges = ActiveEffectFormulaChangeService.#getFormulaChanges(effect);
    let changed = false;

    for (const [index, formulaChange] of Object.entries(formulaChanges)) {
      const change = changes[Number(index)];
      if (!change) {
        continue;
      }

      const total = await ActiveEffectFormulaChangeService.#promptAndRollFormula({
        actor,
        change,
        effect,
        formula: formulaChange.formula
      });

      if (total === null) {
        continue;
      }

      change.value = String(total);
      changed = true;
    }

    if (!changed) {
      return;
    }

    await effect.update(
      { changes },
      { [Constants.MODULE_ID]: { [ROLL_UPDATE_OPTION]: true } }
    );
  }

  static #prepareChanges(source) {
    const changes = foundry.utils.deepClone(source?.changes ?? []);
    if (!Array.isArray(changes) || !changes.length) {
      return { changed: false, changes, formulaChanges: {} };
    }

    const formulaChanges = {};
    let changed = false;

    for (let index = 0; index < changes.length; index += 1) {
      const change = changes[index];
      if (!ActiveEffectFormulaChangeService.#isFormulaChange(change)) {
        continue;
      }

      formulaChanges[index] = {
        formula: String(change.value).trim(),
        key: change.key
      };
      change.value = "0";
      changed = true;
    }

    return { changed, changes, formulaChanges };
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

  static #clearFlattenedChangeUpdates(updates) {
    for (const key of Object.keys(updates)) {
      if (key.startsWith("changes.")) {
        delete updates[key];
      }
    }
  }

  static #isFormulaChange(change) {
    if (!change?.key || ActiveEffectFormulaChangeService.#isCustomChange(change)) {
      return false;
    }

    const value = String(change.value ?? "").trim();
    return DICE_FORMULA_PATTERN.test(value);
  }

  static #isCustomChange(change) {
    return Number(change.mode) === CONST.ACTIVE_EFFECT_MODES.CUSTOM
      || String(change.mode ?? "").toLowerCase() === "custom"
      || String(change.type ?? "").toLowerCase() === "custom";
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
    return foundry.utils.deepClone(effect?.getFlag?.(Constants.MODULE_ID, Constants.FLAG_FORMULA_CHANGES) ?? {});
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
    const flavor = Constants.localize("SCConditionalAE.FormulaChange.RollFlavor", "Active Effect formula roll");
    const title = `${effect.name ?? flavor} - ${change.key}`;
    const BasicRoll = CONFIG.Dice?.BasicRoll;

    if (!BasicRoll?.build) {
      return ActiveEffectFormulaChangeService.#rollWithFallbackDialog({ actor, change, effect, formula });
    }

    const rolls = await BasicRoll.build(
      {
        subject: effect,
        rolls: [{
          parts: [normalizedFormula],
          data: rollData,
          options: { activeEffect: effect.id, key: change.key }
        }]
      },
      {
        configure: true,
        options: {
          window: {
            title,
            subtitle: "DND5E.RollConfiguration.Title",
            icon: effect.img ?? effect.icon ?? "icons/svg/d20.svg"
          }
        }
      },
      {
        rollMode: BasicRoll.getMessageMode?.(),
        data: {
          speaker: ChatMessage.getSpeaker({ actor }),
          flavor,
          title,
          flags: {
            [Constants.MODULE_ID]: {
              effectUuid: effect.uuid,
              changeKey: change.key,
              formula: String(formula ?? "")
            }
          }
        }
      }
    );

    return rolls?.[0]?.total ?? null;
  }

  static async #rollWithFallbackDialog({ actor, change, effect, formula }) {
    const proposedFormula = await ActiveEffectFormulaChangeService.#promptFormula({ actor, change, effect, formula });
    if (!proposedFormula) {
      return null;
    }

    const roll = new Roll(ActiveEffectFormulaChangeService.#normalizeRollFormula(proposedFormula), actor.getRollData?.() ?? {});
    await roll.evaluate();
    await roll.toMessage({
      flavor: Constants.localize("SCConditionalAE.FormulaChange.RollFlavor", "Active Effect formula roll"),
      speaker: ChatMessage.getSpeaker({ actor })
    });
    return roll.total;
  }

  static #normalizeRollFormula(formula) {
    const value = String(formula ?? "").trim();
    return value.startsWith("-") ? value.replace(/^-\s*/, "0 - ") : value;
  }

  static async #promptFormula({ actor, change, effect, formula }) {
    const title = Constants.localize("SCConditionalAE.FormulaChange.DialogTitle", "Roll Active Effect Formula");
    const escapedFormula = ActiveEffectFormulaChangeService.#escapeHtml(String(formula ?? ""));
    const escapedEffectName = ActiveEffectFormulaChangeService.#escapeHtml(effect.name ?? "");
    const escapedActorName = ActiveEffectFormulaChangeService.#escapeHtml(actor.name ?? "");
    const escapedKey = ActiveEffectFormulaChangeService.#escapeHtml(change.key ?? "");
    const content = `
      <p>${Constants.localize("SCConditionalAE.FormulaChange.DialogHint", "Confirm or edit the formula to roll for this Active Effect.")}</p>
      <p><strong>${escapedEffectName}</strong> - ${escapedActorName}</p>
      <label>${escapedKey}</label>
      <input type="text" name="formula" value="${escapedFormula}" autofocus />
    `;

    return ActiveEffectFormulaChangeService.#promptFormulaLegacy(title, content);
  }

  static #promptFormulaLegacy(title, content) {
    return new Promise(resolve => {
      new Dialog({
        title,
        content,
        buttons: {
          roll: {
            label: Constants.localize("SCConditionalAE.FormulaChange.RollButton", "Roll"),
            callback: html => resolve(ActiveEffectFormulaChangeService.#getLegacyDialogFormula(html))
          },
          cancel: {
            label: Constants.localize("Cancel", "Cancel"),
            callback: () => resolve(null)
          }
        },
        default: "roll",
        close: () => resolve(null)
      }).render(true);
    });
  }

  static #getLegacyDialogFormula(html) {
    const element = html instanceof HTMLElement ? html : html?.[0];
    return element?.querySelector("input[name='formula']")?.value?.trim() ?? null;
  }

  static #escapeHtml(value) {
    const element = document.createElement("div");
    element.textContent = String(value ?? "");
    return element.innerHTML;
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
      return parent.actor ?? parent.parent ?? null;
    }

    return null;
  }
}
