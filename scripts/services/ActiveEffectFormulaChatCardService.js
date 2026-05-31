import { Constants } from "../constants/Constants.js";
import { HtmlHelpers } from "../helpers/HtmlHelpers.js";
import { ActiveEffectFormulaChangeService } from "./ActiveEffectFormulaChangeService.js";
import { ModuleSettings } from "../settings/ModuleSettings.js";

export class ActiveEffectFormulaChatCardService {
  static #registered = false;

  static activate() {
    if (ActiveEffectFormulaChatCardService.#registered) {
      return;
    }

    ActiveEffectFormulaChatCardService.#registered = true;
    document.addEventListener("click", ActiveEffectFormulaChatCardService.#onDocumentClick);
  }

  static async requestRoll(effect, { reason = "activation" } = {}) {
    if (
      !ActiveEffectFormulaChangeService.hasFormulaChanges(effect)
      || !ActiveEffectFormulaChangeService.shouldPromptForCurrentUser(effect)
    ) {
      return;
    }

    if (!ModuleSettings.isFormulaChatCardEnabled()) {
      await ActiveEffectFormulaChangeService.rollFormulaChanges(effect);
      return;
    }

    await ActiveEffectFormulaChatCardService.#postChatCard(effect, reason);
  }

  static async #onDocumentClick(event) {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const button = target.closest(".sc-cae-formula-request-button");
    if (!(button instanceof HTMLButtonElement)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    if (button.disabled) {
      return;
    }

    const effectUuid = button.dataset.effectUuid;
    if (!effectUuid) {
      return;
    }

    const effect = await fromUuid(effectUuid);
    if (
      !(effect instanceof CONFIG.ActiveEffect.documentClass)
      || !ActiveEffectFormulaChangeService.hasFormulaChanges(effect)
      || !ActiveEffectFormulaChangeService.shouldPromptForCurrentUser(effect)
    ) {
      return;
    }

    const changeIndex = button.dataset.changeIndex;
    button.disabled = true;
    button.classList.add("loading");

    try {
      await (
        changeIndex === undefined
          ? ActiveEffectFormulaChangeService.rollFormulaChanges(effect)
          : ActiveEffectFormulaChangeService.rollFormulaChange(effect, changeIndex)
      );
    } catch (error) {
      console.warn(`[${Constants.MODULE_ID}] formula chat card roll failed`, error);
    } finally {
      button.disabled = false;
      button.classList.remove("loading");
    }
  }

  static async #postChatCard(effect, reason) {
    const formulaEntries = ActiveEffectFormulaChangeService.getFormulaChangeEntries(effect);
    if (!formulaEntries.length) {
      return;
    }

    const actor = ActiveEffectFormulaChatCardService.#getActor(effect);
    const title = HtmlHelpers.escape(
      Constants.localize("SCConditionalAE.FormulaChange.ChatCardTitle", "Formula roll available")
    );
    const effectName = HtmlHelpers.escape(effect.name ?? "");
    const actorName = HtmlHelpers.escape(actor?.name ?? "");
    const img = HtmlHelpers.escape(
      effect.img ?? effect.icon ?? "icons/svg/d20.svg"
    );
    const effectUuid = HtmlHelpers.escape(effect.uuid ?? "");
    const rawEffectName = String(effect.name ?? "").trim();
    const hint = HtmlHelpers.escape(
      ActiveEffectFormulaChatCardService.#getIntroLabel(reason, rawEffectName || title)
    );
    const reasonText = HtmlHelpers.escape(
      ActiveEffectFormulaChatCardService.#getReasonLabel(reason, rawEffectName || "This effect")
    );
    const prompt = HtmlHelpers.escape(
      Constants.localize("SCConditionalAE.FormulaChange.ChatCardPrompt", "Do you want to roll them now?")
    );
    const buttonLabel = HtmlHelpers.escape(
      Constants.localize("SCConditionalAE.FormulaChange.ChatCardButton", "Roll all formulas")
    );
    const listHtml = formulaEntries
      .map(formulaEntry => ActiveEffectFormulaChatCardService.#buildFormulaEntryHtml(effectUuid, formulaEntry))
      .join("");

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker(actor ? { actor } : {}),
      content: `
        <div class="chat-card item-card sc-cae-formula-request-card" data-effect-uuid="${effectUuid}">
          <section class="card-header">
            <header class="summary">
              <img class="gold-icon" src="${img}" alt="${effectName}">
              <div class="name-stacked border">
                <span class="title">${effectName || title}</span>
                ${actorName ? `<span class="subtitle">${actorName}</span>` : ""}
              </div>
            </header>
          </section>
          <div class="card-content">
            <p class="sc-cae-formula-request-intro">${hint}</p>
            <p class="sc-cae-formula-request-reason">${reasonText}</p>
            <p class="sc-cae-formula-request-prompt">${prompt}</p>
            <div class="sc-cae-formula-request-list" role="list">
              ${listHtml}
            </div>
            <div class="sc-cae-formula-request-actions">
              <button
                type="button"
                class="sc-cae-formula-request-button"
                data-effect-uuid="${effectUuid}"
              >${buttonLabel}</button>
            </div>
          </div>
        </div>
      `,
      flags: {
        [Constants.MODULE_ID]: {
          formulaChatCard: {
            effectUuid: effect.uuid,
            reason
          }
        }
      }
    });
  }

  static #buildFormulaEntryHtml(effectUuid, formulaEntry) {
    const keyLabel = HtmlHelpers.escape(
      Constants.localize("SCConditionalAE.FormulaChange.ChatCardAttributeKeyLabel", "Attribute Key")
    );
    const currentValueLabel = HtmlHelpers.escape(
      Constants.localize("SCConditionalAE.FormulaChange.ChatCardCurrentValueLabel", "Current Value")
    );
    const formulaLabel = HtmlHelpers.escape(
      Constants.localize("SCConditionalAE.FormulaChange.ChatCardFormulaLabel", "Formula")
    );
    const rollLabel = HtmlHelpers.escape(
      Constants.localize("SCConditionalAE.FormulaChange.RollButton", "Roll")
    );
    const displayKey = HtmlHelpers.escape(
      formulaEntry.key || ActiveEffectFormulaChatCardService.#getFallbackChangeLabel(formulaEntry.index)
    );
    const currentValue = HtmlHelpers.escape(formulaEntry.currentValue || "0");
    const formula = HtmlHelpers.escape(formulaEntry.formula);

    return `
      <div class="sc-cae-formula-request-entry" role="listitem">
        <div class="sc-cae-formula-request-entry-copy">
          <span class="sc-cae-formula-request-entry-label">${keyLabel}</span>
          <span class="sc-cae-formula-request-entry-key">${displayKey}</span>
          <span class="sc-cae-formula-request-entry-label">${currentValueLabel}</span>
          <code class="sc-cae-formula-request-entry-value sc-cae-formula-request-entry-value--current">${currentValue}</code>
          <span class="sc-cae-formula-request-entry-label">${formulaLabel}</span>
          <code class="sc-cae-formula-request-entry-value sc-cae-formula-request-entry-value--formula">${formula}</code>
        </div>
        <button
          type="button"
          class="sc-cae-formula-request-button sc-cae-formula-request-button--inline"
          data-effect-uuid="${effectUuid}"
          data-change-index="${formulaEntry.index}"
        >${rollLabel}</button>
      </div>
    `;
  }

  static #getReasonLabel(reason, effectName) {
    if (reason === "condition") {
      return ActiveEffectFormulaChatCardService.#localizeFormat(
        "SCConditionalAE.FormulaChange.ChatCardReasonCondition",
        "{effect} is ready, and its formulas can be rolled now.",
        { effect: effectName }
      );
    }

    return ActiveEffectFormulaChatCardService.#localizeFormat(
      "SCConditionalAE.FormulaChange.ChatCardReasonActivation",
      "{effect} is active, and its formulas can be rolled now.",
      { effect: effectName }
    );
  }

  static #getIntroLabel(reason, effectName) {
    if (reason === "condition") {
      return ActiveEffectFormulaChatCardService.#localizeFormat(
        "SCConditionalAE.FormulaChange.ChatCardIntroCondition",
        "The condition for {effect} has been met.",
        { effect: effectName }
      );
    }

    return ActiveEffectFormulaChatCardService.#localizeFormat(
      "SCConditionalAE.FormulaChange.ChatCardIntroActivation",
      "{effect} has just been activated.",
      { effect: effectName }
    );
  }

  static #getFallbackChangeLabel(index) {
    const baseLabel = Constants.localize("SCConditionalAE.FormulaChange.ChatCardUnnamedKey", "Change");
    return `${baseLabel} ${Number(index) + 1}`;
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

  static #localizeFormat(key, fallback, data) {
    if (typeof game?.i18n?.format === "function") {
      const formatted = game.i18n.format(key, data);
      if (formatted && formatted !== key) {
        return formatted;
      }
    }

    return String(fallback ?? key).replace(/\{(\w+)\}/g, (_match, token) => String(data?.[token] ?? ""));
  }
}
