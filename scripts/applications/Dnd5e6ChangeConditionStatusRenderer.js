import { ApplicationRoot } from "../helpers/ApplicationRoot.js";
import { Constants } from "../constants/Constants.js";
import { ConditionStateLabels } from "../helpers/ConditionStateLabels.js";
import { Dnd5e6ChangeConditionService } from "../services/Dnd5e6ChangeConditionService.js";
import { ModuleSettings } from "../settings/ModuleSettings.js";

const MARKER_ATTRIBUTE = "data-sc-cae-change-status";

/**
 * Marks each row of dnd5e 6's Changes tab with the state of that change's own
 * conditions, the way the effect list already marks the whole Active Effect.
 */
export class Dnd5e6ChangeConditionStatusRenderer {
  static activate() {
    if (!Dnd5e6ChangeConditionStatusRenderer.#isSupported()) return;
    Hooks.on("renderActiveEffectConfig", (app, html) => Dnd5e6ChangeConditionStatusRenderer.render(app, html));
  }

  static render(app, html = null) {
    if (!Dnd5e6ChangeConditionStatusRenderer.#isSupported()) return;
    const effect = app?.document ?? app?.effect ?? null;
    if (!effect?.system) return;

    const root = ApplicationRoot.resolve(app, html);
    // Only real Changes-tab rows. Anything else carrying a change id — the
    // Condition tab's summary controls, say — must not be badged as a row.
    const rows = Array.from(root?.querySelectorAll?.("[data-change-id]") ?? [])
      .filter(row => row.tagName === "LI" || row.classList?.contains?.("item"));
    if (!rows.length) return;

    const summary = Dnd5e6ChangeConditionService.summarize(effect);
    if (!summary.supported) return;

    const entries = new Map(summary.changes.map(entry => [entry.changeId, entry]));
    for (const row of rows) {
      // A sheet re-render reuses the row, so drop the previous badge first.
      row.querySelector(`[${MARKER_ATTRIBUTE}]`)?.remove();
      const entry = entries.get(row.dataset?.changeId);
      if (!entry?.configured) continue;
      // .item-controls is a fixed 70px cell whose padding leaves ~28px for the
      // edit and delete buttons, so a badge there squeezes them. .item-name is
      // the flexible cell and reads as a status for the change it labels.
      const host = row.querySelector(".item-name") ?? row.querySelector(".item-row") ?? row;
      host.insertAdjacentElement(
        "afterbegin",
        Dnd5e6ChangeConditionStatusRenderer.#buildBadge(host.ownerDocument, entry, summary.effect)
      );
    }
  }

  static #isSupported() {
    return Dnd5e6ChangeConditionService.isSupported() && ModuleSettings.isConditionTabEnabled();
  }

  static #buildBadge(ownerDocument, entry, effectEntry) {
    const badge = ownerDocument.createElement("span");
    badge.className = "sc-cae-change-status";
    badge.setAttribute(MARKER_ATTRIBUTE, "");
    badge.setAttribute("role", "img");
    badge.dataset.state = entry.state;

    const text = Dnd5e6ChangeConditionStatusRenderer.#buildTooltip(entry, effectEntry);
    badge.setAttribute("aria-label", text);
    // Foundry renders data-tooltip as HTML, so the message text must be escaped.
    badge.dataset.tooltip = Dnd5e6ChangeConditionStatusRenderer.#escape(text).replaceAll("\n", "<br>");

    const icon = ownerDocument.createElement("i");
    icon.className = `fa-solid ${ConditionStateLabels.icon(entry.state)}`;
    icon.setAttribute("aria-hidden", "true");
    badge.append(icon);
    return badge;
  }

  static #buildTooltip(entry, effectEntry) {
    const lines = [ConditionStateLabels.describe(entry)];
    if (effectEntry?.configured && effectEntry.state !== "pass") {
      lines.push(Constants.format(
        "SCConditionalAE.ConditionTab.Summary.EffectGate",
        { state: ConditionStateLabels.label(effectEntry.state) },
        "The effect-wide condition is {state}, so this change stays suppressed."
      ));
    }
    return lines.join("\n");
  }

  static #escape(text) {
    return String(text)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }
}
