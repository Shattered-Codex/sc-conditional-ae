import { Constants } from "../constants/Constants.js";
import { ActiveEffectContextBuilder } from "../helpers/ActiveEffectContextBuilder.js";
import { DaeCompatibility } from "../compat/DaeCompatibility.js";
import { ActiveEffectConditionService } from "../services/ActiveEffectConditionService.js";

export class ConditionTabContextBuilder {
  static normalizeDisplayedApplyBehavior(applyBehavior) {
    const normalized = ActiveEffectContextBuilder.normalizeApplyBehavior(applyBehavior);
    if (normalized === "dae" && !Constants.isDaeActive()) {
      return "default";
    }

    if (normalized === "update") {
      return "default";
    }

    return normalized;
  }

  static getApplyBehaviorLabel(applyBehavior) {
    const normalized = ConditionTabContextBuilder.normalizeDisplayedApplyBehavior(applyBehavior);
    if (normalized === "duplicate") {
      return Constants.localize("SCConditionalAE.ConditionTab.ApplyBehaviorDuplicate", "Stack");
    }

    if (normalized === "dae") {
      return Constants.localize("SCConditionalAE.ConditionTab.ApplyBehaviorDae", "Same as DAE");
    }

    return Constants.localize("SCConditionalAE.ConditionTab.ApplyBehaviorUpdate", "Default");
  }

  static getApplyBehaviorDescription(applyBehavior) {
    const normalized = ConditionTabContextBuilder.normalizeDisplayedApplyBehavior(applyBehavior);
    if (normalized === "duplicate") {
      return Constants.localize(
        "SCConditionalAE.ConditionTab.ApplyBehaviorDuplicateHint",
        "Adds a new Active Effect instead of updating the existing one."
      );
    }

    if (normalized === "dae") {
      return Constants.localize(
        "SCConditionalAE.ConditionTab.ApplyBehaviorDaeHint",
        "Uses DAE's Stackable setting to decide whether the effect stacks."
      );
    }

    return Constants.localize(
      "SCConditionalAE.ConditionTab.ApplyBehaviorUpdateHint",
      "Reapplies the current Active Effect on the target instead of creating a new one."
    );
  }

