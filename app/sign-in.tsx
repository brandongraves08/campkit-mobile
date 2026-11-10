import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { Link, router } from 'expo-router';
import { useSession } from '../src/auth/session-context';

export default function SignInScreen() {
  const { session, signIn, error } = useSession();
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (session) router.replace('/households'); }, [session]);
  async function onSignIn() { setBusy(true); await signIn(); setBusy(false); }
  return <SafeAreaView style={styles.page}>
    <View style={styles.content}>
      <Text style={styles.brand}>CampKit</Text><Text style={styles.title}>Pack for the good days.</Text>
      <Text style={styles.copy}>Sign in to choose a household and get your trip ready. Your member account is opened securely in your browser.</Text>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <Pressable accessibilityRole="button" disabled={busy} onPress={onSignIn} style={styles.button}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Continue in browser</Text>}
      </Pressable>
      <Link href="/" style={styles.back}>Back</Link>
    </View>
  </SafeAreaView>;
}
const styles = StyleSheet.create({ page: { flex: 1, backgroundColor: '#F7F5EF' }, content: { flex: 1, justifyContent: 'center', padding: 28 }, brand: { color: '#1F5A43', fontWeight: '700', fontSize: 17 }, title: { color: '#182D3A', fontSize: 30, lineHeight: 37, fontWeight: '700', marginTop: 20 }, copy: { color: '#52636A', fontSize: 16, lineHeight: 24, marginTop: 12 }, button: { minHeight: 54, marginTop: 30, backgroundColor: '#1F5A43', borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' }, error: { color: '#9E3028', marginTop: 18 }, back: { color: '#52636A', textAlign: 'center', marginTop: 20 } });
