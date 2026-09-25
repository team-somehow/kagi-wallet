import React from 'react';
import { Stack } from 'expo-router';
import { colors } from '../../theme';

export default function OnboardingLayout() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.ground } }} />;
}
