import { KIT_STORE, type Kit } from "./kit-store";

/** Returns a kit by ID with NO owner check.
 *
 * INTENTIONALLY UNSAFE — planted vulnerability for the security-twin demo.
 * Any caller who knows (or guesses) a kit ID can read it regardless of who owns it.
 * Use getKitForUser() everywhere in real code.
 */
export function getKit(id: string): Kit | undefined {
  return KIT_STORE.find((k) => k.id === id);
}

/** Returns a kit by ID only if it belongs to the given userId. Safe version. */
export function getKitForUser(id: string, userId: string): Kit | undefined {
  return KIT_STORE.find((k) => k.id === id && k.ownerId === userId);
}

export function listKitsForUser(userId: string): Kit[] {
  return KIT_STORE.filter((k) => k.ownerId === userId);
}

export const USERS = ["alice", "bob", "carol"] as const;
