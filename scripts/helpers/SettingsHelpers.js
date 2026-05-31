export class SettingsHelpers {
  static resolveRoot(html) {
    if (!html) {
      return null;
    }

    if (html.jquery || typeof html.get === "function") {
      return html[0] ?? html.get(0) ?? null;
    }

    if (html instanceof Element || html?.querySelector) {
      return html;
    }

    return null;
  }
}
