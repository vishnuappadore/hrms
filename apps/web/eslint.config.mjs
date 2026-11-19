import base from "@keystonehr/config/eslint/base.mjs";

export default [
  ...base,
  {
    ignores: [".next/**", "next-env.d.ts"]
  }
];
