import { Constants } from "../constants/Constants.js";
import { ConditionVariablePopover } from "./ConditionVariablePopover.js";
import { ConditionStateLabels } from "../helpers/ConditionStateLabels.js";
import { ConditionVariableRegistry } from "../helpers/ConditionVariableRegistry.js";
import { Dnd5e6ConditionEvaluationService } from "./Dnd5e6ConditionEvaluationService.js";
import { Dnd5e6NativeFilterBuilderModel } from "../models/Dnd5e6NativeFilterBuilderModel.js";
import { Dnd5e6NativeFilterBuilderView } from "./Dnd5e6NativeFilterBuilderView.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const TEMPLATE = `modules/${Constants.MODULE_ID}/templates/dnd5e-v6-advanced-conditions-editor.hbs`;
const REFRESH_DELAY_MS = 300;
const TABS = Object.freeze(["native", "advanced", "evaluation"]);

// English fallbacks, so the builder still reads well when a translation is missing.
const GROUP_OPERATOR_LABELS = {
  AND: "Match all",
  NAND: "Fail at least one",
  OR: "Match any",
  NOR: "Match none",
  XOR: "Match exactly one",
  NOT: "Invert the single child"
};

const COMPARISON_OPERATOR_LABELS = {
  exact: "is exactly",
  gt: "is greater than",
  gte: "is at least",
  lt: "is less than",
  lte: "is at most",
  empty: "is empty",
  contains: "contains",
  icontains: "contains (ignore case)",
  startswith: "starts with",
  istartswith: "starts with (ignore case)",
  endswith: "ends with",
  iendswith: "ends with (ignore case)",
  has: "has",
  hasany: "has any of",
  hasall: "has all of",
  subsetof: "is a subset of",
  in: "is one of"
};

const COMPARISON_CATEGORY_LABELS = {
  value: "Value",
  text: "Text",
  collection: "Collection"
};

