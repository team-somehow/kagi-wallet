import React, { createContext, useContext, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useKeepAwake } from 'expo-keep-awake';
import * as SecureStore from 'expo-secure-store';
import { link } from '../lib/link';

type Preferences = { awake: boolean; sound: boolean };
const defaults: Preferences = { awake: true, sound: true };
const Context = createContext({ ...defaults, update: (_: Partial<Preferences>) => {} });
function KeepScreenOn() {
  useKeepAwake('kagi-presentation');
  return null;
}
export function PresentationProvider({ children }: { children: React.ReactNode }) {
  const [prefs, setPrefs] = useState(defaults);
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    void SecureStore.getItemAsync('kagi.presentation')
      .then((raw) => {
        if (raw) {
          const value = JSON.parse(raw);
          setPrefs({ awake: value.awake !== false, sound: value.sound !== false });
        }
      })
      .catch(() => {});
    const sub = AppState.addEventListener('change', (value) => setActive(value === 'active'));
    return () => sub.remove();
  }, []);
  useEffect(() => {
    const send = () => link.send({ t: 'sound', enabled: prefs.sound });
    send();
    return link.on((m) => {
      if (m.t === 'hello' && !m.from) send();
    });
  }, [prefs.sound]);
  const update = (patch: Partial<Preferences>) =>
    setPrefs((old) => {
      const next = { ...old, ...patch };
      void SecureStore.setItemAsync('kagi.presentation', JSON.stringify(next)).catch(() => {});
      return next;
    });
  return (
    <Context.Provider value={{ ...prefs, update }}>
      {active && prefs.awake ? <KeepScreenOn /> : null}
      {children}
    </Context.Provider>
  );
}
export const usePresentation = () => useContext(Context);
