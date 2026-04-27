import path from "node:path";
import { fileURLToPath } from "node:url";
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import tesseractPlugin from "./tools/eslint-rules/no-horizontal-primitive-deps.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default tseslint.config(
  { ignores: ["**/dist", "**/node_modules", "pnpm-lock.yaml", "tools/**/*.mjs"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: [
      "packages/tesseract/src/**/*.ts",
      "packages/@tesseract/**/*.ts",
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
      "@tesseract": tesseractPlugin,
    },
    rules: {
      "@tesseract/no-horizontal-primitive-deps": "error",
    },
  },
);
