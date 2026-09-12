import { ActiveEffectContextBuilder } from "../helpers/ActiveEffectContextBuilder.js";
import { DaeCompatibility } from "../compat/DaeCompatibility.js";
import { ActiveEffectConditionService } from "../services/ActiveEffectConditionService.js";
import { Dnd5e6ChangeConditionService } from "../services/Dnd5e6ChangeConditionService.js";

export class Dnd5e6ConditionEvaluationService {
  static evaluate({ effect, nativeCode, advancedCode, advancedMode = null, changeId = null }) {
    if (changeId) {
      const evaluation = Dnd5e6ChangeConditionService.evaluateCombinedCode(effect, changeId, {
        nativeChangeCode: nativeCode,
        scChangeCode: advancedCode
      });
      return {
        nativeGlobal: evaluation.nativeGlobal,
        advancedGlobal: evaluation.scGlobal,
        native: evaluation.nativeChange,
        advanced: evaluation.scChange,
        combined: evaluation.combined
      };
    }

    const native = Dnd5e6ConditionEvaluationService.#evaluateNative(effect, nativeCode);
    const advanced = Dnd5e6ConditionEvaluationService.#evaluateAdvanced(
      effect,
      advancedMode ? DaeCompatibility.toCompatibilityCondition(advancedCode, advancedMode) : advancedCode,
      changeId
    );
    return {
      native,
      advanced,
      combined: Dnd5e6ConditionEvaluationService.#combine(native, advanced)
    };
  }

  static #evaluateNative(effect, code) {
    let definition;
    try {
      definition = JSON.parse(String(code ?? "{}").trim() || "{}");
    } catch (error) {
      return { state: "error", available: false, error };
    }

    if (Dnd5e6ChangeConditionService.usesRollData(definition)) {
      return { state: "contextual", available: null, error: null };
    }

    try {
      const actor = ActiveEffectContextBuilder.getAffectedActor(effect);
      const baseData = actor?.getRollData?.() ?? {};
      const data = effect?.getReplacementData?.(baseData) ?? baseData;
      const filter = Dnd5e6ChangeConditionService.createNativeFilter(effect, null, definition);
      const available = filter.check(data);
      return { state: available ? "pass" : "fail", available, error: null };
    } catch (error) {
      return { state: "error", available: false, error };
    }
  }

  static #evaluateAdvanced(effect, code, changeId) {
    const source = String(code ?? "");
    if (!source.trim()) {
      return { state: "pass", available: true, error: null };
    }

    const validation = ActiveEffectConditionService.validateCondition(source);
    if (!validation.valid) {
      return { state: "error", available: false, error: validation.error };
    }

    try {
      const evaluation = changeId
        ? Dnd5e6ChangeConditionService.evaluateCode(effect, changeId, source)
        : ActiveEffectConditionService.evaluateCode(effect, source);
      if (!evaluation) {
        return { state: "contextual", available: null, error: null };
      }
      return {
        state: evaluation.error ? "error" : (evaluation.available ? "pass" : "fail"),
        available: evaluation.error ? false : Boolean(evaluation.available),
        error: evaluation.error ?? null
      };
    } catch (error) {
      return { state: "error", available: false, error };
    }
  }

  static #combine(native, advanced) {
    if (native.state === "fail" || advanced.state === "fail") {
      return { state: "fail", available: false };
    }
    if (native.state === "error" || advanced.state === "error") {
      return { state: "error", available: false };
    }
    if (native.state === "contextual" || advanced.state === "contextual") {
      return { state: "contextual", available: null };
    }
    return { state: "pass", available: true };
  }
}
