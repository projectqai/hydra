const { FileStore } = require("@expo/metro/metro-cache");
const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");
const path = require("node:path");

const config = getDefaultConfig(__dirname);

config.cacheStores = [
  new FileStore({ root: path.join(__dirname, "node_modules", ".cache", "metro") }),
];

config.resolver.unstable_enablePackageExports = true;
config.resolver.blockList = [/node_modules[/\\]\.bin[/\\].*/];

module.exports = withNativeWind(config, { input: "./global.css" });
