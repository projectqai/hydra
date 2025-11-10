import HydraEngineModule from "./hydra-engine-module";

const isAndroid = process.env.EXPO_OS === "android";

export function startEngineService(): Promise<string> {
  if (!isAndroid) return Promise.resolve("unsupported");
  return HydraEngineModule.startEngineService();
}

export function stopEngine(): Promise<string> {
  if (!isAndroid) return Promise.resolve("unsupported");
  return HydraEngineModule.stopEngine();
}
