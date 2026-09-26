import React from 'react';
import { Image } from 'react-native';

const RATIO = 1840 / 772;

/** The Kagi Wallet stick logo, the same artwork as the app icon. */
export function Logo({ height = 28 }: { height?: number }) {
  return (
    <Image
      source={require('../../assets/logo.png')}
      accessibilityRole="image"
      accessibilityLabel="Kagi Wallet"
      style={{ height, width: height * RATIO }}
    />
  );
}
