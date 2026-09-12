/**
 * The root element of a rendering Application.
 *
 * Render hooks hand the markup over in three shapes depending on the Foundry
 * version and the application class: a bare element, a jQuery wrapper, or
 * nothing at all. Six call sites had each grown their own spelling of this.
 */
export class ApplicationRoot {
  static resolve(app, html = null) {
    return ApplicationRoot.#unwrap(html) ?? ApplicationRoot.#unwrap(app?.element) ?? null;
  }

  static #unwrap(candidate) {
    if (!candidate) {
      return null;
    }

    if (typeof candidate.querySelectorAll === "function") {
      return candidate;
    }

    // jQuery, or anything else indexable that wraps the real element.
    const first = candidate[0] ?? candidate.get?.(0) ?? null;
    return typeof first?.querySelectorAll === "function" ? first : null;
  }
}
