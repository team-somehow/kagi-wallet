import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '../components/Screen';
import { Txt } from '../components/Txt';
import { Button } from '../components/Button';
import { TopBar } from '../components/TopBar';
import { Fact } from '../components/Fact';
import { wristStatus } from '../components/WristChip';
import { useStore } from '../store/store';
import { link, type Msg } from '../lib/link';
import { success, tap, warn } from '../lib/haptics';
import { colors, fonts, radius, space } from '../theme';

type AddState = 'idle' | 'waiting' | 'saved' | 'rejected' | 'failed';

/** The wrist's connection, and the WiFi networks it knows. */
export default function WristSettings() {
  const { state } = useStore();
  const { wrist } = state;
  const status = wristStatus(wrist, state.address);
  const [networks, setNetworks] = useState<string[] | null>(null);
  const [ssid, setSsid] = useState('');
  const [pass, setPass] = useState('');
  const [add, setAdd] = useState<AddState>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [nearby, setNearby] = useState<{ ssid: string; rssi: number; open: boolean }[] | null>(null);

  useEffect(() => {
    const off = link.on((m: Msg) => {
      if (m.t === 'wifi_list' && Array.isArray(m.networks)) setNetworks(m.networks.map(String));
      if (m.t === 'wifi_scan' && Array.isArray(m.networks)) {
        // One row per name, strongest signal first.
        const seen = new Map<string, { ssid: string; rssi: number; open: boolean }>();
        for (const n of m.networks as { ssid: string; rssi: number; open: boolean }[]) {
          const prev = seen.get(n.ssid);
          if (!prev || n.rssi > prev.rssi) seen.set(n.ssid, n);
        }
        setNearby([...seen.values()].sort((a, b) => b.rssi - a.rssi));
      }
    });
    if (wrist.connected) {
      link.send({ t: 'wifi_list?' });
      link.send({ t: 'wifi_scan?' });
    }
    return off;
  }, [wrist.connected]);

  const save = async () => {
    // Names are sent exactly as the wrist saw them. Spaces at the ends are real.
    const name = ssid;
    setAdd('waiting');
    setMessage(null);
    const reply = link.waitFor((m) => m.t === 'wifi_added' || m.t === 'wifi_add_reject', 60000);
    if (!link.send({ t: 'wifi_add', ssid: name, pass })) {
      setAdd('failed');
      setMessage('Lost the hub. Nothing was sent.');
      return;
    }
    try {
      const m = await reply;
      if (m.t === 'wifi_added') {
        setAdd('saved');
        setMessage(`Saved ${name}. The wrist joins it whenever it is in range.`);
        setSsid('');
        setPass('');
        void success();
        link.send({ t: 'wifi_list?' });
      } else {
        setAdd('rejected');
        setMessage(m.reason === 'user' ? 'You pressed B on the wrist, so it was not saved.' : 'The wrist refused that network name or password.');
        void warn();
      }
    } catch {
      setAdd('failed');
      setMessage('The wrist did not answer. Nothing was saved.');
      void warn();
    }
  };

  const net = wrist.ssid ? `, ${wrist.ssid.trim()}` : '';
  const link_ = !wrist.connected
    ? 'offline'
    : wrist.via === 'ble'
      ? 'Bluetooth'
      : wrist.via === 'relay'
      ? `Internet relay${net}`
      : wrist.via === 'wifi'
        ? `Local WiFi${net}`
        : 'USB cable';

  return (
    <Screen scroll edges={['top', 'bottom']}>
      <TopBar left={{ label: 'Close', onPress: () => router.back() }} />
      <Txt size={32} weight="bold" lineHeight={36}>
        Wrist
      </Txt>

      <View style={styles.facts}>
        <Fact label="Status" value={status.text} mono={false} color={status.color} />
        <Fact label="Connected by" value={link_} mono={false} />
        <Fact label="Device" value={wrist.id ?? 'unknown'} />
        <Fact label="Battery" value={wrist.connected ? `${wrist.battery}%` : 'unknown'} />
      </View>

      <View style={styles.section}>
        <Txt size={15} weight="medium" color={colors.muted}>
          Another device
        </Txt>
        <Txt size={14} color={colors.faint}>
          Add a second stick. Every approval then needs both, and they sign together by infrared.
        </Txt>
        <Button label="Connect another device" variant="secondary" onPress={() => router.push('/vault')} />
      </View>

      <View style={styles.section}>
        <Txt size={15} weight="medium" color={colors.muted}>
          Saved networks
        </Txt>
        {networks === null ? (
          <Txt size={15} color={colors.faint} style={styles.row}>
            {wrist.connected ? 'Asking the wrist' : 'Connect the wrist to see its networks.'}
          </Txt>
        ) : networks.length === 0 ? (
          <Txt size={15} color={colors.faint} style={styles.row}>
            None yet. Add the network this laptop is on.
          </Txt>
        ) : (
          networks.map((n) => (
            <View key={n} style={styles.net}>
              <Txt size={16}>{n}</Txt>
              {wrist.ssid === n ? (
                <Txt size={13} color={colors.muted}>
                  connected
                </Txt>
              ) : null}
            </View>
          ))
        )}
      </View>

      <View style={styles.section}>
        <Txt size={15} weight="medium" color={colors.muted}>
          Add a network
        </Txt>
        <Txt size={14} color={colors.faint}>
          It has to be 2.4 GHz and the same network as the laptop running the hub. The wrist asks you to press A
          before it saves anything.
        </Txt>
        {nearby === null ? (
          <Txt size={14} color={colors.faint}>
            {wrist.connected ? 'Looking for networks near the wrist' : 'Connect the wrist to see nearby networks.'}
          </Txt>
        ) : (
          <View style={styles.nearby}>
            {nearby.map((n) => {
              const on = n.ssid === ssid;
              return (
                <Pressable
                  key={n.ssid}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  onPress={() => {
                    void tap();
                    setSsid(n.ssid);
                  }}
                  style={[styles.pick, on && styles.pickOn]}
                >
                  <Txt size={15} weight="medium" color={on ? colors.onFill : colors.text}>
                    {n.ssid.trim() || '(no name)'}
                  </Txt>
                </Pressable>
              );
            })}
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                void tap();
                setNearby(null);
                link.send({ t: 'wifi_scan?' });
              }}
              style={styles.pick}
            >
              <Txt size={15} color={colors.muted}>
                Scan again
              </Txt>
            </Pressable>
          </View>
        )}
        <TextInput
          value={ssid}
          onChangeText={setSsid}
          placeholder="Or type the network name"
          placeholderTextColor={colors.faint}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={32}
          style={styles.input}
        />
        <TextInput
          value={pass}
          onChangeText={setPass}
          placeholder="Password"
          placeholderTextColor={colors.faint}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          maxLength={63}
          style={styles.input}
        />
        {message ? (
          <Txt size={14} color={add === 'saved' ? colors.text : colors.red}>
            {message}
          </Txt>
        ) : null}
        {add === 'waiting' ? (
          <Txt size={15} color={colors.amber}>
            Press A on the wrist to save {ssid}.
          </Txt>
        ) : (
          <Button
            label="Send to the wrist"
            onPress={() => void save()}
            disabled={!wrist.connected || ssid.length === 0 || (pass.length > 0 && pass.length < 8)}
          />
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  facts: { marginTop: space.l },
  section: { marginTop: space.xl, gap: space.s },
  row: { paddingVertical: space.s },
  net: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  nearby: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  pick: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: radius.m, borderWidth: 1, borderColor: colors.line },
  pickOn: { backgroundColor: colors.text, borderColor: colors.text },
  input: {
    fontFamily: fonts.mono,
    fontSize: 16,
    color: colors.text,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.panel,
  },
});
