export interface NutritionData {
  food_name?: string;
  nf_calories: number;
  nf_total_fat: number;
  nf_total_carbohydrate: number;
  nf_protein: number;
}

const USDA_API_KEY = process.env.EXPO_PUBLIC_USDA_API_KEY;

const toNumber = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const getNutrientValue = (food: any, nutrientNames: string[]): number => {
  const nutrients = food.foodNutrients || [];

  const match = nutrients.find((item: any) =>
    nutrientNames.some((name) =>
      item.nutrientName?.toLowerCase().includes(name.toLowerCase())
    )
  );

  return toNumber(match?.value);
};

export const fetchNutritionForFood = async (query: string): Promise<NutritionData | null> => {
  const response = await fetch(
    `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${USDA_API_KEY}&query=${encodeURIComponent(query)}&pageSize=1`
  );

  if (!response.ok) {
    throw new Error(`USDA request failed with status ${response.status}`);
  }

  const data = await response.json();
  const food = data.foods?.[0];

  if (!food) {
    return null;
  }

  return {
    food_name: food.description,
    nf_calories: getNutrientValue(food, ['Energy']),
    nf_total_fat: getNutrientValue(food, ['Total lipid', 'Total fat']),
    nf_total_carbohydrate: getNutrientValue(food, ['Carbohydrate']),
    nf_protein: getNutrientValue(food, ['Protein']),
  };
};

export interface DishNutritionEstimate {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  matchedComponents: string[];
  unmatchedComponents: string[];
}

const DEFAULT_PORTION_GRAMS = 350;

export const estimateDishNutrition = async (
  components: string[],
  portionGrams: number | null
): Promise<DishNutritionEstimate | null> => {
  if (components.length === 0) return null;
  const gramsPerComponent = (portionGrams || DEFAULT_PORTION_GRAMS) / components.length;

  const results = await Promise.all(
    components.map((component) => fetchNutritionForFood(component).catch(() => null))
  );

  const estimate: DishNutritionEstimate = {
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    matchedComponents: [],
    unmatchedComponents: [],
  };
  results.forEach((result, index) => {
    if (!result) {
      estimate.unmatchedComponents.push(components[index]);
      return;
    }
    const scale = gramsPerComponent / 100;
    estimate.calories += result.nf_calories * scale;
    estimate.protein += result.nf_protein * scale;
    estimate.carbs += result.nf_total_carbohydrate * scale;
    estimate.fat += result.nf_total_fat * scale;
    estimate.matchedComponents.push(components[index]);
  });

  return estimate.matchedComponents.length > 0 ? estimate : null;
};
