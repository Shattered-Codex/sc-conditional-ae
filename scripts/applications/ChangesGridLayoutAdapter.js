import { ApplicationRoot } from "../helpers/ApplicationRoot.js";
import { DebugLog } from "../helpers/DebugLog.js";

const CHANGES_SECTION_SELECTOR = "section.tab.changes, section.tab[data-tab='changes']";
const ADAPTED_CLASS = "sc-cae-changes-grid";
const SPACER_CLASS = "sc-cae-changes-spacer";

/**
 * Column identities the adapter knows how to size, matched in order. The
 * module's own cells come first so they are not mistaken for a system column.
 */
const COLUMN_CLASS_IDS = [
  ["sc-cae-formula-cell", "formula"],
  ["sc-cae-formula-column", "formula"],
  ["sc-cae-formula-header", "formula"],
  ["key", "key"],
  ["type", "type"],
  ["mode", "mode"],
  ["value", "value"],
  ["phase", "phase"],
  ["priority", "priority"],
  ["controls", "controls"]
];

/** Field name endings used when a cell carries no recognisable class. */
const COLUMN_FIELD_IDS = ["key", "type", "mode", "value", "phase", "priority"];

const COLUMN_TRACKS = {
  key: "minmax(0, 2.2fr)",
  type: "minmax(0, 0.9fr)",
  mode: "minmax(0, 0.9fr)",
  value: "minmax(0, 1.5fr)",
  formula: "2.75rem",
  "formula-field": "minmax(0, 1.2fr)",
  phase: "minmax(0, 0.8fr)",
  priority: "minmax(0, 0.55fr)",
  controls: "max-content"
};

const UNKNOWN_TRACK = "minmax(0, 0.8fr)";

/** Elements that never take a grid track of their own. */
const NON_CELL_TAGS = new Set(["TEMPLATE", "SCRIPT", "STYLE", "LINK"]);
const SPANNING_CELL_SELECTOR = ".sc-cae-formula-expansion";

/**
 * Keeps the Changes tab readable when several modules add columns to the same
 * row.
 *
 * On dnd5e 5.3 the tab is Foundry's own grid: the row container declares a
 * fixed track list and each `li` is `display: contents`, so every cell of a
 * change consumes one track. Every stylesheet involved — Foundry's, DAE's and
 * this module's — declares that list statically, so as soon as the cells
 * outnumber the tracks (DAE's Phase column plus this module's formula cell)
 * the surplus wraps onto new lines and the row falls apart.
 *
 * The adapter reads the cells actually present and rewrites
 * `grid-template-columns` inline, which outranks every stylesheet without
 * having to predict which modules are installed.
 */
export class ChangesGridLayoutAdapter {
  static #observers = new WeakMap();
  static #registered = false;

  static activate() {
    if (ChangesGridLayoutAdapter.#registered) {
      return;
    }

    ChangesGridLayoutAdapter.#registered = true;
    Hooks.on("renderActiveEffectConfig", (sheet, html) => {
      ChangesGridLayoutAdapter.scheduleAdapt(sheet, html);
    });
    Hooks.on("closeActiveEffectConfig", sheet => {
      ChangesGridLayoutAdapter.deactivateObserver(sheet);
    });
  }

  /**
   * Adapts now and once more on the next frame, because other modules inject
   * their cells from their own render hooks, in an order nobody controls.
   */
  static scheduleAdapt(sheet, rootOverride) {
    ChangesGridLayoutAdapter.#adapt(sheet, rootOverride);

    // dnd5e 6 renders the Changes tab as a card list with no grid to align, so
    // there is nothing to re-run and nothing to watch for.
    if (!ChangesGridLayoutAdapter.#hasAdaptableGrid(sheet, rootOverride)) {
      ChangesGridLayoutAdapter.deactivateObserver(sheet);
      return;
    }

    requestAnimationFrame(() => ChangesGridLayoutAdapter.#adapt(sheet, rootOverride));
    ChangesGridLayoutAdapter.activateObserver(sheet, rootOverride);
  }

  static #hasAdaptableGrid(sheet, rootOverride) {
    const root = ChangesGridLayoutAdapter.#getSheetRoot(sheet, rootOverride);
    if (!root) {
      return false;
    }

    for (const section of root.querySelectorAll(CHANGES_SECTION_SELECTOR)) {
      const list = section.querySelector(":scope > ol");
      if (!list || !section.querySelector(":scope > header")) continue;
      const firstRow = list.querySelector(":scope > li");
      if (ChangesGridLayoutAdapter.#readTrackCount(list, firstRow)) return true;
    }

    return false;
  }

  static activateObserver(sheet, rootOverride) {
    const root = ChangesGridLayoutAdapter.#getSheetRoot(sheet, rootOverride);
    const lists = root ? ChangesGridLayoutAdapter.#findChangeLists(root) : [];
    if (!lists.length) {
      ChangesGridLayoutAdapter.deactivateObserver(sheet);
      return;
    }

    const current = ChangesGridLayoutAdapter.#observers.get(sheet);
    if (
      current?.lists?.length === lists.length
      && current.lists.every((list, index) => list === lists[index])
    ) {
      return;
    }

    current?.observer?.disconnect();

    let queued = false;
    const observer = new MutationObserver(() => {
      if (queued) {
        return;
      }

      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        ChangesGridLayoutAdapter.#adapt(sheet, root);
      });
    });

