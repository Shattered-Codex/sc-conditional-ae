import { Constants } from "../constants/Constants.js";
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

    button.disabled = true;
    button.classList.add("loading");

    try {
      const rolled = await ActiveEffectFormulaChangeService.rollFormulaChanges(effect);
      if (!rolled) {
        button.disabled = false;
      }
    } catch (error) {
      console.warn(`[${Constants.MODULE_ID}] formula chat card roll failed`, error);
      button.disabled = false;
    } finally {
      button.classList.remove("loading");
    }
  }

  static async #postChatCard(effect, reason) {
    const actor = ActiveEffectFormulaChatCardService.#getActor(effect);
    const title = ActiveEffectFormulaChatCardService.#escapeHtml(
      Constants.localize("SCConditionalAE.FormulaChange.ChatCardTitle", "Formula roll available")
    );
    const effectName = ActiveEffectFormulaChatCardService.#escapeHtml(effect.name ?? "");
    const actorName = ActiveEffectFormulaChatCardService.#escapeHtml(actor?.name ?? "");
    const img = ActiveEffectFormulaChatCardService.#escapeHtml(
      effect.img ?? effect.icon ?? "icons/svg/d20.svg"
    );
    const effectUuid = ActiveEffectFormulaChatCardService.#escapeHtml(effect.uuid ?? "");
    const hint = ActiveEffectFormulaChatCardService.#escapeHtml(
      Constants.localize(
        "SCConditionalAE.FormulaChange.ChatCardHint",
        "This Active Effect has formula-backed changes ready to roll."
      )
    );
    const reasonText = ActiveEffectFormulaChatCardService.#escapeHtml(
      ActiveEffectFormulaChatCardService.#getReasonLabel(reason)
    );
    const buttonLabel = ActiveEffectFormulaChatCardService.#escapeHtml(
      Constants.localize("SCConditionalAE.FormulaChange.ChatCardButton", "Roll formulas")
    );

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
            <p>${hint}</p>
            <p class="sc-cae-formula-request-reason">${reasonText}</p>
            <button
              type="button"
              class="sc-cae-formula-request-button"
              data-effect-uuid="${effectUuid}"
            >${buttonLabel}</button>
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

  static #getReasonLabel(reason) {
    if (reason === "condition") {
      return Constants.localize(
        "SCConditionalAE.FormulaChange.ChatCardReasonCondition",
        "Triggered because the condition became true."
      );
    }

    return Constants.localize(
      "SCConditionalAE.FormulaChange.ChatCardReasonActivation",
      "Triggered because the Active Effect was activated."
    );
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

  static #escapeHtml(value) {
    const element = document.createElement("div");
    element.textContent = String(value ?? "");
    return element.innerHTML;
  }
}
