import { NativeModule, requireNativeModule } from "expo-modules-core";

declare class HydraEngineModule extends NativeModule<Record<string, never>> {
  startEngineService(): Promise<string>;
  stopEngine(): Promise<string>;
}

export default requireNativeModule<HydraEngineModule>("HydraEngine");
