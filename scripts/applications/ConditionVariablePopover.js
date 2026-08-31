import { ConditionVariableInserter } from "./ConditionVariableInserter.js";

const POPOVER_SELECTOR = "[data-sc-cae-variable-popover]";
const TRIGGER_SELECTOR = "[data-sc-cae-variable-trigger]";
const PANEL_SELECTOR = "[data-sc-cae-variable-panel]";
const SEARCH_SELECTOR = "[data-sc-cae-variable-search]";
const EMPTY_SELECTOR = "[data-sc-cae-variable-empty]";
const OPTION_SELECTOR = "[data-sc-cae-insert-variable]";
const HIDDEN_CLASS = "sc-cae-variable-option--hidden";
const ACTIVE_CLASS = "sc-cae-variable-option--active";

export class ConditionVariablePopover {
  static activate(root, conditionFlagPath) {
    const popover = root?.querySelector?.(POPOVER_SELECTOR);
    if (!popover || popover.dataset.scCaeVariablePopoverBound === "true") {
      return null;
    }

    popover.dataset.scCaeVariablePopoverBound = "true";
    return new ConditionVariablePopover(root, popover, conditionFlagPath);
  }

  #root;
  #popover;
  #conditionFlagPath;
  #trigger;
  #panel;
  #search;
  #empty;
  #options;
  #ownerDocument;
  #open = false;
  #onDocumentPointerDown;

  constructor(root, popover, conditionFlagPath) {
    this.#root = root;
    this.#popover = popover;
    this.#conditionFlagPath = conditionFlagPath;
    this.#trigger = popover.querySelector(TRIGGER_SELECTOR);
    this.#panel = popover.querySelector(PANEL_SELECTOR);
    this.#search = popover.querySelector(SEARCH_SELECTOR);
    this.#empty = popover.querySelector(EMPTY_SELECTOR);
    this.#options = Array.from(popover.querySelectorAll(OPTION_SELECTOR));
    this.#ownerDocument = popover.ownerDocument ?? globalThis.document;
    this.#onDocumentPointerDown = event => {
      // A sheet re-render detaches this popover; drop the listener instead of leaking it.
      if (!this.#popover.isConnected || !this.#popover.contains(event.target)) {
        this.close();
      }
    };

    this.#bind();
  }

  get isOpen() {
    return this.#open;
  }

  #bind() {
    this.#trigger?.addEventListener("click", event => {
      event.preventDefault();
      this.toggle();
    });

    this.#search?.addEventListener("input", () => this.#filter(this.#search.value));
    this.#search?.addEventListener("keydown", event => this.#onSearchKeyDown(event));

    this.#panel?.addEventListener("click", event => {
      const option = event.target?.closest?.(OPTION_SELECTOR);
      if (!option) {
        return;
      }

      event.preventDefault();
      this.#insert(option.dataset.scCaeInsertVariable);
    });

    this.#panel?.addEventListener("keydown", event => {
      if (event.key === "Escape") {
        event.preventDefault();
        this.close({ focusTrigger: true });
      }
    });

    for (const option of this.#options) {
      option.addEventListener("pointerenter", () => this.#setActive(option, { scroll: false }));
    }
  }

  toggle() {
    if (this.#open) {
      this.close({ focusTrigger: true });
    } else {
      this.open();
    }
  }

  open() {
    if (this.#open) {
      return;
    }

    this.#open = true;
    this.#popover.classList.add("sc-cae-variable-popover--open");
    this.#trigger?.setAttribute("aria-expanded", "true");
    if (this.#search) {
      this.#search.value = "";
    }

    this.#filter("");
    this.#ownerDocument?.addEventListener("pointerdown", this.#onDocumentPointerDown, true);
    this.#search?.focus();
  }

  close({ focusTrigger = false } = {}) {
    if (!this.#open) {
      return;
    }

    this.#open = false;
    this.#popover.classList.remove("sc-cae-variable-popover--open");
    this.#trigger?.setAttribute("aria-expanded", "false");
    this.#ownerDocument?.removeEventListener("pointerdown", this.#onDocumentPointerDown, true);
    if (focusTrigger) {
      this.#trigger?.focus();
    }
  }

  destroy() {
    this.#ownerDocument?.removeEventListener("pointerdown", this.#onDocumentPointerDown, true);
    this.#open = false;
    this.#popover.classList.remove("sc-cae-variable-popover--open");
    this.#trigger?.setAttribute("aria-expanded", "false");
  }

  #onSearchKeyDown(event) {
    switch (event.key) {
      case "Escape":
        event.preventDefault();
        this.close({ focusTrigger: true });
        return;
      case "ArrowDown":
        event.preventDefault();
        this.#moveActive(1);
        return;
      case "ArrowUp":
        event.preventDefault();
        this.#moveActive(-1);
        return;
      case "Enter": {
        event.preventDefault();
        const active = this.#getActive() ?? this.#getVisibleOptions()[0];
        this.#insert(active?.dataset.scCaeInsertVariable);
        return;
      }
      default:
    }
  }

  #filter(query) {
    const normalized = String(query ?? "").trim().toLowerCase();
    let visible = 0;

    for (const option of this.#options) {
      const matches = ConditionVariablePopover.matches(option.dataset.scCaeVariableSearch ?? "", normalized);
      option.classList.toggle(HIDDEN_CLASS, !matches);
      if (matches) {
        visible += 1;
      }
    }

    this.#empty?.classList.toggle(HIDDEN_CLASS, visible > 0);
    this.#setActive(this.#getVisibleOptions()[0] ?? null);
  }

  #getVisibleOptions() {
    return this.#options.filter(option => !option.classList.contains(HIDDEN_CLASS));
  }

  #getActive() {
    return this.#options.find(option => (
      option.classList.contains(ACTIVE_CLASS) && !option.classList.contains(HIDDEN_CLASS)
    )) ?? null;
  }

  #setActive(option, { scroll = true } = {}) {
    if (this.#getActive() === option) {
      return;
    }

    for (const candidate of this.#options) {
      candidate.classList.toggle(ACTIVE_CLASS, candidate === option);
    }

    if (scroll) {
      option?.scrollIntoView({ block: "nearest" });
    }
  }

  #moveActive(offset) {
    const visible = this.#getVisibleOptions();
    if (!visible.length) {
      return;
    }

    const currentIndex = visible.indexOf(this.#getActive());
    const nextIndex = currentIndex === -1
      ? (offset > 0 ? 0 : visible.length - 1)
      : (currentIndex + offset + visible.length) % visible.length;
    this.#setActive(visible[nextIndex]);
  }

  #insert(variable) {
    if (!variable) {
      return;
    }

    const editor = this.#root.querySelector(`code-mirror[name="${this.#conditionFlagPath}"]`);
    this.close();
    ConditionVariableInserter.insert(editor, variable);
  }

  static matches(haystack, query) {
    if (!query) {
      return true;
    }

    return String(haystack).toLowerCase().includes(query);
  }
}
