import path from "node:path";
import { fileURLToPath } from "node:url";
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import tesseractPlugin from "./internal/tools/eslint-rules/no-horizontal-primitive-deps.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default tseslint.config(
  { ignores: ["**/dist", "**/node_modules", "pnpm-lock.yaml", "internal/tools/**/*.mjs"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: [
      "internal/packages/tesseract/src/**/*.ts",
      "internal/packages/@tesseract/**/*.ts",
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
