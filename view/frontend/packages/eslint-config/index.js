const js = require("@eslint/js");
const tsPlugin = require("@typescript-eslint/eslint-plugin");
const tsParser = require("@typescript-eslint/parser");
const prettierPlugin = require("eslint-plugin-prettier");
const prettierConfig = require("eslint-config-prettier");
const unicornPlugin = require("eslint-plugin-unicorn");
const unusedImportsPlugin = require("eslint-plugin-unused-imports");
const simpleImportSortPlugin = require("eslint-plugin-simple-import-sort");
const reactCompilerPlugin = require("eslint-plugin-react-compiler");
const globals = require("globals");

module.exports = [
  js.configs.recommended,
  prettierConfig,
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/.expo/**",
      "**/coverage/**",
      "**/.turbo/**",
      "**/android/**",
      "**/ios/**",
      "**/web-build/**",
      "**/.next/**",
      "**/.vscode/**",
      "**/generated/**",
      "**/*.generated.*",
    ],
  },
  {
    files: ["**/*.{js,jsx,ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2021,
        __DEV__: "readonly",
        Deno: "readonly",
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      prettier: prettierPlugin,
      unicorn: unicornPlugin,
      "unused-imports": unusedImportsPlugin,
      "simple-import-sort": simpleImportSortPlugin,
      "react-compiler": reactCompilerPlugin,
    },
    rules: {
      "prettier/prettier": [
        "warn",
        {},
        {
          usePrettierrc: true,
        },
      ],
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/consistent-type-imports": [
        "warn",
        {
          prefer: "type-imports",
          fixStyle: "inline-type-imports",
          disallowTypeAnnotations: true,
        },
      ],
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": "error",
      "unused-imports/no-unused-imports": "error",
      "simple-import-sort/imports": "error",
      "simple-import-sort/exports": "error",
      "unicorn/filename-case": [
        "error",
        {
          case: "kebabCase",
          ignore: ["/android", "\\.config\\."],
        },
      ],
      "no-console": "off",
      "react-compiler/react-compiler": "error",
      "no-redeclare": ["error", { builtinGlobals: false }],
      "no-case-declarations": "off",
    },
  },
  {
    files: ["**/__tests__/**/*.[jt]s?(x)", "**/?(*.)+(spec|test).[jt]s?(x)"],
    languageOptions: {
      globals: {
        ...globals.jest,
      },
    },
    rules: {
      "no-console": "off",
    },
  },
  {
    files: ["**/*.{jsx,tsx}"],
    languageOptions: {
      globals: {
        React: "readonly",
      },
    },
  },
];
