import React from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, space } from '../theme';
import { Pulse } from './Pulse';
import { Txt } from './Txt';

export type StepState = 'todo' | 'active' | 'done' | 'failed';

export interface Step {
  label: string;
  detail?: string;
  state: StepState;
}

function Marker({ state }: { state: StepState }) {
  if (state === 'active') return <Pulse />;
  const bg = state === 'done' ? colors.text : state === 'failed' ? colors.red : 'transparent';
  const border = state === 'todo' ? colors.faint : bg;
  return <View style={[styles.marker, { backgroundColor: bg, borderColor: border }]} />;
}

/** A sequence of things that must happen in order. Markers, not numbers. */
export function Steps({ steps }: { steps: Step[] }) {
  return (
    <View style={styles.list}>
      {steps.map((s, i) => {
        const dim = s.state === 'todo';
        return (
          <View key={i} style={styles.row}>
            <View style={styles.markerCol}>
              <Marker state={s.state} />
              {i < steps.length - 1 ? <View style={styles.rail} /> : null}
            </View>
            <View style={styles.text}>
              <Txt size={16} weight="medium" color={dim ? colors.faint : s.state === 'failed' ? colors.red : colors.text}>
                {s.label}
              </Txt>
              {s.detail ? (
                <Txt size={14} color={dim ? colors.faint : colors.muted}>
                  {s.detail}
                </Txt>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 0 },
  row: { flexDirection: 'row', gap: space.m, minHeight: 56 },
  markerCol: { width: 12, alignItems: 'center', paddingTop: 6 },
  marker: { width: 10, height: 10, borderRadius: 2, borderWidth: 1.5 },
  rail: { flex: 1, width: 1, backgroundColor: colors.line, marginTop: 6, marginBottom: -2 },
  text: { flex: 1, gap: 2, paddingBottom: space.m },
});
