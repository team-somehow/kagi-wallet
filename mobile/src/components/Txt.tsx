import React from 'react';
import { Text, type TextProps } from 'react-native';
import { colors, fonts } from '../theme';

type Weight = 'regular' | 'medium' | 'bold';

export interface TxtProps extends TextProps {
  mono?: boolean;
  size?: number;
  weight?: Weight;
  color?: string;
  align?: 'left' | 'center' | 'right';
  lineHeight?: number;
}

function family(mono: boolean, weight: Weight): string {
  if (mono) return weight === 'regular' ? fonts.mono : fonts.monoBold;
  if (weight === 'bold') return fonts.sansBold;
  if (weight === 'medium') return fonts.sansMedium;
  return fonts.sans;
}

export function Txt({
  mono = false,
  size = 16,
  weight = 'regular',
  color = colors.text,
  align,
  lineHeight,
  style,
  ...rest
}: TxtProps) {
  return (
    <Text
      {...rest}
      style={[
        {
          fontFamily: family(mono, weight),
          fontSize: size,
          color,
          lineHeight: lineHeight ?? Math.round(size * (mono ? 1.35 : 1.3)),
          textAlign: align,
          letterSpacing: mono ? (size >= 32 ? -1.5 : -0.3) : 0,
        },
        style,
      ]}
    />
  );
}
