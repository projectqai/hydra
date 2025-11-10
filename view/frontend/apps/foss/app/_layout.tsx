import "../global.css";

import { configureReanimatedLogger, ReanimatedLogLevel } from "react-native-reanimated";

if (__DEV__) {
  configureReanimatedLogger({
    level: ReanimatedLogLevel.warn,
    strict: false,
  });
}

import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from "@expo-google-fonts/inter";
import { useFonts } from "expo-font";
import * as NavigationBar from "expo-navigation-bar";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { Platform, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Toaster } from "sonner-native";

SplashScreen.preventAutoHideAsync();

import { TopNav } from "@hydra/core/components/top-nav";
import * as HydraEngine from "@hydra/engine";
import Constants from "expo-constants";

function FossTopNav() {
  return (
    <TopNav.Root>
      <TopNav.Left>
        <TopNav.LogoOrTime />
      </TopNav.Left>
    </TopNav.Root>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Inter: Inter_400Regular,
    "Inter-Medium": Inter_500Medium,
    "Inter-SemiBold": Inter_600SemiBold,
    "Inter-Bold": Inter_700Bold,
  });

  useEffect(() => {
    if (Platform.OS === "android") {
      NavigationBar.setVisibilityAsync("hidden");
    }
  }, []);

  useEffect(() => {
    const hasRemoteBackend = !!Constants.expoConfig?.extra?.PUBLIC_HYDRA_API_URL;
    if (Platform.OS === "android" && !hasRemoteBackend) {
      HydraEngine.startEngineService();
    }
  }, []);

  useEffect(() => {
    if (fontsLoaded) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    <SafeAreaProvider>
      <View className="flex-1 bg-background">
        <Stack
          screenOptions={{
            headerShown: true,
            header: () => <FossTopNav />,
            contentStyle: { backgroundColor: "#161616" },
            headerTransparent: true,
            headerShadowVisible: false,
            animation: "none",
          }}
        >
          <Stack.Screen name="index" />
        </Stack>
        <StatusBar style="light" />
        <Toaster
          position="top-center"
          offset={68}
          toastOptions={{
            style: {
              backgroundColor: "rgb(27, 27, 27)",
              borderColor: "rgb(60, 60, 60)",
              borderWidth: 1,
              borderRadius: 4,
              paddingHorizontal: 16,
              paddingVertical: 10,
              alignSelf: "center",
              flexGrow: 0,
              flexShrink: 1,
            },
            titleStyle: {
              color: "rgb(220, 220, 220)",
              fontFamily: "Inter-Medium",
              fontSize: 13,
            },
          }}
        />
      </View>
    </SafeAreaProvider>
  );
}