  static build(sheet, context) {
    const condition = ActiveEffectConditionService.getCondition(sheet.document);
    const conditionInputValue = DaeCompatibility.toDisplayCondition(condition);
    const validation = ActiveEffectConditionService.validateCondition(condition);
    const usesDaeCompatibility = DaeCompatibility.isCompatibilityCondition(condition);
    const evaluation = ConditionTabContextBuilder.#buildEvaluation(sheet, condition, validation);
    const conditionBadgeLabel = String(
      foundry.utils.getProperty(sheet.document ?? {}, Constants.CONDITION_BADGE_LABEL_FLAG_PATH) ?? ""
    );
    const applyBehavior = String(
      foundry.utils.getProperty(sheet.document ?? {}, Constants.APPLY_BEHAVIOR_FLAG_PATH) ?? "auto"
    );
    const normalizedApplyBehavior = ConditionTabContextBuilder.normalizeDisplayedApplyBehavior(applyBehavior);
    const showDaeApplyBehavior = Constants.isDaeActive();

    return {
      tab: ConditionTabContextBuilder.#getConditionTab(sheet, context),
      condition,
      conditionInputValue,
      conditionFlagPath: Constants.CONDITION_FLAG_PATH,
      conditionBadgeLabel,
      conditionBadgeLabelLength: conditionBadgeLabel.length,
      conditionBadgeLabelFlagPath: Constants.CONDITION_BADGE_LABEL_FLAG_PATH,
      applyBehavior: ConditionTabContextBuilder.getApplyBehaviorLabel(normalizedApplyBehavior),
      applyBehaviorDescription: ConditionTabContextBuilder.getApplyBehaviorDescription(normalizedApplyBehavior),
      applyBehaviorIsDefault: normalizedApplyBehavior === "default",
      applyBehaviorIsDuplicate: normalizedApplyBehavior === "duplicate",
      applyBehaviorIsDae: normalizedApplyBehavior === "dae",
      applyBehaviorFlagPath: Constants.APPLY_BEHAVIOR_FLAG_PATH,
      showDaeApplyBehavior,
      badgeLabelMaxLength: Constants.CONDITION_BADGE_LABEL_MAX_LENGTH,
      conditionWikiUrl: `${Constants.MODULE_WIKI_URL}#active-effect-condition`,
      conditionInvalid: !validation.valid,
      validationMessage: validation.error?.message ?? "",
      evaluation,
      codeHelpTooltip: ConditionTabContextBuilder.#buildCodeHelpTooltip(sheet, usesDaeCompatibility),
      strings: {
        label: Constants.localize("SCConditionalAE.ConditionTab.Label", "Condition"),
        heading: Constants.localize("SCConditionalAE.ConditionTab.Heading", "Active Effect condition"),
        hint: Constants.localize(
          "SCConditionalAE.ConditionTab.Hint",
          "Use JavaScript. This Active Effect is applied only when the script returns true."
        ),
        compatibilityHint: usesDaeCompatibility
          ? Constants.localize(
            "SCConditionalAE.ConditionTab.CompatibilityHint",
            "This condition came from DAE. SC Conditional AE is adapting it automatically."
          )
          : "",
        variables: Constants.localize(
          "SCConditionalAE.ConditionTab.Variables",
          "Available variables: effect, actor, targetActor, item, origin, originActor, user, rollData, source, getProperty, hasProperty, deepClone, game."
        ),
        placeholder: Constants.localize(
          "SCConditionalAE.ConditionTab.Placeholder",
          "Example: return actor?.system?.attributes?.hp?.value > 0;"
        ),
        evaluationHeading: Constants.localize("SCConditionalAE.ConditionTab.Evaluation.Heading", "Current evaluation"),
        evaluationEmpty: Constants.localize(
          "SCConditionalAE.ConditionTab.Evaluation.Empty",
          "No condition configured. The effect is available."
        ),
        evaluationTrue: Constants.localize(
          "SCConditionalAE.ConditionTab.Evaluation.True",
          "The condition currently resolves to true. The effect is available."
        ),
        evaluationFalse: Constants.localize(
          "SCConditionalAE.ConditionTab.Evaluation.False",
          "The condition currently resolves to false. The effect is suppressed."
        ),
        evaluationError: Constants.localize(
          "SCConditionalAE.ConditionTab.Evaluation.Error",
          "The condition threw an error while being evaluated."
        ),
        evaluationResult: Constants.localize("SCConditionalAE.ConditionTab.Evaluation.Result", "Returned value"),
        evaluationContext: Constants.localize("SCConditionalAE.ConditionTab.Evaluation.Context", "Evaluated against"),
        evaluationEffectState: Constants.localize("SCConditionalAE.ConditionTab.Evaluation.EffectState", "Effect state"),
        wiki: Constants.localize("SCConditionalAE.ConditionTab.Wiki", "Open wiki"),
        invalid: Constants.localize("SCConditionalAE.ConditionTab.Invalid", "This condition has invalid code."),
        helpTooltipLabel: Constants.localize("SCConditionalAE.ConditionTab.HelpTooltipLabel", "Code help"),
        badgeLabel: Constants.localize("SCConditionalAE.ConditionTab.BadgeLabel", "Condition badge label"),
        badgeLabelHint: Constants.localize(
          "SCConditionalAE.ConditionTab.BadgeLabelHint",
          "Single-line label shown on inactive effects. Leave blank to hide."
        ),
        badgeLabelPlaceholder: Constants.localize(
          "SCConditionalAE.ConditionTab.BadgeLabelPlaceholder",
          "e.g. Condition not met"
        ),
        applyBehavior: Constants.localize("SCConditionalAE.ConditionTab.ApplyBehavior", "When applied to a target"),
        applyBehaviorUpdate: Constants.localize("SCConditionalAE.ConditionTab.ApplyBehaviorUpdate", "Default"),
        applyBehaviorDuplicate: Constants.localize("SCConditionalAE.ConditionTab.ApplyBehaviorDuplicate", "Stack"),
        applyBehaviorDae: Constants.localize("SCConditionalAE.ConditionTab.ApplyBehaviorDae", "Same as DAE"),
        applyBehaviorUpdateHint: Constants.localize(
          "SCConditionalAE.ConditionTab.ApplyBehaviorUpdateHint",
          "Reapplies the current Active Effect on the target instead of creating a new one."
        ),
        applyBehaviorDuplicateHint: Constants.localize(
          "SCConditionalAE.ConditionTab.ApplyBehaviorDuplicateHint",
          "Adds a new Active Effect instead of updating the existing one."
        ),
        applyBehaviorDaeHint: Constants.localize(
          "SCConditionalAE.ConditionTab.ApplyBehaviorDaeHint",
          "Uses DAE's Stackable setting to decide whether the effect stacks."
        )
      }
    };
  }

