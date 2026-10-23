/**
 * A key field's list of keys, completed one segment at a time: typing
 * `attributes.` lists what is under `attributes`, a branch fills in its name
 * and a dot and keeps the list open, a key fills in the whole path and closes
 * it. Plain DOM, one list for every key field of the builder.
 *
 * The list is a manual popover, so the builder's scrolling never clips it, and
 * it stays inside the window, so it wears the window's look. Arrow keys move,
 * Enter and Tab accept, Escape closes; Enter never reaches the form.
 */
export class Dnd5e6NativeFilterKeyPicker {
  static WIDTH = 280;
  static HEIGHT = 280;

  #popup;
  #tree;
  #strings;
  #signal;
  #input = null;
  #items = [];
  #active = -1;
  #closeTimer = null;
  #sequence = 0;

  /**
   * @param {object} options
   * @param {HTMLElement} options.popup     The list element, `role="listbox"`.
   * @param {Function} options.tree         Returns the Dnd5e6NativeFilterKeyTree to read; `{ fresh: true }` when the list opens.
   * @param {object} [options.strings]      `{ common, keys, matches, more, empty }`.
   * @param {AbortSignal} [options.signal]  Removes every listener when aborted.
   */
  constructor({ popup, tree, strings = {}, signal = null }) {
    this.#popup = popup;
    this.#tree = tree;
    this.#strings = strings;
    this.#signal = signal;
    const doc = popup.ownerDocument;
    const listen = signal ? { signal } : {};
    // A press on the list keeps the focus in the field, so choosing never closes it first.
    popup.addEventListener("pointerdown", (event) => event.preventDefault(), listen);
    popup.addEventListener("mousedown", (event) => event.preventDefault(), listen);
    popup.addEventListener("click", (event) => this.#onClick(event), listen);
    doc?.addEventListener?.("pointerdown", (event) => {
      if (this.isOpen && event.target !== this.#input && !popup.contains?.(event.target)) this.close();
    }, { ...listen, capture: true });
    doc?.addEventListener?.("scroll", () => { if (this.isOpen) this.#place(); }, { ...listen, capture: true, passive: true });
    signal?.addEventListener?.("abort", () => this.close());
  }

  get isOpen() {
    return this.#input !== null && !this.#popup.hidden;
  }

  get items() {
    return this.#items;
  }

  get active() {
    return this.#items[this.#active] ?? null;
  }

  /** Makes a key field a combobox for this list. */
  attach(input) {
    const listen = this.#signal ? { signal: this.#signal } : {};
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-expanded", "false");
    input.setAttribute("aria-controls", this.#popup.id ?? "");
    input.setAttribute("autocomplete", "off");
    input.addEventListener("focus", () => { if (!String(input.value ?? "").trim()) this.open(input); }, listen);
    input.addEventListener("click", () => { if (!this.isOpen || this.#input !== input) this.open(input); }, listen);
    input.addEventListener("input", (event) => {
      if (event?.scCaeKeyPicker) return;
      this.open(input);
    }, listen);
    input.addEventListener("keydown", (event) => this.#onKeyDown(event, input), listen);
    input.addEventListener("blur", () => {
      clearTimeout(this.#closeTimer);
      this.#closeTimer = setTimeout(() => { if (this.#input === input && input.ownerDocument?.activeElement !== input) this.close(); }, 0);
    }, listen);
    return input;
  }

  /** Lists the keys for what the field holds now; opening reads the keys again, typing does not. */
  open(input) {
    const fresh = !this.isOpen;
    if (this.#input && this.#input !== input) this.#setExpanded(this.#input, false);
    this.#input = input;
    this.#render(this.#tree({ fresh }).query(input.value));
    this.#show();
    return this.#items;
  }

  /** Closes the list if its field is inside `container`, which is about to be drawn again. */
  release(container) {
    if (this.#input && (!container || container.contains?.(this.#input))) this.close();
  }

  close() {
    clearTimeout(this.#closeTimer);
    if (this.#input) {
      this.#setExpanded(this.#input, false);
      this.#input.removeAttribute("aria-activedescendant");
    }
    this.#input = null;
    this.#items = [];
    this.#active = -1;
    if (typeof this.#popup.hidePopover === "function" && this.#popup.matches?.(":popover-open")) {
      try { this.#popup.hidePopover(); }
      catch { /* already hidden */ }
    }
    this.#popup.hidden = true;
  }

  /** Puts a listed key in the field: a branch keeps the list open one level down. */
  accept(item = this.active) {
    const input = this.#input;
    if (!input || !item) return false;
    input.value = item.insert;
    input.setSelectionRange?.(item.insert.length, item.insert.length);
    const View = input.ownerDocument?.defaultView;
    const event = View?.Event ? new View.Event("input", { bubbles: true }) : { type: "input" };
    // The builder reads the new key; this list reads it below, without reopening on its own event.
    event.scCaeKeyPicker = true;
    if (typeof input.dispatchEvent === "function") input.dispatchEvent(event);
    if (item.branch) this.open(input);
    else this.close();
    return true;
  }

  move(step) {
    if (!this.#items.length) return null;
    const count = this.#items.length;
    this.#active = this.#active < 0 ? (step > 0 ? 0 : count - 1) : (this.#active + step + count) % count;
    this.#highlight();
    return this.active;
  }

  #onKeyDown(event, input) {
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp":
        event.preventDefault();
        if (!this.isOpen || this.#input !== input) this.open(input);
        this.move(event.key === "ArrowDown" ? 1 : -1);
        break;
      case "Enter":
        // Never a form submission: the editor saves only from its Save button.
        event.preventDefault();
        event.stopPropagation();
        if (this.isOpen && this.active) this.accept();
        else this.close();
        break;
      case "Tab":
        if (!this.isOpen || !this.active || event.shiftKey) {
          this.close();
          break;
        }
        // A branch keeps the focus here, to type what comes under it.
        if (this.active.branch) event.preventDefault();
        this.accept();
        break;
      case "Escape":
        if (!this.isOpen) break;
        event.preventDefault();
        event.stopPropagation();
        this.close();
        break;
      default:
        break;
    }
  }

  #onClick(event) {
    const option = event.target?.closest?.("[data-sc-cae-key-option]");
    if (!option) return;
    const item = this.#items[Number(option.dataset.scCaeKeyOption)];
    if (item) this.accept(item);
  }

  #render(result) {
    const doc = this.#popup.ownerDocument;
    const element = (tag, className, text = null) => {
      const node = doc.createElement(tag);
      node.className = className;
      if (text !== null) node.textContent = text;
      return node;
    };
    this.#items = [];
    this.#active = -1;
    const id = this.#popup.id || "sc-cae-key-picker";
    this.#sequence += 1;
    const rows = [];
    for (const group of result.groups) {
      if (result.groups.length > 1 || group.id !== "keys") {
        const header = element("li", "sc-cae-key-picker__group", this.#strings[group.id] ?? group.id);
        header.setAttribute("role", "presentation");
        rows.push(header);
      }
      for (const item of group.items) {
        const index = this.#items.push(item) - 1;
        const option = element("li", `sc-cae-key-picker__option${item.branch ? " is-branch" : ""}`);
        option.id = `${id}-${this.#sequence}-${index}`;
        option.dataset.scCaeKeyOption = String(index);
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", "false");
        const segment = result.base && item.key.startsWith(`${result.base}.`) ? item.key.slice(result.base.length + 1) : item.key;
        const text = element("span", "sc-cae-key-picker__text");
        text.append(element("span", "sc-cae-key-picker__key", segment));
        if (item.label) text.append(element("span", "sc-cae-key-picker__label", item.label));
        option.append(text);
        if (item.value) option.append(element("span", "sc-cae-key-picker__value", item.value));
        if (item.branch) option.append(element("span", "sc-cae-key-picker__more", "›"));
        rows.push(option);
      }
    }
    if (!this.#items.length) rows.push(element("li", "sc-cae-key-picker__empty", this.#strings.empty ?? ""));
    if (result.more > 0) {
      const more = String(this.#strings.more ?? "+{count}").replace("{count}", String(result.more));
      rows.push(element("li", "sc-cae-key-picker__hint", more));
    }
    for (const row of rows) if (row.getAttribute?.("role") !== "option") row.setAttribute?.("aria-hidden", "true");
    this.#popup.replaceChildren(...rows);
  }

  #highlight() {
    const options = Array.from(this.#popup.querySelectorAll?.("[data-sc-cae-key-option]") ?? []);
    for (const option of options) {
      const active = Number(option.dataset.scCaeKeyOption) === this.#active;
      option.classList.toggle("is-active", active);
      option.setAttribute("aria-selected", String(active));
      if (active) {
        this.#input?.setAttribute("aria-activedescendant", option.id);
        option.scrollIntoView?.({ block: "nearest" });
      }
    }
  }

  #show() {
    this.#popup.hidden = false;
    if (typeof this.#popup.showPopover === "function" && !this.#popup.matches?.(":popover-open")) {
      try { this.#popup.showPopover(); }
      catch { /* shown in place */ }
    }
    this.#setExpanded(this.#input, true);
    this.#input.removeAttribute("aria-activedescendant");
    this.#place();
  }

  #setExpanded(input, expanded) {
    input?.setAttribute("aria-expanded", String(expanded));
  }

  /** Under the field, or above it when the window's bottom is too close. */
  #place() {
    // A field the builder drew over is gone: nothing to follow.
    if (this.#input?.isConnected === false) {
      this.close();
      return;
    }
    const rect = this.#input?.getBoundingClientRect?.();
    const view = this.#popup.ownerDocument?.defaultView;
    if (!rect || !view) return;
    const style = this.#popup.style;
    const width = Math.max(rect.width, Dnd5e6NativeFilterKeyPicker.WIDTH);
    const left = Math.max(4, Math.min(rect.left, view.innerWidth - width - 4));
    const below = view.innerHeight - rect.bottom;
    style.left = `${left}px`;
    style.minWidth = `${width}px`;
    style.maxHeight = `${Math.max(120, Math.min(Dnd5e6NativeFilterKeyPicker.HEIGHT, Math.max(below, rect.top) - 12))}px`;
    if (below >= Math.min(Dnd5e6NativeFilterKeyPicker.HEIGHT, 180) || below >= rect.top) {
      style.top = `${rect.bottom + 2}px`;
      style.bottom = "auto";
    } else {
      style.top = "auto";
      style.bottom = `${view.innerHeight - rect.top + 2}px`;
    }
  }
}
