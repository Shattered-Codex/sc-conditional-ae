import { Constants } from "../constants/Constants.js";
import { ActiveEffectContextBuilder } from "../helpers/ActiveEffectContextBuilder.js";
import { ActiveEffectChangesCompatibility } from "../compat/ActiveEffectChangesCompatibility.js";
import { ConditionSourceInspector } from "../helpers/ConditionSourceInspector.js";
import { ActiveEffectConditionService } from "./ActiveEffectConditionService.js";

/**
 * Advanced SC conditions attached to dnd5e 6 Active Effect changes.
 *
 * The persisted map is keyed by the dnd5e change `_id`, never by its array
 * position. Native conditions remain authoritative in `system.conditions` and
 * `system.changes[*].conditions`; this service neither copies nor rewrites them.
 */
export class Dnd5e6ChangeConditionService {
  static FLAG_CHANGE_CONDITIONS = "changeConditions";
  static CHANGE_CONDITIONS_FLAG_PATH =
    `flags.${Constants.MODULE_ID}.${Dnd5e6ChangeConditionService.FLAG_CHANGE_CONDITIONS}`;

  static isSupported() {
    return Constants.isDnd5eAtLeast(6);
  }

  static getChangeId(changeOrId) {
    if (typeof changeOrId === "string") {
      return changeOrId.trim();
    }

    return String(changeOrId?._id ?? changeOrId?.id ?? "").trim();
  }

  static getChanges(effect) {
    return Array.from(ActiveEffectChangesCompatibility.get(effect));
  }

  static getChange(effect, changeOrId) {
    if (changeOrId && typeof changeOrId === "object") {
      return changeOrId;
    }

    const changeId = Dnd5e6ChangeConditionService.getChangeId(changeOrId);
    return Dnd5e6ChangeConditionService.getChanges(effect)
      .find(change => Dnd5e6ChangeConditionService.getChangeId(change) === changeId) ?? null;
  }

  static getConditionMap(effect) {
    const value = effect?.getFlag?.(
      Constants.MODULE_ID,
      Dnd5e6ChangeConditionService.FLAG_CHANGE_CONDITIONS
    ) ?? foundry.utils.getProperty(
      effect ?? {},
      Dnd5e6ChangeConditionService.CHANGE_CONDITIONS_FLAG_PATH
    );

    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  }

  static getCondition(effect, changeOrId) {
    if (!Dnd5e6ChangeConditionService.isSupported()) {
      return "";
    }

    const changeId = Dnd5e6ChangeConditionService.getChangeId(changeOrId);
    return changeId
      ? String(Dnd5e6ChangeConditionService.getConditionMap(effect)[changeId] ?? "")
      : "";
  }

  static hasCondition(effect, changeOrId) {
    return Dnd5e6ChangeConditionService.getCondition(effect, changeOrId).trim().length > 0;
  }

  static hasAnyCondition(effect) {
    if (!Dnd5e6ChangeConditionService.isSupported()) {
      return false;
    }

    return Dnd5e6ChangeConditionService.getConditionedChanges(effect).length > 0;
  }

  static getConditionedChanges(effect) {
    if (!Dnd5e6ChangeConditionService.isSupported()) {
      return [];
    }

    return Dnd5e6ChangeConditionService.getChanges(effect).flatMap(change => {
      const changeId = Dnd5e6ChangeConditionService.getChangeId(change);
      const code = Dnd5e6ChangeConditionService.getCondition(effect, changeId);
      return changeId && code.trim().length ? [{ change, changeId, code }] : [];
    });
  }

  static usesLightingContext(effect, changeOrId = null) {
    return Dnd5e6ChangeConditionService.#usesIdentifier(effect, changeOrId, "lightLevel");
  }

  static usesTokenContext(effect, changeOrId = null) {
    return Dnd5e6ChangeConditionService.usesLightingContext(effect, changeOrId)
      || Dnd5e6ChangeConditionService.usesDirectTokenContext(effect, changeOrId);
  }

  static usesDirectTokenContext(effect, changeOrId = null) {
    return Dnd5e6ChangeConditionService.#usesIdentifier(effect, changeOrId, "token");
  }

  static validateCondition(code) {
    return ActiveEffectConditionService.validateCondition(code);
  }

