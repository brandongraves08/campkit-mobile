import { Pressable, StyleSheet, Text, View } from 'react-native';
import { TripSummary } from '../trips/trips-service';

interface Props {
  trip: Pick<TripSummary, 'tripId' | 'name' | 'destination' | 'startsOn' | 'endsOn'> & Partial<Pick<TripSummary, 'status'>>; downloaded?: boolean; downloading?: boolean; onDownload?: () => void; onOpen?: () => void;
}
export function TripCard({ trip, downloaded = false, downloading = false, onDownload, onOpen }: Props) {
  return <View style={styles.card}>
    <View style={styles.text}><Text style={styles.name}>{trip.name}</Text><Text style={styles.detail}>{trip.destination ?? 'Destination not set'} · {trip.startsOn ?? 'Date not set'}</Text></View>
    {downloaded ? <Pressable accessibilityRole="button" accessibilityLabel={`Open ${trip.name} offline`} onPress={onOpen} style={styles.button}><Text style={styles.buttonText}>Open offline</Text></Pressable>
      : <Pressable accessibilityRole="button" accessibilityLabel={`Download ${trip.name} for offline use`} disabled={downloading} onPress={onDownload} style={[styles.button, downloading && styles.disabled]}><Text style={styles.buttonText}>{downloading ? 'Downloading…' : 'Download'}</Text></Pressable>}
  </View>;
}
const styles = StyleSheet.create({ card: { borderRadius: 16, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E2E6E0', padding: 16, marginTop: 12, gap: 12 }, text: { gap: 5 }, name: { color: '#182D3A', fontSize: 17, fontWeight: '700' }, detail: { color: '#52636A', fontSize: 14 }, button: { alignSelf: 'flex-start', backgroundColor: '#1F5A43', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 11, minHeight: 44, justifyContent: 'center' }, buttonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' }, disabled: { opacity: 0.6 } });
