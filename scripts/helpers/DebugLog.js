import { Constants } from "../constants/Constants.js";
import { ModuleSettings } from "../settings/ModuleSettings.js";

/**
 * The one gate for the module's debug output.
 *
 * Five copies of this had drifted into three different conditions: some read
 * only the setting, some only the global, and Constants.debug only the global —
 * so turning debug logging on in the settings silenced half the module's own
 * tracing. Both switches now open every log.
 */
export class DebugLog {
  static isEnabled() {
    // Reading the setting is safe before registration: ModuleSettings falls
    // back rather than throwing, which matters for init-time callers.
    return ModuleSettings.isDebugLoggingEnabled() || Boolean(globalThis[Constants.DEBUG_GLOBAL]);
  }

  static write(message, data = undefined) {
    if (!DebugLog.isEnabled()) {
      return;
    }

    const prefix = `[${Constants.MODULE_ID}] ${message}`;
    if (data === undefined) {
      console.debug(prefix);
      return;
    }

    console.debug(prefix, data);
  }
}
