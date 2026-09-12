import { Constants } from "../constants/Constants.js";
import { ActiveEffectContextBuilder } from "../helpers/ActiveEffectContextBuilder.js";
import { DaeCompatibility } from "../compat/DaeCompatibility.js";
import { ActiveEffectConditionService } from "../services/ActiveEffectConditionService.js";
import { ConditionVariableRegistry } from "../helpers/ConditionVariableRegistry.js";
import { ConditionStateLabels } from "../helpers/ConditionStateLabels.js";
import { Dnd5e6AttributeLabel } from "../helpers/Dnd5e6AttributeLabel.js";
import { Dnd5e6ChangeConditionService } from "../services/Dnd5e6ChangeConditionService.js";

export class ConditionTabContextBuilder {
  static normalizeConditionBehavior(conditionBehavior) {
    return conditionBehavior === Constants.CONDITION_BEHAVIOR_DISABLE
      ? Constants.CONDITION_BEHAVIOR_DISABLE
      : Constants.CONDITION_BEHAVIOR_SUPPRESS;
  }

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
    const conditionBehavior = ConditionTabContextBuilder.normalizeConditionBehavior(
      foundry.utils.getProperty(sheet.document ?? {}, Constants.CONDITION_BEHAVIOR_FLAG_PATH)
    );
    const applyBehavior = String(
      foundry.utils.getProperty(sheet.document ?? {}, Constants.APPLY_BEHAVIOR_FLAG_PATH) ?? "auto"
    );
    const normalizedApplyBehavior = ConditionTabContextBuilder.normalizeDisplayedApplyBehavior(applyBehavior);
    const showDaeApplyBehavior = Constants.isDaeActive();
    const conditionUsesTokenContext = ActiveEffectConditionService.usesTokenContext(sheet.document);

