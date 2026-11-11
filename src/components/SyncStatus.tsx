import { StyleSheet, Text, View } from 'react-native';

export function SyncStatus({ downloadedAt }: { downloadedAt: string }) {
  const timestamp = new Date(downloadedAt);
  const readable = Number.isNaN(timestamp.getTime()) ? 'unknown time' : timestamp.toLocaleString();
  return <View accessibilityRole="summary" style={styles.banner}><Text style={styles.title}>Offline copy · may be stale</Text><Text style={styles.detail}>Downloaded {readable}. Packed changes are stored on this device.</Text></View>;
}
const styles = StyleSheet.create({ banner: { backgroundColor: '#E7EFE9', borderRadius: 12, padding: 14, marginTop: 14, gap: 4 }, title: { color: '#1F5A43', fontWeight: '700', fontSize: 14 }, detail: { color: '#405A4A', fontSize: 13, lineHeight: 18 } });
