// Password rules shared by signup and password reset.
//
// This lives outside `lib/actions/` because a `"use server"` module may export
// only async functions — a plain constant exported from one is a build error.

/** Minimum characters for a new password. Enforced server-side in both flows. */
export const MIN_PASSWORD_LENGTH = 8;
