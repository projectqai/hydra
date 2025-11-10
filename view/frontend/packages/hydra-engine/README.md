# @hydra/engine

Expo module wrapping Hydra Go backend AAR as Android ForegroundService.

## Setup

Requires `hydra.aar` in `android/libs/`.

Build from [github.com/projectqai/hydra](https://github.com/projectqai/hydra):

```bash
cd android && gomobile bind -target=android -androidapi 24 -o hydra.aar
```

Then copy `hydra.aar` to this package's `android/libs/` directory.

## API

```typescript
import * as HydraEngine from "@hydra/engine";

await HydraEngine.startEngineService(); // starts foreground service
await HydraEngine.stopEngine();
```

## Android Only

Returns `"unsupported"` on non-Android platforms.
