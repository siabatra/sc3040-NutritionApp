import { Platform } from 'react-native';
import Constants from 'expo-constants';

export function localServerUrl(override: string | undefined, port: number) {
  if (override) return override.replace(/\/$/, '');
  const host = Platform.OS === 'web' ? window.location.hostname : Constants.expoConfig?.hostUri?.split(':')[0];
  return `http://${host || (Platform.OS === 'android' ? '10.0.2.2' : 'localhost')}:${port}`;
}
