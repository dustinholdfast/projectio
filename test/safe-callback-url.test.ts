import { describe, expect, it } from "vitest";

import { safeCallbackUrl } from "@/lib/safe-callback-url";

describe("safeCallbackUrl", () => {
  it("keeps a same-site invitation path including its query string", () => {
    expect(safeCallbackUrl("/join/token-123?from=email")).toBe(
      "/join/token-123?from=email",
    );
  });

  it.each([
    "https://attacker.example/",
    "//attacker.example/",
    "/\\attacker.example/",
    "javascript:alert(1)",
    "/join/ok\nLocation: https://attacker.example/",
  ])("rejects unsafe callback %s", (value) => {
    expect(safeCallbackUrl(value)).toBe("/");
  });

  it("uses the requested fallback for a missing value", () => {
    expect(safeCallbackUrl(undefined, "/login")).toBe("/login");
  });
});
