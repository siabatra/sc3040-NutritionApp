// Restaurant Details Screen (app/(app)/restaurant-details.tsx)
import React, { useEffect, useState, useContext } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, FlatList, ActivityIndicator, Alert, Platform, Image, ScrollView } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { auth, db } from '../../firebaseConfig';
import { doc, getDoc, setDoc, updateDoc, arrayUnion } from 'firebase/firestore';
import { ArrowLeft, Heart, Plus, MapPin, ArrowUpRight, Search, X, Camera, Check } from 'lucide-react-native';
import { ThemeContext } from '../../context/ThemeContext';
import { MapView, Marker, PROVIDER_GOOGLE } from '../../utils/nativeMaps';
import { fetchNutritionForFood, estimateDishNutrition, type NutritionData } from '../../utils/nutritionApi';
import { extractMenuFromImage, AiServiceError } from '../../utils/claudeApi';
import PhotoCaptureModal from '../../components/PhotoCaptureModal';

interface MenuItem {
  id: string;
  foodName: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  createdBy?: string;
  createdAt?: any;
}

// A dish read from a menu photo, awaiting the user's review before it is saved.
interface CapturedMenuItem {
  include: boolean;
  foodName: string;
  calories: string;
  protein: string;
  carbs: string;
  fat: string;
  price: number | null;
  components: string[];
  unmatchedComponents: string[];
  nutritionFound: boolean;
}

const MACRO_KEYS = ['calories', 'protein', 'carbs', 'fat'] as const;

const isValidAmount = (value: string) => value.trim() !== '' && Number.isFinite(Number(value)) && Number(value) >= 0;

const isSavable = (item: CapturedMenuItem) =>
  item.foodName.trim() !== '' && MACRO_KEYS.every((key) => isValidAmount(item[key])) && Number(item.calories) > 0;

