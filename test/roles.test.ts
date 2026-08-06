import { describe, expect, it } from "vitest";

import {
  ROLE_DESCRIPTION,
  ROLE_LABEL,
  SHAREABLE_ROLES,
  isShareableRole,
  roleAtLeast,
  type BoardRole,
} from "@/lib/roles";

// The rank comparison is what every authorisation check in the app funnels
// through, so it is worth pinning down exhaustively rather than by example.

const ALL: BoardRole[] = ["VIEWER", "EDITOR", "OWNER"];

describe("roleAtLeast", () => {
  it("lets every role meet itself", () => {
    for (const role of ALL) expect(roleAtLeast(role, role)).toBe(true);
  });

  it("ranks VIEWER < EDITOR < OWNER", () => {
    expect(roleAtLeast("EDITOR", "VIEWER")).toBe(true);
    expect(roleAtLeast("OWNER", "VIEWER")).toBe(true);
    expect(roleAtLeast("OWNER", "EDITOR")).toBe(true);
  });

  it("refuses every downward comparison", () => {
    expect(roleAtLeast("VIEWER", "EDITOR")).toBe(false);
    expect(roleAtLeast("VIEWER", "OWNER")).toBe(false);
    expect(roleAtLeast("EDITOR", "OWNER")).toBe(false);
  });

  it("keeps a viewer out of everything above viewing", () => {
    // The single most important property here: this is the check standing
    // between a read-only guest and someone else's board.
    expect(roleAtLeast("VIEWER", "EDITOR")).toBe(false);
    expect(roleAtLeast("VIEWER", "OWNER")).toBe(false);
  });

  it("is a total order — exactly one direction holds for any distinct pair", () => {
    for (const a of ALL) {
      for (const b of ALL) {
        if (a === b) continue;
        expect(roleAtLeast(a, b) && roleAtLeast(b, a)).toBe(false);
        expect(roleAtLeast(a, b) || roleAtLeast(b, a)).toBe(true);
      }
    }
  });
});

describe("shareable roles", () => {
  it("never lets a link grant OWNER", () => {
    // A link granting OWNER would let anyone holding a URL delete the board and
    // evict the person who created it.
    expect(SHAREABLE_ROLES).not.toContain("OWNER");
    expect(isShareableRole("OWNER")).toBe(false);
  });

  it("accepts the two it should", () => {
    expect(isShareableRole("VIEWER")).toBe(true);
    expect(isShareableRole("EDITOR")).toBe(true);
  });

  it("rejects anything that is not a role at all", () => {
    for (const junk of ["", "owner", "ADMIN", "viewer", "OWNER "]) {
      expect(isShareableRole(junk)).toBe(false);
    }
  });
});

describe("labels", () => {
  it("names and describes every role", () => {
    for (const role of ALL) {
      expect(ROLE_LABEL[role]).toBeTruthy();
      expect(ROLE_DESCRIPTION[role]).toBeTruthy();
    }
  });
});
