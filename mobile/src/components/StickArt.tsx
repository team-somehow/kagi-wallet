import React from 'react';
import { View } from 'react-native';
import { StickModel } from './SpatialDevices';
export function StickArt({
  pointToA = false,
  pressing = false,
  screen,
}: {
  pointToA?: boolean;
  pressing?: boolean;
  screen?: string;
}) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: 20 }}>
      <StickModel
        value={screen ?? 'Kagi'}
        active={pointToA || pressing}
        detail={pointToA ? 'HOLD A TO APPROVE →' : 'Your approval device'}
      />
    </View>
  );
}
