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
import { ChainProvider } from '../store/chain';
import { colors } from '../theme';
import { buzz } from '../lib/haptics';
import { WristBridge } from '../components/WristBridge';
import { PresentationProvider } from '../components/Presentation';
import { BackgroundKeeper } from '../components/BackgroundKeeper';
import { AUTOTEST } from '../lib/biometrics';
import { View } from 'react-native';
import { Txt } from '../components/Txt';

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

function AutotestBanner() {
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingBottom: 18, alignItems: 'center' }}>
      <Txt size={11} color={colors.red}>
        Test mode: fingerprint skipped
      </Txt>
    </View>
  );
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
      <ChainProvider>
      <ThemeProvider value={theme}>
      <PresentationProvider>
        <StatusBar style="dark" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.ground } }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="onboarding" />
          <Stack.Screen name="(tabs)" options={{ gestureEnabled: false }} />
          <Stack.Screen name="key/[id]" />
          <Stack.Screen name="request/[id]" options={{ presentation: 'modal' }} />
          <Stack.Screen name="issue" options={{ presentation: 'modal' }} />
          <Stack.Screen name="sign/[id]" options={{ presentation: 'modal', gestureEnabled: false }} />
          <Stack.Screen name="revoke" options={{ presentation: 'modal', gestureEnabled: false }} />
          <Stack.Screen name="wrist" options={{ presentation: 'modal' }} />
          <Stack.Screen name="vault" options={{ presentation: 'modal' }} />
          <Stack.Screen name="agent" options={{ presentation: 'modal' }} />
          <Stack.Screen name="session/[address]" options={{ presentation: 'modal' }} />
          <Stack.Screen name="limit/[id]" options={{ presentation: 'modal', gestureEnabled: false }} />
        </Stack>
        {AUTOTEST ? <AutotestBanner /> : null}
        <IncomingWatcher />
        <WristBridge />
        <BackgroundKeeper />
      </PresentationProvider>
      </ThemeProvider>
      </ChainProvider>
    </StoreProvider>
  );
}