    return {
      tab: ConditionTabContextBuilder.#getConditionTab(sheet, context),
      condition,
      conditionInputValue,
      conditionFlagPath: Constants.CONDITION_FLAG_PATH,
      conditionBadgeLabel,
      conditionBadgeLabelLength: conditionBadgeLabel.length,
      conditionBadgeLabelFlagPath: Constants.CONDITION_BADGE_LABEL_FLAG_PATH,
      conditionBehaviorIsSuppress: conditionBehavior === Constants.CONDITION_BEHAVIOR_SUPPRESS,
      conditionBehaviorIsDisable: conditionBehavior === Constants.CONDITION_BEHAVIOR_DISABLE,
      conditionBehaviorFlagPath: Constants.CONDITION_BEHAVIOR_FLAG_PATH,
      conditionUsesTokenContext,
      useNativeAdvancedEditor: Dnd5e6ChangeConditionService.isSupported(),
      applyBehavior: ConditionTabContextBuilder.getApplyBehaviorLabel(normalizedApplyBehavior),
      applyBehaviorDescription: ConditionTabContextBuilder.getApplyBehaviorDescription(normalizedApplyBehavior),
      applyBehaviorIsDefault: normalizedApplyBehavior === "default",
      applyBehaviorIsDuplicate: normalizedApplyBehavior === "duplicate",
      applyBehaviorIsDae: normalizedApplyBehavior === "dae",
      applyBehaviorFlagPath: Constants.APPLY_BEHAVIOR_FLAG_PATH,
      showDaeApplyBehavior,
      badgeLabelMaxLength: Constants.CONDITION_BADGE_LABEL_MAX_LENGTH,
      conditionWikiUrl: `${Constants.MODULE_WIKI_URL}#active-effect-condition`,
      conditionSummary: ConditionTabContextBuilder.#buildConditionSummary(sheet),
      conditionInvalid: !validation.valid,
      validationMessage: validation.error?.message ?? "",
      evaluation,
      conditionVariables: ConditionTabContextBuilder.#buildConditionVariables(),
      codeHelpTooltip: ConditionTabContextBuilder.#buildCodeHelpTooltip(sheet, usesDaeCompatibility),
      strings: {
        label: Constants.localize("SCConditionalAE.ConditionTab.Label", "Condition"),
        heading: Constants.localize("SCConditionalAE.ConditionTab.Heading", "Active Effect condition"),
        summaryHeading: Constants.localize(
          "SCConditionalAE.ConditionTab.Summary.Heading",
          "Condition status"
        ),
        summaryEmpty: Constants.localize(
          "SCConditionalAE.ConditionTab.Summary.Empty",
          "No condition configured on this effect or on any of its changes."
        ),
        advancedEditorHint: Constants.localize(
          "SCConditionalAE.AdvancedConditions.OpenFromNative",
          "Edit the JavaScript condition from the Advanced Conditions tab in the native condition editor."
        ),
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
        variables: ConditionTabContextBuilder.#getAvailableVariablesText(),
        variableToolbarLabel: Constants.localize(
          "SCConditionalAE.ConditionTab.VariableToolbarLabel",
          "Available variables"
        ),
        variableToolbarHint: Constants.localize(
          "SCConditionalAE.ConditionTab.VariableToolbarHint",
          "Select a variable to insert it at the current cursor position."
        ),
        insertVariable: Constants.localize(
          "SCConditionalAE.ConditionTab.InsertVariable",
          "Insert variable"
        ),
        variableSearchPlaceholder: Constants.localize(
          "SCConditionalAE.ConditionTab.VariableSearchPlaceholder",
          "Search variables..."
        ),
        variableSearchEmpty: Constants.localize(
          "SCConditionalAE.ConditionTab.VariableSearchEmpty",
          "No variable matches this search."
        ),
        placeholder: Constants.localize(
          "SCConditionalAE.ConditionTab.Placeholder",
          "Example: return lightLevel === \"bright\";"
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
          "Optional custom label for the condition status badge. Leave blank to use the default label."
        ),
        badgeLabelPlaceholder: Constants.localize(
          "SCConditionalAE.ConditionTab.BadgeLabelPlaceholder",
          "e.g. Condition not met"
        ),
        conditionBehavior: Constants.localize(
          "SCConditionalAE.ConditionTab.ConditionBehavior",
          "When the condition is not met"
        ),
        conditionBehaviorSuppress: Constants.localize(
          "SCConditionalAE.ConditionTab.ConditionBehaviorSuppress",
          "Suppress changes (default)"
        ),
        conditionBehaviorDisable: Constants.localize(
          "SCConditionalAE.ConditionTab.ConditionBehaviorDisable",
          "Disable Active Effect"
        ),
        conditionBehaviorHint: Constants.localize(
          "SCConditionalAE.ConditionTab.ConditionBehaviorHint",
          "Choose whether to keep the Active Effect enabled while suppressing its changes, or synchronize its disabled state with the condition."
        ),
        spatialConditionBehaviorHint: Constants.localize(
          "SCConditionalAE.ConditionTab.SpatialConditionBehaviorHint",
          "Conditions that use token or lightLevel always suppress changes locally. They never persist the Active Effect's disabled state."
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

  /**
   * The at-a-glance panel for dnd5e 6: what each condition layer resolves to
   * right now, for the effect and for every change that carries one.
   */
  static #buildConditionSummary(sheet) {
    const summary = Dnd5e6ChangeConditionService.summarize(sheet?.document);
    if (!summary.supported) {
      return null;
    }

    const actor = ActiveEffectContextBuilder.getAffectedActor(sheet?.document);
    const rows = [
      ConditionTabContextBuilder.#buildSummaryRow(
        summary.effect,
        Constants.localize("SCConditionalAE.ConditionTab.Summary.Effect", "Active Effect"),
        actor
      ),
      ...summary.changes
        .filter(entry => entry.configured)
        .map(entry => ConditionTabContextBuilder.#buildSummaryRow(entry, "", actor))
    ];

    return {
      state: summary.combined.state,
      stateLabel: ConditionStateLabels.label(summary.combined.state),
      stateIcon: ConditionStateLabels.icon(summary.combined.state),
      rows,
      counts: ConditionTabContextBuilder.#buildSummaryCounts(summary.totals),
      hasIssues: summary.totals.error > 0,
      configuredCount: summary.totals.configured,
      isEmpty: !rows.some(row => row.configured)
    };
  }

  static #buildSummaryRow(entry, fallbackLabel, actor) {
    const label = fallbackLabel
      || Dnd5e6AttributeLabel.resolve(entry.key, { actor })
      || entry.key
      || Constants.localize("SCConditionalAE.ConditionTab.Summary.UnnamedChange", "Unnamed change");

    return {
      scope: entry.scope,
      changeId: entry.changeId ?? "",
      key: entry.key,
      label,
      state: entry.state,
      stateLabel: ConditionStateLabels.label(entry.state),
      stateIcon: ConditionStateLabels.icon(entry.state),
      configured: entry.configured,
      layers: [
        ConditionTabContextBuilder.#buildSummaryLayer(
          entry.native,
          "SCConditionalAE.ConditionTab.Summary.LayerNative",
          "Native"
        ),
        ConditionTabContextBuilder.#buildSummaryLayer(
          entry.advanced,
          "SCConditionalAE.ConditionTab.Summary.LayerAdvanced",
          "JavaScript"
        )
      ].filter(Boolean),
      message: entry.message,
      messageLabel: entry.message
        ? Constants.localize(
          entry.syntaxError
            ? "SCConditionalAE.ConditionTab.Summary.SyntaxError"
            : "SCConditionalAE.ConditionTab.Summary.RuntimeError",
          entry.syntaxError ? "Syntax error" : "Evaluation error"
        )
        : ""
    };
  }

  static #buildSummaryLayer(stage, key, fallback) {
    if (!stage?.configured) {
      return null;
    }

    return {
      label: Constants.localize(key, fallback),
      state: stage.state,
      stateLabel: ConditionStateLabels.label(stage.state)
    };
  }

  static #buildSummaryCounts(totals) {
    return ConditionStateLabels.STATES
      .filter(state => totals[state] > 0)
      .map(state => ({
        state,
        count: totals[state],
        icon: ConditionStateLabels.icon(state),
        label: ConditionStateLabels.label(state)
      }));
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
      ConditionTabContextBuilder.#getAvailableVariablesText()
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

  static #buildConditionVariables() {
    return ConditionVariableRegistry.variables.map(variable => {
      const description = Constants.localize(variable.descriptionKey, variable.description);
      const kindLabel = Constants.localize(variable.kindKey, variable.kind);
      return {
        name: variable.name,
        description,
        kindLabel,
        searchText: `${variable.name} ${kindLabel} ${description}`
      };
    });
  }

  static #getAvailableVariablesText() {
    const variables = ConditionVariableRegistry.names.join(", ");
    return Constants.format(
      "SCConditionalAE.ConditionTab.Variables",
      { variables },
      `Available variables: ${variables}.`
    );
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
