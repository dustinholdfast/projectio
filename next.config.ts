import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Pin the workspace root to this project so Next.js does not infer it from a
  // stray parent-directory lockfile.
  outputFileTracingRoot: path.join(__dirname),
  // No serverExternalPackages entry is needed for the Postgres stack: `pg` is
  // pure JavaScript and bundles cleanly. (The previous SQLite adapter pulled in
  // a native module that had to be excluded here.) If a build ever warns about
  // the optional `pg-native` require, add `serverExternalPackages: ["pg"]`.
};

export default nextConfig;
