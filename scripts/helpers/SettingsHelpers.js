import { ApplicationRoot } from "./ApplicationRoot.js";

export class SettingsHelpers {
  static resolveRoot(html) {
    return ApplicationRoot.resolve(null, html);
  }
}
