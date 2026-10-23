import globals from "globals";
import { config as base } from "./base.js";

// TypeScript 7 is checked by tsc. The existing Babel parser does not track
// type-only references for these two core rules; tsc's noUnused* checks do.
export const config = [
  ...base,
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: { "no-undef": "off", "no-unused-vars": "off" },
  },
  { languageOptions: { globals: { ...globals.node, ...globals.browser } } },
];