    // Only the row container is observed: the adapter writes inline styles and
    // header spacers, so watching it too would feed its own mutations back.
    for (const list of lists) {
      observer.observe(list, { childList: true, subtree: true });
    }

    ChangesGridLayoutAdapter.#observers.set(sheet, { observer, lists });
  }

  static deactivateObserver(sheet) {
    const current = ChangesGridLayoutAdapter.#observers.get(sheet);
    current?.observer?.disconnect();
    ChangesGridLayoutAdapter.#observers.delete(sheet);
  }

  /**
   * Counts the tracks of a `grid-template-columns` value. Line names are not
   * tracks, and the spaces inside a function such as `minmax(0, 1fr)` do not
   * separate one.
   */
  static countTracks(template) {
    const value = String(template ?? "").replace(/\[[^\]]*\]/g, " ").trim();
    if (!value.length || value === "none") {
      return 0;
    }

    let depth = 0;
    let count = 0;
    let inTrack = false;
    for (const character of value) {
      if (character === "(") {
        depth += 1;
      } else if (character === ")") {
        depth -= 1;
      }

      if (depth === 0 && /\s/.test(character)) {
        inTrack = false;
        continue;
      }

      if (!inTrack) {
        count += 1;
        inTrack = true;
      }
    }

    return count;
  }

  static resolveColumnId({ classNames = [], fieldName = "" } = {}) {
    for (const [className, id] of COLUMN_CLASS_IDS) {
      if (classNames.includes(className)) {
        return id;
      }
    }

    const field = String(fieldName).split(".").pop();
    return COLUMN_FIELD_IDS.includes(field) ? field : "";
  }

  static buildTrackList(columnIds, columnCount = columnIds.length) {
    const tracks = [];
    for (let index = 0; index < columnCount; index += 1) {
      tracks.push(COLUMN_TRACKS[columnIds[index]] ?? UNKNOWN_TRACK);
    }
    return tracks.join(" ");
  }

  static #getSheetRoot(sheet, rootOverride) {
    return ApplicationRoot.resolve(sheet, rootOverride);
  }

  static #findChangeLists(root) {
    const lists = [];
    for (const section of root.querySelectorAll(CHANGES_SECTION_SELECTOR)) {
      const list = section.querySelector(":scope > ol");
      if (list) {
        lists.push(list);
      }
    }
    return lists;
  }

  static #adapt(sheet, rootOverride) {
    const root = ChangesGridLayoutAdapter.#getSheetRoot(sheet, rootOverride);
    if (!root) {
      return;
    }

    for (const section of root.querySelectorAll(CHANGES_SECTION_SELECTOR)) {
      ChangesGridLayoutAdapter.#adaptSection(section);
    }
  }

  static #adaptSection(section) {
    const list = section.querySelector(":scope > ol");
    const header = section.querySelector(":scope > header");
    if (!list || !header) {
      return;
    }

    const rows = Array.from(list.querySelectorAll(":scope > li"));
    const trackCount = ChangesGridLayoutAdapter.#readTrackCount(list, rows[0]);
    if (!trackCount) {
      return;
    }

    const columnIds = ChangesGridLayoutAdapter.#getWidestRowColumns(rows);
    const headerCells = ChangesGridLayoutAdapter.#getGridCells(header);
    const columnCount = Math.max(columnIds.length, headerCells.length);
    if (columnCount < 2 || columnCount === trackCount) {
      return;
    }

    const template = ChangesGridLayoutAdapter.buildTrackList(columnIds, columnCount);
    DebugLog.write("adapting the Changes tab grid", {
      effect: section.closest("form")?.id ?? null,
      trackCount,
      columnCount,
      columnIds,
      template
    });

    header.style.gridTemplateColumns = template;
    list.style.gridTemplateColumns = template;
    section.classList.add(ADAPTED_CLASS);
    ChangesGridLayoutAdapter.#syncHeaderCellCount(header, columnCount);
    ChangesGridLayoutAdapter.#syncSpanningCells(rows, columnCount);
  }

  /**
   * Returns the declared track count, or 0 when the tab does not use the grid
   * layout this adapter understands — dnd5e 6.0 renders the same tab as a card
   * list, and a table layout has no tracks at all.
   */
  static #readTrackCount(list, row) {
    if (!row) {
      return 0;
    }

    const listStyle = getComputedStyle(list);
    if (listStyle.display !== "grid" || getComputedStyle(row).display !== "contents") {
      return 0;
    }

    return ChangesGridLayoutAdapter.countTracks(listStyle.gridTemplateColumns);
  }

  /** Rows differ: an unregistered change shows a warning instead of its fields. */
  static #getWidestRowColumns(rows) {
    let widest = [];
    for (const row of rows) {
      const cells = ChangesGridLayoutAdapter.#getGridCells(row);
      if (cells.length > widest.length) {
        widest = cells;
      }
    }
    return widest.map(cell => ChangesGridLayoutAdapter.#getColumnId(cell));
  }

  static #getGridCells(parent) {
    return Array.from(parent.children).filter(child => ChangesGridLayoutAdapter.#isGridCell(child));
  }

  static #isGridCell(element) {
    if (element.hidden || NON_CELL_TAGS.has(element.tagName)) {
      return false;
    }

    // The formula expansion is a row of its own; core keeps the change's phase
    // in a hidden input. Neither takes a track.
    if (element.matches(SPANNING_CELL_SELECTOR)) {
      return false;
    }

    return element.tagName !== "INPUT" || element.type !== "hidden";
  }

  static #getColumnId(cell) {
    const id = ChangesGridLayoutAdapter.resolveColumnId({
      classNames: Array.from(cell.classList),
      fieldName: cell.querySelector("[name]")?.getAttribute("name") ?? ""
    });

    if (id !== "formula") {
      return id;
    }

    // The `column` treatment edits in place and needs a real share of the row;
    // the button treatments only need room for the button.
    return cell.querySelector(".sc-cae-formula-input--visible") ? "formula-field" : "formula";
  }

  /**
   * A module that adds a cell without adding its header label would shift every
   * label one track to the left, so the missing ones are filled with spacers.
   */
  static #syncHeaderCellCount(header, columnCount) {
    const cells = ChangesGridLayoutAdapter.#getGridCells(header);
    if (cells.length === columnCount) {
      return;
    }

    if (cells.length < columnCount) {
      // Inserted before the trailing controls label so it stays on the edge.
      const anchor = cells[cells.length - 1] ?? null;
      for (let index = cells.length; index < columnCount; index += 1) {
        const spacer = ChangesGridLayoutAdapter.#createSpacer();
        if (anchor) {
          anchor.before(spacer);
        } else {
          header.append(spacer);
        }
      }
      return;
    }

    const spacers = cells.filter(cell => cell.classList.contains(SPACER_CLASS));
    for (let excess = cells.length - columnCount; excess > 0 && spacers.length; excess -= 1) {
      spacers.pop().remove();
    }
  }

  static #createSpacer() {
    const spacer = document.createElement("div");
    spacer.className = SPACER_CLASS;
    spacer.setAttribute("aria-hidden", "true");
    return spacer;
  }

  /** Core spans the "unregistered change" warning across the field columns. */
  static #syncSpanningCells(rows, columnCount) {
    const span = Math.max(1, columnCount - 2);
    for (const row of rows) {
      const warning = row.querySelector(":scope > .unregistered");
      if (warning) {
        warning.style.gridColumn = `span ${span}`;
      }
    }
  }
}
