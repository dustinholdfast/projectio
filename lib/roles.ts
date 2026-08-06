// Role vocabulary: the type, the ranking, and the labels.
//
// Deliberately free of any database import. `lib/authz.ts` pulls in Prisma, which
// pulls in `pg`, which needs Node's `fs` — so a client component importing role
// labels from there fails the build with "Can't resolve 'fs'". The split is the
// same one `lib/auth.config.ts` makes for the Edge middleware: the part everyone
// needs stays free of server-only dependencies.
//
// Server code should import from `@/lib/authz`, which re-exports all of this
// alongside the checks that do touch the database.

export type BoardRole = "VIEWER" | "EDITOR" | "OWNER";

const RANK: Record<BoardRole, number> = {
  VIEWER: 1,
  EDITOR: 2,
  OWNER: 3,
};

/**
 * Does `role` meet or exceed `minimum`?
 *
 * Comparing by rank rather than listing allowed roles at each call site is what
 * lets a role be added later without re-auditing every check.
 */
export function roleAtLeast(role: BoardRole, minimum: BoardRole): boolean {
  return RANK[role] >= RANK[minimum];
}

/** Roles a share link may grant. OWNER is never one of them. */
export const SHAREABLE_ROLES: readonly BoardRole[] = ["VIEWER", "EDITOR"] as const;

export function isShareableRole(value: string): value is BoardRole {
  return (SHAREABLE_ROLES as readonly string[]).includes(value);
}

export const ROLE_LABEL: Record<BoardRole, string> = {
  VIEWER: "Viewer",
  EDITOR: "Editor",
  OWNER: "Owner",
};

export const ROLE_DESCRIPTION: Record<BoardRole, string> = {
  VIEWER: "Can see the board. Cannot change anything.",
  EDITOR: "Can add, edit, move and delete cards and columns.",
  OWNER: "Full control, including sharing and deleting the board.",
};