  static #buildEvaluation(sheet, condition, validation) {
    const trimmedCondition = String(condition ?? "").trim();
    if (!trimmedCondition.length) {
      return {
        state: "empty",
        available: true,
        isEmpty: true,
        isTrue: false,
        isFalse: false,
        isError: false,
        hasResult: false,
        resultLabel: "",
        contextLabel: ConditionTabContextBuilder.#getEvaluationContextLabel(sheet.document),
        effectStateLabel: ConditionTabContextBuilder.#getEffectStateLabel(sheet.document)
      };
    }

    if (!validation.valid) {
      return {
        state: "error",
        available: false,
        isEmpty: false,
        isTrue: false,
        isFalse: false,
        isError: true,
        hasResult: false,
        resultLabel: "",
        contextLabel: ConditionTabContextBuilder.#getEvaluationContextLabel(sheet.document),
        effectStateLabel: ConditionTabContextBuilder.#getEffectStateLabel(sheet.document),
        errorMessage: validation.error?.message ?? ""
      };
    }

    const evaluation = ActiveEffectConditionService.evaluate(sheet.document);
    return {
      state: evaluation.error ? "error" : (evaluation.available ? "true" : "false"),
      available: evaluation.available,
      isEmpty: false,
      isTrue: !evaluation.error && evaluation.available,
      isFalse: !evaluation.error && !evaluation.available,
      isError: Boolean(evaluation.error),
      hasResult: !evaluation.error,
      resultLabel: ConditionTabContextBuilder.#formatConditionResult(evaluation.result),
      contextLabel: ConditionTabContextBuilder.#getEvaluationContextLabel(sheet.document),
      effectStateLabel: ConditionTabContextBuilder.#getEffectStateLabel(sheet.document),
      errorMessage: evaluation.error?.message ?? ""
    };
  }

  static #buildCodeHelpTooltip(sheet, usesDaeCompatibility) {
    const lines = [
      Constants.localize(
        "SCConditionalAE.ConditionTab.Hint",
        "Use JavaScript. This Active Effect is applied only when the script returns true."
      ),
      Constants.localize(
        "SCConditionalAE.ConditionTab.Variables",
        "Available variables: effect, actor, targetActor, item, origin, originActor, user, rollData, source, getProperty, hasProperty, deepClone, game."
      )
    ];

    if (usesDaeCompatibility) {
      lines.push(
        Constants.localize(
          "SCConditionalAE.ConditionTab.CompatibilityHint",
          "This condition came from DAE. SC Conditional AE is adapting it automatically."
        )
      );
    }

    return lines.join("\n");
  }

  static #formatConditionResult(value) {
    if (value === undefined) {
      return "undefined";
    }

    if (typeof value === "string") {
      return JSON.stringify(value);
    }

    if (typeof value === "function") {
      return "[Function]";
    }

    if (typeof value === "object" && value !== null) {
      try {
        const serialized = JSON.stringify(value);
        return serialized.length > 180 ? `${serialized.slice(0, 177)}...` : serialized;
      } catch {
        return "[Object]";
      }
    }

    return String(value);
  }

  static #getEvaluationContextLabel(effect) {
    const parent = effect?.parent;
    if (parent instanceof CONFIG.Actor.documentClass) {
      return parent.name ?? parent.uuid ?? "";
    }

    if (parent instanceof CONFIG.Item.documentClass) {
      const actor = parent.actor ?? parent.parent ?? null;
      if (actor instanceof CONFIG.Actor.documentClass) {
        return `${actor.name ?? actor.uuid ?? ""} / ${parent.name ?? parent.uuid ?? ""}`;
      }

      return parent.name ?? parent.uuid ?? "";
    }

    return effect?.name ?? effect?.uuid ?? "";
  }

  static #getEffectStateLabel(effect) {
    const states = [];

    if (effect?.disabled === true) {
      states.push("disabled");
    }

    if (effect?.isSuppressed === true) {
      states.push("suppressed");
    }

    if (effect?.active === false) {
      states.push("inactive");
    }

    if (!states.length) {
      states.push("active");
    }

    return states.join(", ");
  }

  static #getConditionTab(sheet, context) {
    if (context?.tabs?.condition) {
      return context.tabs.condition;
    }

    const active = sheet.tabGroups?.sheet === "condition";
    return {
      id: "condition",
      group: "sheet",
      active,
      cssClass: active ? "active" : ""
    };
  }
}
