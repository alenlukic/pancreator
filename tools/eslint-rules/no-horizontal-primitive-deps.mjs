/**
 * @file Local ESLint plugin for Phase 0a horizontal-dependency policy.
 * Files under `packages/@tesseract/<name>/` SHALL NOT import or re-export
 * another primitive package except `core` and the current package.
 *
 * Carveout: `packages/@tesseract/cli` is the workspace composer for `tess`.
 * It MAY import any `@tesseract/*` package (BOOTSTRAP.md Phase 3 step 8).
 */
const WORKSPACE_COMPOSER_PRIMITIVE_IDS = new Set(["cli"]);
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const TESSERACT_SCOPE = "@tesseract/";

/**
 * @param {string} source
 * @returns {string | null} Package id after the scope, or `null` if not a scoped tesseract spec.
 */
function tesseractPackageId(source) {
  if (typeof source !== "string" || !source.startsWith(TESSERACT_SCOPE)) {
    return null;
  }
  const rest = source.slice(TESSERACT_SCOPE.length);
  if (!rest) {
    return null;
  }
  const [id] = rest.split("/");
  return id || null;
}

/**
 * @param {string} filePath
 * @returns {string | null} Directory name of the primitive, or `null` if the file is not under `packages/@tesseract/<id>/`.
 */
function primitiveNameFromFile(filePath) {
  const rel = path.relative(REPO_ROOT, filePath).split(path.sep).join("/");
  const m = /^packages\/@tesseract\/([^/]+)\//.exec(rel);
  if (!m) {
    return null;
  }
  return m[1] ?? null;
}

/** @param {import('eslint').Rule.RuleContext} context */
function checkSourceString(context, sourceNode, value) {
  const primitive = primitiveNameFromFile(context.filename);
  if (primitive == null) {
    return;
  }
  if (WORKSPACE_COMPOSER_PRIMITIVE_IDS.has(primitive)) {
    return;
  }
  const target = tesseractPackageId(value);
  if (target == null) {
    return;
  }
  if (target === "core" || target === primitive) {
    return;
  }
  context.report({
    node: sourceNode,
    message: `A primitive in @tesseract/* MUST NOT import or re-export @tesseract/${target} (horizontal dependency). The system MUST allow @tesseract/core and the current package only.`,
  });
}

const noHorizontalPrimitiveDeps = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow horizontal @tesseract/* dependencies between primitive packages; only @tesseract/core and the same package are allowed. @tesseract/cli is exempt as the workspace composer.",
    },
    schema: [],
  },
  create(context) {
    return {
      ImportDeclaration(n) {
        if (n.source) {
          checkSourceString(context, n.source, n.source.value);
        }
      },
      ExportNamedDeclaration(n) {
        if (n.source) {
          checkSourceString(context, n.source, n.source.value);
        }
      },
      ExportAllDeclaration(n) {
        if (n.source) {
          checkSourceString(context, n.source, n.source.value);
        }
      },
    };
  },
};

const plugin = {
  rules: {
    "no-horizontal-primitive-deps": noHorizontalPrimitiveDeps,
  },
};

export default plugin;
