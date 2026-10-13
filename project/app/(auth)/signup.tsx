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
import { auth } from '../../firebaseConfig';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import axios from 'axios';
import { localServerUrl } from '../../utils/serverUrl';

const SERVER_URL = localServerUrl(process.env.EXPO_PUBLIC_SERVER_URL, 4000);

const SignUpScreen: React.FC = () => {
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [confirmPassword, setConfirmPassword] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');
  
  const [loading, setLoading] = useState<boolean>(false); 

  const doDisplaySignUpFields = () => (
    <>
      <Text style={globalStyles.title}>Create Account</Text>
      <TextInput
        style={globalStyles.inputField}
        placeholder="Email"
        keyboardType="email-address"
        autoCapitalize="none"
        onChangeText={setEmail}
        value={email}
        editable={!loading}
      />
      <TextInput
        style={globalStyles.inputField}
        placeholder="Password"
        secureTextEntry
        onChangeText={setPassword}
        value={password}
        editable={!loading}
      />
      <TextInput
        style={globalStyles.inputField}
        placeholder="Confirm Password"
        secureTextEntry
        onChangeText={setConfirmPassword}
        value={confirmPassword}
        editable={!loading}
      />
      {errorMessage ? <Text style={globalStyles.errorText}>{errorMessage}</Text> : null}
    </>
  );

  const handleSignUp = async () => {
    if (!email.trim() || !password || !confirmPassword) {
      setErrorMessage('Please fill in all fields.');
      return;
    }
    if (password !== confirmPassword) {
      setErrorMessage("Passwords don't match");
      return;
    }
    if (password.length < 6) {
      setErrorMessage("Password must be at least 6 characters long.");
      return;
    }

    setLoading(true);
    setErrorMessage('');

    try {
      await createUserWithEmailAndPassword(auth, email, password);

      try {
        const response = await axios.post(`${SERVER_URL}/send-otp`, {
          email: email,
          purpose: 'signup'
        });

        if (response.data.success) {
          router.push({
            pathname: '/(auth)/otp-verification',
            params: { email: email, purpose: 'signup' }
          });
        } else {
          const serverMsg = response.data.message || 'Failed to send verification email.';
          setErrorMessage(serverMsg);
          Alert.alert("Signup Error", `${serverMsg} Please try signing up again later.`);
        }

      } catch (serverError: any) {
        console.error('Server error sending OTP:', serverError);
        const errMsg = 'Failed to connect to verification server. Please check network and try again.';
        setErrorMessage(errMsg);
        Alert.alert("Network Error", errMsg);
      }

    } catch (authError: any) {
      console.error('Firebase Auth error:', authError);
      if (authError.code === 'auth/email-already-in-use') {
        setErrorMessage('This email address is already registered.');
      } else if (authError.code === 'auth/invalid-email') {
         setErrorMessage('Please enter a valid email address.');
      } else {
        setErrorMessage(authError.message || 'An unexpected error occurred during sign up.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={globalStyles.container}>
      {doDisplaySignUpFields()}
      
      <TouchableOpacity
        onPress={handleSignUp}
        style={[globalStyles.button, loading && styles.buttonDisabled]}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator size="small" color="#ffffff" />
        ) : (
          <Text style={globalStyles.buttonText}>Sign Up</Text>
        )}
      </TouchableOpacity>
      
      <TouchableOpacity 
        onPress={() => router.push('/(auth)/')} 
        disabled={loading}
      >
        <Text style={globalStyles.link}>Already have an account? Log in</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  buttonDisabled: {
    backgroundColor: '#cccccc',
  }
});

export default SignUpScreen;
