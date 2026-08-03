// Auth.js catch-all route handler. Mounts the sign-in / sign-out / session /
// callback endpoints at /api/auth/* using the handlers built in lib/auth.ts.
import { handlers } from "@/lib/auth";

export const { GET, POST } = handlers;
