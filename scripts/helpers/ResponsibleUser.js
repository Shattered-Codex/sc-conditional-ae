/**
 * The single client that should act for an actor.
 *
 * Formula rolls and condition-driven macros both need exactly one client to
 * run, or every connected player fires the same macro. Prefer an active,
 * non-GM owner; fall back to the active GM.
 */
export class ResponsibleUser {
  static resolve(actor) {
    const activeUsers = game.users?.filter(user => user.active) ?? [];
    const owner = activeUsers.find(user => !user.isGM && actor?.testUserPermission?.(user, "OWNER"));
    if (owner) {
      return owner;
    }

    return game.users?.activeGM ?? activeUsers.find(user => user.isGM) ?? null;
  }

  static isCurrentUser(actor) {
    return ResponsibleUser.resolve(actor)?.id === game.user?.id;
  }
}
