import { auth } from '../firebaseConfig';
import { localServerUrl } from './serverUrl';

const SERVER_URL = localServerUrl(process.env.EXPO_PUBLIC_SERVER_URL, 4000);

export type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

export interface Macros {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface ExtractedMenuItem {
  name: string;
  description: string | null;
  price: number | null;
  components: string[];
  estimatedPortionGrams: number | null;
  verified: false;
}

export interface DetectedFood extends Macros {
  name: string;
  servingDescription: string;
  estimatedGrams: number;
  confidence: 'high' | 'medium' | 'low';
  usdaSearchTerms: string[];
  verified: false;
}

export interface PlanSlotInput {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  locationType: 'home' | 'restaurant';
}

export interface PlanCandidate extends Macros {
  id: string;
  foodName: string;
  restaurantId: string;
  restaurantName: string;
  restaurantAddress?: string;
}

export interface MealPlanRequest {
  remainingCalories: number;
  dietaryPreferences: string[];
  exclusions?: string[];
  feedback?: string;
  slots: PlanSlotInput[];
  candidates: PlanCandidate[];
  previousPlan?: { slotId: string; dishName: string }[];
}

export interface PlannedMeal extends Macros {
  slotId: string;
  source: 'restaurant' | 'home';
  candidateId: string | null;
  dishName: string;
  portion: string;
  reason: string;
  estimated: boolean;
  restaurantId?: string;
  restaurantName?: string;
  restaurantAddress?: string | null;
}

export interface MealPlanResult {
  meals: PlannedMeal[];
  totals: Macros;
  notes: string | null;
}

export type AiErrorCode =
  | 'UNAUTHENTICATED'
  | 'INVALID_REQUEST'
  | 'IMAGE_TOO_LARGE'
  | 'IMAGE_ILLEGIBLE'
  | 'NO_ITEMS_FOUND'
  | 'FOOD_NOT_IDENTIFIED'
  | 'INSUFFICIENT_OPTIONS'
  | 'AI_NOT_CONFIGURED'
  | 'AI_BUSY'
  | 'AI_UNAVAILABLE'
  | 'AI_BAD_REQUEST'
  | 'AI_REFUSED'
  | 'AI_INVALID_RESPONSE'
  | 'NETWORK'
  | 'INTERNAL';

export class AiServiceError extends Error {
  constructor(public code: AiErrorCode, message: string, public status?: number) {
    super(message);
    this.name = 'AiServiceError';
  }

  get shouldOfferManualEntry() {
    return ['AI_NOT_CONFIGURED', 'AI_BUSY', 'AI_UNAVAILABLE', 'FOOD_NOT_IDENTIFIED', 'NETWORK'].includes(this.code);
  }
}

async function postToAi<T>(path: string, body: unknown): Promise<T> {
  const user = auth.currentUser;
  if (!user) {
    throw new AiServiceError('UNAUTHENTICATED', 'You must be signed in.');
  }
  const idToken = await user.getIdToken();

  let response: Response;
  try {
    response = await fetch(`${SERVER_URL}/ai${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify(body),
    });
  } catch {
    throw new AiServiceError('NETWORK', 'Could not reach the server. Check your connection and try again.');
  }

  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.success) {
    throw new AiServiceError(data?.code ?? 'INTERNAL', data?.message ?? 'Something went wrong. Please try again.', response.status);
  }
  return data as T;
}

export const extractMenuFromImage = (imageBase64: string, mediaType: ImageMediaType = 'image/jpeg') =>
  postToAi<{ items: ExtractedMenuItem[] }>('/extract-menu', { imageBase64, mediaType });

export const analyzeMealPhoto = (imageBase64: string, mediaType: ImageMediaType = 'image/jpeg') =>
  postToAi<{ foods: DetectedFood[]; totals: Macros }>('/analyze-meal-photo', { imageBase64, mediaType });

export const generateAiMealPlan = (request: MealPlanRequest) =>
  postToAi<MealPlanResult>('/meal-plan', request);
