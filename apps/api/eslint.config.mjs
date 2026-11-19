import base from "@keystonehr/config/eslint/base.mjs";

export default [
  ...base,
  {
    rules: {
      // Nest DI relies on parameter properties & empty constructors
      "@typescript-eslint/no-empty-function": "off"
    }
  }
];