const RestaurantDetailsScreen: React.FC = () => {
  const params = useLocalSearchParams();
  const { placeId, name, latitude, longitude, address } = params;
  
  const { theme } = useContext(ThemeContext);
  const isDark = theme === 'dark';
  
  const [isFavorite, setIsFavorite] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [filteredMenuItems, setFilteredMenuItems] = useState<MenuItem[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isAddingMode, setIsAddingMode] = useState<boolean>(false);
  const [fetchingNutrition, setFetchingNutrition] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [addingItem, setAddingItem] = useState<boolean>(false);

  // Menu capture (SRS 7.2.4)
  const [showMenuCamera, setShowMenuCamera] = useState<boolean>(false);
  const [menuCaptureStatus, setMenuCaptureStatus] = useState<string | null>(null);
  const [capturedItems, setCapturedItems] = useState<CapturedMenuItem[] | null>(null);
  const [savingCapturedItems, setSavingCapturedItems] = useState<boolean>(false);
  
  // Fetch restaurant details and check if it's a favorite
  useEffect(() => {
    const fetchRestaurantDetails = async () => {
      if (!placeId) return;
      
      setLoading(true);
      
      try {
        // Check if restaurant is a favorite
        if (auth.currentUser) {
          const userDoc = await getDoc(doc(db, 'users', auth.currentUser.uid));
          if (userDoc.exists() && userDoc.data().favorites) {
            setIsFavorite(userDoc.data().favorites.includes(placeId));
          }
        }
        
        // Fetch restaurant menu items
        await fetchRestaurantItems(placeId as string);
      } catch (error) {
        console.error('Error fetching restaurant details:', error);
        setErrorMsg('Failed to fetch restaurant details');
      } finally {
        setLoading(false);
      }
    };
    
    fetchRestaurantDetails();
  }, [placeId]);
  
  // Filter menu items when search query changes
  useEffect(() => {
    if (!isAddingMode) {
      if (searchQuery.trim() === '') {
        setFilteredMenuItems(menuItems);
      } else {
        const lowercaseQuery = searchQuery.toLowerCase();
        const filtered = menuItems.filter(item => 
          item.foodName.toLowerCase().includes(lowercaseQuery)
        );
        setFilteredMenuItems(filtered);
      }
    }
  }, [searchQuery, menuItems, isAddingMode]);
  
  const fetchRestaurantItems = async (restaurantId: string) => {
    try {
      // Check if restaurant document exists
      const restaurantDoc = await getDoc(doc(db, 'restaurants', restaurantId));
      
      if (restaurantDoc.exists() && restaurantDoc.data().items) {
        const items = restaurantDoc.data().items;
        setMenuItems(items);
        setFilteredMenuItems(items);
      } else {
        // If no document exists, create one with empty items array
        await setDoc(doc(db, 'restaurants', restaurantId), {
          placeId: restaurantId,
          name: name,
          address: address,
          location: { lat: Number(latitude), lng: Number(longitude) },
          items: []
        });
        setMenuItems([]);
        setFilteredMenuItems([]);
      }
    } catch (error) {
      console.error('Error fetching restaurant items:', error);
      setErrorMsg('Failed to fetch menu items');
    }
  };
  
  const toggleFavorite = async () => {
    if (!auth.currentUser) {
      Alert.alert('Login Required', 'Please login to save favorites');
      return;
    }
    
    const userId = auth.currentUser.uid;
    const userRef = doc(db, 'users', userId);
    
    try {
      const userDoc = await getDoc(userRef);
      
      if (userDoc.exists()) {
        const userData = userDoc.data();
        const favorites = userData.favorites || [];
        
        if (isFavorite) {
          // Remove from favorites
          const updatedFavorites = favorites.filter((id: string) => id !== placeId);
          await updateDoc(userRef, { favorites: updatedFavorites });
        } else {
          // Add to favorites
          const updatedFavorites = [...favorites, placeId];
          await updateDoc(userRef, { favorites: updatedFavorites });
        }
        
        setIsFavorite(!isFavorite);
      }
    } catch (error) {
      console.error('Error updating favorites:', error);
      Alert.alert('Error', 'Failed to update favorites');
    }
  };
  
  const getNutritionData = async (foodName: string): Promise<NutritionData | null> => {
    setFetchingNutrition(true);
    
    try {
      return await fetchNutritionForFood(foodName);
    } catch (error) {
      console.error('Error fetching nutrition data:', error);
      return null;
    } finally {
      setFetchingNutrition(false);
    }
  };
  
  const addNewItemToRestaurant = async () => {
    if (!searchQuery.trim()) {
      Alert.alert('Input Required', 'Please enter a food item name');
      return;
    }
    
    if (!placeId) {
      setErrorMsg('Restaurant ID is missing');
      return;
    }
    
    try {
      setAddingItem(true);
      
      // Get nutrition data for the new item
      const nutritionData = await getNutritionData(searchQuery);
      
      if (!nutritionData) {
        Alert.alert('Error', 'Could not retrieve nutrition information for this item');
        setAddingItem(false);
        return;
      }
      
      // Create new item object
      const newItem: MenuItem = {
        id: Date.now().toString(),
        foodName: searchQuery,
        calories: Math.round(nutritionData.nf_calories),
        protein: Math.round(nutritionData.nf_protein),
        carbs: Math.round(nutritionData.nf_total_carbohydrate),
        fat: Math.round(nutritionData.nf_total_fat),
        createdBy: auth.currentUser?.uid || 'anonymous',
        createdAt: new Date(),
      };
      
      // Update restaurant document in Firestore
      const restaurantRef = doc(db, 'restaurants', placeId as string);
      const restaurantDoc = await getDoc(restaurantRef);
      
      if (restaurantDoc.exists()) {
        // Create a new items array with the new item added
        const updatedItems = [...(restaurantDoc.data().items || []), newItem];
        
        // Update the document with the new items array
        await updateDoc(restaurantRef, { items: updatedItems });
        
        // Update local state
        setMenuItems(updatedItems);
        setFilteredMenuItems(updatedItems);
        
        // Clear input and show success message
        setSearchQuery('');
        setIsAddingMode(false);
        Alert.alert('Success', 'Food item added to the restaurant menu');
      } else {
        // Create a new document if it doesn't exist
        await setDoc(restaurantRef, {
          placeId: placeId,
          name: name,
          address: address,
          location: { lat: Number(latitude), lng: Number(longitude) },
          items: [newItem]
        });
        
        // Update local state
        setMenuItems([newItem]);
        setFilteredMenuItems([newItem]);
        
        // Clear input and show success message
        setSearchQuery('');
        setIsAddingMode(false);
        Alert.alert('Success', 'Food item added to the restaurant menu');
      }
    } catch (error) {
      console.error('Error adding new item:', error);
      Alert.alert('Error', 'Failed to add food item. Please try again.');
    } finally {
      setAddingItem(false);
    }
  };
  
  const handleMenuPhotoConfirmed = async (imageBase64: string) => {
    setShowMenuCamera(false);
    setMenuCaptureStatus('Reading the menu...');
    try {
      const { items } = await extractMenuFromImage(imageBase64, 'image/jpeg');

      setMenuCaptureStatus(`Looking up nutrition for ${items.length} dishes...`);
      const reviewed: CapturedMenuItem[] = [];
      // Small batches keep USDA FoodData Central requests within its rate limit.
      for (let i = 0; i < items.length; i += 4) {
        const batch = items.slice(i, i + 4);
        const estimates = await Promise.all(
          batch.map((item) => estimateDishNutrition(item.components, item.estimatedPortionGrams))
        );
        batch.forEach((item, j) => {
          const estimate = estimates[j];
          reviewed.push({
            include: estimate !== null,
            foodName: item.name,
            calories: estimate ? Math.round(estimate.calories).toString() : '',
            protein: estimate ? Math.round(estimate.protein).toString() : '',
            carbs: estimate ? Math.round(estimate.carbs).toString() : '',
            fat: estimate ? Math.round(estimate.fat).toString() : '',
            price: item.price,
            components: item.components,
            unmatchedComponents: estimate ? estimate.unmatchedComponents : item.components,
            nutritionFound: estimate !== null,
          });
        });
      }
      setCapturedItems(reviewed);
    } catch (error) {
      console.error('Menu capture failed:', error);
      const message = error instanceof AiServiceError ? error.message : 'Could not process the menu photo.';
      Alert.alert('Menu capture failed', message);
    } finally {
      setMenuCaptureStatus(null);
    }
  };

  const updateCapturedItem = (index: number, changes: Partial<CapturedMenuItem>) => {
    setCapturedItems((items) => items && items.map((item, i) => (i === index ? { ...item, ...changes } : item)));
  };

  const saveCapturedItems = async () => {
    if (!capturedItems || !placeId) return;
    const selected = capturedItems.filter((item) => item.include);
    if (selected.length === 0) {
      Alert.alert('Nothing selected', 'Select at least one dish to add to the menu.');
      return;
    }
    if (selected.some((item) => !isSavable(item))) {
      Alert.alert('Check the values', 'Each selected dish needs a name and valid calories, protein, carbs and fat.');
      return;
    }

    setSavingCapturedItems(true);
    try {
      const now = Date.now();
      const newItems = selected.map((item, index) => ({
        id: `${now}-${index}`,
        foodName: item.foodName.trim(),
        calories: Math.round(Number(item.calories)),
        protein: Math.round(Number(item.protein)),
        carbs: Math.round(Number(item.carbs)),
        fat: Math.round(Number(item.fat)),
        price: item.price,
        createdBy: auth.currentUser?.uid || 'anonymous',
        createdAt: new Date(),
        source: 'menu-photo',
        // Values are estimated from USDA FoodData Central components (or entered by the user).
        nutritionSource: item.nutritionFound ? 'USDA FoodData Central (estimated portion)' : 'user-entered',
        nutritionVerified: false,
      }));

      // arrayUnion avoids overwriting items other users add to the same restaurant at the same time.
      await setDoc(
        doc(db, 'restaurants', placeId as string),
        {
          placeId,
          name,
          address,
          location: { lat: Number(latitude), lng: Number(longitude) },
          items: arrayUnion(...newItems),
        },
        { merge: true }
      );

      const updatedItems = [...menuItems, ...newItems];
      setMenuItems(updatedItems);
      setFilteredMenuItems(updatedItems);
      setCapturedItems(null);
      Alert.alert('Menu saved', `${newItems.length} dish${newItems.length === 1 ? '' : 'es'} added to this restaurant.`);
    } catch (error) {
      console.error('Error saving captured menu:', error);
      Alert.alert('Error', 'Failed to save the menu. Please try again.');
    } finally {
      setSavingCapturedItems(false);
    }
  };

  const renderMenuCapture = () => {
    if (menuCaptureStatus) {
      return (
        <View style={[styles.captureStatus, isDark && styles.capturePanelDark]}>
          <ActivityIndicator size="small" color="#2ecc71" />
          <Text style={[styles.captureStatusText, isDark && styles.textLight]}>{menuCaptureStatus}</Text>
        </View>
      );
    }
    if (!capturedItems) {
      return (
        <TouchableOpacity style={styles.captureButton} onPress={() => setShowMenuCamera(true)}>
          <Camera size={18} color="#fff" />
          <Text style={styles.captureButtonText}>Capture Menu</Text>
        </TouchableOpacity>
      );
    }
    return (
      <View style={[styles.capturePanel, isDark && styles.capturePanelDark]}>
        <Text style={[styles.captureTitle, isDark && styles.textLight]}>Review captured dishes</Text>
        <Text style={[styles.captureNote, isDark && styles.macroTextDark]}>
          Nutrition is estimated from USDA FoodData Central. Correct anything that looks wrong and untick dishes you don't want to save.
        </Text>
        {capturedItems.map((item, index) => (
          <View key={index} style={[styles.capturedItem, isDark && styles.capturedItemDark, !item.include && styles.capturedItemExcluded]}>
            <View style={styles.capturedItemHeader}>
              <TouchableOpacity
                style={[styles.checkbox, item.include && styles.checkboxChecked]}
                onPress={() => updateCapturedItem(index, { include: !item.include })}
              >
                {item.include && <Check size={14} color="#fff" />}
              </TouchableOpacity>
              <TextInput
                style={[styles.captureInput, styles.captureNameInput, isDark && styles.captureInputDark, item.include && !item.foodName.trim() && styles.captureInputInvalid]}
                value={item.foodName}
                onChangeText={(foodName) => updateCapturedItem(index, { foodName })}
              />
            </View>
            <View style={styles.captureMacroRow}>
              {MACRO_KEYS.map((key) => {
                const invalid = item.include && (!isValidAmount(item[key]) || (key === 'calories' && Number(item.calories) <= 0));
                return (
                  <View key={key} style={styles.captureMacro}>
                    <Text style={[styles.captureMacroLabel, isDark && styles.macroTextDark]}>
                      {key === 'calories' ? 'kcal' : `${key[0].toUpperCase()}${key.slice(1)} (g)`}
                    </Text>
                    <TextInput
                      style={[styles.captureInput, isDark && styles.captureInputDark, invalid && styles.captureInputInvalid]}
                      value={item[key]}
                      onChangeText={(value) => updateCapturedItem(index, { [key]: value })}
                      keyboardType="numeric"
                    />
                  </View>
                );
              })}
            </View>
            {!item.nutritionFound ? (
              <Text style={styles.captureWarning}>No USDA match – enter the values yourself to save this dish.</Text>
            ) : item.unmatchedComponents.length > 0 ? (
              <Text style={styles.captureWarning}>Not matched: {item.unmatchedComponents.join(', ')}</Text>
            ) : null}
          </View>
        ))}
        <View style={styles.captureActions}>
          <TouchableOpacity
            style={[styles.cancelAddButton, isDark && styles.cancelAddButtonDark, styles.captureActionButton]}
            onPress={() => setCapturedItems(null)}
            disabled={savingCapturedItems}
          >
            <Text style={[styles.cancelAddText, isDark && styles.cancelAddTextDark]}>Discard</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.captureButton, styles.captureActionButton]}
            onPress={saveCapturedItems}
            disabled={savingCapturedItems}
          >
            {savingCapturedItems ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.captureButtonText}>Save to Menu</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const selectMenuItem = (item: MenuItem) => {
    router.push({
      pathname: '/(app)/meal-logging',
      params: {
        restaurantId: placeId as string,
        restaurantName: name as string,
        foodName: item.foodName,
        calories: item.calories.toString(),
        protein: item.protein.toString(),
        carbs: item.carbs.toString(),
        fat: item.fat.toString(),
        latitude: latitude as string,
        longitude: longitude as string,
        address: address as string
      }
    });
  };
  
  const goToDirections = () => {
    router.push({
      pathname: '/(app)/restaurant-directions',
      params: {
        placeId: placeId as string,
        name: name as string,
        latitude: latitude as string,
        longitude: longitude as string,
        address: address as string
      }
    });
  };
  
  const renderMenuItem = ({ item }: { item: MenuItem }) => (
    <TouchableOpacity
      style={[styles.menuItem, isDark && styles.menuItemDark]}
      onPress={() => selectMenuItem(item)}
    >
      <View style={styles.menuItemContent}>
        <Text style={[styles.menuItemName, isDark && styles.textLight]}>{item.foodName}</Text>
        <View style={styles.nutritionInfo}>
          <Text style={styles.calorieText}>{Math.round(item.calories)} cal</Text>
          <View style={styles.macroDetails}>
            <Text style={[styles.macroText, isDark && styles.macroTextDark]}>P: {Math.round(item.protein)}g</Text>
            <Text style={[styles.macroText, isDark && styles.macroTextDark]}>C: {Math.round(item.carbs)}g</Text>
            <Text style={[styles.macroText, isDark && styles.macroTextDark]}>F: {Math.round(item.fat)}g</Text>
          </View>
        </View>
      </View>
      <ArrowUpRight size={20} color="#2ecc71" />
    </TouchableOpacity>
  );
  
  const renderMap = () => {
    if (Platform.OS === 'web') {
      return (
        <View style={styles.webMapPlaceholder}>
          <Text style={styles.webMapText}>Map view is not available on web platform</Text>
          <TouchableOpacity
            style={styles.directionsButton}
            onPress={goToDirections}
          >
            <MapPin size={16} color="#fff" />
            <Text style={styles.directionsText}>Get Directions</Text>
          </TouchableOpacity>
        </View>
      );
    }
    
    return (
      <MapView
        style={styles.map}
        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
        initialRegion={{
          latitude: Number(latitude),
          longitude: Number(longitude),
          latitudeDelta: 0.005,
          longitudeDelta: 0.005,
        }}
        scrollEnabled={false}
        zoomEnabled={false}
      >
        <Marker
          coordinate={{
            latitude: Number(latitude),
            longitude: Number(longitude),
          }}
          title={name as string}
        />
      </MapView>
    );
  };
  
  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      <View style={[styles.header, isDark && styles.headerDark]}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <ArrowLeft size={24} color="#2ecc71" />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, isDark && styles.textLight]} numberOfLines={1}>
          {name}
        </Text>
        <TouchableOpacity
          style={styles.favoriteButton}
          onPress={toggleFavorite}
        >
          <Heart
            size={24}
            color="#FF6B6B"
            fill={isFavorite ? "#FF6B6B" : "transparent"}
          />
        </TouchableOpacity>
      </View>
      
      <ScrollView style={[styles.content, isDark && styles.contentDark]} contentContainerStyle={{ paddingBottom: 90 }}>
        <View style={styles.restaurantDetails}>
          <Text style={[styles.address, isDark && styles.addressDark]}>{address}</Text>
          
          <View style={styles.mapContainer}>
            {renderMap()}
            <TouchableOpacity
              style={styles.directionsButton}
              onPress={goToDirections}
            >
              <MapPin size={16} color="#fff" />
              <Text style={styles.directionsText}>Get Directions</Text>
            </TouchableOpacity>
          </View>
          
          <View style={styles.menuHeader}>
            <Text style={[styles.menuTitle, isDark && styles.textLight]}>Menu Items</Text>
            <Text style={[styles.menuSubtitle, isDark && styles.menuSubtitleDark]}>
              Select an item to log it as a meal
            </Text>
          </View>
          
          {loading ? (
            <ActivityIndicator size="large" color="#2ecc71" style={styles.loader} />
          ) : errorMsg ? (
            <Text style={styles.errorText}>{errorMsg}</Text>
          ) : (
            <>
              {renderMenuCapture()}
              <View style={styles.searchContainer}>
                <View style={[styles.searchInputContainer, isDark && styles.searchInputContainerDark]}>
                  <Search size={18} color={isDark ? "#aaa" : "#888"} style={styles.searchIcon} />
                  <TextInput
                    style={[styles.searchInput, isDark && styles.searchInputDark]}
                    placeholder={isAddingMode ? "Add new menu item..." : "Search menu items..."}
                    placeholderTextColor={isDark ? "#777" : "#aaa"}
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    onSubmitEditing={isAddingMode ? addNewItemToRestaurant : undefined}
                  />
                  {searchQuery.length > 0 && (
                    <TouchableOpacity onPress={() => setSearchQuery('')}>
                      <X size={18} color={isDark ? "#aaa" : "#888"} />
                    </TouchableOpacity>
                  )}
                </View>
                <TouchableOpacity
                  style={styles.addButton}
                  onPress={isAddingMode ? addNewItemToRestaurant : () => setIsAddingMode(true)}
                  disabled={isAddingMode && (fetchingNutrition || !searchQuery.trim() || addingItem)}
                >
                  {isAddingMode ? (
                    fetchingNutrition || addingItem ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Plus size={20} color="#fff" />
                    )
                  ) : (
                    <Plus size={20} color="#fff" />
                  )}
                </TouchableOpacity>
              </View>
              
              {isAddingMode && (
                <TouchableOpacity 
                  style={[styles.cancelAddButton, isDark && styles.cancelAddButtonDark]}
                  onPress={() => {
                    setIsAddingMode(false);
                    setSearchQuery('');
                  }}
                >
                  <Text style={[styles.cancelAddText, isDark && styles.cancelAddTextDark]}>Cancel</Text>
                </TouchableOpacity>
              )}
              
              {filteredMenuItems.length > 0 ? (
                <FlatList
                  data={filteredMenuItems}
                  renderItem={renderMenuItem}
                  keyExtractor={(item) => item.id}
                  style={styles.menuList}
                  scrollEnabled={false}
                  ListEmptyComponent={
                    searchQuery.length > 0 ? (
                      <View style={[styles.emptyContainer, isDark && styles.emptyContainerDark]}>
                        <Text style={[styles.emptyText, isDark && styles.emptyTextDark]}>No matching menu items found</Text>
                      </View>
                    ) : null
                  }
                />
              ) : (
                <View style={[styles.emptyContainer, isDark && styles.emptyContainerDark]}>
                  {searchQuery.length > 0 ? (
                    <Text style={[styles.emptyText, isDark && styles.emptyTextDark]}>
                      No matching menu items found
                    </Text>
                  ) : (
                    <Text style={[styles.emptyText, isDark && styles.emptyTextDark]}>
                      No menu items available. Add the first one!
                    </Text>
                  )}
                </View>
              )}
            </>
          )}
        </View>
      </ScrollView>

      <PhotoCaptureModal
        visible={showMenuCamera}
        title="Capture Menu"
        hint="Keep the whole menu in frame and avoid glare."
        onCancel={() => setShowMenuCamera(false)}
        onConfirm={handleMenuPhotoConfirmed}
      />
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
  textLight: {
    color: '#f2f2f2',
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
    flex: 1,
    fontSize: 20,
    fontWeight: 'bold',
    color: '#2ecc71',
    textAlign: 'center',
    marginHorizontal: 10,
  },
  favoriteButton: {
    padding: 4,
  },
  content: {
    flex: 1,
  },
  contentDark: {
    backgroundColor: '#121212',
  },
  restaurantDetails: {
    padding: 16,
    paddingBottom: 90, // Additional padding for the tab bar
  },
  address: {
    fontSize: 16,
    color: '#555',
    marginBottom: 16,
  },
  addressDark: {
    color: '#aaa',
  },
  mapContainer: {
    height: 180,
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 24,
    position: 'relative',
    backgroundColor: '#e1e1e1',
  },
  map: {
    ...StyleSheet.absoluteFillObject,
  },
  webMapPlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  webMapText: {
    fontSize: 14,
    color: '#666',
    marginBottom: 16,
    textAlign: 'center',
  },
  directionsButton: {
    position: 'absolute',
    bottom: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2ecc71',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 20,
  },
  directionsText: {
    color: '#fff',
    fontWeight: 'bold',
    marginLeft: 4,
  },
  menuHeader: {
    marginBottom: 16,
  },
  menuTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 4,
  },
  menuSubtitle: {
    fontSize: 14,
    color: '#666',
  },
  menuSubtitleDark: {
    color: '#aaa',
  },
  searchContainer: {
    flexDirection: 'row',
    marginBottom: 12,
    alignItems: 'center',
  },
  searchInputContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'white',
    borderRadius: 8,
    paddingHorizontal: 12,
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    height: 44,
  },
  searchInputContainerDark: {
    backgroundColor: '#252525',
    borderColor: '#444',
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    height: '100%',
    fontSize: 16,
    color: '#333',
  },
  searchInputDark: {
    color: '#f2f2f2',
  },
  addButton: {
    width: 44,
    height: 44,
    backgroundColor: '#2ecc71',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cancelAddButton: {
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
    marginBottom: 16,
  },
  cancelAddButtonDark: {
    backgroundColor: '#2a2a2a',
  },
  cancelAddText: {
    color: '#666',
    fontWeight: 'bold',
  },
  cancelAddTextDark: {
    color: '#aaa',
  },
  menuList: {
    marginBottom: 16,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'white',
    borderRadius: 8,
    padding: 16,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 1,
  },
  menuItemDark: {
    backgroundColor: '#1e1e1e',
    shadowColor: '#000',
  },
  menuItemContent: {
    flex: 1,
  },
  menuItemName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 4,
  },
  nutritionInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  calorieText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#2ecc71',
  },
  macroDetails: {
    flexDirection: 'row',
  },
  macroText: {
    fontSize: 12,
    color: '#666',
    marginLeft: 8,
  },
  macroTextDark: {
    color: '#aaa',
  },
  emptyContainer: {
    backgroundColor: 'white',
    borderRadius: 8,
    padding: 24,
    alignItems: 'center',
    marginTop: 8,
  },
  emptyContainerDark: {
    backgroundColor: '#1e1e1e',
  },
  emptyText: {
    fontSize: 14,
    color: '#888',
    textAlign: 'center',
  },
  emptyTextDark: {
    color: '#aaa',
  },
  loader: {
    marginVertical: 24,
  },
  captureButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2ecc71',
    borderRadius: 8,
    paddingVertical: 12,
    marginBottom: 16,
    gap: 8,
  },
  captureButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
  captureStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
    gap: 8,
  },
  captureStatusText: {
    fontSize: 15,
    color: '#333',
  },
  capturePanel: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  capturePanelDark: {
    backgroundColor: '#1e1e1e',
  },
  captureTitle: {
    fontSize: 17,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 4,
  },
  captureNote: {
    fontSize: 13,
    color: '#888',
    marginBottom: 12,
  },
  capturedItem: {
    borderWidth: 1,
    borderColor: '#eee',
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
  },
  capturedItemDark: {
    borderColor: '#333',
  },
  capturedItemExcluded: {
    opacity: 0.5,
  },
  capturedItemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: '#2ecc71',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  checkboxChecked: {
    backgroundColor: '#2ecc71',
  },
  captureInput: {
    backgroundColor: '#f5f5f5',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#eee',
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontSize: 14,
    color: '#333',
  },
  captureInputDark: {
    backgroundColor: '#2a2a2a',
    borderColor: '#333',
    color: '#f2f2f2',
  },
  captureInputInvalid: {
    borderColor: '#ff6b6b',
    borderWidth: 2,
  },
  captureNameInput: {
    flex: 1,
    fontWeight: 'bold',
  },
  captureMacroRow: {
    flexDirection: 'row',
  },
  captureMacro: {
    flex: 1,
    marginHorizontal: 2,
  },
  captureMacroLabel: {
    fontSize: 12,
    color: '#666',
    marginBottom: 2,
  },
  captureWarning: {
    marginTop: 6,
    fontSize: 12,
    color: '#e67e22',
  },
  captureActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  captureActionButton: {
    flex: 1,
    marginBottom: 0,
    marginTop: 0,
  },
  errorText: {
    color: '#ff6b6b',
    textAlign: 'center',
    marginVertical: 24,
  },
});

export default RestaurantDetailsScreen;
