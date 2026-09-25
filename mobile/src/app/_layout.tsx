import React, { useEffect, useRef } from 'react';
import { useFonts } from 'expo-font';
import { MartianMono_400Regular, MartianMono_600SemiBold } from '@expo-google-fonts/martian-mono';
import {
  SchibstedGrotesk_400Regular,
  SchibstedGrotesk_500Medium,
  SchibstedGrotesk_700Bold,
} from '@expo-google-fonts/schibsted-grotesk';
import { DarkTheme, Stack, ThemeProvider, router, useRootNavigationState } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { StoreProvider, useStore } from '../store/store';
import { colors } from '../theme';
import { buzz } from '../lib/haptics';

void SplashScreen.preventAutoHideAsync();

const theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: colors.ground, card: colors.ground, text: colors.text, border: colors.line },
};

/** Watches for a new over-cap request and brings the co-sign screen up, like a push would. */
function IncomingWatcher() {
  const { state } = useStore();
  const ready = Boolean(useRootNavigationState()?.key);
  const seen = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!ready) return;
    const pending = state.signs.find((s) => s.status === 'pending' && !seen.current.has(s.id));
    if (!pending) return;
    seen.current.add(pending.id);
    void buzz();
    router.push(`/sign/${pending.id}`);
  }, [state.signs, ready]);
  return null;
}

export default function RootLayout() {
  const [loaded] = useFonts({
    MartianMono_400Regular,
    MartianMono_600SemiBold,
    SchibstedGrotesk_400Regular,
    SchibstedGrotesk_500Medium,
    SchibstedGrotesk_700Bold,
  });

  useEffect(() => {
    if (loaded) void SplashScreen.hideAsync();
  }, [loaded]);

  if (!loaded) return null;

  return (
    <StoreProvider>
      <ThemeProvider value={theme}>
        <StatusBar style="light" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.ground } }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="onboarding" />
          <Stack.Screen name="home" options={{ gestureEnabled: false }} />
          <Stack.Screen name="key/[id]" />
          <Stack.Screen name="request/[id]" options={{ presentation: 'modal' }} />
          <Stack.Screen name="issue" options={{ presentation: 'modal' }} />
          <Stack.Screen name="sign/[id]" options={{ presentation: 'modal', gestureEnabled: false }} />
          <Stack.Screen name="revoke" options={{ presentation: 'modal', gestureEnabled: false }} />
          <Stack.Screen name="demo" options={{ presentation: 'modal' }} />
        </Stack>
        <IncomingWatcher />
      </ThemeProvider>
    </StoreProvider>
  );
}
