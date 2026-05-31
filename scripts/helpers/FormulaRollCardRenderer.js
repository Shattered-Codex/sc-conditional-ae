import { Constants } from "../constants/Constants.js";
import { HtmlHelpers } from "./HtmlHelpers.js";

export class FormulaRollCardRenderer {
  static async build({ change, effect, roll, title }) {
    const escapedTitle = HtmlHelpers.escape(title);
    const escapedSubtitle = HtmlHelpers.escape(change.key ?? "");
    const escapedImg = HtmlHelpers.escape(effect.img ?? effect.icon ?? "icons/svg/d20.svg");
    const escapedUuid = HtmlHelpers.escape(effect.uuid ?? "");

    return `
      <div class="chat-card item-card sc-cae-formula-roll-card" data-effect-uuid="${escapedUuid}">
        <section class="card-header">
          <header class="summary">
            <img class="gold-icon" src="${escapedImg}" alt="${escapedTitle}">
            <div class="name-stacked border">
              <span class="title">${escapedTitle}</span>
              ${escapedSubtitle ? `<span class="subtitle">${escapedSubtitle}</span>` : ""}
            </div>
          </header>
        </section>
        ${await FormulaRollCardRenderer.renderRoll(roll)}
      </div>
    `;
  }

  static async renderRoll(roll) {
    if (!roll) {
      return "";
    }

    try {
      if (typeof roll.render === "function") {
        return FormulaRollCardRenderer.#expandRollContent(await roll.render());
      }
    } catch (error) {
      console.warn(`[${Constants.MODULE_ID}] active effect formula roll render failed`, error);
    }

    const formula = HtmlHelpers.escape(roll.formula ?? "");
    const total = HtmlHelpers.escape(roll.total ?? "");
    return `
      <div class="dice-roll">
        <div class="dice-result">
          <div class="dice-formula">${formula}</div>
          <h4 class="dice-total">${total}</h4>
        </div>
      </div>
    `;
  }

  static #expandRollContent(content) {
    return String(content ?? "").replace(
      /class=(["'])dice-roll(?![^"']*\bexpanded\b)/,
      "class=$1dice-roll expanded"
    );
  }
}
