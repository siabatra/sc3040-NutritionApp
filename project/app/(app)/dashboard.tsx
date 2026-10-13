import React, { useEffect, useState, useContext } from 'react';
import { 
  View, 
  Text, 
  TouchableOpacity, 
  StyleSheet, 
  ScrollView, 
  Alert,
  ActivityIndicator,
  Platform
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db } from '../../firebaseConfig';
import { doc, collection, query, where, onSnapshot, orderBy } from 'firebase/firestore';
import { Settings, Map, UtensilsCrossed, ChartBar as BarChart3, CalendarClock, Check } from 'lucide-react-native';
import { ThemeContext } from '../../context/ThemeContext';
import { dateKey, dayBounds } from '../../functions/lib/reporting';
import { logDailyPlanMeal } from '../../utils/mealPlanPersistence';

export interface MealPlanSlot {
  id: string;
  loggedMealId?: string;
  name: string;
  time: string;
  menuItem: {
    foodName: string;
    calories: number;
    protein?: number;
    carbs?: number;
    fat?: number;
    restaurantName?: string;
    restaurantAddress?: string;
    location?: {
      name?: string;
      address?: string;
    }
  } | null;
  locationType: 'home' | 'restaurant';
  reason?: string;
}

const DashboardScreen: React.FC = () => {
  const { theme } = useContext(ThemeContext);
  const isDark = theme === 'dark';
  
  const [userData, setUserData] = useState<any>(null);
  const [totalCalories, setTotalCalories] = useState<number>(0);
  const [caloriesLeft, setCaloriesLeft] = useState<number>(0);
  const [recentMeals, setRecentMeals] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [totalProtein, setTotalProtein] = useState<number>(0);
  const [totalCarbs, setTotalCarbs] = useState<number>(0);
  const [totalFat, setTotalFat] = useState<number>(0);
  const [isCalorieExceeded, setIsCalorieExceeded] = useState<boolean>(false);
  const [isProteinExceeded, setIsProteinExceeded] = useState<boolean>(false);
  const [isCarbsExceeded, setIsCarbsExceeded] = useState<boolean>(false);
  const [isFatExceeded, setIsFatExceeded] = useState<boolean>(false);
  
  const [todaysPlan, setTodaysPlan] = useState<MealPlanSlot[]>([]);
  const [planCreated, setPlanCreated] = useState<boolean>(false);
  
  const [uid, setUid] = useState<string | null>(auth.currentUser?.uid || null);
  useEffect(() => onAuthStateChanged(auth, (user) => setUid(user?.uid || null)), []);
  useEffect(() => {
    const target = userData?.dailyCalorieTarget || 2000;
    setCaloriesLeft(target - totalCalories); setIsCalorieExceeded(totalCalories > target);
    setIsProteinExceeded(totalProtein > target * 0.25 / 4);
    setIsCarbsExceeded(totalCarbs > target * 0.5 / 4);
    setIsFatExceeded(totalFat > target * 0.25 / 9);
  }, [userData?.dailyCalorieTarget, totalCalories, totalProtein, totalCarbs, totalFat]);
  useFocusEffect(React.useCallback(() => {
    setLoading(true); setRecentMeals([]); setTotalCalories(0);
    setTotalProtein(0); setTotalCarbs(0); setTotalFat(0);
    setTodaysPlan([]); setPlanCreated(false); setUserData(null);
    if (!uid) { setLoading(false); return; }
    const stops: (() => void)[] = [];
    const subscribe = () => {
      stops.splice(0).forEach((stop) => stop());
      const key = dateKey()!; const { start, end } = dayBounds(key);
      stops.push(onSnapshot(doc(db, 'users', uid), (snapshot) => setUserData(snapshot.exists() ? snapshot.data() : null), (error) => console.error('Profile sync failed:', error.message)));
      stops.push(onSnapshot(query(collection(db, 'mealLogs'), where('userId', '==', uid),
        where('date', '>=', start), where('date', '<', end), orderBy('date', 'desc')), (snapshot) => {
        const meals = snapshot.docs.map((entry) => ({ ...entry.data(), id: entry.id,
          date: entry.data().date?.toDate?.() || new Date(entry.data().date) }));
        const sum = (metric: string) => meals.reduce((total, meal) => {
          const value = (meal as Record<string, any>)[metric];
          return total + (typeof value === 'number' && Number.isFinite(value) ? value : 0);
        }, 0);
        setRecentMeals(meals); setTotalCalories(sum('calories')); setTotalProtein(sum('protein'));
        setTotalCarbs(sum('carbs')); setTotalFat(sum('fat')); setLoading(false);
      }, () => { setLoading(false); Alert.alert('Meal sync failed', 'Please reconnect and reopen the dashboard.'); }));
      stops.push(onSnapshot(doc(db, 'users', uid, 'plans', key), (snapshot) => {
        setPlanCreated(snapshot.exists()); setTodaysPlan(snapshot.data()?.slots || []);
      }));
    };
    let reportingDate = dateKey(); subscribe();
    const timer = setInterval(() => {
      if (dateKey() !== reportingDate) { reportingDate = dateKey(); subscribe(); }
    }, 30000);
    return () => { clearInterval(timer); stops.forEach((stop) => stop()); };
  }, [uid]));

  const logPlannedMeal = async (slot: MealPlanSlot) => {
    if (!auth.currentUser || !slot.menuItem) return;
    
    try {
      const updatedSlots = await logDailyPlanMeal(auth.currentUser.uid, slot.id);
      setTodaysPlan(updatedSlots);
      Alert.alert('Success', 'Meal logged successfully!');
    } catch (error) {
      console.error('Error logging planned meal:', error);
      Alert.alert('Error', 'Failed to log meal');
    }
  };
  
  const welcomeMessage = `Welcome${userData?.name ? ', ' + userData.name : userData?.email ? ', ' + userData.email.split('@')[0] : ''}!`;

  const navigateToRestaurants = () => {
    router.push('/(app)/nearby-restaurants');
  };

  const navigateToMealLogging = (mealType?: string) => {
    if (mealType) {
      router.push({
        pathname: '/(app)/meal-logging',
        params: { mealType }
      });
    } else {
      router.push('/(app)/meal-logging');
    }
  };
  
  const navigateToMealHistory = () => {
    router.push('/(app)/meal-history');
  };

  const navigateToAnalytics = () => {
    router.push('/(app)/dining-analytics');
  };

  const navigateToSettings = () => {
    router.push('/(app)/settings');
  };

  const navigateToPlanMyDay = () => {
    router.push('/(app)/plan-my-day');
  };
  
  const renderRecentFoods = () => {
    if (recentMeals.length === 0) {
      return <Text style={[styles.emptyStateText, isDark && styles.emptyStateTextDark]}>No foods added yet</Text>;
    }
    
    return (
      <View style={styles.recentFoodsContainer}>
        {recentMeals.slice(0, 3).map((meal) => (
          <View key={meal.id} style={[styles.recentFoodItem, isDark && styles.recentFoodItemDark]}>
            <View style={styles.recentFoodInfo}>
              <Text style={[styles.recentFoodName, isDark && styles.textLight]}>{meal.foodName}</Text>
              <Text style={[styles.recentFoodLocation, isDark && styles.recentFoodLocationDark]}>
                {meal.mealType ? meal.mealType.charAt(0).toUpperCase() + meal.mealType.slice(1) : ''}
                {meal.mealType && meal.location?.name ? ' • ' : ''}
                {meal.location?.name || 'Custom meal'}
              </Text>
            </View>
            <View style={styles.recentFoodCalories}>
              <Text style={styles.calorieValue}>{Math.round(meal.calories)}</Text>
              <Text style={[styles.calorieLabel, isDark && styles.calorieLabelDark]}>cal</Text>
            </View>
          </View>
        ))}
        {recentMeals.length > 3 && (
          <TouchableOpacity 
            style={[styles.viewAllButton, isDark && styles.viewAllButtonDark]}
            onPress={navigateToMealHistory}
          >
            <Text style={[styles.viewAllText, isDark && styles.viewAllTextDark]}>View All</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  const renderMacroProgress = () => {
    const dailyTarget = userData?.dailyCalorieTarget || 2000;
    const proteinTarget = dailyTarget * 0.25 / 4;
    const carbsTarget = dailyTarget * 0.5 / 4;
    const fatTarget = dailyTarget * 0.25 / 9;
    
    return (
      <View style={styles.macroContainer}>
        <View style={styles.macroItem}>
          <View style={styles.macroHeader}>
            <Text style={[styles.macroLabel, isDark && styles.textLight]}>Protein</Text>
            <Text style={[styles.macroValue, isProteinExceeded && styles.exceededText, isDark && styles.textLight]}>
              {Math.round(totalProtein)}g
              <Text style={[styles.macroTarget, isDark && styles.macroTargetDark]}> / {Math.round(proteinTarget)}g</Text>
              {isProteinExceeded && <Text style={styles.exceededIndicator}> (Exceeded)</Text>}
            </Text>
          </View>
          <View style={[styles.macroProgressBar, isDark && styles.macroProgressBarDark]}>
            <View 
              style={[
                styles.macroProgress, 
                { 
                  width: `${Math.min(100, (totalProtein / proteinTarget) * 100)}%`, 
                  backgroundColor: isProteinExceeded ? '#e74c3c' : '#3498db' 
                }
              ]}
            />
          </View>
        </View>
        
        <View style={styles.macroItem}>
          <View style={styles.macroHeader}>
            <Text style={[styles.macroLabel, isDark && styles.textLight]}>Carbs</Text>
            <Text style={[styles.macroValue, isCarbsExceeded && styles.exceededText, isDark && styles.textLight]}>
              {Math.round(totalCarbs)}g
              <Text style={[styles.macroTarget, isDark && styles.macroTargetDark]}> / {Math.round(carbsTarget)}g</Text>
              {isCarbsExceeded && <Text style={styles.exceededIndicator}> (Exceeded)</Text>}
            </Text>
          </View>
          <View style={[styles.macroProgressBar, isDark && styles.macroProgressBarDark]}>
            <View 
              style={[
                styles.macroProgress, 
                { 
                  width: `${Math.min(100, (totalCarbs / carbsTarget) * 100)}%`, 
                  backgroundColor: isCarbsExceeded ? '#e74c3c' : '#f39c12' 
                }
              ]}
            />
          </View>
        </View>
        
        <View style={styles.macroItem}>
          <View style={styles.macroHeader}>
            <Text style={[styles.macroLabel, isDark && styles.textLight]}>Fat</Text>
            <Text style={[styles.macroValue, isFatExceeded && styles.exceededText, isDark && styles.textLight]}>
              {Math.round(totalFat)}g
              <Text style={[styles.macroTarget, isDark && styles.macroTargetDark]}> / {Math.round(fatTarget)}g</Text>
              {isFatExceeded && <Text style={styles.exceededIndicator}> (Exceeded)</Text>}
            </Text>
          </View>
          <View style={[styles.macroProgressBar, isDark && styles.macroProgressBarDark]}>
            <View 
              style={[
                styles.macroProgress, 
                { 
                  width: `${Math.min(100, (totalFat / fatTarget) * 100)}%`,
                  backgroundColor: isFatExceeded ? '#e74c3c' : '#e67e22' 
                }
              ]}
            />
          </View>
        </View>
      </View>
    );
  };

  const formatTimeForDisplay = (time: string) => {
    if (!time) return "";
    const [hours, minutes] = time.split(':').map(Number);
    const period = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;
    return `${displayHours}:${minutes.toString().padStart(2, '0')} ${period}`;
  };

  const renderTodaysPlan = () => {
    if (!planCreated) {
      return (
        <View style={[styles.emptyPlanContainer, isDark && styles.emptyPlanContainerDark]}>
          <Text style={[styles.emptyPlanText, isDark && styles.textLight]}>
            No meal plan for today
          </Text>
          <TouchableOpacity
            style={styles.createPlanButton}
            onPress={navigateToPlanMyDay}
          >
            <Text style={styles.createPlanButtonText}>Create Plan</Text>
          </TouchableOpacity>
        </View>
      );
    }
    
    if (todaysPlan.length === 0) {
      return (
        <View style={[styles.emptyPlanContainer, isDark && styles.emptyPlanContainerDark]}>
          <Text style={[styles.emptyPlanText, isDark && styles.textLight]}>
            No meal plan for today
          </Text>
          <TouchableOpacity
            style={styles.createPlanButton}
            onPress={navigateToPlanMyDay}
          >
            <Text style={styles.createPlanButtonText}>Create Plan</Text>
          </TouchableOpacity>
        </View>
      );
    }
    
    const allCompleted = todaysPlan.every(slot => Boolean(slot.loggedMealId) || !slot.menuItem);
    if (allCompleted) {
      return (
        <View style={[styles.completedPlanContainer, isDark && styles.completedPlanContainerDark]}>
          <Check size={40} color="#2ecc71" />
          <Text style={[styles.completedPlanTitle, isDark && styles.textLight]}>Meal Plan Completed!</Text>
          <Text style={[styles.completedPlanSubtitle, isDark && styles.textLight]}>
            Great job completing today's plan!
          </Text>
        </View>
      );
    }
    
    return (
      <View style={styles.planContainer}>
        {todaysPlan.map(slot => (
          <View key={slot.id} style={[styles.planItem, isDark && styles.planItemDark]}>
            <View style={styles.planItemHeader}>
              <Text style={[styles.planItemTitle, isDark && styles.textLight]}>{slot.name}</Text>
              <Text style={[styles.planItemTime, isDark && styles.planItemTimeDark]}>
                {formatTimeForDisplay(slot.time)}
              </Text>
            </View>
            {slot.menuItem && !slot.loggedMealId ? (
              <>
                <View style={styles.planItemDetails}>
                  <View style={styles.planItemFood}>
                    <Text style={[styles.planItemFoodName, isDark && styles.textLight]}>
                      {slot.menuItem.foodName}
                    </Text>
                    {slot.locationType === 'restaurant' && slot.menuItem.location && slot.menuItem.location.name && (
                      <Text style={[styles.restaurantDetails, isDark && styles.textLight]}>
                        {slot.menuItem.location.name}
                        {slot.menuItem.location.address ? ` - ${slot.menuItem.location.address}` : ''}
                      </Text>
                    )}
                    <View style={styles.planItemMacros}>
                      <Text style={styles.planItemCalories}>{Math.round(slot.menuItem.calories)} cal</Text>
                      <Text style={[styles.planItemMacro, isDark && styles.planItemMacroDark]}>
                        P: {slot.menuItem.protein ? Math.round(slot.menuItem.protein) : 0}g
                      </Text>
                      <Text style={[styles.planItemMacro, isDark && styles.planItemMacroDark]}>
                        C: {slot.menuItem.carbs ? Math.round(slot.menuItem.carbs) : 0}g
                      </Text>
                      <Text style={[styles.planItemMacro, isDark && styles.planItemMacroDark]}>
                        F: {slot.menuItem.fat ? Math.round(slot.menuItem.fat) : 0}g
                      </Text>
                    </View>
                  </View>
                  <TouchableOpacity
                    style={styles.planItemLogButton}
                    onPress={() => logPlannedMeal(slot)}
                  >
                    <Check size={16} color="#fff" />
                  </TouchableOpacity>
                </View>
                <View style={styles.planItemLocation}>
                  <Text style={[styles.planItemLocationText, isDark && styles.planItemLocationTextDark]}>
                    {slot.locationType === 'home' ? '🏠 Home' : '🍽️ Restaurant'}
                  </Text>
                </View>
              </>
            ) : (
              <View style={styles.completedContainer}>
                <Check size={16} color="#2ecc71" />
                <Text style={[styles.completedText, isDark && styles.textLight]}>Meal Completed</Text>
              </View>
            )}
          </View>
        ))}
      </View>
    );
  };

  const doDisplayDashboard = () => (
    <>
      <View style={[styles.header, isDark && styles.headerDark]}>
        <Text style={[styles.welcomeMessage, isDark && styles.welcomeMessageDark]}>{welcomeMessage}</Text>
        <TouchableOpacity onPress={navigateToSettings}>
          <Settings color={isDark ? "#2ecc71" : "#2ecc71"} size={24} />
        </TouchableOpacity>
      </View>
      
      <View style={[styles.calorieCard, isDark && styles.calorieCardDark]}>
        <View style={styles.calorieInfo}>
          <Text style={[styles.calorieTitle, isDark && styles.calorieTitleDark]}>Daily Calories</Text>
          <Text style={[
            styles.calorieValue,
            isCalorieExceeded ? styles.calorieValueExceeded : isDark ? styles.calorieValueDark : null
          ]}>
            {caloriesLeft < 0 ? '-' : ''}{Math.abs(Math.round(caloriesLeft))}
          </Text>
          <Text style={[styles.calorieSubtext, isDark && styles.calorieSubtextDark]}>
            {caloriesLeft >= 0 ? 'remaining' : 'over limit'}
          </Text>
          {isCalorieExceeded && (
            <View style={[styles.warningBadge, isDark && styles.warningBadgeDark]}>
              <Text style={styles.warningText}>Daily limit exceeded</Text>
            </View>
          )}
        </View>
        <View style={styles.calorieProgress}>
          <View style={[styles.progressBar, isDark && styles.progressBarDark]}>
            <View 
              style={[
                styles.progressFill, 
                { 
                  width: `${Math.min(100, (totalCalories / (userData?.dailyCalorieTarget || 2000)) * 100)}%`,
                  backgroundColor: isCalorieExceeded ? '#e74c3c' : '#2ecc71'
                }
              ]}
            />
          </View>
          <View style={styles.progressLabels}>
            <Text style={[styles.progressLabel, isDark && styles.progressLabelDark]}>{Math.round(totalCalories)} consumed</Text>
            <Text style={[styles.progressLabel, isDark && styles.progressLabelDark]}>{userData?.dailyCalorieTarget || 2000} goal</Text>
          </View>
        </View>
        
        {renderMacroProgress()}
        
        <TouchableOpacity 
          style={styles.analyticsButton}
          onPress={navigateToAnalytics}
        >
          <BarChart3 size={16} color="#fff" />
          <Text style={styles.analyticsButtonText}>View Full Analytics</Text>
        </TouchableOpacity>
      </View>
      
      <Text style={[styles.sectionTitle, isDark && styles.sectionTitleDark]}>Quick Actions</Text>
      <View style={styles.actionButtons}>
        <TouchableOpacity style={[styles.actionButton, isDark && styles.actionButtonDark]} onPress={navigateToRestaurants}>
          <Map color="#2ecc71" size={24} style={styles.actionIcon} />
          <Text style={[styles.actionButtonText, isDark && styles.actionButtonTextDark]}>Find Restaurants</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionButton, isDark && styles.actionButtonDark]} onPress={() => navigateToMealLogging()}>
          <UtensilsCrossed color="#2ecc71" size={24} style={styles.actionIcon} />
          <Text style={[styles.actionButtonText, isDark && styles.actionButtonTextDark]}>Log Custom Meal</Text>
        </TouchableOpacity>
      </View>
      
      <TouchableOpacity 
        style={[styles.planMyDayButton, isDark && styles.planMyDayButtonDark]} 
        onPress={navigateToPlanMyDay}
      >
        <CalendarClock size={20} color="#fff" />
        <Text style={styles.planMyDayText}>Plan My Day</Text>
      </TouchableOpacity>
      
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, isDark && styles.sectionTitleDark]}>Today's Plan</Text>
      </View>
      {renderTodaysPlan()}
      
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, isDark && styles.sectionTitleDark]}>Recent Foods</Text>
        <TouchableOpacity onPress={navigateToMealHistory}>
          <Text style={[styles.viewAllLink, isDark && styles.viewAllLinkDark]}>View All</Text>
        </TouchableOpacity>
      </View>
      {renderRecentFoods()}
    </>
  );

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      {loading ? (
        <View style={[styles.loadingContainer, isDark && styles.loadingContainerDark]}>
          <ActivityIndicator size="large" color="#2ecc71" />
          <Text style={[styles.loadingText, isDark && styles.textLight]}>Loading your dashboard...</Text>
        </View>
      ) : (
        <ScrollView 
          style={styles.scrollView} 
          contentContainerStyle={[styles.contentContainer, isDark && styles.contentContainerDark]}
          showsVerticalScrollIndicator={false}
        >
          {doDisplayDashboard()}
        </ScrollView>
      )}
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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingContainerDark: {
    backgroundColor: '#121212',
  },
  loadingText: {
    fontSize: 16,
    color: '#666',
    marginTop: 12,
  },
  textLight: {
    color: '#f2f2f2',
  },
  scrollView: {
    flex: 1,
  },
  contentContainer: {
    padding: 20,
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingBottom: 90,
  },
  contentContainerDark: {
    backgroundColor: '#121212',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  headerDark: {
    borderBottomColor: '#2a2a2a',
  },
  welcomeMessage: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#2ecc71',
  },
  welcomeMessageDark: {
    color: '#2ecc71',
  },
  calorieCard: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 20,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  calorieCardDark: {
    backgroundColor: '#1e1e1e',
    shadowColor: '#000',
  },
  calorieInfo: {
    alignItems: 'center',
    marginBottom: 15,
  },
  calorieTitle: {
    fontSize: 16,
    color: '#666',
    marginBottom: 8,
  },
  calorieTitleDark: {
    color: '#aaa',
  },
  calorieValue: {
    fontSize: 48,
    fontWeight: 'bold',
    color: '#2ecc71',
  },
  calorieValueDark: {
    fontSize: 48,
    fontWeight: 'bold',
    color: '#2ecc71',
  },
  calorieValueExceeded: {
    color: '#e74c3c',
  },
  calorieSubtext: {
    fontSize: 14,
    color: '#888',
  },
  calorieSubtextDark: {
    color: '#aaa',
  },
  warningBadge: {
    backgroundColor: '#ffebeb',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 12,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#ffcdd2',
  },
  warningBadgeDark: {
    backgroundColor: '#4e2c2c',
    borderColor: '#632f2f',
  },
  warningText: {
    color: '#e74c3c',
    fontSize: 12,
    fontWeight: 'bold',
  },
  calorieProgress: {
    marginTop: 10,
  },
  progressBar: {
    height: 10,
    backgroundColor: '#f0f0f0',
    borderRadius: 5,
    overflow: 'hidden',
  },
  progressBarDark: {
    backgroundColor: '#2a2a2a',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#2ecc71',
  },
  progressLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 5,
  },
  progressLabel: {
    fontSize: 12,
    color: '#888',
  },
  progressLabelDark: {
    color: '#aaa',
  },
  macroContainer: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
  },
  macroItem: {
    marginBottom: 10,
  },
  macroHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  macroLabel: {
    fontSize: 14,
    color: '#666',
  },
  macroValue: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#333',
  },
  exceededText: {
    color: '#e74c3c',
  },
  exceededIndicator: {
    fontSize: 12,
    fontWeight: 'normal',
    color: '#e74c3c',
  },
  macroTarget: {
    fontWeight: 'normal',
    color: '#999',
    fontSize: 12,
  },
  macroTargetDark: {
    color: '#777',
  },
  macroProgressBar: {
    height: 6,
    backgroundColor: '#f0f0f0',
    borderRadius: 3,
    overflow: 'hidden',
  },
  macroProgressBarDark: {
    backgroundColor: '#2a2a2a',
  },
  macroProgress: {
    height: '100%',
  },
  analyticsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2ecc71',
    borderRadius: 8,
    paddingVertical: 10,
    marginTop: 16,
  },
  analyticsButtonText: {
    color: 'white',
    fontWeight: 'bold',
    marginLeft: 8,
  },
  planMyDayButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#3498db',
    borderRadius: 8,
    paddingVertical: 12,
    marginBottom: 20,
  },
  planMyDayButtonDark: {
    backgroundColor: '#2980b9',
  },
  planMyDayText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 16,
    marginLeft: 8,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginTop: 15,
    marginBottom: 10,
    color: '#333',
  },
  sectionTitleDark: {
    color: '#f2f2f2',
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 15,
    marginBottom: 10,
  },
  viewAllLink: {
    color: '#2ecc71',
    fontWeight: 'bold',
  },
  viewAllLinkDark: {
    color: '#2ecc71',
  },
  actionButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 15,
  },
  actionButton: {
    backgroundColor: 'white',
    width: '48%',
    padding: 15,
    borderRadius: 8,
    marginBottom: 10,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 1,
  },
  actionButtonDark: {
    backgroundColor: '#1e1e1e',
    shadowColor: '#000',
  },
  actionIcon: {
    marginBottom: 8,
  },
  actionButtonText: {
    color: '#2ecc71',
    fontWeight: 'bold',
  },
  actionButtonTextDark: {
    color: '#2ecc71',
  },
  planContainer: {
    marginBottom: 20,
  },
  planItem: {
    backgroundColor: 'white',
    borderRadius: 8,
    padding: 12,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 1,
  },
  planItemDark: {
    backgroundColor: '#1e1e1e',
    shadowColor: '#000',
  },
  planItemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  planItemTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
  },
  planItemTime: {
    fontSize: 13,
    color: '#666',
  },
  planItemTimeDark: {
    color: '#aaa',
  },
  planItemDetails: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  planItemFood: {
    flex: 1,
  },
  planItemFoodName: {
    fontSize: 14,
    color: '#333',
    marginBottom: 4,
  },
  restaurantDetails: {
    fontSize: 14,
    color: '#888',
    marginTop: 4,
  },
  planItemMacros: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  planItemCalories: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#2ecc71',
    marginRight: 8,
  },
  planItemMacro: {
    fontSize: 12,
    color: '#666',
    marginRight: 8,
  },
  planItemMacroDark: {
    color: '#aaa',
  },
  planItemLogButton: {
    backgroundColor: '#2ecc71',
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  planItemLocation: {
    marginTop: 8,
  },
  planItemLocationText: {
    fontSize: 12,
    color: '#666',
  },
  planItemLocationTextDark: {
    color: '#aaa',
  },
  emptyPlanContainer: {
    backgroundColor: 'white',
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
    marginBottom: 20,
  },
  emptyPlanContainerDark: {
    backgroundColor: '#1e1e1e',
  },
  emptyPlanText: {
    fontSize: 14,
    color: '#666',
    marginBottom: 12,
  },
  createPlanButton: {
    backgroundColor: '#3498db',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  createPlanButtonText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 14,
  },
  recentFoodsContainer: {
    marginBottom: 15,
  },
  recentFoodItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: 'white',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 1,
  },
  recentFoodItemDark: {
    backgroundColor: '#1e1e1e',
    shadowColor: '#000',
  },
  recentFoodInfo: {
    flex: 1,
  },
  recentFoodName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
  },
  recentFoodLocation: {
    fontSize: 12,
    color: '#888',
  },
  recentFoodLocationDark: {
    color: '#aaa',
  },
  recentFoodCalories: {
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
  },
  calorieLabel: {
    fontSize: 12,
    color: '#888',
  },
  calorieLabelDark: {
    color: '#aaa',
  },
  viewAllButton: {
    backgroundColor: '#f0f0f0',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  viewAllButtonDark: {
    backgroundColor: '#2a2a2a',
  },
  viewAllText: {
    color: '#2ecc71',
    fontWeight: 'bold',
  },
  viewAllTextDark: {
    color: '#2ecc71',
  },
  emptyStateText: {
    textAlign: 'center',
    color: '#888',
    padding: 20,
    backgroundColor: 'white',
    borderRadius: 8,
    fontStyle: 'italic',
  },
  emptyStateTextDark: {
    backgroundColor: '#1e1e1e',
    color: '#aaa',
  },
  completedContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    justifyContent: 'center',
  },
  completedText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#2ecc71',
    marginLeft: 6,
  },
  completedPlanContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    backgroundColor: '#e8f5e9',
    borderRadius: 12,
    marginBottom: 20,
  },
  completedPlanContainerDark: {
    backgroundColor: '#2e7d32',
  },
  completedPlanTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#2ecc71',
    marginTop: 8,
  },
  completedPlanSubtitle: {
    fontSize: 16,
    color: '#666',
    marginTop: 4,
  }
});

export default DashboardScreen;
