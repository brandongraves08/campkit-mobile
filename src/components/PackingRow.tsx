import { Switch, StyleSheet, Text, View } from 'react-native';
import { PackingRowSnapshot } from '../storage/trips-repository';

export function PackingRow({ row, onChange, disabled = false }: { row: PackingRowSnapshot; onChange: (packed: boolean) => void; disabled?: boolean }) {
  return <View style={styles.row}><View style={styles.label}><Text style={styles.name}>{row.label}</Text>{row.quantity ? <Text style={styles.quantity}>Quantity {row.quantity}</Text> : null}</View><Switch accessibilityRole="checkbox" accessibilityLabel={row.label} value={row.packed} disabled={disabled} onValueChange={onChange} trackColor={{ false: '#C8D0C9', true: '#1F5A43' }} thumbColor="#FFFFFF" /></View>;
}
const styles = StyleSheet.create({ row: { minHeight: 68, borderBottomWidth: 1, borderBottomColor: '#E2E6E0', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 10 }, label: { flex: 1, gap: 4 }, name: { color: '#182D3A', fontSize: 16, fontWeight: '600' }, quantity: { color: '#52636A', fontSize: 13 } });
