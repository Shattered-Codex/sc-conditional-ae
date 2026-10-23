export class DocumentDeletionCompatibility {
  static buildUpdate(path) {
    const ForcedDeletion = globalThis.foundry?.data?.operators?.ForcedDeletion;
    if (typeof ForcedDeletion === "function") {
      return { [path]: new ForcedDeletion() };
    }

    // Foundry v13 requires the legacy deletion key.
    const separator = path.lastIndexOf(".");
    const parent = separator < 0 ? "" : path.slice(0, separator + 1);
    return { [`${parent}-=${path.slice(separator + 1)}`]: null };
  }
}
