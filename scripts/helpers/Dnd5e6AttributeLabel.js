/**
 * The human-readable attribute name dnd5e prints for a change key.
 *
 * dnd5e 6 exposes this through its own utils, and its native filter breakdown
 * uses it, so the builder and the Changes tab summary read the same names the
 * system shows elsewhere. Returns null when the system cannot name the path.
 */
export class Dnd5e6AttributeLabel {
  static resolve(key, { actor = null, item = null } = {}) {
    const path = String(key ?? "").trim();
    if (!path) {
      return null;
    }

    try {
      const resolve = globalThis.game?.dnd5e?.utils?.getHumanReadableAttributeLabel;
      const label = resolve?.(path, { actor, item });
      return label && label !== path ? label : null;
    } catch {
      return null;
    }
  }
}
