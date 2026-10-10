// Full-screen camera used for meal-photo logging and menu capture.
// Flow: camera -> preview -> retake or confirm -> compressed JPEG (base64) passed to onConfirm.
import React, { useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, Image, ActivityIndicator, Platform } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { X, RotateCcw, Check } from 'lucide-react-native';

// Claude downsizes larger images anyway, so this keeps uploads small and fast.
const MAX_WIDTH = 1280;

interface PhotoCaptureModalProps {
  visible: boolean;
  title: string;
  hint?: string;
  onCancel: () => void;
  onConfirm: (imageBase64: string) => void;
}

const PhotoCaptureModal: React.FC<PhotoCaptureModalProps> = ({ visible, title, hint, onCancel, onConfirm }) => {
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [preview, setPreview] = useState<{ uri: string; base64: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setPreview(null);
    setError(null);
    onCancel();
  };

  const takePicture = async () => {
    if (!cameraRef.current || busy) return;
    setBusy(true);
    setError(null);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 1 });
      const context = ImageManipulator.manipulate(photo.uri);
      if (photo.width > MAX_WIDTH) {
        context.resize({ width: MAX_WIDTH });
      }
      const image = await context.renderAsync();
      const result = await image.saveAsync({ compress: 0.7, format: SaveFormat.JPEG, base64: true });
      if (!result.base64) throw new Error('No image data');
      setPreview({ uri: result.uri, base64: result.base64 });
    } catch (err) {
      console.error('Photo capture failed:', err);
      setError('Could not take the photo. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const confirm = () => {
    if (!preview) return;
    const { base64 } = preview;
    setPreview(null);
    onConfirm(base64);
  };

  const renderBody = () => {
    if (!permission) {
      return <ActivityIndicator size="large" color="#2ecc71" style={styles.centered} />;
    }
    if (!permission.granted) {
      return (
        <View style={styles.centered}>
          <Text style={styles.message}>Camera access is needed to take a photo.</Text>
          {permission.canAskAgain ? (
            <TouchableOpacity style={styles.primaryButton} onPress={requestPermission}>
              <Text style={styles.primaryButtonText}>Allow Camera</Text>
            </TouchableOpacity>
          ) : (
            <Text style={styles.message}>Please enable camera access in your device settings.</Text>
          )}
        </View>
      );
    }
    if (preview) {
      return (
        <>
          <Image source={{ uri: preview.uri }} style={styles.camera} resizeMode="contain" />
          <View style={styles.controls}>
            <TouchableOpacity style={styles.secondaryButton} onPress={() => setPreview(null)}>
              <RotateCcw size={20} color="#fff" />
              <Text style={styles.secondaryButtonText}>Retake</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.primaryButton} onPress={confirm}>
              <Check size={20} color="#fff" />
              <Text style={styles.primaryButtonText}>Use Photo</Text>
            </TouchableOpacity>
          </View>
        </>
      );
    }
    return (
      <>
        <CameraView ref={cameraRef} style={styles.camera} facing="back" />
        {hint && <Text style={styles.hint}>{hint}</Text>}
        {error && <Text style={styles.error}>{error}</Text>}
        <View style={styles.controls}>
          <TouchableOpacity style={styles.shutter} onPress={takePicture} disabled={busy}>
            {busy ? <ActivityIndicator color="#2ecc71" /> : <View style={styles.shutterInner} />}
          </TouchableOpacity>
        </View>
      </>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close}>
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={close} style={styles.closeButton}>
            <X size={26} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.title}>{title}</Text>
          <View style={styles.closeButton} />
        </View>
        {renderBody()}
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 50 : 30,
    paddingBottom: 12,
  },
  closeButton: {
    width: 32,
  },
  title: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  camera: {
    flex: 1,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  message: {
    color: '#fff',
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 16,
  },
  hint: {
    color: '#ddd',
    textAlign: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  error: {
    color: '#ff6b6b',
    textAlign: 'center',
    paddingVertical: 4,
  },
  controls: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 24,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
    gap: 16,
  },
  shutter: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 4,
    borderColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  shutterInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#fff',
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2ecc71',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 20,
    gap: 8,
  },
  primaryButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#444',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 20,
    gap: 8,
  },
  secondaryButtonText: {
    color: '#fff',
    fontSize: 16,
  },
});

export default PhotoCaptureModal;
