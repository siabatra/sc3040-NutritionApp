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
