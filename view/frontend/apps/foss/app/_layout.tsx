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
import * as Linking from "expo-linking";
import * as NavigationBar from "expo-navigation-bar";
import { router, Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
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
      <TopNav.Right>
        <TopNav.ConnectionStatus />
      </TopNav.Right>
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
    if (process.env.EXPO_OS === "android") {
      NavigationBar.setVisibilityAsync("hidden");
    }
  }, []);

  useEffect(() => {
    if (process.env.EXPO_OS === "web") return;

    const subscription = Linking.addEventListener("url", ({ url }) => {
      const { hostname, queryParams } = Linking.parse(url);
      if (hostname === "aware" && queryParams) {
        router.navigate({ pathname: "/aware", params: queryParams });
      }
    });

    return () => subscription.remove();
  }, []);

  useEffect(() => {
    const hasRemoteBackend = !!Constants.expoConfig?.extra?.PUBLIC_HYDRA_API_URL;
    if (process.env.EXPO_OS === "android" && !hasRemoteBackend) {
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
    <GestureHandlerRootView style={{ flex: 1 }}>
      <KeyboardProvider>
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
                  ...(process.env.EXPO_OS === "web"
                    ? { alignSelf: "center", flexGrow: 0, flexShrink: 1 }
                    : { marginHorizontal: "35%" }),
                },
                titleStyle: {
                  color: "rgb(220, 220, 220)",
                },
              }}
            />
          </View>
        </SafeAreaProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}
