import React, { useState } from 'react';
import { 
  View, 
  Text, 
  TextInput, 
  TouchableOpacity, 
  StyleSheet, 
  ActivityIndicator,
  Alert
} from 'react-native';
import { router } from 'expo-router';
import globalStyles from '../styles/globalStyles';
import axios from 'axios';
import { localServerUrl } from '../../utils/serverUrl';

const SERVER_URL = localServerUrl(process.env.EXPO_PUBLIC_SERVER_URL, 4000);

const ForgotPasswordScreen: React.FC = () => {
  const [email, setEmail] = useState<string>('');
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [isError, setIsError] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);

  const doDisplayPasswordResetOptions = () => (
    <>
      <Text style={globalStyles.title}>Reset Password</Text>
      <Text style={globalStyles.subtitle}>Enter your email to receive a verification code</Text>
      <TextInput
        style={globalStyles.inputField}
        placeholder="Enter your registered email"
        keyboardType="email-address"
        autoCapitalize="none"
        onChangeText={(text) => { setEmail(text); setStatusMessage(''); }}
        value={email}
        editable={!loading}
      />
      {statusMessage ? (
        <Text style={isError ? globalStyles.errorText : styles.successText}>
          {statusMessage}
        </Text>
      ) : null}
    </>
  );

  const handleSendOtpRequest = async () => {
    if (!email.trim()) {
      setStatusMessage('Please enter your email address.');
      setIsError(true);
      return;
    }
     if (!/\S+@\S+\.\S+/.test(email)) {
       setStatusMessage('Please enter a valid email format.');
       setIsError(true);
       return;
     }

    setLoading(true);
    setStatusMessage('');
    setIsError(false);

    try {
      const response = await axios.post(`${SERVER_URL}/send-otp`, {
        email: email,
        purpose: 'reset'
      });

      if (response.data.success) {
        setStatusMessage('Verification code sent. Please check your email.');
        setIsError(false);
        router.push({
          pathname: '/(auth)/otp-verification',
          params: { email: email, purpose: 'reset' } 
        });
      } else {
        const serverMsg = response.data.message || 'Failed to send verification code.';
        setStatusMessage(serverMsg);
        setIsError(true);
        Alert.alert("Error", serverMsg);
      }
    } catch (error: any) {
      console.error('Error requesting password reset OTP:', error);
      const errMsg = 'Failed to connect to the server. Please check network.';
      setStatusMessage(errMsg);
      setIsError(true);
      Alert.alert("Network Error", errMsg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={globalStyles.container}>
      {doDisplayPasswordResetOptions()}
      <TouchableOpacity 
        onPress={handleSendOtpRequest} 
        style={[globalStyles.button, loading && styles.buttonDisabled]}
        disabled={loading}
      >
         {loading ? (
          <ActivityIndicator size="small" color="#ffffff" />
        ) : (
           <Text style={globalStyles.buttonText}>Send Verification Code</Text>
        )}
      </TouchableOpacity>
      <TouchableOpacity onPress={() => router.push('/(auth)/login')} disabled={loading}>
        <Text style={[globalStyles.link, loading && styles.linkDisabled]}>Back to Login</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  successText: {
    color: '#2ecc71',
    marginVertical: 8,
    textAlign: 'center',
    fontWeight: '500',
  },
  buttonDisabled: {
    backgroundColor: '#cccccc',
  },
   linkDisabled: {
      color: '#aaaaaa', 
  }
});

export default ForgotPasswordScreen;
