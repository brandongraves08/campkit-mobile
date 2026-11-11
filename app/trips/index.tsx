import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { TripCard } from '../../src/components/TripCard';
import { TripSnapshotSummary } from '../../src/storage/trips-repository';
import { TripSummary } from '../../src/trips/trips-service';
import { useTrips } from '../../src/trips/trips-context';

export default function TripsScreen() {
  const tripsService = useTrips();
  const [online, setOnline] = useState<TripSummary[]>([]);
  const [downloaded, setDownloaded] = useState<TripSnapshotSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [onlineError, setOnlineError] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloadedNow, setDownloadedNow] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true); setOnlineError(false); setDownloadError(null);
    const [tripsResult, cachedResult] = await Promise.allSettled([tripsService.refreshTrips(), tripsService.getDownloadedTrips()]);
    if (tripsResult.status === 'fulfilled') setOnline(tripsResult.value); else { setOnline([]); setOnlineError(true); }
    if (cachedResult.status === 'fulfilled') setDownloaded(cachedResult.value); else { setDownloaded([]); setDownloadError('Downloaded trips could not be opened from secure storage.'); }
    setLoading(false);
  }, [tripsService]);
  useEffect(() => { void load(); }, [load]);

  async function download(trip: TripSummary) {
    setDownloading(trip.tripId); setDownloadError(null);
    try {
      const saved = await tripsService.downloadTrip(trip.tripId);
      setDownloaded((items) => [{ tripId: saved.tripId, name: saved.name, destination: saved.destination ?? null, startsOn: saved.startsOn, endsOn: saved.endsOn, snapshotAt: saved.snapshotAt, downloadedAt: saved.downloadedAt, version: saved.version }, ...items.filter((item) => item.tripId !== saved.tripId)]);
      setDownloadedNow((items) => [...items.filter((id) => id !== trip.tripId), trip.tripId]);
    } catch {
      setDownloadError(`Download failed for ${trip.name}. Check your connection and try again.`);
    } finally { setDownloading(null); }
  }
  const cached = new Set(downloaded.map((trip) => trip.tripId));
  const showOfflineEmpty = onlineError && downloaded.length === 0;
  return <SafeAreaView style={styles.page}><View style={styles.header}><Text style={styles.brand}>CampKit</Text><Text style={styles.kicker}>YOUR GEAR, READY</Text></View>
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.title}>Trips</Text><Text style={styles.subtitle}>Download a packing list before you head out. Your saved trips stay available offline.</Text>
      {loading ? <View style={styles.state}><ActivityIndicator color="#1F5A43" size="large"/><Text style={styles.body}>Loading trips…</Text></View> : <>
        {onlineError ? <View style={styles.notice}><Text accessibilityRole="alert" style={styles.body}>Trips could not be refreshed. Showing any saved downloads.</Text><Pressable accessibilityRole="button" onPress={() => void load()}><Text style={styles.retry}>Try again</Text></Pressable></View> : null}
        {downloadError ? <Text accessibilityRole="alert" style={styles.error}>{downloadError}</Text> : null}
        <Text style={styles.section}>Downloaded trips</Text>
        {downloaded.length ? downloaded.map((trip) => <View key={trip.tripId}><TripCard trip={trip} downloaded onOpen={() => router.push(`/trips/${trip.tripId}` as never)}/>{downloadedNow.includes(trip.tripId) ? <Text style={styles.success}>Downloaded for offline use</Text> : <Text style={styles.timestamp}>Saved {new Date(trip.downloadedAt).toLocaleString()}</Text>}</View>) : <View style={styles.empty}><Text style={styles.emptyTitle}>{showOfflineEmpty ? 'No trips are downloaded yet' : 'Nothing saved offline yet'}</Text><Text style={styles.body}>Download a trip while connected and it will be ready when service is limited.</Text></View>}
        {!onlineError ? <><Text style={styles.section}>Online trips</Text>{online.filter((trip) => !cached.has(trip.tripId)).length ? online.filter((trip) => !cached.has(trip.tripId)).map((trip) => <TripCard key={trip.tripId} trip={trip} downloading={downloading === trip.tripId} onDownload={() => void download(trip)}/>) : <Text style={styles.body}>{online.length ? 'All available trips are downloaded.' : 'No trips are available for this household.'}</Text>}</> : null}
      </>}
    </ScrollView>
  </SafeAreaView>;
}
const styles = StyleSheet.create({ page: { flex: 1, backgroundColor: '#F7F5EF', paddingHorizontal: 22 }, header: { paddingTop: 10, paddingBottom: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, brand: { color: '#1F5A43', fontSize: 17, fontWeight: '800' }, kicker: { color: '#52636A', fontSize: 11, letterSpacing: 1.2, fontWeight: '700' }, content: { paddingBottom: 36 }, title: { color: '#182D3A', fontSize: 30, lineHeight: 36, fontWeight: '800', marginTop: 24 }, subtitle: { color: '#52636A', fontSize: 15, lineHeight: 22, marginTop: 7, marginBottom: 8 }, section: { color: '#182D3A', fontSize: 19, fontWeight: '700', marginTop: 26 }, body: { color: '#52636A', fontSize: 15, lineHeight: 22 }, state: { minHeight: 190, justifyContent: 'center', alignItems: 'center', gap: 14 }, notice: { backgroundColor: '#F1EAD9', borderRadius: 12, padding: 14, marginTop: 18, gap: 6 }, retry: { color: '#1F5A43', fontWeight: '700', paddingVertical: 8 }, error: { color: '#9B312C', marginTop: 12, fontWeight: '600' }, empty: { marginTop: 12, borderRadius: 14, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E2E6E0', padding: 18, gap: 5 }, emptyTitle: { color: '#182D3A', fontSize: 16, fontWeight: '700' }, success: { color: '#1F5A43', fontWeight: '700', marginTop: 7 }, timestamp: { color: '#52636A', fontSize: 13, marginTop: 7 } });
