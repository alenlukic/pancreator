import path from "node:path";
import { fileURLToPath } from "node:url";
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import pancreatorPlugin from "./pancreator/lib/internal/tools/lint/eslint-rules/no-horizontal-primitive-deps.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default tseslint.config(
  {
    ignores: [
      "**/dist",
      "**/node_modules",
      "pnpm-lock.yaml",
      "pancreator/lib/internal/tools/**/*.mjs",
      "pancreator/client/**",
      "**/next-env.d.ts",
      "pancreator/.pan/**",
    ],
  },
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
    files: ["pancreator/tests/**/*.mjs", "*.config.mjs"],
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
    files: ["pancreator/lib/internal/packages/@pancreator/**/bin/*.js"],
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
      "pancreator/lib/internal/packages/@pancreator/**/*.ts",
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
      "@pancreator": pancreatorPlugin,
    },
    rules: {
      "@pancreator/no-horizontal-primitive-deps": "error",
    },
  },
);
