import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSession } from '../src/auth/session-context';
import { Household } from '../src/api/http';

export default function HouseholdsScreen() {
  const { session, error, listHouseholds, selectHousehold, selectedHousehold, signOut } = useSession();
  const [items, setItems] = useState<Household[]>([]);
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true); setProblem(null);
    try { const [households, active] = await Promise.all([listHouseholds(), selectedHousehold()]); setItems(households); setSelected(active); } catch { setProblem('Households could not be loaded. Check your connection and try again.'); }
    finally { setLoading(false); }
  }, [listHouseholds, selectedHousehold]);
  useEffect(() => { if (!session) router.replace('/sign-in'); else void load(); }, [session, load]);
  async function choose(h: Household) { await selectHousehold(h.id); setSelected(h.id); router.replace('/trips'); }
  async function exit() { try { await signOut(); router.replace('/'); } catch { /* Keep the protected account screen open until secure data is cleared. */ } }
  return <SafeAreaView style={styles.page}><View style={styles.header}><Text style={styles.brand}>CampKit</Text><Pressable accessibilityRole="button" onPress={() => void exit()}><Text style={styles.signout}>Sign out</Text></Pressable></View>
    <Text style={styles.title}>Choose a household</Text><Text style={styles.subtitle}>Trips and packing lists available to your member account.</Text>
    {error ? <Text accessibilityRole="alert" style={styles.copy}>{error}</Text> : null}
    {loading ? <View style={styles.state}><ActivityIndicator color="#1F5A43"/><Text style={styles.copy}>Loading households…</Text></View> : problem ? <View style={styles.state}><Text accessibilityRole="alert" style={styles.copy}>{problem}</Text><Pressable accessibilityRole="button" onPress={() => void load()}><Text style={styles.retry}>Try again</Text></Pressable></View> : items.length === 0 ? <View style={styles.state}><Text style={styles.empty}>No households are available for this account.</Text></View> : items.map((h) => <Pressable key={h.id} accessibilityRole="button" accessibilityState={{ selected: selected === h.id }} onPress={() => void choose(h)} style={[styles.card, selected === h.id && styles.active]}><Text style={styles.household}>{h.name}</Text>{selected === h.id ? <Text style={styles.activeLabel}>Selected</Text> : null}</Pressable>)}
  </SafeAreaView>;
}
const styles = StyleSheet.create({ page: { flex: 1, backgroundColor: '#F7F5EF', padding: 24 }, header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, brand: { color: '#1F5A43', fontSize: 17, fontWeight: '700' }, signout: { color: '#52636A', fontSize: 15, padding: 8 }, title: { color: '#182D3A', fontSize: 28, lineHeight: 34, fontWeight: '700', marginTop: 36 }, subtitle: { color: '#52636A', fontSize: 15, lineHeight: 22, marginTop: 8 }, state: { minHeight: 190, justifyContent: 'center', alignItems: 'center', gap: 14 }, copy: { color: '#52636A', fontSize: 15, textAlign: 'center' }, retry: { color: '#1F5A43', fontWeight: '700', padding: 12 }, empty: { color: '#52636A', fontSize: 16, textAlign: 'center' }, card: { marginTop: 14, minHeight: 68, borderRadius: 14, padding: 18, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2E6E0', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, active: { borderColor: '#1F5A43', borderWidth: 2 }, household: { color: '#182D3A', fontSize: 16, fontWeight: '600' }, activeLabel: { color: '#1F5A43', fontSize: 13, fontWeight: '700' } });
