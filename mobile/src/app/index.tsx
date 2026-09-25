import React from 'react';
import { Redirect } from 'expo-router';
import { useStore } from '../store/store';

export default function Index() {
  const { state } = useStore();
  if (!state.hydrated) return null;
  return <Redirect href={state.onboarded ? '/home' : '/onboarding'} />;
}
