import { Constants } from "../constants/Constants.js";
import { DaeCompatibility } from "../compat/DaeCompatibility.js";
import { ActiveEffectConditionService } from "../services/ActiveEffectConditionService.js";
import { ActiveEffectFormulaChangeService } from "../services/ActiveEffectFormulaChangeService.js";
import { FormulaColumnRenderer } from "./FormulaColumnRenderer.js";
import { ModuleSettings } from "../settings/ModuleSettings.js";
import { ConditionTabContextBuilder } from "./ConditionTabContextBuilder.js";

export class EffectSheetSubmitDataHandler {
  static clean(sheet, submitData) {
    const data = submitData?.object && typeof submitData.object === "object" ? submitData.object : submitData;
    const targets = EffectSheetSubmitDataHandler.#getTargets(submitData, data);
    const daeConditionWasEdited = Array.from(targets).some(target =>
      EffectSheetSubmitDataHandler.#hasSubmittedDaeConditionChange(sheet.document, target)
    );
    for (const target of targets) {
      EffectSheetSubmitDataHandler.#collectCustomFields(sheet, target);
      EffectSheetSubmitDataHandler.#syncDaeStacking(target);
      EffectSheetSubmitDataHandler.#cleanCondition(sheet, target, daeConditionWasEdited);
      if (ModuleSettings.isFormulaChangesEnabled()) {
        EffectSheetSubmitDataHandler.#collectFormulaFields(sheet, target);
        ActiveEffectFormulaChangeService.prepareSubmitData(sheet.document, target);
      }
    }
  }

  // Foundry v13 passes submitData as args[2]; v14 changed the signature.
  // This heuristic finds the correct argument across both versions and dnd5e overrides.
  static findSubmitDataArgument(args) {
    if (args[2]?.object && typeof args[2].object === "object") {
      return args[2].object;
    }

    if (args[2] && typeof args[2] === "object") {
      return args[2];
    }

    for (let index = args.length - 1; index >= 0; index -= 1) {
      const arg = args[index];
      if (!arg || typeof arg !== "object") {
        continue;
      }

      if (arg.object && typeof arg.object === "object") {
        return arg.object;
      }

      if (!("currentTarget" in arg) && !("target" in arg)) {
        return arg;
      }
    }

    return {};
  }

  static #cleanCondition(sheet, submitData, daeConditionWasEdited) {
    const condition = foundry.utils.getProperty(submitData ?? {}, Constants.CONDITION_FLAG_PATH);
    if (typeof condition !== "string") {
      return;
    }

    const existingCondition = ActiveEffectConditionService.getCondition(sheet.document);
    const existingIsDaeBacked = DaeCompatibility.isCompatibilityCondition(existingCondition);
    const displayedExistingCondition = DaeCompatibility.toDisplayCondition(existingCondition);
    const conditionWasEdited = condition !== displayedExistingCondition;
    if (!conditionWasEdited && (existingIsDaeBacked || daeConditionWasEdited)) {
      // DAE and SC render separate inputs for the same logical condition. Leave
      // DAE-backed values intact when SC's input did not change.
      if (existingIsDaeBacked || !existingCondition.trim().length) {
        // The SC flag does not own the displayed value here, so drop the copy
        // collected from the input. An unedited SC-native script keeps its
        // collected value instead and survives a DAE-side edit untouched.
        foundry.utils.setProperty(submitData, Constants.CONDITION_FLAG_PATH, null);
      }
      return;
    }

    // The displayed mode tells which DAE field the SC input was editing, so
    // updates and clears only ever touch that field.
    const fallbackMode = DaeCompatibility.getCompatibilityMode(existingCondition);
    const trimmedCondition = condition.trim();
    if (!trimmedCondition.length) {
      DaeCompatibility.applyConditionSubmitData(submitData, "", fallbackMode);
      return;
    }

    DaeCompatibility.applyConditionSubmitData(submitData, trimmedCondition, fallbackMode);
  }

  static #hasSubmittedDaeConditionChange(effect, submitData) {
    for (const path of [
      Constants.DAE_CONDITION_FLAG_PATH,
      Constants.DAE_DISABLE_CONDITION_FLAG_PATH
    ]) {
      if (!foundry.utils.hasProperty(submitData ?? {}, path)) {
        continue;
      }

      const submittedValue = String(foundry.utils.getProperty(submitData, path) ?? "");
      const existingValue = String(foundry.utils.getProperty(effect ?? {}, path) ?? "");
      if (submittedValue !== existingValue) {
        return true;
      }
    }

    return false;
  }

  static #collectCustomFields(sheet, submitData) {
    const root = FormulaColumnRenderer.getSheetRoot(sheet) ?? sheet.element;
    if (!root || !submitData) {
      return;
    }

    for (const element of root.querySelectorAll([
      `[name="${Constants.CONDITION_BADGE_LABEL_FLAG_PATH}"]`,
      `[name="${Constants.CONDITION_BEHAVIOR_FLAG_PATH}"]`,
      `[name="${Constants.APPLY_BEHAVIOR_FLAG_PATH}"]`,
      `[name="${Constants.CONDITION_FLAG_PATH}"]`
    ].join(", "))) {
      if (!element?.name) {
        continue;
      }

      foundry.utils.setProperty(submitData, element.name, element.value ?? "");
    }
  }

  static #syncDaeStacking(submitData) {
    if (!Constants.isDaeActive() || !submitData) {
      return;
    }

    const applyBehavior = ConditionTabContextBuilder.normalizeDisplayedApplyBehavior(
      foundry.utils.getProperty(submitData, Constants.APPLY_BEHAVIOR_FLAG_PATH)
    );
    if (applyBehavior !== "duplicate") {
      return;
    }

    foundry.utils.setProperty(submitData, "flags.dae.stackable", "multi");
  }

  static #collectFormulaFields(sheet, submitData) {
    const root = FormulaColumnRenderer.getSheetRoot(sheet);
    if (!root || !submitData) {
      return;
    }

    for (const input of root.querySelectorAll(".sc-cae-formula-input")) {
      if (!input.name) {
        continue;
      }

      foundry.utils.setProperty(submitData, input.name, input.value ?? "");
    }
  }

  static #getTargets(submitData, primaryData) {
    const targets = new Set();
    if (primaryData && typeof primaryData === "object") {
      targets.add(primaryData);
    }

    for (const key of ["object", "updateData"]) {
      const value = submitData?.[key];
      if (value && typeof value === "object") {
        targets.add(value);
      }
    }

    if (
      targets.size === 0
      && submitData
      && typeof submitData === "object"
      && !("currentTarget" in submitData)
      && !("target" in submitData)
    ) {
      targets.add(submitData);
    }

    return targets;
  }
}
