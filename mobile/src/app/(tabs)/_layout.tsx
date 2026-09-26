import React from 'react';
import { type ColorValue, View } from 'react-native';
import { Tabs } from 'expo-router/js-tabs';
import { colors, fonts } from '../../theme';

// Three small marks drawn with views, so the tab bar needs no icon font.
function WalletIcon({ color }: { color: ColorValue }) {
  return (
    <View style={{ width: 24, height: 18, borderRadius: 5, borderWidth: 2, borderColor: color, justifyContent: 'center', alignItems: 'flex-end', paddingRight: 3 }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />
    </View>
  );
}

function SpendingIcon({ color }: { color: ColorValue }) {
  return (
    <View style={{ width: 22, height: 18, flexDirection: 'row', alignItems: 'flex-end', gap: 3 }}>
      {[8, 14, 11, 18].map((h, i) => (
        <View key={i} style={{ width: 3.5, height: h, borderRadius: 1.5, backgroundColor: color }} />
      ))}
    </View>
  );
}

function MoreIcon({ color }: { color: ColorValue }) {
  return (
    <View style={{ width: 22, height: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      {[0, 1, 2].map((i) => (
        <View key={i} style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: color }} />
      ))}
    </View>
  );
}

/** The wallet, its spending, and settings: one tap apart. Everything else opens over these. */
export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.text,
        tabBarInactiveTintColor: colors.faint,
        tabBarStyle: { backgroundColor: colors.panel, borderTopColor: colors.line },
        tabBarLabelStyle: { fontFamily: fonts.sansMedium, fontSize: 12 },
        sceneStyle: { backgroundColor: colors.ground },
      }}
    >
      <Tabs.Screen name="home" options={{ title: 'Wallet', tabBarIcon: ({ color }) => <WalletIcon color={color} /> }} />
      <Tabs.Screen name="spending" options={{ title: 'Spending', tabBarIcon: ({ color }) => <SpendingIcon color={color} /> }} />
      <Tabs.Screen name="demo" options={{ title: 'More', tabBarIcon: ({ color }) => <MoreIcon color={color} /> }} />
    </Tabs>
  );
}
