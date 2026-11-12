import { useCallback, useEffect, useState } from 'react';
import { AppState, ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { PackingRow } from '../../src/components/PackingRow';
import { SyncStatus } from '../../src/components/SyncStatus';
import { TripSnapshot } from '../../src/storage/trips-repository';
import { PendingOperation } from '../../src/storage/operations-repository';
import { onConnectionRestored, onForeground } from '../../src/sync/connectivity';
import { useTrips } from '../../src/trips/trips-context';

export default function TripScreen() {
  const { tripId: rawTripId } = useLocalSearchParams<{ tripId: string }>();
  const tripId = Array.isArray(rawTripId) ? rawTripId[0] : rawTripId;
  const service = useTrips();
  const [trip, setTrip] = useState<TripSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [saveError, setSaveError] = useState(false);
  const [operations, setOperations] = useState<PendingOperation[]>([]);
  const refreshQueue = useCallback(async () => { try { setOperations(await service.listOperations()); } catch { /* account/session may be changing */ } }, [service]);
  const sync = useCallback(async () => { try { await service.syncPendingOperations(); } finally { await refreshQueue(); } }, [refreshQueue, service]);
  const load = useCallback(async () => {
    setLoading(true); setProblem(null);
    try {
      if (!tripId) throw new Error('missing trip');
      const saved = await service.getPackingSnapshot(tripId);
      if (!saved) throw new Error('not downloaded');
      setTrip(saved);
    } catch { setProblem('This trip is not downloaded on this device. Connect and download it from Trips first.'); }
    finally { setLoading(false); }
  }, [service, tripId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    void sync();
    const wake = () => { if (AppState.currentState === 'active') void sync(); };
    const appStateSubscription = onForeground(wake);
    const networkSubscription = onConnectionRestored(wake);
    return () => { appStateSubscription.remove(); networkSubscription.remove(); };
  }, [sync]);
  async function changePacked(entryId: string, packed: boolean) {
    if (!trip) return;
    setSaving(entryId); setSaveError(false);
    try {
      const pending = await service.setPacked(trip.tripId, entryId, packed);
      setTrip({ ...trip, packing: trip.packing.map((row) => row.entryId === entryId ? { ...row, packed } : row) });
      setOperations((current) => [...current.filter((item) => item.id !== pending.id), pending]);
    } catch { setSaveError(true); }
    finally { setSaving(null); }
  }
  return <SafeAreaView style={styles.page}><View style={styles.header}><Pressable accessibilityRole="button" onPress={() => router.back()}><Text style={styles.back}>‹ Trips</Text></Pressable><Text style={styles.brand}>CampKit</Text></View>
    <ScrollView contentContainerStyle={styles.content}>
      {loading ? <View style={styles.state}><ActivityIndicator color="#1F5A43" size="large"/><Text style={styles.body}>Opening downloaded trip…</Text></View> : problem ? <View style={styles.state}><Text accessibilityRole="alert" style={styles.body}>{problem}</Text><Pressable accessibilityRole="button" onPress={() => void load()}><Text style={styles.retry}>Try again</Text></Pressable></View> : trip ? <>
        <Text style={styles.kicker}>PACKING LIST</Text><Text style={styles.title}>{trip.name}</Text><Text style={styles.subtitle}>{trip.destination ?? 'Destination not set'} · {trip.startsOn}</Text>
        <SyncStatus downloadedAt={trip.downloadedAt}/>
        {operations.filter((operation) => operation.tripId === trip.tripId && operation.status === 'pending').map((operation) => <Text key={operation.id} accessibilityRole="summary" style={styles.pending}>Pending sync · {operation.packed ? 'Packed' : 'Not packed'}</Text>)}
        {operations.filter((operation) => operation.tripId === trip.tripId && operation.status === 'conflict').map((operation) => <View key={operation.id} style={styles.notice}><Text style={styles.noticeTitle}>Packing changed elsewhere</Text><Text style={styles.body}>Server: {trip.packing.find((row) => row.entryId === operation.entryId)?.packed ? 'Packed' : 'Not packed'} · Your value: {operation.packed ? 'Packed' : 'Not packed'}</Text><Pressable accessibilityRole="button" accessibilityLabel="Resolve packing conflict" onPress={() => router.push({ pathname: '/trips/conflicts', params: { operationId: operation.id } })}><Text style={styles.retry}>Review choices</Text></Pressable></View>)}
        {operations.filter((operation) => operation.tripId === trip.tripId && operation.status === 'needs_attention').map((operation) => <View key={operation.id} style={styles.notice}><Text accessibilityRole="alert" style={styles.error}>Needs attention · {operation.errorCode === 'not_found' ? 'This item is unavailable or access may have changed.' : operation.errorCode === 'trip_read_only' ? 'This trip is read-only.' : 'This change could not be safely synced.'}</Text><Pressable accessibilityRole="button" accessibilityLabel="Discard unsyncable packing change" onPress={async () => { await service.discardOperation(operation.id); await refreshQueue(); }}><Text style={styles.retry}>Discard change</Text></Pressable></View>)}
        {saveError ? <Text accessibilityRole="alert" style={styles.error}>Your change was not saved. Please try again.</Text> : null}
        <Text style={styles.section}>Gear · {trip.packing.length}</Text>
        {trip.packing.length ? trip.packing.map((row) => <PackingRow key={row.entryId} row={row} disabled={saving === row.entryId} onChange={(packed) => void changePacked(row.entryId, packed)}/>) : <Text style={styles.body}>This trip has no packing items yet.</Text>}
      </> : null}
    </ScrollView>
  </SafeAreaView>;
}
const styles = StyleSheet.create({ page: { flex: 1, backgroundColor: '#F7F5EF', paddingHorizontal: 22 }, header: { height: 54, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, back: { color: '#1F5A43', fontSize: 16, fontWeight: '700', paddingVertical: 10, paddingRight: 12 }, brand: { color: '#1F5A43', fontSize: 16, fontWeight: '800' }, content: { paddingBottom: 32 }, kicker: { color: '#1F5A43', fontSize: 12, letterSpacing: 1.3, fontWeight: '800', marginTop: 18 }, title: { color: '#182D3A', fontSize: 29, lineHeight: 35, fontWeight: '800', marginTop: 8 }, subtitle: { color: '#52636A', fontSize: 15, marginTop: 6 }, section: { color: '#182D3A', fontSize: 19, fontWeight: '700', marginTop: 28, marginBottom: 8 }, body: { color: '#52636A', fontSize: 15, lineHeight: 22, textAlign: 'center' }, state: { minHeight: 250, justifyContent: 'center', alignItems: 'center', gap: 14 }, retry: { color: '#1F5A43', fontWeight: '700', padding: 12 }, error: { color: '#9B312C', fontWeight: '600', marginTop: 12 }, pending: { color: '#52636A', fontSize: 13, fontWeight: '700', marginTop: 12 }, notice: { backgroundColor: '#FFF1D6', borderRadius: 12, padding: 14, marginTop: 12, gap: 6 }, noticeTitle: { color: '#704B12', fontSize: 15, fontWeight: '800' } });
