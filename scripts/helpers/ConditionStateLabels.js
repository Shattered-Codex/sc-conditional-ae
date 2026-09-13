import { Constants } from "../constants/Constants.js";

/**
 * The single vocabulary for a condition's evaluated state.
 *
 * The Advanced Conditions editor, the Condition tab summary and the per-change
 * badge in the Changes tab all read from here, so a state never reads as
 * "Met" in one panel and something else in another.
 */
export class ConditionStateLabels {
  static STATES = Object.freeze(["pass", "fail", "error", "contextual"]);

  static ICONS = Object.freeze({
    pass: "fa-circle-check",
    fail: "fa-circle-xmark",
    error: "fa-circle-exclamation",
    contextual: "fa-circle-question"
  });

  static #FALLBACKS = Object.freeze({
    pass: "Met",
    fail: "Not met",
    error: "Invalid or errored",
    contextual: "Depends on roll context"
  });

  static #KEYS = Object.freeze({
    pass: "SCConditionalAE.AdvancedConditions.Pass",
    fail: "SCConditionalAE.AdvancedConditions.Fail",
    error: "SCConditionalAE.AdvancedConditions.Error",
    contextual: "SCConditionalAE.AdvancedConditions.Contextual"
  });

  static normalize(state) {
    return ConditionStateLabels.STATES.includes(state) ? state : "pass";
  }

  static label(state) {
    const normalized = ConditionStateLabels.normalize(state);
    return Constants.localize(ConditionStateLabels.#KEYS[normalized], ConditionStateLabels.#FALLBACKS[normalized]);
  }

  static icon(state) {
    return ConditionStateLabels.ICONS[ConditionStateLabels.normalize(state)];
  }

  /** "Not met — Native: not met · JavaScript: met" */
  static describe(entry) {
    const layers = [
      ConditionStateLabels.#layer("Native", "SCConditionalAE.ConditionTab.Summary.LayerNative", entry?.native),
      ConditionStateLabels.#layer("JavaScript", "SCConditionalAE.ConditionTab.Summary.LayerAdvanced", entry?.advanced)
    ].filter(Boolean);

    const headline = ConditionStateLabels.label(entry?.state);
    const detail = layers.length ? ` — ${layers.join(" · ")}` : "";
    const message = String(entry?.message ?? "").trim();
    return message ? `${headline}${detail}\n${message}` : `${headline}${detail}`;
  }

  static #layer(fallbackName, key, stage) {
    if (!stage?.configured) {
      return "";
    }
    return `${Constants.localize(key, fallbackName)}: ${ConditionStateLabels.label(stage.state)}`;
  }
}
