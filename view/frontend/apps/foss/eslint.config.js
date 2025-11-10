const baseConfig = require("@hydra/eslint-config");

module.exports = [
  ...baseConfig,
  {
    ignores: ["expo-env.d.ts"],
  },
];
