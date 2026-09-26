import React from 'react';
import { View } from 'react-native';
import { colors } from '../theme';

/**
 * Intercepta's mark: a 3 x 4 grid of dots (their logo-black.svg, 21 x 29: dots of radius 2.5 on
 * an 8 unit pitch). Drawn with views, so it needs no SVG library. `size` is the height.
 */
export function InterceptaMark({ size = 20, color = colors.text }: { size?: number; color?: string }) {
  const k = size / 29;
  const d = 5 * k;
  return (
    <View accessibilityLabel="Intercepta" style={{ width: 21 * k, height: size }}>
      {[0, 1, 2, 3].map((row) =>
        [0, 1, 2].map((col) => (
          <View
            key={`${row}${col}`}
            style={{
              position: 'absolute',
              left: col * 8 * k,
              top: row * 8 * k,
              width: d,
              height: d,
              borderRadius: d / 2,
              backgroundColor: color,
            }}
          />
        )),
      )}
    </View>
  );
}
