import { Constants } from "../constants/Constants.js";
import { SettingsHelpers } from "../helpers/SettingsHelpers.js";

const { ApplicationV2 } = foundry?.applications?.api ?? {};
if (!ApplicationV2) {
  throw new Error(`${Constants.MODULE_ID}: ApplicationV2 is required to render DocumentationMenu.`);
}

const DOCUMENTATION_MENU_KEY = `${Constants.MODULE_ID}.docsMenu`;

export class DocumentationMenu extends ApplicationV2 {
  static DEFAULT_OPTIONS = foundry.utils.mergeObject(super.DEFAULT_OPTIONS, {
    id: `${Constants.MODULE_ID}-documentation-menu`,
    window: {
      title: Constants.localize("SCConditionalAE.Settings.DocumentationMenu.Name", "Documentation"),
      resizable: false,
      icon: "fas fa-hat-wizard"
    },
    position: {
      width: 420,
      height: "auto"
    }
  }, { inplace: false });

  render(..._args) {
    DocumentationMenu.openDocs();
    return this;
  }

  static openDocs() {
    window?.open?.(Constants.MODULE_WIKI_URL, "_blank", "noopener");
  }

  static bindSettingsButton(html) {
    const root = SettingsHelpers.resolveRoot(html);
    if (!root) {
      return;
    }

    const candidates = root.querySelectorAll([
      `[data-setting-id="${DOCUMENTATION_MENU_KEY}"]`,
      `[data-menu-id="${DOCUMENTATION_MENU_KEY}"]`,
      `[data-key="${DOCUMENTATION_MENU_KEY}"]`,
      `[data-setting="${DOCUMENTATION_MENU_KEY}"]`
    ].join(","));

    for (const candidate of candidates) {
      candidate.classList.add("sc-cae-docs-setting-row");
      const button = candidate instanceof HTMLButtonElement
        ? candidate
        : candidate.querySelector("button");
      if (!button) {
        continue;
      }
      button.classList.add("sc-cae-docs-button");
      if (button.dataset.scCaeDocsBound === "true") {
        continue;
      }
      button.dataset.scCaeDocsBound = "true";
      button.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        DocumentationMenu.openDocs();
      }, { capture: true });
    }
  }
}
