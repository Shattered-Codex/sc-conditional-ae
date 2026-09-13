/**
 * The Active Effect's icon tint, as the effect list should paint it.
 *
 * `tint` is a core ActiveEffect field, not a dnd5e 6 addition, so this needs no
 * system version gate: an effect that never set one simply has nothing to paint.
 */
export class EffectIconTint {
  static MARKER = "data-sc-cae-icon-tint";

  static #HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

  /** The tint to paint, or null when there is nothing to paint. */
  static resolve(effect) {
    const raw = effect?.tint;
    const color = typeof raw === "string" ? raw.trim() : (raw?.css ?? raw?.toString?.() ?? "");
    const normalized = String(color).trim().toLowerCase();

    if (!EffectIconTint.#HEX.test(normalized)) {
      return null;
    }

    // White is the identity tint: Foundry multiplies by it, so painting it would
    // only cost a wrapper and change nothing.
    return EffectIconTint.#expand(normalized) === "#ffffff" ? null : normalized;
  }

  /**
   * Paint (or clear) the tint on one icon element.
   *
   * A raster icon is multiplied by the colour through a wrapper, matching how
   * Foundry tints the same image on a token. An SVG icon is a single fill, so it
   * takes the colour directly through dnd5e's --icon-fill.
   */
  static paint(icon, tint) {
    if (!icon) {
      return;
    }

    const wrapper = icon.closest?.(`[${EffectIconTint.MARKER}]`) ?? null;

    if (!tint) {
      icon.style?.removeProperty?.("--icon-fill");
      wrapper?.replaceWith(icon);
      return;
    }

    if (String(icon.tagName ?? "").toLowerCase() === "dnd5e-icon") {
      icon.style?.setProperty?.("--icon-fill", tint);
      wrapper?.replaceWith(icon);
      return;
    }

    const host = wrapper ?? icon.ownerDocument.createElement("span");
    host.className = "sc-cae-effect-icon-tint";
    host.setAttribute(EffectIconTint.MARKER, "");
    host.style.setProperty("--sc-cae-effect-tint", tint);
    // The overlay has to be clipped to the icon's own corners, and those differ
    // between the 8px sheet portrait and the list icons.
    host.style.borderRadius = EffectIconTint.#cornerRadius(icon);

    if (!wrapper) {
      icon.replaceWith(host);
      host.append(icon);
    }
  }

  static #cornerRadius(icon) {
    try {
      return icon.ownerDocument?.defaultView?.getComputedStyle?.(icon)?.borderRadius || "";
    } catch {
      return "";
    }
  }

  static #expand(color) {
    if (color.length !== 4) {
      return color;
    }

    return `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`;
  }
}
