// Meal Logging Screen (app/(app)/meal-logging.tsx)
import React, { useState, useEffect, useContext, useRef } from 'react';
import { 
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Alert, ActivityIndicator, Switch, Platform, Modal, Animated 
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { auth, db } from '../../firebaseConfig';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { ArrowLeft, Save, Calendar, Check, Camera, X } from 'lucide-react-native';
import { ThemeContext } from '../../context/ThemeContext';
import { fetchNutritionForFood } from '../../utils/nutritionApi';
import { analyzeMealPhoto, AiServiceError } from '../../utils/claudeApi';
import PhotoCaptureModal from '../../components/PhotoCaptureModal';

// A food detected in a meal photo, with string fields so the user can edit them.
interface PhotoFoodItem {
  name: string;
  servingDescription: string;
  estimatedGrams: number;
  calories: string;
  protein: string;
  carbs: string;
  fat: string;
  confidence: 'high' | 'medium' | 'low';
}

const MACRO_KEYS = ['calories', 'protein', 'carbs', 'fat'] as const;

const isValidAmount = (value: string) => value.trim() !== '' && Number.isFinite(Number(value)) && Number(value) >= 0;

// For web platform compatibility, provide a DateTimePicker alternative
const DateTimePickerWeb = ({ value, onChange, mode }: any) => {
  const { theme } = useContext(ThemeContext);
  const isDark = theme === 'dark';

  return (
    <View style={styles.webDatePicker}>
      <TextInput
        value={value.toLocaleString()}
        editable={false}
        style={[styles.webDatePickerInput, isDark && styles.webDatePickerInputDark]}
      />
      <TouchableOpacity
        style={[styles.webDatePickerButton, isDark && styles.webDatePickerButtonDark]}
        onPress={() => {
          // Increment by 30 minutes as a simple alternative
          const newDate = new Date(value.getTime());
          newDate.setMinutes(newDate.getMinutes() + 30);
          onChange({ type: 'set', nativeEvent: { timestamp: newDate.getTime() } }, newDate);
        }}
      >
        <Text style={styles.webDatePickerButtonText}>+30 min</Text>
      </TouchableOpacity>
    </View>
  );
};

const MealLoggingScreen: React.FC = () => {
  const params = useLocalSearchParams();
  const { theme } = useContext(ThemeContext);
  const isDark = theme === 'dark';
  
  // Initialize states with params or defaults
  const [foodName, setFoodName] = useState(params.foodName as string || '');
  const [calories, setCalories] = useState(params.calories as string || '0');
  const [protein, setProtein] = useState(params.protein as string || '0');
  const [carbs, setCarbs] = useState(params.carbs as string || '0');
  const [fat, setFat] = useState(params.fat as string || '0');
  const [mealDate, setMealDate] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [isCustomLocation, setIsCustomLocation] = useState(params.restaurantId ? false : true);
  const [customLocation, setCustomLocation] = useState('');
  const [loading, setLoading] = useState(false);
  const [fetchingNutrition, setFetchingNutrition] = useState(false);
  const [mealType, setMealType] = useState(params.mealType as string || '');

  // Photo logging (SRS 7.3.2)
  const [showCamera, setShowCamera] = useState(false);
  const [analyzingPhoto, setAnalyzingPhoto] = useState(false);
  const [photoItems, setPhotoItems] = useState<PhotoFoodItem[] | null>(null);
  
  // State for success modal
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const checkScale = useRef(new Animated.Value(0)).current;
  const modalOpacity = useRef(new Animated.Value(0)).current;
  
  const restaurantId = params.restaurantId as string;
  const restaurantName = params.restaurantName as string;
  const restaurantLat = params.latitude ? parseFloat(params.latitude as string) : null;
  const restaurantLng = params.longitude ? parseFloat(params.longitude as string) : null;
  const restaurantAddress = params.address as string;
  
  // Lazy-load the DateTimePicker component only on native platforms
  let DateTimePicker: any;
  if (Platform.OS !== 'web') {
    try {
      // Dynamic import of native components
      DateTimePicker = require('@react-native-community/datetimepicker').default;
    } catch (error) {
      console.error('Failed to load DateTimePicker:', error);
    }
  }
  
  // Fetch nutrition data when food name changes (if not from a restaurant)
  useEffect(() => {
    // Photo results already carry nutrition values; don't overwrite them with a lookup.
    if (photoItems) return;
    if (!restaurantId && foodName.trim().length > 2) {
      const debounceTimer = setTimeout(() => {
        fetchNutritionData(foodName);
      }, 1000);
      
      return () => clearTimeout(debounceTimer);
    }
  }, [foodName, restaurantId, photoItems]);
  
  const fetchNutritionData = async (query: string) => {
    if (!query.trim()) return;
    
    setFetchingNutrition(true);
    
    try {
      const nutritionData = await fetchNutritionForFood(query);

      if (nutritionData) {
        setCalories(Math.round(nutritionData.nf_calories || 0).toString());
        setFat(Math.round(nutritionData.nf_total_fat || 0).toString());
        setCarbs(Math.round(nutritionData.nf_total_carbohydrate || 0).toString());
        setProtein(Math.round(nutritionData.nf_protein || 0).toString());
      }
    } catch (error) {
      console.error('Error fetching nutrition data:', error);
      Alert.alert('Error', 'Failed to fetch nutrition data');
    } finally {
      setFetchingNutrition(false);
    }
  };
  
  // Copy the (possibly corrected) photo items into the meal form.
  const applyPhotoItems = (items: PhotoFoodItem[]) => {
    setFoodName(items.map((item) => item.name).filter(Boolean).join(', '));
    for (const key of MACRO_KEYS) {
      const total = items.reduce((sum, item) => sum + (Number(item[key]) || 0), 0);
      const setter = { calories: setCalories, protein: setProtein, carbs: setCarbs, fat: setFat }[key];
      setter(Math.round(total).toString());
    }
  };

  const updatePhotoItem = (index: number, field: keyof PhotoFoodItem, value: string) => {
    if (!photoItems) return;
    const updated = photoItems.map((item, i) => (i === index ? { ...item, [field]: value } : item));
    setPhotoItems(updated);
    applyPhotoItems(updated);
  };

  const removePhotoItem = (index: number) => {
    if (!photoItems) return;
    const updated = photoItems.filter((_, i) => i !== index);
    if (updated.length === 0) {
      clearPhotoResults();
      return;
    }
    setPhotoItems(updated);
    applyPhotoItems(updated);
  };

  const clearPhotoResults = () => {
    setPhotoItems(null);
    setFoodName('');
    setCalories('0');
    setProtein('0');
    setCarbs('0');
    setFat('0');
  };

  const handlePhotoConfirmed = async (imageBase64: string) => {
    setShowCamera(false);
    setAnalyzingPhoto(true);
    try {
      const result = await analyzeMealPhoto(imageBase64, 'image/jpeg');
      const items: PhotoFoodItem[] = result.foods.map((food) => ({
        name: food.name,
        servingDescription: food.servingDescription,
        estimatedGrams: food.estimatedGrams,
        calories: Math.round(food.calories).toString(),
        protein: Math.round(food.protein).toString(),
        carbs: Math.round(food.carbs).toString(),
        fat: Math.round(food.fat).toString(),
        confidence: food.confidence,
      }));
      setPhotoItems(items);
      applyPhotoItems(items);
    } catch (error) {
      console.error('Meal photo analysis failed:', error);
      const message = error instanceof AiServiceError ? error.message : 'Could not analyse the photo.';
      const offerManual = !(error instanceof AiServiceError) || error.shouldOfferManualEntry;
      Alert.alert(
        'Photo not recognised',
        offerManual ? `${message}\n\nYou can enter the meal manually below.` : message
      );
    } finally {
      setAnalyzingPhoto(false);
    }
  };

  const handleDateChange = (event: any, selectedDate?: Date) => {
    const currentDate = selectedDate || mealDate;
    setShowDatePicker(Platform.OS === 'ios');
    setMealDate(currentDate);
  };
  
  const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };
  
  const validateForm = (): boolean => {
    if (!foodName.trim()) {
      Alert.alert('Error', 'Please enter a food name');
      return false;
    }
    
    if (isNaN(Number(calories)) || Number(calories) <= 0) {
      Alert.alert('Error', 'Please enter valid calories');
      return false;
    }

    if (![protein, carbs, fat].every(isValidAmount)) {
      Alert.alert('Error', 'Please enter valid protein, carbs and fat values');
      return false;
    }

    if (photoItems && photoItems.some((item) => !item.name.trim() || !MACRO_KEYS.every((key) => isValidAmount(item[key])))) {
      Alert.alert('Error', 'Please fix the highlighted values in the detected foods');
      return false;
    }
    
    if (isCustomLocation && !customLocation.trim()) {
      Alert.alert('Error', 'Please enter a location');
      return false;
    }
    
    if (!auth.currentUser) {
      Alert.alert('Error', 'You must be logged in to log meals');
      return false;
    }
    
    return true;
  };
  
  const handleSaveMeal = async () => {
    if (!validateForm()) return;
    
    setLoading(true);
    
    try {
      const userId = auth.currentUser!.uid;
      
      // Prepare location data
      let locationData = null;
      
      if (isCustomLocation) {
        locationData = {
          name: customLocation,
          type: 'custom'
        };
      } else {
        locationData = {
          name: restaurantName,
          address: restaurantAddress,
          placeId: restaurantId,
          coordinates: { lat: restaurantLat, lng: restaurantLng },
          type: 'restaurant'
        };
      }
      
      // Create meal log document
      await addDoc(collection(db, 'mealLogs'), {
        userId,
        foodName,
        calories: Number(calories),
        protein: Number(protein),
        carbs: Number(carbs),
        fat: Number(fat),
        date: mealDate,
        createdAt: serverTimestamp(),
        location: locationData,
        mealType: mealType || null,
        source: photoItems ? 'photo' : 'manual',
        // Detected foods as reviewed and corrected by the user (AI estimates, not verified).
        ...(photoItems && {
          items: photoItems.map((item) => ({
            name: item.name.trim(),
            servingDescription: item.servingDescription,
            estimatedGrams: item.estimatedGrams,
            calories: Number(item.calories),
            protein: Number(item.protein),
            carbs: Number(item.carbs),
            fat: Number(item.fat),
            confidence: item.confidence,
          })),
          nutritionVerified: false,
        }),
      });

      // Show success modal with improved animations
      setShowSuccessModal(true);
      
      // Start the animations
      Animated.sequence([
        // Fade in the modal overlay
        Animated.timing(modalOpacity, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        // Pop and bounce effect for the check icon
        Animated.spring(checkScale, {
          toValue: 1,
          friction: 5,
          tension: 40,
          useNativeDriver: true,
        })
      ]).start();
      
      // Keep the modal visible for a bit then navigate away
      setTimeout(() => {
        // Fade out animation before hiding
        Animated.timing(modalOpacity, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }).start(() => {
          setShowSuccessModal(false);
          router.push('/(app)/dashboard');
        });
      }, 1500);
      
    } catch (error) {
      console.error('Error logging meal:', error);
      Alert.alert('Error', 'Failed to log meal. Please try again.');
    } finally {
      setLoading(false);
    }
  };
  
  const renderDatePicker = () => {
    if (Platform.OS === 'web') {
      return showDatePicker && <DateTimePickerWeb 
        value={mealDate}
        onChange={handleDateChange}
        mode="datetime"
      />;
    }
    
    return showDatePicker && DateTimePicker && (
      <DateTimePicker
        value={mealDate}
        mode="datetime"
        display="default"
        onChange={handleDateChange}
      />
    );
  };

  const renderPhotoSection = () => (
    <View style={[styles.formSection, isDark && styles.formSectionDark]}>
      <Text style={[styles.sectionTitle, isDark && styles.textLight]}>Log by Photo</Text>
      {analyzingPhoto ? (
        <View style={styles.analyzingRow}>
          <ActivityIndicator size="small" color="#2ecc71" />
          <Text style={[styles.analyzingText, isDark && styles.textLight]}>Identifying your meal...</Text>
        </View>
      ) : (
        <TouchableOpacity style={styles.photoButton} onPress={() => setShowCamera(true)}>
          <Camera size={20} color="#fff" />
          <Text style={styles.photoButtonText}>{photoItems ? 'Retake Meal Photo' : 'Take a Meal Photo'}</Text>
        </TouchableOpacity>
      )}

      {photoItems && (
        <View style={styles.photoResults}>
          <Text style={[styles.photoNote, isDark && styles.photoNoteDark]}>
            AI estimates – check and correct the values before logging.
          </Text>
          {photoItems.map((item, index) => (
            <View key={index} style={[styles.photoItem, isDark && styles.photoItemDark]}>
              <View style={styles.photoItemHeader}>
                <TextInput
                  style={[styles.input, styles.photoItemName, isDark && styles.inputDark, !item.name.trim() && styles.inputInvalid]}
                  value={item.name}
                  onChangeText={(value) => updatePhotoItem(index, 'name', value)}
                  placeholder="Food name"
                  placeholderTextColor={isDark ? '#777' : '#aaa'}
                />
                <TouchableOpacity onPress={() => removePhotoItem(index)} style={styles.photoItemRemove}>
                  <X size={18} color={isDark ? '#aaa' : '#888'} />
                </TouchableOpacity>
              </View>
              <TextInput
                style={[styles.input, styles.photoServing, isDark && styles.inputDark]}
                value={item.servingDescription}
                onChangeText={(value) => updatePhotoItem(index, 'servingDescription', value)}
                placeholder="Serving size"
                placeholderTextColor={isDark ? '#777' : '#aaa'}
              />
              <View style={styles.macroRow}>
                {MACRO_KEYS.map((key) => (
                  <View key={key} style={styles.photoMacro}>
                    <Text style={[styles.photoMacroLabel, isDark && styles.labelDark]}>
                      {key === 'calories' ? 'kcal' : `${key[0].toUpperCase()}${key.slice(1)} (g)`}
                    </Text>
                    <TextInput
                      style={[styles.input, styles.photoMacroInput, isDark && styles.inputDark, !isValidAmount(item[key]) && styles.inputInvalid]}
                      value={item[key]}
                      onChangeText={(value) => updatePhotoItem(index, key, value)}
                      keyboardType="numeric"
                    />
                  </View>
                ))}
              </View>
              {item.confidence === 'low' && (
                <Text style={styles.lowConfidence}>Low confidence – please double-check this item.</Text>
              )}
            </View>
          ))}
          <TouchableOpacity onPress={clearPhotoResults}>
            <Text style={styles.clearPhotoText}>Clear photo results and enter manually</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );

  const renderMealTypeSelector = () => (
    <View style={styles.inputGroup}>
      <Text style={[styles.label, isDark && styles.labelDark]}>Meal Type</Text>
      <View style={styles.mealTypeContainer}>
        <TouchableOpacity 
          style={[
            styles.mealTypeButton, 
            isDark && styles.mealTypeButtonDark,
            mealType === 'breakfast' && styles.mealTypeButtonSelected,
            mealType === 'breakfast' && isDark && styles.mealTypeButtonSelectedDark
          ]}
          onPress={() => setMealType('breakfast')}
        >
          <Text style={[
            styles.mealTypeButtonText, 
            isDark && styles.mealTypeButtonTextDark,
            mealType === 'breakfast' && styles.mealTypeButtonTextSelected,
            mealType === 'breakfast' && isDark && styles.mealTypeButtonTextSelected
          ]}>
            Breakfast
          </Text>
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={[
            styles.mealTypeButton,
            isDark && styles.mealTypeButtonDark,
            mealType === 'lunch' && styles.mealTypeButtonSelected,
            mealType === 'lunch' && isDark && styles.mealTypeButtonSelectedDark
          ]}
          onPress={() => setMealType('lunch')}
        >
          <Text style={[
            styles.mealTypeButtonText,
            isDark && styles.mealTypeButtonTextDark,
            mealType === 'lunch' && styles.mealTypeButtonTextSelected,
            mealType === 'lunch' && isDark && styles.mealTypeButtonTextSelected
          ]}>
            Lunch
          </Text>
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={[
            styles.mealTypeButton,
            isDark && styles.mealTypeButtonDark,
            mealType === 'dinner' && styles.mealTypeButtonSelected,
            mealType === 'dinner' && isDark && styles.mealTypeButtonSelectedDark
          ]}
          onPress={() => setMealType('dinner')}
        >
          <Text style={[
            styles.mealTypeButtonText,
            isDark && styles.mealTypeButtonTextDark,
            mealType === 'dinner' && styles.mealTypeButtonTextSelected,
            mealType === 'dinner' && isDark && styles.mealTypeButtonTextSelected
          ]}>
            Dinner
          </Text>
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={[
            styles.mealTypeButton,
            isDark && styles.mealTypeButtonDark,
            mealType === 'snack' && styles.mealTypeButtonSelected,
            mealType === 'snack' && isDark && styles.mealTypeButtonSelectedDark
          ]}
          onPress={() => setMealType('snack')}
        >
          <Text style={[
            styles.mealTypeButtonText,
            isDark && styles.mealTypeButtonTextDark,
            mealType === 'snack' && styles.mealTypeButtonTextSelected,
            mealType === 'snack' && isDark && styles.mealTypeButtonTextSelected
          ]}>
            Snack
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
  
  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      <View style={[styles.header, isDark && styles.headerDark]}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <ArrowLeft size={24} color="#2ecc71" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Log a Meal</Text>
        <TouchableOpacity
          style={styles.saveButton}
          onPress={handleSaveMeal}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Save size={24} color="#2ecc71" />
          )}
        </TouchableOpacity>
      </View>
      
      <ScrollView style={styles.content} contentContainerStyle={[styles.contentContainer, isDark && styles.contentContainerDark]}>
        {renderPhotoSection()}

        <View style={[styles.formSection, isDark && styles.formSectionDark]}>
          <Text style={[styles.sectionTitle, isDark && styles.textLight]}>Food Details</Text>
          
          {renderMealTypeSelector()}
          
          <View style={styles.inputGroup}>
            <Text style={[styles.label, isDark && styles.labelDark]}>Food Name</Text>
            <TextInput
              style={[styles.input, isDark && styles.inputDark]}
              value={foodName}
              onChangeText={setFoodName}
              placeholder="e.g., Grilled Chicken Salad"
              placeholderTextColor={isDark ? "#777" : "#aaa"}
            />
            {fetchingNutrition && (
              <ActivityIndicator 
                size="small" 
                color="#2ecc71" 
                style={styles.nutritionLoader} 
              />
            )}
          </View>
          
          <View style={styles.macroRow}>
            <View style={[styles.inputGroup, { flex: 1, marginRight: 8 }]}>
              <Text style={[styles.label, isDark && styles.labelDark]}>Calories</Text>
              <TextInput
                style={[styles.input, isDark && styles.inputDark]}
                value={calories}
                onChangeText={setCalories}
                keyboardType="numeric"
                placeholder="0"
                placeholderTextColor={isDark ? "#777" : "#aaa"}
              />
            </View>
            
            <View style={[styles.inputGroup, { flex: 1 }]}>
              <Text style={[styles.label, isDark && styles.labelDark]}>Protein (g)</Text>
              <TextInput
                style={[styles.input, isDark && styles.inputDark]}
                value={protein}
                onChangeText={setProtein}
                keyboardType="numeric"
                placeholder="0"
                placeholderTextColor={isDark ? "#777" : "#aaa"}
              />
            </View>
          </View>
          
          <View style={styles.macroRow}>
            <View style={[styles.inputGroup, { flex: 1, marginRight: 8 }]}>
              <Text style={[styles.label, isDark && styles.labelDark]}>Carbs (g)</Text>
              <TextInput
                style={[styles.input, isDark && styles.inputDark]}
                value={carbs}
                onChangeText={setCarbs}
                keyboardType="numeric"
                placeholder="0"
                placeholderTextColor={isDark ? "#777" : "#aaa"}
              />
            </View>
            
            <View style={[styles.inputGroup, { flex: 1 }]}>
              <Text style={[styles.label, isDark && styles.labelDark]}>Fat (g)</Text>
              <TextInput
                style={[styles.input, isDark && styles.inputDark]}
                value={fat}
                onChangeText={setFat}
                keyboardType="numeric"
                placeholder="0"
                placeholderTextColor={isDark ? "#777" : "#aaa"}
              />
            </View>
          </View>
        </View>
        
        <View style={[styles.formSection, isDark && styles.formSectionDark]}>
          <Text style={[styles.sectionTitle, isDark && styles.textLight]}>Date & Time</Text>
          
          <TouchableOpacity
            style={[styles.datePickerButton, isDark && styles.datePickerButtonDark]}
            onPress={() => setShowDatePicker(true)}
          >
            <Calendar size={20} color="#2ecc71" />
            <Text style={[styles.dateText, isDark && styles.dateTextDark]}>{formatDate(mealDate)}</Text>
          </TouchableOpacity>
          
          {renderDatePicker()}
        </View>
        
        <View style={[styles.formSection, isDark && styles.formSectionDark]}>
          <Text style={[styles.sectionTitle, isDark && styles.textLight]}>Location</Text>
          
          <View style={styles.locationTypeSwitch}>
            <Text style={[
              styles.locationTypeText,
              !isCustomLocation && styles.activeLocationType,
              isDark && styles.locationTypeTextDark,
              !isCustomLocation && isDark && styles.activeLocationTypeDark
            ]}>
              Restaurant
            </Text>
            <Switch
              trackColor={{ false: '#2ecc71', true: '#2ecc71' }}
              thumbColor="#fff"
              ios_backgroundColor={isDark ? "#2a2a2a" : "#e9e9e9"}
              onValueChange={() => setIsCustomLocation(!isCustomLocation)}
              value={isCustomLocation}
            />
            <Text style={[
              styles.locationTypeText,
              isCustomLocation && styles.activeLocationType,
              isDark && styles.locationTypeTextDark,
              isCustomLocation && isDark && styles.activeLocationTypeDark
            ]}>
              Custom
            </Text>
          </View>
          
          {isCustomLocation ? (
            <View style={styles.inputGroup}>
              <Text style={[styles.label, isDark && styles.labelDark]}>Location Name</Text>
              <TextInput
                style={[styles.input, isDark && styles.inputDark]}
                value={customLocation}
                onChangeText={setCustomLocation}
                placeholder="e.g., Home, Work, etc."
                placeholderTextColor={isDark ? "#777" : "#aaa"}
              />
            </View>
          ) : (
            <View style={[styles.restaurantInfo, isDark && styles.restaurantInfoDark]}>
              <Text style={[styles.restaurantName, isDark && styles.restaurantNameDark]}>{restaurantName || 'Select a restaurant'}</Text>
              {restaurantAddress && (
                <Text style={[styles.restaurantAddress, isDark && styles.restaurantAddressDark]}>{restaurantAddress}</Text>
              )}
              
              {!restaurantName && (
                <TouchableOpacity
                  style={styles.selectRestaurantButton}
                  onPress={() => router.push('/(app)/nearby-restaurants')}
                >
                  <Text style={styles.selectRestaurantText}>
                    Find a Restaurant
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
        
        <TouchableOpacity
          style={[styles.logButton, loading && styles.logButtonDisabled]}
          onPress={handleSaveMeal}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.logButtonText}>Log Meal</Text>
          )}
        </TouchableOpacity>
      </ScrollView>

      <PhotoCaptureModal
        visible={showCamera}
        title="Meal Photo"
        hint="Fit the whole plate or bowl in the frame."
        onCancel={() => setShowCamera(false)}
        onConfirm={handlePhotoConfirmed}
      />

      {/* Success Modal */}
      <Modal
        visible={showSuccessModal}
        transparent
        animationType="none"
      >
        <Animated.View style={[styles.modalOverlay, { opacity: modalOpacity }]}>
          <Animated.View 
            style={[
              styles.modalContainer, 
              isDark && styles.modalContainerDark,
              { transform: [{ scale: checkScale }] }
            ]}
          >
            <Check size={80} color="#2ecc71" />
            <Text style={[styles.successText, isDark && styles.successTextDark]}>Meal Logged!</Text>
          </Animated.View>
        </Animated.View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f9f9f9',
  },
  containerDark: {
    backgroundColor: '#121212',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 50 : 30,
    paddingBottom: 16,
    backgroundColor: 'white',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  headerDark: {
    backgroundColor: '#1e1e1e',
    shadowColor: '#000',
  },
  backButton: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#2ecc71',
  },
  saveButton: {
    padding: 4,
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 16,
    paddingBottom: 90, // Add extra padding for tab bar
  },
  contentContainerDark: {
    backgroundColor: '#121212',
  },
  formSection: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 1,
  },
  formSectionDark: {
    backgroundColor: '#1e1e1e',
    shadowColor: '#000',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 16,
  },
  textLight: {
    color: '#f2f2f2',
  },
  inputGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#555',
    marginBottom: 8,
  },
  labelDark: {
    color: '#f2f2f2',
  },
  input: {
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#eee',
  },
  inputDark: {
    backgroundColor: '#2a2a2a',
    borderColor: '#333',
    color: '#f2f2f2',
  },
  macroRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  datePickerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: '#eee',
  },
  datePickerButtonDark: {
    backgroundColor: '#2a2a2a',
    borderColor: '#333',
  },
  dateText: {
    fontSize: 16,
    marginLeft: 8,
    color: '#333',
  },
  dateTextDark: {
    color: '#f2f2f2',
  },
  webDatePicker: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  webDatePickerInput: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#eee',
    marginRight: 8,
  },
  webDatePickerInputDark: {
    backgroundColor: '#2a2a2a',
    borderColor: '#333',
    color: '#f2f2f2',
  },
  webDatePickerButton: {
    backgroundColor: '#2ecc71',
    borderRadius: 8,
    padding: 12,
  },
  webDatePickerButtonDark: {
    backgroundColor: '#27ae60',
  },
  webDatePickerButtonText: {
    color: 'white',
    fontWeight: 'bold',
  },
  locationTypeSwitch: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  locationTypeText: {
    fontSize: 16,
    marginHorizontal: 8,
    color: '#888',
  },
  locationTypeTextDark: {
    color: '#aaa',
  },
  activeLocationType: {
    fontWeight: 'bold',
    color: '#2ecc71',
  },
  activeLocationTypeDark: {
    color: '#2ecc71',
  },
  restaurantInfo: {
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    padding: 16,
    borderWidth: 1,
    borderColor: '#eee',
  },
  restaurantInfoDark: {
    backgroundColor: '#2a2a2a',
    borderColor: '#333',
  },
  restaurantName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 4,
  },
  restaurantNameDark: {
    color: '#f2f2f2',
  },
  restaurantAddress: {
    fontSize: 14,
    color: '#666',
  },
  restaurantAddressDark: {
    color: '#aaa',
  },
  selectRestaurantButton: {
    backgroundColor: '#2ecc71',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 12,
  },
  selectRestaurantText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 16,
  },
  logButton: {
    backgroundColor: '#2ecc71',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 32,
  },
  logButtonDisabled: {
    backgroundColor: '#a8e6cf',
  },
  logButtonText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 18,
  },
  nutritionLoader: {
    position: 'absolute',
    right: 12,
    top: 40,
  },
  mealTypeContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  mealTypeButton: {
    width: '48%',
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 10,
    marginBottom: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#eee',
  },
  mealTypeButtonDark: {
    backgroundColor: '#2a2a2a',
    borderColor: '#333',
  },
  mealTypeButtonSelected: {
    backgroundColor: '#2ecc71',
    borderColor: '#2ecc71',
  },
  mealTypeButtonSelectedDark: {
    backgroundColor: '#2ecc71',
    borderColor: '#2ecc71',
  },
  mealTypeButtonText: {
    color: '#666',
    fontWeight: '500',
  },
  mealTypeButtonTextDark: {
    color: '#aaa',
  },
  mealTypeButtonTextSelected: {
    color: 'white',
    fontWeight: 'bold',
  },
  // Photo logging styles
  photoButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2ecc71',
    borderRadius: 8,
    paddingVertical: 12,
    gap: 8,
  },
  photoButtonText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 16,
  },
  analyzingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    gap: 8,
  },
  analyzingText: {
    fontSize: 16,
    color: '#333',
  },
  photoResults: {
    marginTop: 16,
  },
  photoNote: {
    fontSize: 13,
    color: '#888',
    marginBottom: 12,
  },
  photoNoteDark: {
    color: '#aaa',
  },
  photoItem: {
    borderWidth: 1,
    borderColor: '#eee',
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
  },
  photoItemDark: {
    borderColor: '#333',
  },
  photoItemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  photoItemName: {
    flex: 1,
    fontWeight: 'bold',
  },
  photoItemRemove: {
    padding: 8,
  },
  photoServing: {
    marginTop: 8,
    marginBottom: 8,
    fontSize: 14,
    padding: 8,
  },
  photoMacro: {
    flex: 1,
    marginHorizontal: 2,
  },
  photoMacroLabel: {
    fontSize: 12,
    color: '#555',
    marginBottom: 4,
  },
  photoMacroInput: {
    padding: 8,
    fontSize: 14,
  },
  inputInvalid: {
    borderColor: '#ff6b6b',
    borderWidth: 2,
  },
  lowConfidence: {
    marginTop: 6,
    fontSize: 12,
    color: '#e67e22',
  },
  clearPhotoText: {
    color: '#2ecc71',
    textAlign: 'center',
    fontWeight: '500',
    paddingVertical: 4,
  },
  // Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContainer: {
    width: 160,
    height: 160,
    backgroundColor: '#fff',
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 8,
  },
  modalContainerDark: {
    backgroundColor: '#1e1e1e',
    shadowColor: '#000',
  },
  successText: {
    marginTop: 12,
    fontSize: 18,
    color: '#333',
    fontWeight: 'bold',
  },
  successTextDark: {
    color: '#f2f2f2',
  },
});

export default MealLoggingScreen;
