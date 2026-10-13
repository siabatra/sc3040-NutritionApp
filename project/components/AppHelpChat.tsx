import { useContext, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { MessageCircle, Send, X } from 'lucide-react-native';
import Constants from 'expo-constants';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../firebaseConfig';
import { ThemeContext } from '../context/ThemeContext';

type Message = { role: 'user' | 'assistant'; content: string };
function endpoint() {
  if (process.env.EXPO_PUBLIC_CHATBOT_URL) return process.env.EXPO_PUBLIC_CHATBOT_URL.replace(/\/$/, '');
  const host = Platform.OS === 'web' ? window.location.hostname : Constants.expoConfig?.hostUri?.split(':')[0];
  return `http://${host || (Platform.OS === 'android' ? '10.0.2.2' : 'localhost')}:4001`;
}

export default function AppHelpChat() {
  const { isDark } = useContext(ThemeContext);
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [signedIn, setSignedIn] = useState(Boolean(auth.currentUser));
  const scroll = useRef<ScrollView>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, user => {
      request.current?.abort(); request.current = null; setSignedIn(Boolean(user)); setMessages([]); setInput(''); setError(''); setBusy(false); setOpen(false);
    });
    return () => { unsubscribe(); request.current?.abort(); };
  }, []);
  const bg = isDark ? '#17212b' : '#ffffff';
  const ink = isDark ? '#f1f5f9' : '#17212b';
  async function send(question = input, retry = false) {
    if (busy || request.current || !question.trim() || !auth.currentUser) return;
    const user = auth.currentUser;
    const next: Message[] = retry ? messages : [...messages, { role: 'user', content: question.trim() }];
    setMessages(next); setInput(''); setError(''); setBusy(true);
    const controller = new AbortController(); request.current = controller;
    const timeout = setTimeout(() => controller.abort(), 55000);
    try {
      const token = await user.getIdToken();
      const response = await fetch(`${endpoint()}/api/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ messages: next.slice(-12) }), signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to answer. Please try again.');
      if (typeof data.answer !== 'string' || !data.answer.trim()) throw new Error('No answer was received. Please try again.');
      if (auth.currentUser?.uid === user.uid && request.current === controller) setMessages([...next, { role: 'assistant', content: data.answer }]);
    } catch (err) {
      const connectionError = err instanceof Error && (err.name === 'AbortError' || /failed to fetch|network request failed|load failed|fetch failed/i.test(err.message));
      if (auth.currentUser?.uid === user.uid && request.current === controller) setError(err instanceof Error && !connectionError ? err.message : 'Cannot reach app help. Start npm run dev and check the chatbot server address or your connection.');
    } finally {
      clearTimeout(timeout);
      if (request.current === controller) { request.current = null; setBusy(false); }
    }
  }
  if (!signedIn) return null;
  return <>
    <TouchableOpacity accessibilityRole="button" accessibilityLabel="Open MealCare app help" onPress={() => setOpen(true)} style={[styles.launcher, { top: Math.max(insets.top, 32) + 8 }]}>
      <MessageCircle size={22} color="white" />
    </TouchableOpacity>
    <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)} transparent>
      <View style={styles.backdrop}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.panel, { backgroundColor: bg, paddingBottom: Math.max(insets.bottom, 12), marginTop: insets.top + 20 }]}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}><Text style={[styles.title, { color: ink }]}>MealCare Help</Text><Text style={{ color: isDark ? '#b7c7d7' : '#526477' }}>Powered by OpenAI</Text></View>
            <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={() => { setMessages([]); setError(''); }} style={styles.action}><Text style={{ color: '#16a34a' }}>Clear</Text></TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close app help" onPress={() => setOpen(false)} style={styles.action}><X color={ink} size={24} /></TouchableOpacity>
          </View>
          <ScrollView ref={scroll} style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 12 }} keyboardShouldPersistTaps="handled" onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}>
            {messages.length === 0 && <>
              <Text style={{ color: ink }}>Ask how to use MealCare. I can explain features, but cannot access your personal account data. Your messages are sent to OpenAI.</Text>
              {['How do I log a meal?', 'How do I add a planned meal?', 'What does confirmed adherence mean?', 'Why is my analytics unavailable?'].map(q => <TouchableOpacity accessibilityRole="button" key={q} onPress={() => send(q)} style={[styles.bubble, { backgroundColor: isDark ? '#253544' : '#edf7f0' }]}><Text style={{ color: ink }}>{q}</Text></TouchableOpacity>)}
            </>}
            {messages.map((m, i) => <View key={i} style={[styles.bubble, { alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', backgroundColor: m.role === 'user' ? '#168548' : isDark ? '#253544' : '#f1f5f9' }]}><Text selectable style={{ color: m.role === 'user' ? 'white' : ink, lineHeight: 22 }}>{m.content}</Text></View>)}
            {busy && <ActivityIndicator accessibilityLabel="Getting an answer" color="#16a34a" />}
            {!!error && <View><Text accessibilityRole="alert" style={{ color: isDark ? '#ffb4b4' : '#b42318' }}>{error}</Text><TouchableOpacity accessibilityRole="button" onPress={() => send(messages.at(-1)?.content || '', true)} style={styles.action}><Text style={{ color: '#16a34a' }}>Retry</Text></TouchableOpacity></View>}
          </ScrollView>
          <View style={styles.composer}>
            <TextInput accessibilityLabel="Question about MealCare" value={input} onChangeText={setInput} placeholder="Ask about the app…" placeholderTextColor="#788896" maxLength={3000} multiline style={[styles.input, { color: ink, borderColor: isDark ? '#445566' : '#d4dde5' }]} editable={!busy} />
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Send question" disabled={busy || !input.trim()} onPress={() => send()} style={[styles.send, { opacity: busy || !input.trim() ? 0.4 : 1 }]}><Send color="white" size={20} /></TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  </>;
}
const styles = StyleSheet.create({
  launcher: { position: 'absolute', right: 66, width: 40, height: 40, borderRadius: 20, backgroundColor: '#168548', alignItems: 'center', justifyContent: 'center', zIndex: 100, elevation: 8 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end', alignItems: 'center' },
  panel: { width: '100%', maxWidth: 640, height: '85%', borderTopLeftRadius: 20, borderTopRightRadius: 20, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: '#8799aa44' },
  title: { fontSize: 20, fontWeight: '700' },
  action: { padding: 12 },
  bubble: { borderRadius: 14, padding: 12, maxWidth: '95%' },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, padding: 12 },
  input: { flex: 1, borderWidth: 1, borderRadius: 14, padding: 12, maxHeight: 130, minHeight: 46 },
  send: { backgroundColor: '#168548', padding: 14, borderRadius: 24 },
});
