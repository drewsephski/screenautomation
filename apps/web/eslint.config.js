import { nextJsConfig } from "@repo/eslint-config/next-js";

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...nextJsConfig,
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parserOptions: {
        babelOptions: {
          presets: [],
          parserOpts: { plugins: ["typescript", "jsx"] },
        },
      },
    },
    rules: { "no-undef": "off", "no-unused-vars": "off" },
  },
];
