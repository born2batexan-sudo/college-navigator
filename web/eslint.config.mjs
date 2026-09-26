// Next.js 16 removed the built-in `next lint` command; ESLint is run
// directly (see package.json's "lint" script) against this flat config.
// eslint-config-next ships native ESLint 9 flat configs, so no
// FlatCompat/legacy-shareable-config bridging is needed or wanted here.
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = [
  ...nextCoreWebVitals,
  {
    ignores: ["lib/db/dev.sqlite3", "*.tsbuildinfo"],
  },
];

export default eslintConfig;
