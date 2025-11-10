import type { ConfigContext, ExpoConfig } from "@expo/config";
import type { AppIconBadgeConfig } from "app-icon-badge/types";

import { ClientEnv, Env } from "./env";

const appIconBadgeConfig: AppIconBadgeConfig = {
  enabled: Env.APP_ENV !== "production",
  badges: [
    {
      text: Env.APP_ENV,
      type: "banner",
      background: "#000000",
      color: "white",
    },
    {
      text: Env.VERSION.toString(),
      type: "ribbon",
      background: "#000000",
      color: "white",
    },
  ],
};

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: Env.NAME,
  description: `${Env.NAME} Mobile App`,
  scheme: Env.SCHEME,
  slug: "hydra-foss",
  version: Env.VERSION.toString(),
  orientation: "landscape",
  icon: "./assets/images/icon.png",
  userInterfaceStyle: "automatic",
  newArchEnabled: true,
  android: {
    adaptiveIcon: {
      backgroundColor: "#E6F4FE",
      foregroundImage: "./assets/images/android-icon-foreground.png",
      backgroundImage: "./assets/images/android-icon-background.png",
      monochromeImage: "./assets/images/android-icon-monochrome.png",
    },
    package: Env.PACKAGE,
    edgeToEdgeEnabled: true,
    predictiveBackGestureEnabled: false,
    splash: {
      image: "./assets/images/splash-icon.png",
      resizeMode: "contain",
      backgroundColor: "#161616",
    },
  },
  web: {
    bundler: "metro",
    output: "static",
    favicon: "./assets/images/favicon.png",
  },
  plugins: [
    "expo-router",
    [
      "expo-splash-screen",
      {
        image: "./assets/images/splash-icon.png",
        imageWidth: 200,
        backgroundColor: "#161616",
      },
    ],
    ["app-icon-badge", appIconBadgeConfig],
    [
      "expo-navigation-bar",
      {
        visibility: "hidden",
        behavior: "overlay-swipe",
        position: "absolute",
        backgroundColor: "#00000000",
      },
    ],
    [
      "expo-build-properties",
      {
        android: {
          enableMinifyInReleaseBuilds: false,
          enableShrinkResourcesInReleaseBuilds: false,
        },
      },
    ],
    "./plugins/with-cleartext-traffic.js",
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  extra: {
    ...ClientEnv,
  },
});