  static evaluate(effect, changeOrId, options = {}) {
    const change = Dnd5e6ChangeConditionService.getChange(effect, changeOrId);
    const condition = Dnd5e6ChangeConditionService.getCondition(effect, change ?? changeOrId);

    if (!Dnd5e6ChangeConditionService.isSupported()) {
      return Dnd5e6ChangeConditionService.#stage({ configured: false, available: true });
    }

    if (!change) {
      const error = new Error("The Active Effect change could not be resolved by its stable ID.");
      return Dnd5e6ChangeConditionService.#stage({
        configured: condition.trim().length > 0,
        available: false,
        error
      });
    }

    return Dnd5e6ChangeConditionService.evaluateCode(effect, change, condition, options);
  }

  /**
   * Whether every condition layer currently lets this change act — the native
   * dnd5e filter included.
   *
   * dnd5e enforces its own filters when it applies a change, but a macro or a
   * formula is ours to run, so nothing would stop them when only the native
   * layer is false.
   */
  static isChangeAllowed(effect, changeOrId, options = {}) {
    const summary = Dnd5e6ChangeConditionService.summarize(effect, options);
    if (!summary.supported) {
      const evaluation = Dnd5e6ChangeConditionService.evaluate(effect, changeOrId, options);
      return !evaluation.error && evaluation.available !== false;
    }

    // A contextual native filter (for example roll.type) cannot be proven true
    // during an actor refresh or a standalone macro/formula roll. Those custom
    // execution paths must fail closed until their caller supplies roll data.
    if (summary.effect.state !== "pass") {
      return false;
    }

    const changeId = Dnd5e6ChangeConditionService.getChangeId(changeOrId);
    const entry = summary.changes.find(candidate => candidate.changeId === changeId);
    return !entry || entry.state === "pass";
  }

  /** Whether the effect-wide layers, native and SC, currently pass. */
  static isEffectAllowed(effect, options = {}) {
    const summary = Dnd5e6ChangeConditionService.summarize(effect, options);
    if (!summary.supported) {
      return !ActiveEffectConditionService.shouldSuppress(effect);
    }

    return summary.effect.state === "pass";
  }

  static evaluateCode(effect, changeOrId, code, options = {}) {
    const change = Dnd5e6ChangeConditionService.getChange(effect, changeOrId);
    if (!Dnd5e6ChangeConditionService.isSupported()) {
      return Dnd5e6ChangeConditionService.#stage({ configured: false, available: true });
    }
    if (!change) {
      return Dnd5e6ChangeConditionService.#stage({
        configured: String(code ?? "").trim().length > 0,
        available: false,
        error: new Error("The Active Effect change could not be resolved by its stable ID.")
      });
    }

    const source = String(code ?? "");
    const evaluation = ActiveEffectConditionService.evaluateCode(effect, source, {
      ...options,
      change
    });
    return Dnd5e6ChangeConditionService.#stage({
      configured: source.trim().length > 0,
      ...evaluation
    });
  }

  /** Evaluate unsaved editor values together with the currently selected change. */
  static evaluateCombinedCode(effect, changeOrId, drafts = {}, options = {}) {
    if (!Dnd5e6ChangeConditionService.isSupported()) {
      return Dnd5e6ChangeConditionService.#unsupportedDiagnosis();
    }

    const change = Dnd5e6ChangeConditionService.getChange(effect, changeOrId);
    const nativeData = Dnd5e6ChangeConditionService.#getNativeData(effect, options);
    const hasRollContext = Dnd5e6ChangeConditionService.#hasExplicitRollContext(options);
    let nativeGlobalCondition = Dnd5e6ChangeConditionService.#getNativeConditionForDiagnostics(effect, null);
    let nativeChangeCondition = Dnd5e6ChangeConditionService.#getNativeConditionForDiagnostics(effect, change);

    try {
      if (drafts.nativeGlobalCode !== undefined) {
        nativeGlobalCondition = Dnd5e6ChangeConditionService.createNativeFilter(
          effect,
          null,
          drafts.nativeGlobalCode
        );
      }
      if (drafts.nativeChangeCode !== undefined) {
        nativeChangeCondition = Dnd5e6ChangeConditionService.createNativeFilter(
          effect,
          change,
          drafts.nativeChangeCode
        );
      }
    } catch (error) {
      const errorStage = Dnd5e6ChangeConditionService.#stage({
        configured: true,
        available: false,
        error
      });
      return Dnd5e6ChangeConditionService.#combineStages({
        nativeGlobal: drafts.nativeGlobalCode !== undefined
          ? errorStage
          : Dnd5e6ChangeConditionService.#evaluateNative(nativeGlobalCondition, nativeData, undefined, hasRollContext),
        scGlobal: Dnd5e6ChangeConditionService.#evaluateScGlobalDraft(effect, drafts, options),
        nativeChange: drafts.nativeChangeCode !== undefined
          ? errorStage
          : Dnd5e6ChangeConditionService.#evaluateNativeChange(
            change,
            nativeChangeCondition,
            nativeData,
            undefined,
            hasRollContext
          ),
        scChange: Dnd5e6ChangeConditionService.#evaluateScChangeDraft(effect, change ?? changeOrId, drafts, options)
      });
    }

    return Dnd5e6ChangeConditionService.#combineStages({
      nativeGlobal: Dnd5e6ChangeConditionService.#evaluateNative(
        nativeGlobalCondition,
        nativeData,
        options.nativeGlobalEvaluation,
        hasRollContext
      ),
      scGlobal: Dnd5e6ChangeConditionService.#evaluateScGlobalDraft(effect, drafts, options),
      nativeChange: Dnd5e6ChangeConditionService.#evaluateNativeChange(
        change,
        nativeChangeCondition,
        nativeData,
        options.nativeChangeEvaluation,
        hasRollContext
      ),
      scChange: Dnd5e6ChangeConditionService.#evaluateScChangeDraft(
        effect,
        change ?? changeOrId,
        drafts,
        options
      )
    });
  }

  /**
   * Every condition layer of an effect and of each of its changes, in one pass.
   *
   * Roll data is resolved once and shared across every row, so a sheet with many
   * conditioned changes does not rebuild it per change.
   */
  static summarize(effect, options = {}) {
    if (!Dnd5e6ChangeConditionService.isSupported()) {
      return { supported: false, effect: null, changes: [], combined: null, totals: null };
    }

    const nativeData = Dnd5e6ChangeConditionService.#getNativeData(effect, options);
    const hasRollContext = Dnd5e6ChangeConditionService.#hasExplicitRollContext(options);

    const effectEntry = Dnd5e6ChangeConditionService.#summarizeEntry({
      scope: "effect",
      changeId: null,
      key: "",
      code: ActiveEffectConditionService.getCondition(effect),
      native: Dnd5e6ChangeConditionService.#evaluateNative(
        Dnd5e6ChangeConditionService.#getNativeConditionForDiagnostics(effect, null),
        nativeData,
        options.nativeGlobalEvaluation,
        hasRollContext
      ),
      advanced: Dnd5e6ChangeConditionService.#stage({
        configured: ActiveEffectConditionService.hasCondition(effect),
        ...ActiveEffectConditionService.evaluate(effect, options)
      })
    });

    const changes = Dnd5e6ChangeConditionService.getChanges(effect).map(change => {
      const changeId = Dnd5e6ChangeConditionService.getChangeId(change);
      const code = Dnd5e6ChangeConditionService.getCondition(effect, changeId);
      return Dnd5e6ChangeConditionService.#summarizeEntry({
        scope: "change",
        changeId,
        key: String(change?.key ?? ""),
        code,
        native: Dnd5e6ChangeConditionService.#evaluateNativeChange(
          change,
          Dnd5e6ChangeConditionService.#getNativeConditionForDiagnostics(effect, change),
          nativeData,
          undefined,
          hasRollContext
        ),
        advanced: Dnd5e6ChangeConditionService.evaluateCode(effect, change, code, options)
      });
    });

    const entries = [effectEntry, ...changes];
    const combined = Dnd5e6ChangeConditionService.#combineStages(
      Object.fromEntries(entries.map((entry, index) => [`${entry.scope}:${entry.changeId ?? index}`, entry.combined]))
    ).combined;

    return {
      supported: true,
      effect: effectEntry,
      changes,
      combined,
      totals: Dnd5e6ChangeConditionService.#countStates(entries)
    };
  }

  static #summarizeEntry({ scope, changeId, key, code, native, advanced }) {
    const validation = Dnd5e6ChangeConditionService.validateCondition(code);
    const combined = Dnd5e6ChangeConditionService.#combineStages({ native, advanced }).combined;
    return {
      scope,
      changeId,
      key,
      native,
      advanced,
      combined,
      state: combined.state,
      configured: native.configured || advanced.configured,
      syntaxError: !validation.valid,
      message: validation.error?.message ?? combined.error?.message ?? ""
    };
  }

  static #countStates(entries) {
    const totals = { total: 0, pass: 0, fail: 0, error: 0, contextual: 0, configured: 0, syntaxError: 0 };
    for (const entry of entries) {
      totals.total += 1;
      totals[entry.state] += 1;
      if (entry.configured) totals.configured += 1;
      if (entry.syntaxError) totals.syntaxError += 1;
    }
    return totals;
  }

  static #combineStages(stages) {
    const error = Object.values(stages).find(stage => stage.error)?.error ?? null;
    const failed = Object.values(stages).some(stage => stage.available === false);
    const indeterminate = !failed && !error
      && Object.values(stages).some(stage => stage.indeterminate);
    const combined = Dnd5e6ChangeConditionService.#stage({
      configured: Object.values(stages).some(stage => stage.configured),
      available: error || failed ? false : (indeterminate ? null : true),
      error,
      indeterminate
    });

    return {
      ...stages,
      combined,
      available: combined.available,
      error: combined.error,
      indeterminate: combined.indeterminate,
      stages
    };
  }

  static #unsupportedDiagnosis() {
    const pass = () => Dnd5e6ChangeConditionService.#stage({
      configured: false,
      available: true
    });
    return Dnd5e6ChangeConditionService.#combineStages({
      nativeGlobal: pass(),
      scGlobal: pass(),
      nativeChange: pass(),
      scChange: pass()
    });
  }

  static #evaluateScGlobalDraft(effect, drafts, options) {
    const code = drafts.scGlobalCode === undefined
      ? ActiveEffectConditionService.getCondition(effect)
      : String(drafts.scGlobalCode ?? "");
    return Dnd5e6ChangeConditionService.#stage({
      configured: code.trim().length > 0,
      ...ActiveEffectConditionService.evaluateCode(effect, code, options)
    });
  }

  static #evaluateScChangeDraft(effect, changeOrId, drafts, options) {
    const code = drafts.scChangeCode === undefined
      ? Dnd5e6ChangeConditionService.getCondition(effect, changeOrId)
      : String(drafts.scChangeCode ?? "");
    return Dnd5e6ChangeConditionService.evaluateCode(effect, changeOrId, code, options);
  }

  static createNativeFilter(effect, change, code) {
    const definition = typeof code === "string"
      ? JSON.parse(code.trim() || "{}")
      : (code ?? {});

    const fields = effect?.system?.schema?.fields;
    const field = change
      ? fields?.changes?.element?.fields?.conditions
      : fields?.conditions;
    let filter = null;
    if (typeof field?.initialize === "function") {
      filter = field.initialize(JSON.stringify(definition), effect.system, {});
    } else {
      const Filter = change?.conditions?.constructor
        ?? effect?.system?.conditions?.constructor
        ?? globalThis.dnd5e?.Filter?.Filter;
      if (typeof Filter === "function" && Filter !== Object) {
        filter = new Filter(definition);
      }
    }

    if (typeof filter?.check !== "function") {
      throw new Error("The dnd5e Filter API is unavailable.");
    }

    // Filter stores its definition in a private field. Retain the draft beside
    // the initialized filter so diagnostics can still detect roll.* filters.
    return {
      check: data => filter.check(data),
      empty: foundry.utils.isEmpty?.(definition)
        ?? (Array.isArray(definition) ? definition.length === 0 : Object.keys(definition).length === 0),
      toJSON: () => definition
    };
  }

  /**
   * The stored native filter as the JSON text the editor works on.
   *
   * The initialized Filter hides its definition, so the editor reads the
   * source data instead — the same string dnd5e's own filters-input carries.
   */
  static getNativeConditionSource(effect, changeOrId = null) {
    const changeId = Dnd5e6ChangeConditionService.getChangeId(changeOrId);
    const source = changeId
      ? effect?.system?._source?.changes?.find(candidate => (
        Dnd5e6ChangeConditionService.getChangeId(candidate) === changeId
      ))?.conditions
      : effect?.system?._source?.conditions;

    if (typeof source === "string") {
      return source.trim() || "{}";
    }
    return source && typeof source === "object" ? JSON.stringify(source) : "{}";
  }

  /**
   * One update carrying a change's native filter and its SC condition together.
   *
   * Persist only the selected change's conditions, retaining stored fields and
   * sibling filters even when a separate change dialog has unsaved edits.
   */
  static buildChangeConditionsUpdate(effect, changeOrId, { nativeValue, advancedValue }) {
    const changeId = Dnd5e6ChangeConditionService.getChangeId(changeOrId);
    // Preserve the serialized JSON strings of every sibling condition. The
    // prepared `system.changes` array contains initialized Filter instances,
    // which are not the document source shape expected by an update.
    const sourceChanges = effect?.system?._source?.changes
      ?? effect?.system?.toObject?.().changes
      ?? ActiveEffectChangesCompatibility.get(effect);
    const changes = foundry.utils.deepClone(sourceChanges);
    const change = changes.find(candidate => Dnd5e6ChangeConditionService.getChangeId(candidate) === changeId);
    if (!change) {
      throw new Error("The Active Effect change could not be resolved by its stable ID.");
    }

    change.conditions = String(nativeValue ?? "").trim() || "{}";
    return {
      ...ActiveEffectChangesCompatibility.buildUpdate(changes, effect),
      ...Dnd5e6ChangeConditionService.buildUpdate(effect, changeId, advancedValue)
    };
  }

  static #getNativeConditionForDiagnostics(effect, change) {
    const changeId = Dnd5e6ChangeConditionService.getChangeId(change);
    const source = changeId
      ? effect?.system?._source?.changes?.find(candidate => (
        Dnd5e6ChangeConditionService.getChangeId(candidate) === changeId
      ))?.conditions
      : effect?.system?._source?.conditions;

    if (typeof source === "string") {
      try {
        return Dnd5e6ChangeConditionService.createNativeFilter(effect, change, source);
      } catch {
        // Runtime evaluation remains owned by dnd5e; fall back to its already
        // initialized Filter when diagnostic reconstruction is unavailable.
      }
    }

    // Scope-correct fallback: a change without its own filter has no native
    // condition. The effect-wide filter is reported separately, so leaking it
    // here would mark every change as conditioned and count it twice.
    return change ? (change.conditions ?? null) : (effect?.system?.conditions ?? null);
  }

  static buildConditionMap(effect, changeOrId, condition) {
    const changeId = Dnd5e6ChangeConditionService.getChangeId(changeOrId);
    if (!changeId) {
      throw new Error("A stable Active Effect change ID is required.");
    }

    const conditions = { ...Dnd5e6ChangeConditionService.pruneOrphanedConditions(effect) };
    const source = String(condition ?? "");
    if (source.trim().length) {
      conditions[changeId] = source;
    } else {
      delete conditions[changeId];
    }
    return conditions;
  }

  static buildUpdate(effect, changeOrId, condition) {
    return Dnd5e6ChangeConditionService.#buildMapUpdate(
      effect,
      Dnd5e6ChangeConditionService.buildConditionMap(effect, changeOrId, condition)
    );
  }

  /**
   * Foundry merges flag objects recursively, so writing the whole map only ever
   * adds keys: a cleared or orphaned condition would survive and keep gating its
   * change forever. Removals need an explicit `-=key`, the same way
   * ActiveEffectFormulaChangeService clears formula entries.
   */
  static #buildMapUpdate(effect, nextConditions) {
    const update = {};
    const path = Dnd5e6ChangeConditionService.CHANGE_CONDITIONS_FLAG_PATH;

    for (const changeId of Object.keys(Dnd5e6ChangeConditionService.getConditionMap(effect))) {
      if (Object.prototype.hasOwnProperty.call(nextConditions, changeId)) continue;
      update[`${path}.-=${changeId}`] = null;
    }

    for (const [changeId, code] of Object.entries(nextConditions)) {
      update[`${path}.${changeId}`] = code;
    }

    return update;
  }

  static pruneOrphanedConditions(effect) {
    const validIds = new Set(
      Dnd5e6ChangeConditionService.getChanges(effect)
        .map(change => Dnd5e6ChangeConditionService.getChangeId(change))
        .filter(Boolean)
    );
    return Object.fromEntries(
      Object.entries(Dnd5e6ChangeConditionService.getConditionMap(effect))
        .filter(([changeId]) => validIds.has(changeId))
    );
  }

  static #usesIdentifier(effect, changeOrId, identifier) {
    if (!Dnd5e6ChangeConditionService.isSupported()) {
      return false;
    }

    const conditions = changeOrId === null
      ? Dnd5e6ChangeConditionService.getConditionedChanges(effect).map(entry => entry.code)
      : [Dnd5e6ChangeConditionService.getCondition(effect, changeOrId)];
    return conditions.some(condition => ConditionSourceInspector.usesIdentifier(condition, identifier));
  }

  static #getNativeData(effect, options) {
    if (options.nativeData !== undefined) {
      return options.nativeData;
    }

    if (options.rollData !== undefined) {
      return options.rollData;
    }

    const actor = options.actor ?? ActiveEffectContextBuilder.getAffectedActor(effect);
    const rollData = actor?.getRollData?.() ?? {};
    return effect?.getReplacementData?.(rollData) ?? rollData;
  }

  static #evaluateNative(condition, data, override, hasRollContext) {
    if (override !== undefined) {
      const normalized = typeof override === "object" && override !== null
        ? override
        : { available: Boolean(override), result: override };
      return Dnd5e6ChangeConditionService.#stage({ configured: true, ...normalized });
    }

    const configured = Dnd5e6ChangeConditionService.#hasNativeCondition(condition);
    if (!configured) {
      return Dnd5e6ChangeConditionService.#stage({ configured: false, available: true });
    }

    if (Dnd5e6ChangeConditionService.usesRollData(condition) && !hasRollContext) {
      return Dnd5e6ChangeConditionService.#stage({
        configured: true,
        available: null,
        indeterminate: true
      });
    }

    try {
      if (typeof condition?.check !== "function") {
        throw new Error("The native dnd5e condition is not initialized as a Filter.");
      }
      const result = condition.check(data);
      if (result && typeof result.then === "function") {
        throw new Error("Native Active Effect conditions must be synchronous.");
      }
      return Dnd5e6ChangeConditionService.#stage({
        configured: true,
        available: Boolean(result),
        result
      });
    } catch (error) {
      return Dnd5e6ChangeConditionService.#stage({
        configured: true,
        available: false,
        error
      });
    }
  }

  /** Mirror ActiveEffect5e.shouldApplyChange for rule changes whose native filters are informational only. */
  static #evaluateNativeChange(change, condition, data, override, hasRollContext) {
    if (CONFIG.ActiveEffect.changeTypes?.[change?.type]?.skipConditions) {
      return Dnd5e6ChangeConditionService.#stage({ configured: false, available: true });
    }

    return Dnd5e6ChangeConditionService.#evaluateNative(condition, data, override, hasRollContext);
  }

  static #hasNativeCondition(condition) {
    if (condition === null || condition === undefined || condition === "") {
      return false;
    }
    if (typeof condition === "string") {
      return condition.trim().length > 0;
    }
    if (Array.isArray(condition)) {
      return condition.length > 0;
    }
    if (typeof condition === "object") {
      if (typeof condition.empty === "boolean") {
        return !condition.empty;
      }
      if (typeof condition.isEmpty === "boolean") {
        return !condition.isEmpty;
      }
      return true;
    }
    return true;
  }

  /**
   * Whether a native filter reads `roll.*`, which only exists while a roll is
   * being prepared. Such a filter is reported as contextual instead of failing.
   */
  static usesRollData(condition) {
    try {
      const source = typeof condition?.toJSON === "function"
        ? condition.toJSON()
        : condition;
      return Dnd5e6ChangeConditionService.#hasRollKey(source);
    } catch {
      return false;
    }
  }

  static #hasRollKey(value) {
    if (Array.isArray(value)) {
      return value.some(entry => Dnd5e6ChangeConditionService.#hasRollKey(entry));
    }
    if (!value || typeof value !== "object") {
      return false;
    }
    if (String(value.k ?? "").startsWith("roll.")) {
      return true;
    }
    return Object.values(value).some(entry => Dnd5e6ChangeConditionService.#hasRollKey(entry));
  }

  static #hasExplicitRollContext(options) {
    return options.rollData !== undefined || options.nativeData !== undefined;
  }

  static #stage({ configured, available, error = null, result = available, indeterminate = false }) {
    const isIndeterminate = Boolean(indeterminate) && !error;
    return {
      configured: Boolean(configured),
      available: isIndeterminate ? null : (Boolean(available) && !error),
      error,
      result: error || isIndeterminate ? null : result,
      indeterminate: isIndeterminate,
      state: error ? "error" : (isIndeterminate ? "contextual" : (available ? "pass" : "fail"))
    };
  }
}