export class Dnd5e6AdvancedConditionsEditor extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = foundry.utils.mergeObject(super.DEFAULT_OPTIONS, {
    id: `${Constants.MODULE_ID}-advanced-conditions`,
    classes: ["standard-form", "dnd5e2", "sc-cae-v6-conditions-editor"],
    position: { width: 620, height: 620 },
    tag: "form",
    window: {
      icon: "fa-solid fa-filter-circle-dollar",
      resizable: true,
      title: "SCConditionalAE.AdvancedConditions.Title"
    }
  }, { inplace: false });

  static PARTS = {
    editor: { template: TEMPLATE }
  };

  /**
   * One registered instance per target. A shared id would let a second editor
   * evict the first from foundry.applications.instances, leaving an orphaned
   * window on screen that still saves to the change it was opened for.
   */
  _initializeApplicationOptions(options) {
    const initialized = super._initializeApplicationOptions(options);
    const target = [options.effect?.uuid ?? options.effect?.id, options.changeId]
      .filter(Boolean)
      .join("-")
      .replace(/[^A-Za-z0-9_-]/g, "-");
    if (target) initialized.id = `${initialized.id}-${target}`;
    return initialized;
  }

  #activeTab = "native";
  #variablePopover = null;
  #nativeBuilder = null;
  #nativeView = "builder";
  #renderAbortController = null;
  #saving = false;
  #scheduleRefresh = null;

  async _prepareContext(_options) {
    const evaluation = this.#evaluate(this.options.nativeValue, this.options.advancedValue);
    return {
      conditionWikiUrl: `${Constants.MODULE_WIKI_URL}#active-effect-condition`,
      nativeValue: this.options.nativeValue || "{}",
      advancedValue: this.options.advancedValue || "",
      evaluation: this.#toViewModel(evaluation),
      variables: ConditionVariableRegistry.variables.map(variable => {
        const description = Constants.localize(variable.descriptionKey, variable.description);
        const kindLabel = Constants.localize(variable.kindKey, variable.kind);
        return {
          ...variable,
          description,
          kindLabel,
          searchText: `${variable.name} ${kindLabel} ${description}`
        };
      }),
      strings: this.#getStrings()
    };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    this.#renderAbortController?.abort();
    const AbortControllerClass = this.element.ownerDocument?.defaultView?.AbortController ?? AbortController;
    this.#renderAbortController = new AbortControllerClass();
    const listenerOptions = { signal: this.#renderAbortController.signal };
    this.#variablePopover?.destroy?.();
    this.#variablePopover = null;
    this.#nativeBuilder = null;
    this.#activateTab(this.#activeTab);
    this.element.querySelectorAll("[data-sc-cae-tab]").forEach(button => {
      button.addEventListener("click", event => {
        event.preventDefault();
        this.#activateTab(button.dataset.scCaeTab);
      }, listenerOptions);
      button.addEventListener("keydown", event => this.#onTabKeyDown(event), listenerOptions);
    });
    this.element.querySelectorAll("[data-sc-cae-native-view]").forEach(button => {
      button.addEventListener("click", event => {
        event.preventDefault();
        this.#activateNativeView(button.dataset.scCaeNativeView);
      }, listenerOptions);
    });
    // Every keystroke would otherwise recompile and run the half-written
    // condition, and deep-clone the whole effect to build its context.
    this.#scheduleRefresh = foundry.utils.debounce(() => this.#refreshEvaluation(), REFRESH_DELAY_MS);
    this.element.addEventListener("input", () => this.#scheduleRefresh(), listenerOptions);
    this.element.addEventListener("change", () => this.#scheduleRefresh(), listenerOptions);
    this.element.addEventListener("submit", event => {
      event.preventDefault();
      void this.#save();
    }, listenerOptions);
    this.element.querySelector("[data-action='save']")?.addEventListener("click", event => {
      event.preventDefault();
      void this.#save();
    }, listenerOptions);
    this.element.querySelector("[data-action='cancel']")?.addEventListener("click", event => {
      event.preventDefault();
      void this.close();
    }, listenerOptions);
    this.#variablePopover = ConditionVariablePopover.activate(this.element, "advancedCondition");
    if (!this.#createNativeBuilder()) this.#nativeView = "json";
    this.#activateNativeView(this.#nativeView, { rebuild: false });
  }

  async _onClose(options) {
    this.#scheduleRefresh = null;
    this.#variablePopover?.destroy?.();
    this.#variablePopover = null;
    this.#nativeBuilder = null;
    this.#renderAbortController?.abort();
    this.#renderAbortController = null;
    return super._onClose(options);
  }

  #activateTab(tab) {
    this.#activeTab = TABS.includes(tab) ? tab : "native";
    this.element.querySelectorAll("[data-sc-cae-tab]").forEach(button => {
      const active = button.dataset.scCaeTab === this.#activeTab;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
    });
    this.element.querySelectorAll("[data-sc-cae-panel]").forEach(panel => {
      const active = panel.dataset.scCaePanel === this.#activeTab;
      panel.classList.toggle("active", active);
      panel.hidden = !active;
    });
  }

  #onTabKeyDown(event) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const tabs = Array.from(this.element.querySelectorAll("[data-sc-cae-tab]"));
    const current = tabs.indexOf(event.currentTarget);
    const index = event.key === "Home" ? 0
      : event.key === "End" ? tabs.length - 1
        : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    const next = tabs[index];
    this.#activateTab(next.dataset.scCaeTab);
    next.focus();
  }

  #activateNativeView(view, { rebuild = true } = {}) {
    let nextView = view === "json" ? "json" : "builder";
    if (nextView === "builder" && rebuild) {
      try {
        if (this.#nativeBuilder) this.#nativeBuilder.showBuilder();
        else if (!this.#createNativeBuilder()) throw new Error("Invalid native filter JSON.");
      } catch (error) {
        nextView = "json";
        ui.notifications?.warn?.(Constants.localize(
          "SCConditionalAE.AdvancedConditions.Builder.InvalidJson",
          "Correct the JSON before opening the visual builder."
        ));
      }
    }
    this.#nativeView = nextView;
    this.element.querySelectorAll("[data-sc-cae-native-view]").forEach(button => {
      const active = button.dataset.scCaeNativeView === nextView;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    this.element.querySelectorAll("[data-sc-cae-native-content]").forEach(content => {
      content.hidden = content.dataset.scCaeNativeContent !== nextView;
    });
  }

  #createNativeBuilder() {
    const rawEditor = this.element.querySelector('code-mirror[name="nativeCondition"]');
    const builder = this.element.querySelector("[data-sc-cae-native-builder]");
    if (!rawEditor || !builder) return false;
    try {
      this.#nativeBuilder = new Dnd5e6NativeFilterBuilderView({
        builder,
        rawEditor,
        source: rawEditor.value,
        strings: this.#getStrings().builder,
        actor: this.#getActor(),
        onChange: () => this.#scheduleRefresh?.()
      });
      return true;
    } catch {
      this.#nativeBuilder = null;
      return false;
    }
  }

  /** The actor dnd5e uses to resolve attribute labels; an item-owned effect resolves through its item. */
  #getActor() {
    const parent = this.options.effect?.parent ?? null;
    return parent?.documentName === "Actor" ? parent : (parent?.actor ?? null);
  }

  #getValue(name) {
    return String(this.element.querySelector(`code-mirror[name="${name}"]`)?.value ?? "");
  }

  #evaluate(nativeValue, advancedValue) {
    return Dnd5e6ConditionEvaluationService.evaluate({
      effect: this.options.effect,
      nativeCode: nativeValue,
      advancedCode: advancedValue,
      advancedMode: this.options.advancedMode ?? null,
      changeId: this.options.changeId ?? null
    });
  }

  #refreshEvaluation() {
    if (!this.element) return;
    const evaluation = this.#toViewModel(this.#evaluate(
      this.#getValue("nativeCondition"),
      this.#getValue("advancedCondition")
    ));
    const status = this.element?.querySelector?.("[data-sc-cae-combined-status]");
    if (!status) return;
    status.dataset.state = evaluation.combined.state;
    status.querySelector("[data-sc-cae-status-label]").textContent = evaluation.combined.label;
    const tabState = this.element.querySelector("[data-sc-cae-tab-state]");
    if (tabState) {
      tabState.dataset.state = evaluation.combined.state;
      tabState.className = `fa-solid ${evaluation.combined.icon} sc-cae-v6-tab-state`;
    }
    for (const key of ["nativeGlobal", "advancedGlobal", "native", "advanced"]) {
      const row = this.element.querySelector(`[data-sc-cae-evaluation-row="${key}"]`);
      if (!row) continue;
      row.dataset.state = evaluation[key].state;
      row.querySelector("[data-sc-cae-evaluation-value]").textContent = evaluation[key].label;
    }
  }

  async #save() {
    if (this.#saving) return;
    const nativeValue = this.#getValue("nativeCondition").trim() || "{}";
    const advancedValue = this.#getValue("advancedCondition");
    const evaluation = this.#evaluate(nativeValue, advancedValue);
    if (evaluation.native.state === "error" || evaluation.advanced.state === "error") {
      ui.notifications?.warn?.(Constants.localize(
        "SCConditionalAE.AdvancedConditions.Invalid",
        "Correct the invalid condition before saving."
      ));
      this.#refreshEvaluation();
      return;
    }
    const saveButton = this.element.querySelector("[data-action='save']");
    this.#saving = true;
    if (saveButton) saveButton.disabled = true;
    try {
      await this.options.onSave?.({ nativeValue, advancedValue });
      await this.close();
    } catch (error) {
      console.error(`[${Constants.MODULE_ID}] could not save advanced conditions`, error);
      ui.notifications?.error?.(Constants.localize(
        "SCConditionalAE.AdvancedConditions.SaveFailed",
        "The conditions could not be saved."
      ));
      this.#saving = false;
      if (saveButton) saveButton.disabled = false;
    }
  }

  #toViewModel(evaluation) {
    return Object.fromEntries(Object.entries(evaluation).map(([key, value]) => [key, {
      ...value,
      label: ConditionStateLabels.label(value.state),
      icon: ConditionStateLabels.icon(value.state),
      errorMessage: value.error?.message ?? ""
    }]));
  }

  #localize(section, ids, fallbacks) {
    return Object.fromEntries(ids.map(id => [
      id,
      Constants.localize(`SCConditionalAE.AdvancedConditions.Builder.${section}.${id}`, fallbacks[id] ?? id)
    ]));
  }

  #getStrings() {
    return {
      tabsLabel: Constants.localize("SCConditionalAE.AdvancedConditions.TabsLabel", "Condition editors"),
      native: Constants.localize("SCConditionalAE.AdvancedConditions.Native", "Native Conditions"),
      advanced: Constants.localize("SCConditionalAE.AdvancedConditions.Advanced", "Advanced Conditions"),
      advancedCodeLabel: Constants.localize("SCConditionalAE.AdvancedConditions.AdvancedCodeLabel", "JavaScript"),
      evaluation: Constants.localize("SCConditionalAE.AdvancedConditions.Evaluation", "Current evaluation"),
      evaluationTab: Constants.localize("SCConditionalAE.AdvancedConditions.EvaluationTab", "Evaluation"),
      wiki: Constants.localize("SCConditionalAE.ConditionTab.Wiki", "Open wiki"),
      scopeGeneral: Constants.localize("SCConditionalAE.ConditionTab.Summary.ScopeEffect", "General"),
      scopeThisChange: Constants.localize("SCConditionalAE.AdvancedConditions.ScopeThisChange", "This change"),
      layerNative: Constants.localize("SCConditionalAE.ConditionTab.Summary.LayerNative", "Native"),
      layerAdvanced: Constants.localize("SCConditionalAE.ConditionTab.Summary.LayerAdvanced", "JavaScript"),
      evaluationInfo: Constants.localize(
        "SCConditionalAE.AdvancedConditions.EvaluationInfo",
        "What each condition layer resolves to right now, against the effect's current actor. It only applies when every row is met; filters that read roll data can only be decided during a roll."
      ),
      combined: Constants.localize("SCConditionalAE.AdvancedConditions.Combined", "All conditions"),
      insertVariable: Constants.localize("SCConditionalAE.ConditionTab.InsertVariable", "Insert variable"),
      variableSearch: Constants.localize("SCConditionalAE.ConditionTab.VariableSearchPlaceholder", "Search variables..."),
      variableSearchEmpty: Constants.localize("SCConditionalAE.ConditionTab.VariableSearchEmpty", "No variable matches this search."),
      save: Constants.localize("EFFECT.Submit", "Save"),
      cancel: Constants.localize("Cancel", "Cancel"),
      builder: {
        builder: Constants.localize("SCConditionalAE.AdvancedConditions.Builder.Builder", "Builder"),
        json: Constants.localize("SCConditionalAE.AdvancedConditions.Builder.Json", "JSON"),
        viewLabel: Constants.localize("SCConditionalAE.AdvancedConditions.Builder.ViewLabel", "Filter view"),
        filterLabel: Constants.localize("SCConditionalAE.AdvancedConditions.Builder.FilterLabel", "Filter"),
        matchLabel: Constants.localize("SCConditionalAE.AdvancedConditions.Builder.MatchLabel", "Match"),
        attributeColumn: Constants.localize("SCConditionalAE.AdvancedConditions.Builder.AttributeColumn", "Attribute"),
        operatorColumn: Constants.localize("SCConditionalAE.AdvancedConditions.Builder.OperatorColumn", "Operator"),
        valueColumn: Constants.localize("SCConditionalAE.AdvancedConditions.Builder.ValueColumn", "Value"),
        groupOperators: this.#localize("GroupOperators", Dnd5e6NativeFilterBuilderModel.GROUP_OPERATORS, GROUP_OPERATOR_LABELS),
        comparisonOperators: this.#localize(
          "Operators",
          Dnd5e6NativeFilterBuilderModel.COMPARISON_OPERATORS,
          COMPARISON_OPERATOR_LABELS
        ),
        comparisonCategories: this.#localize(
          "OperatorCategories",
          Dnd5e6NativeFilterBuilderModel.COMPARISON_OPERATOR_CATEGORIES.map(category => category.id),
          COMPARISON_CATEGORY_LABELS
        ),
        addCondition: Constants.localize("SCConditionalAE.AdvancedConditions.Builder.AddCondition", "Add condition"),
        addGroup: Constants.localize("SCConditionalAE.AdvancedConditions.Builder.AddGroup", "Add group"),
        remove: Constants.localize("SCConditionalAE.AdvancedConditions.Builder.Remove", "Remove"),
        empty: Constants.localize("SCConditionalAE.AdvancedConditions.Builder.Empty", "No conditions. The filter passes."),
        keyPlaceholder: Constants.localize("SCConditionalAE.AdvancedConditions.Builder.KeyPlaceholder", "e.g. attributes.hp.value"),
        valuePlaceholder: Constants.localize("SCConditionalAE.AdvancedConditions.Builder.ValuePlaceholder", "e.g. 5, true, \"fire\""),
        groupOperator: Constants.localize("SCConditionalAE.AdvancedConditions.Builder.GroupOperator", "Group operator"),
        comparisonOperator: Constants.localize("SCConditionalAE.AdvancedConditions.Builder.ComparisonOperator", "Comparison operator"),
        valueHint: Constants.localize(
          "SCConditionalAE.AdvancedConditions.Builder.ValueHint",
          "Values accept text or JSON literals such as 5, true, null, or [\"fire\", \"cold\"]."
        )
      }
    };
  }
}
