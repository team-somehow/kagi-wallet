import React from 'react';
import { ScrollView, StyleSheet, View, type ViewStyle } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { colors, space } from '../theme';

interface Props {
  children: React.ReactNode;
  scroll?: boolean;
  edges?: Edge[];
  style?: ViewStyle;
  /** Pinned below the scrolling content, above the home indicator. */
  footer?: React.ReactNode;
}

export function Screen({ children, scroll = false, edges = ['top', 'bottom'], style, footer }: Props) {
  return (
    <SafeAreaView edges={edges} style={styles.root}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={[styles.body, style]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.body, styles.fill, style]}>{children}</View>
      )}
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.ground },
  fill: { flex: 1 },
  body: { paddingHorizontal: space.l, paddingTop: space.m, paddingBottom: space.l },
  footer: { paddingHorizontal: space.l, paddingBottom: space.s, gap: space.s },
});
