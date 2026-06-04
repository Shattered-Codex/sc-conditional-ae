import { Constants } from "../constants/Constants.js";
import { ActiveEffectConditionService } from "../services/ActiveEffectConditionService.js";
import { ActiveEffectFormulaChangeService } from "../services/ActiveEffectFormulaChangeService.js";

export class EffectListFormulaRollButtonRenderer {
  static #registered = false;
  static #observers = new WeakMap();
  static #scheduledRoots = new WeakSet();

  static #renderHookNames = [
    "renderActorSheet",
    "renderBaseActorSheet",
    "renderCharacterActorSheet",
    "renderNPCActorSheet",
    "renderVehicleActorSheet",
    "renderItemSheet",
    "renderItemSheet5e",
    "renderContainerSheet",
    "tidy5e-sheet.renderActorSheet",
    "renderTidy5eCharacterSheet",
    "renderTidy5eNpcSheet",
    "renderTidy5eVehicleSheet",
    "renderTidy5eCharacterSheetQuadrone",
    "renderTidy5eNpcSheetQuadrone",
    "renderTidy5eVehicleSheetQuadrone"
  ];

  static activate() {
    if (EffectListFormulaRollButtonRenderer.#registered) {
      return;
    }

    EffectListFormulaRollButtonRenderer.#registered = true;
    for (const hookName of EffectListFormulaRollButtonRenderer.#renderHookNames) {
      Hooks.on(hookName, EffectListFormulaRollButtonRenderer.#onRenderSheet);
    }
  }

  static #onRenderSheet(app, html) {
    const root = EffectListFormulaRollButtonRenderer.#getRootElement(app, html);
    if (!root) {
      return;
    }

    EffectListFormulaRollButtonRenderer.#observeSheet(app, root);
    EffectListFormulaRollButtonRenderer.#scheduleInjection(app, root);
  }

  static #getRootElement(app, html) {
    const appElement = EffectListFormulaRollButtonRenderer.#coerceElement(app?.element);
    if (appElement) {
      return EffectListFormulaRollButtonRenderer.#getRenderRoot(appElement);
    }

    const htmlElement = EffectListFormulaRollButtonRenderer.#coerceElement(html);
    return htmlElement ? EffectListFormulaRollButtonRenderer.#getRenderRoot(htmlElement) : null;
  }

  static #coerceElement(candidate) {
    if (candidate instanceof Element || candidate instanceof DocumentFragment) {
      return candidate;
    }

    if (Array.isArray(candidate)) {
      return EffectListFormulaRollButtonRenderer.#coerceElement(candidate[0] ?? null);
    }

    return candidate?.[0] instanceof Element || candidate?.[0] instanceof DocumentFragment ? candidate[0] : null;
  }

  static #getRenderRoot(element) {
    if (element instanceof Element && element.shadowRoot) {
      return element.shadowRoot;
    }

    return element;
  }

  static #observeSheet(app, root) {
    const previousObserver = EffectListFormulaRollButtonRenderer.#observers.get(app);
    previousObserver?.disconnect();

    const observer = new MutationObserver(mutations => {
      if (!root.isConnected) {
        observer.disconnect();
        EffectListFormulaRollButtonRenderer.#observers.delete(app);
        return;
      }

      for (const mutation of mutations) {
        for (const addedNode of mutation.addedNodes) {
          if (EffectListFormulaRollButtonRenderer.#containsEffectMarkup(addedNode)) {
            EffectListFormulaRollButtonRenderer.#scheduleInjection(app, root);
            return;
          }
        }
      }
    });

    observer.observe(root, { childList: true, subtree: true });
    EffectListFormulaRollButtonRenderer.#observers.set(app, observer);
  }

  static #containsEffectMarkup(node) {
    if (!(node instanceof Element)) {
      return false;
    }

    return node.matches?.(
      "dnd5e-effects, .effects-list, [data-effect-id], [data-tidy-sheet-part='effect-table-row']"
    ) || Boolean(
      node.querySelector?.(
        "dnd5e-effects, .effects-list, [data-effect-id], [data-tidy-sheet-part='effect-table-row']"
      )
    );
  }

  static #scheduleInjection(app, root) {
    if (EffectListFormulaRollButtonRenderer.#scheduledRoots.has(root)) {
      return;
    }

    EffectListFormulaRollButtonRenderer.#scheduledRoots.add(root);
    window.requestAnimationFrame(() => {
      EffectListFormulaRollButtonRenderer.#scheduledRoots.delete(root);
      const currentRoot = root.isConnected ? root : EffectListFormulaRollButtonRenderer.#getRootElement(app, null);
      if (!currentRoot?.isConnected) {
        return;
      }

      EffectListFormulaRollButtonRenderer.#injectButtons(app, currentRoot);
    });
  }

  static #injectButtons(app, root) {
    for (const row of root.querySelectorAll(
      ".effects-list [data-effect-id].item.effect, .effects-list .activity-row[data-effect-id], [data-tidy-sheet-part='effect-table-row'][data-effect-id]"
    )) {
      const effect = EffectListFormulaRollButtonRenderer.#resolveEffect(app, row);

      EffectListFormulaRollButtonRenderer.#updateConditionBadge(row, effect);

      if (!effect || !ActiveEffectFormulaChangeService.hasFormulaChanges(effect)) {
        row.querySelector(".sc-cae-formula-roll-control")?.remove();
        continue;
      }

      const target = EffectListFormulaRollButtonRenderer.#findButtonTarget(row);
      if (!target) {
        continue;
      }

      const button = row.querySelector(".sc-cae-formula-roll-control")
        ?? EffectListFormulaRollButtonRenderer.#createButton(effect);

      EffectListFormulaRollButtonRenderer.#updateButton(button, effect);
      EffectListFormulaRollButtonRenderer.#syncButtonClasses(button, target);

      if (!button.isConnected) {
        if (target.type === "controls" || target.type === "tidy-actions") {
          const contextMenu = target.element.querySelector("[data-context-menu], [data-action='showContextMenu']");
          target.element.insertBefore(button, contextMenu ?? null);
        } else {
          target.element.append(button);
        }
      }
    }
  }

  static #updateConditionBadge(row, effect) {
    EffectListFormulaRollButtonRenderer.#clearConditionBadge(row);

    if (!effect) {
      return;
    }

    const rawLabel = String(
      foundry.utils.getProperty(effect, Constants.CONDITION_BADGE_LABEL_FLAG_PATH) ?? ""
    ).trim();

    if (!rawLabel) {
      return;
    }

    if (!ActiveEffectConditionService.hasCondition(effect)) {
      return;
    }

    const evaluation = ActiveEffectConditionService.evaluate(effect);
    if (evaluation.error || evaluation.available) {
      return;
    }

    const badgeTarget = EffectListFormulaRollButtonRenderer.#findConditionBadgeTarget(row);
    if (!badgeTarget) {
      return;
    }

    if (badgeTarget.type === "tidy") {
      badgeTarget.element.dataset.scCaeConditionBadge = rawLabel.slice(0, Constants.CONDITION_BADGE_LABEL_MAX_LENGTH);
      badgeTarget.element.classList.add("sc-cae-condition-badge-host");
      return;
    }

    const badge = document.createElement("span");
    badge.className = "sc-cae-condition-badge";
    badge.textContent = rawLabel.slice(0, Constants.CONDITION_BADGE_LABEL_MAX_LENGTH);
    badgeTarget.element.append(badge);
  }

  static #clearConditionBadge(row) {
    row.querySelector(".sc-cae-condition-badge")?.remove();
    for (const tidyHost of row.querySelectorAll("[data-sc-cae-condition-badge]")) {
      delete tidyHost.dataset.scCaeConditionBadge;
      tidyHost.classList.remove("sc-cae-condition-badge-host");
    }
  }

  static #findConditionBadgeTarget(row) {
    const tidyNameLink = row.querySelector(
      "[data-tidy-effect-name-container] > a, .tidy-table-cell.primary > a, .item-table-cell.primary > a"
    );
    if (tidyNameLink) {
      return { type: "tidy", element: tidyNameLink };
    }

    const defaultNameContainer = row.querySelector(".effect-name");
    return defaultNameContainer ? { type: "default", element: defaultNameContainer } : null;
  }

  static #createButton(effect) {
    const button = document.createElement("a");
    button.className = "effect-control item-control active-effect-control inline-icon-button sc-cae-formula-roll-control";
    button.href = "#";
    button.role = "button";
    button.tabIndex = 0;
    button.dataset.tooltip = "true";
    button.innerHTML = `<i class="fa-solid fa-dice-d20"></i>`;
    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      void EffectListFormulaRollButtonRenderer.#onClick(button);
    });
    button.addEventListener("keydown", event => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      void EffectListFormulaRollButtonRenderer.#onClick(button);
    });
    EffectListFormulaRollButtonRenderer.#updateButton(button, effect);
    return button;
  }

  static #syncButtonClasses(button, target) {
    const isTidyActions = target?.type === "tidy-actions";
    const isTidyName = target?.type === "name";
    button.classList.toggle("tidy-table-button", isTidyActions);
    for (const cls of ["effect-control", "item-control", "active-effect-control", "inline-icon-button"]) {
      button.classList.toggle(cls, !isTidyName);
    }
  }

  static #updateButton(button, effect) {
    button.dataset.effectUuid = effect.uuid ?? "";
    const available = EffectListFormulaRollButtonRenderer.#canRoll(effect);
    button.classList.toggle("disabled", !available);
    button.setAttribute("aria-disabled", String(!available));
    button.setAttribute(
      "aria-label",
      Constants.localize(
        available
          ? "SCConditionalAE.FormulaChange.RollAllLabel"
          : "SCConditionalAE.FormulaChange.RollAllUnavailableLabel",
        available ? "Roll all formulas" : "Formulas unavailable right now"
      )
    );
  }

  static async #onClick(button) {
    if (button.classList.contains("disabled")) {
      return;
    }

    const effectUuid = button.dataset.effectUuid;
    if (!effectUuid) {
      return;
    }

    const effect = await fromUuid(effectUuid);
    if (!(effect instanceof CONFIG.ActiveEffect.documentClass) || !EffectListFormulaRollButtonRenderer.#canRoll(effect)) {
      return;
    }

    button.classList.add("loading");
    try {
      await ActiveEffectFormulaChangeService.rollFormulaChanges(effect);
    } catch (error) {
      console.warn(`[${Constants.MODULE_ID}] could not roll effect formulas from effect list`, error);
    } finally {
      button.classList.remove("loading");
    }
  }

  static #resolveEffect(app, row) {
    const effectId = row.dataset.effectId;
    if (!effectId) {
      return null;
    }

    const document = app?.document ?? app?.actor ?? app?.item ?? null;
    if (!document) {
      return null;
    }

    const parentId = row.dataset.parentId;
    if (document instanceof CONFIG.Actor.documentClass && parentId) {
      return document.items.get(parentId)?.effects?.get(effectId) ?? null;
    }

    return document.effects?.get(effectId) ?? null;
  }

  static #findButtonTarget(row) {
    const controls = row.querySelector(".item-controls.effect-controls, .item-controls.active-effect-controls");
    if (controls) {
      return { type: "controls", element: controls };
    }

    const tidyNameContainer = row.querySelector(
      "[data-tidy-effect-name-container], .tidy-table-cell.primary, .item-table-cell.primary"
    );
    if (tidyNameContainer) {
      return { type: "name", element: tidyNameContainer };
    }

    const tidyActions = row.querySelector(
      ".tidy-table-actions, [data-tidy-column-key='actions'][data-tidy-sheet-part='table-cell']"
    );
    if (tidyActions) {
      return { type: "tidy-actions", element: tidyActions };
    }

    return null;
  }

  static #canRoll(effect) {
    if (!ActiveEffectFormulaChangeService.hasFormulaChanges(effect)) {
      return false;
    }

    if (!ActiveEffectFormulaChangeService.shouldPromptForCurrentUser(effect)) {
      return false;
    }

    if (effect?.active === false || effect?.disabled === true) {
      return false;
    }

    const evaluation = ActiveEffectConditionService.evaluate(effect);
    return !evaluation.error && evaluation.available;
  }
}
