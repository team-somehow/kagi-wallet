import React, { useCallback, useEffect, useState } from 'react';
import { Image, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { TopBar } from '../../components/TopBar';
import { Txt } from '../../components/Txt';
import { Fact } from '../../components/Fact';
import { InterceptaMark } from '../../components/BrandMarks';
import { fmtEth, useChain } from '../../store/chain';
import { MCP_URL } from '../../lib/session';
import { shortAddr } from '../../lib/format';
import { colors, radius, space } from '../../theme';

/** What the agent server returns: this wallet's totals, from Curvegrid MultiBaas Event Queries. */
interface Summary {
  agents: { agent: string; spent: string; payments: number; grantedCap: string | null; raisedTo: string | null; revoked: boolean }[];
  recipients: { to: string; total: string }[];
  approvals: { requested: number; approved: number; declined: number; held: number; blocked: number };
}

async function fetchSummary(account: string): Promise<Summary> {
  const r = await fetch(`${MCP_URL}/api/summary/${account}`);
  if (!r.ok) throw new Error(`The agent server answered ${r.status}.`);
  return (await r.json()) as Summary;
}

/**
 * The owner's spending dashboard. MultiBaas indexes the wallet's events and aggregates them
 * (totals per agent and per recipient); the agent server holds the MultiBaas key and hands the
 * app the result, so no key ships in the app.
 */
export default function Spending() {
  const { info, sessions } = useChain();
  const account = info?.account ? String(info.account) : null;
  const explorer = info?.explorer ?? 'https://sepolia.etherscan.io';
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const settle = useCallback((p: Promise<Summary>) => {
    p.then((d) => {
      setData(d);
      setError(null);
    })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not reach the agent server.'))
      .finally(() => setLoading(false));
  }, []);

  // Pull to refresh.
  const load = () => {
    if (!account) return;
    setLoading(true);
    settle(fetchSummary(account));
  };

  useEffect(() => {
    if (account) settle(fetchSummary(account));
  }, [account, settle]);

  const nameOf = (a: string) => sessions.find((s) => s.address.toLowerCase() === a.toLowerCase())?.name ?? `Agent ${a.slice(2, 6)}`;
  const total = data ? data.agents.reduce((n, a) => n + BigInt(a.spent), 0n) : 0n;
  const payments = data ? data.agents.reduce((n, a) => n + a.payments, 0) : 0;

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.bar}>
        <TopBar title="Spending" />
      </View>
      <ScrollView contentContainerStyle={styles.body} refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} />}>
        {account ? (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel="Indexed and totalled by Curvegrid MultiBaas"
            onPress={() => void Linking.openURL('https://www.curvegrid.com/multibaas')}
            style={styles.source}
          >
            <Txt size={12} color={colors.faint}>
              Indexed and totalled by
            </Txt>
            <View style={styles.sourceRow}>
              <Image source={require('../../../assets/partners/curvegrid.png')} style={styles.curvegrid} resizeMode="contain" />
              <Txt size={13} weight="medium" color={colors.muted}>
                MultiBaas
              </Txt>
            </View>
          </Pressable>
        ) : null}
        {!account ? (
          <Txt size={15} color={colors.muted}>
            Create the wallet on-chain first. Its spending shows up here.
          </Txt>
        ) : error ? (
          <View style={styles.card}>
            <Txt size={15} color={colors.red}>
              {error}
            </Txt>
            <Txt size={14} color={colors.muted}>
              Pull down to try again.
            </Txt>
          </View>
        ) : !data ? (
          <Txt size={15} color={colors.muted}>
            Reading your wallet’s history
          </Txt>
        ) : (
          <>
            <View style={styles.hero}>
              <Txt size={13} color={colors.muted}>
                Agents spent
              </Txt>
              <Txt mono size={36} weight="bold" lineHeight={44}>
                {fmtEth(total)}
              </Txt>
              <Txt size={14} color={colors.muted}>
                in {payments} {payments === 1 ? 'payment' : 'payments'}
              </Txt>
            </View>

            <Section title="By agent">
              {data.agents.length ? (
                data.agents.map((a) => (
                  <View key={a.agent} style={styles.card}>
                    <View style={styles.row}>
                      <Txt size={16} weight="medium">
                        {nameOf(a.agent)}
                      </Txt>
                      <Txt mono size={15}>
                        {fmtEth(BigInt(a.spent))}
                      </Txt>
                    </View>
                    <Fact label="Payments" value={String(a.payments)} />
                    <Fact
                      label="Limit"
                      value={
                        a.raisedTo
                          ? `${fmtEth(BigInt(a.grantedCap ?? '0'))} → ${fmtEth(BigInt(a.raisedTo))}`
                          : a.grantedCap
                            ? fmtEth(BigInt(a.grantedCap))
                            : 'unknown'
                      }
                    />
                    {a.revoked ? <Fact label="Status" value="Revoked" color={colors.red} mono={false} /> : null}
                  </View>
                ))
              ) : (
                <Txt size={14} color={colors.muted}>
                  No agent has a key yet.
                </Txt>
              )}
            </Section>

            <Section title="Top recipients">
              {data.recipients.length ? (
                <View style={styles.card}>
                  {data.recipients.slice(0, 5).map((r) => (
                    <Pressable key={r.to} onPress={() => void Linking.openURL(`${explorer}/address/${r.to}`)} style={styles.row}>
                      <Txt mono size={14} color={colors.blue}>
                        {shortAddr(r.to)}
                      </Txt>
                      <Txt mono size={14}>
                        {fmtEth(BigInt(r.total))}
                      </Txt>
                    </Pressable>
                  ))}
                </View>
              ) : (
                <Txt size={14} color={colors.muted}>
                  No payments yet.
                </Txt>
              )}
            </Section>

            <Section title="Approvals">
              <View style={styles.card}>
                <Fact label="Limit requests" value={String(data.approvals.requested)} />
                <Fact label="Approved on phone and Kagi Wallet" value={String(data.approvals.approved)} />
                <Fact label="Declined" value={String(data.approvals.declined)} />
                <View style={styles.intercepta}>
                  <InterceptaMark size={16} />
                  <Txt size={14} color={colors.muted}>
                    Intercepta held {data.approvals.held}, refused {data.approvals.blocked}
                  </Txt>
                </View>
              </View>
            </Section>

          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Txt size={15} color={colors.muted}>
        {title}
      </Txt>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.ground },
  bar: { paddingHorizontal: space.l, paddingTop: space.m },
  body: { paddingHorizontal: space.l, paddingBottom: space.xl, gap: space.l },
  hero: { marginTop: space.m, gap: 2 },
  section: { gap: space.s },
  card: { backgroundColor: colors.panel, borderRadius: radius.m, padding: space.m, gap: space.s },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  intercepta: { flexDirection: 'row', alignItems: 'center', gap: space.s, marginTop: space.xs },
  source: { flexDirection: 'row', alignItems: 'center', gap: space.s, alignSelf: 'flex-start', marginTop: space.s, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, backgroundColor: colors.panel },
  sourceRow: { flexDirection: 'row', alignItems: 'center', gap: space.s },
  curvegrid: { width: 88, height: 20 },
});
