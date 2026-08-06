/**
 * Accept only same-site absolute paths as post-auth destinations.
 *
 * Auth forms receive this value from the URL and post it back through a hidden
 * field. Treating it as trusted would create an open redirect after login. A
 * leading double slash is especially important to reject because browsers read
 * `//example.com` as a cross-origin URL despite it beginning with `/`.
 */
export function safeCallbackUrl(value: unknown, fallback = "/"): string {
  if (typeof value !== "string") return fallback;

  const candidate = value.trim();
  if (
    !candidate.startsWith("/") ||
    candidate.startsWith("//") ||
    candidate.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(candidate)
  ) {
    return fallback;
  }

  return candidate;
}
