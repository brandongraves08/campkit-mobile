import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { PendingOperation } from '../../src/storage/operations-repository';
import { useTrips } from '../../src/trips/trips-context';

export default function ConflictsScreen() {
  const params = useLocalSearchParams<{ operationId: string }>();
  const operationId = Array.isArray(params.operationId) ? params.operationId[0] : params.operationId;
  const service = useTrips();
  const [operation, setOperation] = useState<PendingOperation | null>(null);
  const [serverValue, setServerValue] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const rows = await service.listOperations();
        const current = rows.find((item) => item.id === operationId && item.status === 'conflict');
        if (!current) throw new Error('This conflict is no longer available.');
        const snapshot = await service.getPackingSnapshot(current.tripId);
        const row = snapshot?.packing.find((item) => item.entryId === current.entryId);
        if (!row) throw new Error('This packing row is no longer available.');
        if (active) { setOperation(current); setServerValue(row.packed); }
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : 'Unable to load conflict.'); }
    })();
    return () => { active = false; };
  }, [operationId, service]);
  async function choose(resolution: 'keep_server' | 'apply_local') {
    if (!operation) return;
    setBusy(true); setError(null);
    try { await service.resolveConflict(operation.id, resolution); router.back(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to resolve conflict.'); setBusy(false); }
  }
  return <SafeAreaView style={styles.page}><View style={styles.content}><Text style={styles.kicker}>PACKING CONFLICT</Text><Text style={styles.title}>Choose which value to keep</Text>{operation ? <><Text style={styles.body}>The server has a newer value for this item. No automatic retry was made.</Text><View style={styles.card}><Text style={styles.label}>Server value</Text><Text style={styles.value}>{serverValue ? 'Packed' : 'Not packed'}</Text><Text style={styles.label}>Your value</Text><Text style={styles.value}>{operation.packed ? 'Packed' : 'Not packed'}</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Keep server value" disabled={busy} onPress={() => void choose('keep_server')} style={styles.primary}><Text style={styles.primaryText}>Keep server</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Apply my value" disabled={busy} onPress={() => void choose('apply_local')} style={styles.secondary}><Text style={styles.secondaryText}>Apply my value</Text></Pressable></> : !error ? <ActivityIndicator color="#1F5A43"/> : null}{error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}{busy ? <Text accessibilityRole="summary" style={styles.body}>Saving your choice…</Text> : null}<Pressable accessibilityRole="button" onPress={() => router.back()}><Text style={styles.cancel}>Cancel</Text></Pressable></View></SafeAreaView>;
}
const styles = StyleSheet.create({ page: { flex: 1, backgroundColor: '#F7F5EF', padding: 22 }, content: { flex: 1, justifyContent: 'center', gap: 14 }, kicker: { color: '#1F5A43', fontSize: 12, fontWeight: '800', letterSpacing: 1.3 }, title: { color: '#182D3A', fontSize: 27, lineHeight: 34, fontWeight: '800' }, body: { color: '#52636A', fontSize: 15, lineHeight: 22 }, card: { backgroundColor: '#E7EFE9', borderRadius: 14, padding: 16, gap: 6 }, label: { color: '#52636A', fontSize: 13, fontWeight: '700' }, value: { color: '#182D3A', fontSize: 18, fontWeight: '800', marginBottom: 8 }, primary: { backgroundColor: '#1F5A43', borderRadius: 12, padding: 16, alignItems: 'center' }, primaryText: { color: 'white', fontWeight: '800', fontSize: 16 }, secondary: { borderWidth: 1, borderColor: '#1F5A43', borderRadius: 12, padding: 16, alignItems: 'center' }, secondaryText: { color: '#1F5A43', fontWeight: '800', fontSize: 16 }, cancel: { color: '#52636A', textAlign: 'center', fontWeight: '700', padding: 12 }, error: { color: '#9B312C', fontWeight: '700' } });
