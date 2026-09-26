import React from 'react';
import { SpatialDevices, type DeviceBeam } from './SpatialDevices';
export type Beam = DeviceBeam;
export type Link = 'off' | 'searching' | 'on';
export function Trio({
  wrist,
  beam,
  focus = null,
  joined = false,
  setup = false,
  two = true,
  value,
}: {
  wrist: Link;
  stick: Link;
  beam: Beam;
  focus?: 'phone' | 'wrist' | 'stick' | null;
  joined?: boolean;
  setup?: boolean;
  two?: boolean;
  value?: string;
  wristLabel?: string;
  stickLabel?: string;
}) {
  return (
    <SpatialDevices
      two={two}
      beam={beam}
      focus={focus}
      connected={wrist === 'on'}
      joined={joined}
      setup={setup}
      value={value}
    />
  );
}
