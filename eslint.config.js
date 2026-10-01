import js from "@eslint/js";
import tseslint from "typescript-eslint";

// Only src/drivers/ may talk to a screen reader or browser library.
const driverLibraries = ["@guidepup/*", "playwright", "playwright-core", "@playwright/*"];

export default tseslint.config(
  { ignores: ["dist/", "coverage/", "fixture/", "transcripts/"] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
  {
    files: ["src/**/*.ts"],
    ignores: ["src/drivers/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: driverLibraries, message: "Only src/drivers/ may import driver libraries." },
          ],
        },
      ],
    },
  },
  {
    files: ["**/*.js", "**/*.mjs"],
    ...tseslint.configs.disableTypeChecked,
  },
);
