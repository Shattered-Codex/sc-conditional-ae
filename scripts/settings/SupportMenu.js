import { Constants } from "../constants/Constants.js";
import { resolveSettingsRoot } from "./resolveSettingsRoot.js";

const { ApplicationV2 } = foundry?.applications?.api ?? {};
if (!ApplicationV2) {
  throw new Error(`${Constants.MODULE_ID}: ApplicationV2 is required to render SupportMenu.`);
}

const SUPPORT_MENU_KEY = `${Constants.MODULE_ID}.supportMenu`;

export class SupportMenu extends ApplicationV2 {
  static DEFAULT_OPTIONS = foundry.utils.mergeObject(super.DEFAULT_OPTIONS, {
    id: `${Constants.MODULE_ID}-support-menu`,
    window: {
      title: Constants.localize("SCConditionalAE.Settings.SupportMenu.Name", "Support the developer"),
      resizable: false,
      icon: "fas fa-heart"
    },
    position: {
      width: 420,
      height: "auto"
    }
  }, { inplace: false });

  render(..._args) {
    SupportMenu.openPatreon();
    return this;
  }

  static openPatreon() {
    window?.open?.(Constants.PATREON_URL, "_blank", "noopener");
  }

  static bindSettingsButton(html) {
    const root = resolveSettingsRoot(html);
    if (!root) {
      return;
    }

    const candidates = root.querySelectorAll([
      `[data-setting-id="${SUPPORT_MENU_KEY}"]`,
      `[data-menu-id="${SUPPORT_MENU_KEY}"]`,
      `[data-key="${SUPPORT_MENU_KEY}"]`,
      `[data-setting="${SUPPORT_MENU_KEY}"]`
    ].join(","));

    for (const candidate of candidates) {
      const button = candidate instanceof HTMLButtonElement
        ? candidate
        : candidate.querySelector("button");
      if (!button) {
        continue;
      }
      button.classList.add("sc-cae-support-button");
      if (button.dataset.scCaeSupportBound === "true") {
        continue;
      }
      button.dataset.scCaeSupportBound = "true";
      button.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        SupportMenu.openPatreon();
      }, { capture: true });
    }
  }
}
