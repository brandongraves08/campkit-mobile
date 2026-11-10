import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function HomeScreen() {
  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.content}>
        <View style={styles.brandMark} accessibilityElementsHidden>
          <Text style={styles.brandMarkText}>C</Text>
        </View>
        <Text style={styles.brand}>CampKit</Text>
        <Text style={styles.tagline}>Your trips, ready for camp.</Text>

        <View style={styles.statusCard}>
          <View style={styles.signedOutPill}>
            <Text accessibilityLabel="Sign-in status" style={styles.signedOutText}>
              Signed out
            </Text>
          </View>
          <ActivityIndicator color="#1F5A43" size="small" />
          <Text accessibilityLabel="App loading status" style={styles.loadingText}>
            Loading your trips
          </Text>
        </View>
      </View>
      <Text style={styles.footer}>PACK LIGHT. GO FAR.</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F7F5EF',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
  },
  brandMark: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: '#1F5A43',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  brandMarkText: {
    color: '#FFFFFF',
    fontSize: 30,
    fontWeight: '700',
  },
  brand: {
    color: '#182D3A',
    fontSize: 30,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  tagline: {
    color: '#52636A',
    fontSize: 16,
    marginTop: 8,
  },
  statusCard: {
    width: '100%',
    maxWidth: 340,
    minHeight: 144,
    marginTop: 44,
    padding: 24,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    shadowColor: '#182D3A',
    shadowOpacity: 0.06,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  signedOutPill: {
    borderRadius: 99,
    backgroundColor: '#EEF2EC',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  signedOutText: {
    color: '#1F5A43',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  loadingText: {
    color: '#52636A',
    fontSize: 15,
  },
  footer: {
    alignSelf: 'center',
    color: '#78837F',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginBottom: 14,
  },
});
