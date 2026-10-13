import 'react-native-url-polyfill/auto';
import { Platform } from 'react-native';
import { initializeApp } from 'firebase/app';
import {
  getAuth,
  initializeAuth,
  type Auth,
  connectAuthEmulator,
} from '@firebase/auth';
import { getFirestore, initializeFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import ReactNativeAsyncStorage from '@react-native-async-storage/async-storage';

const { getReactNativePersistence } = require('@firebase/auth');

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID
};

const useEmulators = __DEV__ && process.env.EXPO_PUBLIC_USE_FIREBASE_EMULATORS === 'true';
const app = initializeApp(useEmulators ? {
  apiKey: 'demo-api-key', projectId: 'demo-mealcare-analytics',
  authDomain: 'localhost', appId: 'demo-mealcare-analytics',
} : firebaseConfig);

let authInstance: Auth;

if (Platform.OS === 'web') {
  authInstance = getAuth(app);
} else {
  try {
    authInstance = initializeAuth(app, {
      persistence: getReactNativePersistence(ReactNativeAsyncStorage),
    });
  } catch {
    authInstance = getAuth(app);
  }
}

export const auth = authInstance;

export const db =
  Platform.OS === 'web'
    ? getFirestore(app)
    : initializeFirestore(app, {
        experimentalForceLongPolling: true,
      });

if (useEmulators) {
  const host = process.env.EXPO_PUBLIC_FIREBASE_EMULATOR_HOST || '127.0.0.1';
  connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
  connectFirestoreEmulator(db, host, 8080);
}
