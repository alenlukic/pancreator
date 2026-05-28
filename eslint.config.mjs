import path from "node:path";
import { fileURLToPath } from "node:url";
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import daedalinePlugin from "./src/internal/tools/eslint-rules/no-horizontal-primitive-deps.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default tseslint.config(
  { ignores: ["**/dist", "**/node_modules", "pnpm-lock.yaml", "src/internal/tools/**/*.mjs"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["tests/**/*.mjs", "*.config.mjs"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        Buffer: "readonly",
        clearTimeout: "readonly",
        console: "readonly",
        fetch: "readonly",
        process: "readonly",
        setTimeout: "readonly",
      },
    },
  },
  {
    files: ["src/internal/packages/@daedaline/**/bin/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        console: "readonly",
        process: "readonly",
      },
    },
  },
  {
    files: [
      "src/internal/packages/daedaline/src/**/*.ts",
      "src/internal/packages/@daedaline/**/*.ts",
    ],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
        tsconfigRootDir: __dirname,
      },
    },
    plugins: {
      "@daedaline": daedalinePlugin,
    },
    rules: {
      "@daedaline/no-horizontal-primitive-deps": "error",
    },
  },
);
