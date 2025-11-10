# Hydra View

Open-source situational awareness application built with Expo/React Native.

## Contributing

For security reasons, contributions are invite-only at this time.

## Prerequisites

- [Bun](https://bun.sh)
- [Android SDK](https://developer.android.com/studio) (for Android development)

## Setup

```bash
bun install
cp apps/foss/env-example apps/foss/.env.development
```

## Development

```bash
bun dev             # start dev server
bun dev:web         # start web
bun dev:android     # build & run android
```

## Environment

| Variable                    | Description     | Default                  |
| --------------------------- | --------------- | ------------------------ |
| `EXPO_PUBLIC_HYDRA_API_URL` | Backend API URL | `window.location.origin` |

> **Note:** `EXPO_PUBLIC_HYDRA_API_URL` is optional when the frontend is bundled with the backend (single binary). When running the backend separately during development, set this to your backend URL (e.g., `http://localhost:50051`).

## Web

Works out of the box. Set `EXPO_PUBLIC_HYDRA_API_URL` to point to a backend.

## Android

Two options:

**Option 1: Remote backend** (no AAR needed)

```bash
adb reverse tcp:50051 tcp:50051
```

Set `EXPO_PUBLIC_HYDRA_API_URL=http://localhost:50051` and run the backend on your machine.

**Option 2: Native backend** (requires AAR)

Backend runs on device via `hydra.aar` - see `packages/hydra-engine/README.md`.

```bash
adb forward tcp:50051 tcp:50051  # to push test data to device
```

## Troubleshooting

If you change environment variables or encounter stale cache issues, clear the Expo cache:

```bash
bun dev --clear
```

## Build

```bash
# web
bun build:web               # production
bun build:web:staging       # staging
bun serve                   # serve build

# android
bun release:android         # production
bun release:android:staging # staging
```

## Commands

```bash
bun lint                    # eslint check
bun lint:fix                # eslint fix
bun format                  # prettier format
bun type-check              # typescript check
bun test                    # run tests
```

## Structure

```
/
├── apps/foss/          # main app
│   ├── app/            # routes
│   └── src/            # app code
└── packages/           # shared packages
    ├── core/           # shared features (aware, api, stores)
    ├── hydra-engine/   # native module wrapping hydra.aar
    ├── map-engine/     # map abstraction (maplibre)
    └── ui/             # shared ui components
```
