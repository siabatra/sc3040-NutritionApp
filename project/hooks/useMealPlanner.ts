import { useState, useEffect } from 'react';
import { auth, db } from '../firebaseConfig';
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import { MealSlot, MenuItem, Restaurant } from '../types/mealPlanner';
import { saveDailyPlan } from '../utils/mealPlanPersistence';

export interface UseMealPlannerProps {
  dietaryPreferences: string[];
  nearbyRestaurants?: Restaurant[];
}

export const useMealPlanner = ({ dietaryPreferences, nearbyRestaurants = [] }: UseMealPlannerProps) => {
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [slots, setSlots] = useState<MealSlot[]>([]);
  const [remainingCalories, setRemainingCalories] = useState<number>(0);
  const [dailyCalorieTarget, setDailyCalorieTarget] = useState<number>(2000);
  const [todayCalories, setTodayCalories] = useState<number>(0);
  const [homeRecipes, setHomeRecipes] = useState<MenuItem[]>([]);
  const [restaurantItems, setRestaurantItems] = useState<Record<string, MenuItem[]>>({});
  const [timeSlots, setTimeSlots] = useState([
    { id: 'breakfast', name: 'Breakfast', startTime: '07:00', endTime: '10:00', defaultTime: '08:30' },
    { id: 'lunch', name: 'Lunch', startTime: '12:00', endTime: '14:00', defaultTime: '12:30' },
    { id: 'snack', name: 'Snack', startTime: '15:00', endTime: '17:00', defaultTime: '16:00' },
    { id: 'dinner', name: 'Dinner', startTime: '18:00', endTime: '20:00', defaultTime: '19:00' },
  ]);

  useEffect(() => {
    const initializePlanner = async () => {
      if (!auth.currentUser) {
        setError('You must be logged in to plan your day');
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const timeframesDocRef = doc(db, 'timeframes', 'default');
        const timeframesDoc = await getDoc(timeframesDocRef);
        
        if (timeframesDoc.exists() && timeframesDoc.data().slots) {
          setTimeSlots(timeframesDoc.data().slots);
        }

        const userRef = doc(db, 'users', auth.currentUser.uid);
        const userDoc = await getDoc(userRef);
        
        if (userDoc.exists()) {
          const userData = userDoc.data();
          setDailyCalorieTarget(userData.dailyCalorieTarget || 2000);
          setTodayCalories(userData.todayCalories || 0);
          
          const remaining = (userData.dailyCalorieTarget || 2000) - (userData.todayCalories || 0);
          setRemainingCalories(remaining > 0 ? remaining : 0);
        }

        await fetchHomeRecipes();

        await fetchRestaurantItems();

        const availableSlots = timeSlots;
        
        const initializedSlots: MealSlot[] = availableSlots.map(slot => ({
          id: slot.id,
          name: slot.name,
          time: slot.defaultTime,
          locationType: 'home',
          menuItem: null,
          alternatives: [],
          notify: false,
          budget: 0,
        }));

        setSlots(initializedSlots);
      } catch (error) {
        console.error('Error initializing meal planner:', error);
        setError('Failed to initialize meal planner. Please try again.');
      } finally {
        setLoading(false);
      }
    };

    initializePlanner();
  }, [dietaryPreferences]);

  const fetchHomeRecipes = async () => {
    if (!auth.currentUser) return;

    try {
      const logsRef = collection(db, 'mealLogs');
      const q = query(
        logsRef, 
        where('userId', '==', auth.currentUser.uid),
        where('location.type', '==', 'custom')
      );
      
      const snapshot = await getDocs(q);
      
      const recipes: MenuItem[] = [];
      const uniqueNames = new Set<string>();
      
      snapshot.forEach(doc => {
        const data = doc.data();
        
        if (!uniqueNames.has(data.foodName)) {
          uniqueNames.add(data.foodName);
          
          recipes.push({
            id: doc.id,
            foodName: data.foodName,
            calories: data.calories,
            protein: data.protein,
            carbs: data.carbs,
            fat: data.fat,
            createdBy: data.userId,
            createdAt: data.createdAt
          });
        }
      });
      
      setHomeRecipes(recipes);
    } catch (error) {
      console.error('Error fetching home recipes:', error);
      setError('Failed to fetch home recipes');
    }
  };

  const fetchRestaurantItems = async () => {
    if (nearbyRestaurants.length === 0) return;
    
    try {
      const items: Record<string, MenuItem[]> = {};
      
      for (const restaurant of nearbyRestaurants) {
        const restaurantRef = doc(db, 'restaurants', restaurant.place_id);
        const restaurantDoc = await getDoc(restaurantRef);
        
        if (restaurantDoc.exists() && restaurantDoc.data().items) {
          items[restaurant.place_id] = restaurantDoc.data().items;
        } else {
          items[restaurant.place_id] = [];
        }
      }
      
      setRestaurantItems(items);
    } catch (error) {
      console.error('Error fetching restaurant items:', error);
      setError('Failed to fetch restaurant menu items');
    }
  };

  const itemConformsTo = (item: MenuItem, preferences: string[]): boolean => {
    return true;
  };

  const generateMealPlan = async () => {
    if (slots.length === 0) {
      setError('No available meal slots for today');
      return;
    }

    try {
      const perSlotBudget = Math.floor(remainingCalories / slots.length);
      
      const updatedSlots = [...slots].map(slot => ({
        ...slot,
        budget: perSlotBudget
      }));

      const finalSlots: MealSlot[] = await Promise.all(updatedSlots.map(async slot => {
        let candidates: MenuItem[] = [];
        
        if (slot.locationType === 'home') {
          candidates = [...homeRecipes];
        } else {
          const firstRestaurantId = Object.keys(restaurantItems)[0];
          if (firstRestaurantId) {
            candidates = restaurantItems[firstRestaurantId] || [];
          }
        }
        
        candidates = candidates.filter(item => itemConformsTo(item, dietaryPreferences));
        
        candidates = candidates.filter(item => item.calories <= slot.budget);
        
        candidates.sort((a, b) => {
          const diffA = Math.abs(slot.budget - a.calories);
          const diffB = Math.abs(slot.budget - b.calories);
          
          if (diffA !== diffB) return diffA - diffB;
          
          return (b.protein || 0) - (a.protein || 0);
        });
        
        return {
          ...slot,
          menuItem: candidates.length > 0 ? candidates[0] : null,
          alternatives: candidates.slice(1, 4)
        };
      }));
      
      setSlots(finalSlots);
    } catch (error) {
      console.error('Error generating meal plan:', error);
      setError('Failed to generate meal plan. Please try again.');
    }
  };

  const updateSlot = (slotId: string, updates: Partial<MealSlot>) => {
    setSlots(currentSlots => 
      currentSlots.map(slot => 
        slot.id === slotId ? { ...slot, ...updates } : slot
      )
    );
  };

  const swapMenuItem = (slotId: string) => {
    setSlots(currentSlots => {
      return currentSlots.map(slot => {
        if (slot.id === slotId) {
          const allOptions = [
            ...(slot.menuItem ? [slot.menuItem] : []),
            ...slot.alternatives
          ];
          
          if (allOptions.length <= 1) return slot;
          
          const rotatedOptions = [...allOptions.slice(1), allOptions[0]];
          
          return {
            ...slot,
            menuItem: rotatedOptions[0],
            alternatives: rotatedOptions.slice(1)
          };
        }
        return slot;
      });
    });
  };

  const saveMealPlan = async () => {
    if (!auth.currentUser) {
      setError('You must be logged in to save a meal plan');
      return;
    }

    try {
      const savedSlots = await saveDailyPlan(auth.currentUser.uid, slots, dietaryPreferences);
      setSlots(savedSlots);

      return true;
    } catch (error) {
      console.error('Error saving meal plan:', error);
      setError('Failed to save meal plan. Please try again.');
      return false;
    }
  };

  return {
    loading,
    error,
    slots,
    remainingCalories,
    dailyCalorieTarget,
    todayCalories,
    homeRecipes,
    restaurantItems,
    updateSlot,
    generateMealPlan,
    swapMenuItem,
    saveMealPlan
  };
};

export default useMealPlanner;
