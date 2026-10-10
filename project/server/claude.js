// Claude API proxy for MealCare (SRS 7.2.4 Capture Menu, 7.3.2 Log Meal by Photo,
// 7.4.1 Generate AI Daily Meal Plan, 7.4.3 Regenerate Meal Plan).
//
// The Anthropic API key stays server-side. Every route requires a valid
// Firebase ID token, and every AI response is schema-validated before it is
// returned to the app.

const express = require('express');
const admin = require('firebase-admin');
const Anthropic = require('@anthropic-ai/sdk');
const { zodOutputFormat } = require('@anthropic-ai/sdk/helpers/zod');
const z = require('zod/v4');

// =====================================================================
// ANTHROPIC API KEY
// Put your key in project/.env as:
//   ANTHROPIC_API_KEY=sk-ant-...
// Never prefix it with EXPO_PUBLIC_ (that would ship it inside the app).
// =====================================================================
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';

const CLAUDE_MODEL = 'claude-opus-5-5';
// Low effort keeps responses inside the SRS latency targets (10 s for plans, 15 s for photo logging).
const CLAUDE_EFFORT = 'low';
// If a safety classifier declines a request, the API retries it on a fallback model server-side.
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // Claude API per-image limit
const ALLOWED_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

const client = ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: ANTHROPIC_API_KEY, timeout: 30 * 1000, maxRetries: 1 })
  : null;

// Thrown for any failure the app should show to the user. `code` lets the app
// pick a fallback, e.g. offer manual logging on AI_UNAVAILABLE.
class AiRouteError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// ---------------------------------------------------------------------
// Output schemas (what Claude must return)
// ---------------------------------------------------------------------

const MenuExtractionSchema = z.object({
  legible: z.boolean().describe('false if the photo is too blurry, dark, or cropped to read the menu'),
  items: z.array(
    z.object({
      name: z.string().min(1).describe('Dish name exactly as written on the menu'),
      description: z.string().nullable(),
      price: z.number().nonnegative().nullable().describe('Price in the menu currency, or null if not shown'),
      components: z.array(z.string().min(1)).min(1)
        .describe('Constituent foods for nutrition-database lookup, e.g. "chicken rice" -> ["steamed chicken", "white rice"]'),
      estimatedPortionGrams: z.number().positive().nullable(),
    }),
  ),
});

const MacroFields = {
  calories: z.number().nonnegative().max(5000),
  protein: z.number().nonnegative().max(500),
  carbs: z.number().nonnegative().max(1000),
  fat: z.number().nonnegative().max(500),
};

const MealPhotoSchema = z.object({
  identified: z.boolean().describe('false if no food can be identified in the photo'),
  foods: z.array(
    z.object({
      name: z.string().min(1),
      servingDescription: z.string().describe('Human-readable portion, e.g. "1 plate", "1 bowl (350 ml)"'),
      estimatedGrams: z.number().positive().max(3000),
      ...MacroFields,
      confidence: z.enum(['high', 'medium', 'low']),
      usdaSearchTerms: z.array(z.string().min(1)).min(1)
        .describe('Generic food names suitable for a USDA FoodData Central search'),
    }),
  ),
});

const MealPlanSchema = z.object({
  meals: z.array(
    z.object({
      slotId: z.string(),
      source: z.enum(['restaurant', 'home']),
      candidateId: z.string().nullable().describe('id of the chosen candidate dish for restaurant meals; null for home meals'),
      dishName: z.string().min(1),
      portion: z.string(),
      ...MacroFields,
      reason: z.string().describe('One short sentence on why this dish fits'),
    }),
  ),
  notes: z.string().nullable(),
});

// ---------------------------------------------------------------------
// Request schemas (what the app must send)
// ---------------------------------------------------------------------

const ImageRequestSchema = z.object({
  imageBase64: z.string().min(1),
  mediaType: z.enum(ALLOWED_MEDIA_TYPES),
});

const MealPlanRequestSchema = z.object({
  remainingCalories: z.number().positive().max(10000),
  dietaryPreferences: z.array(z.string()).max(20).default([]),
  exclusions: z.array(z.string()).max(50).default([]),
  feedback: z.string().max(500).optional(),
  slots: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      startTime: z.string(),
      endTime: z.string(),
      locationType: z.enum(['home', 'restaurant']),
    }),
  ).min(1).max(8),
  // Dishes already filtered by the app for proximity and dietary rules, each
  // with stored nutrition (SRS 7.4.1: only stored menu items may be recommended).
  candidates: z.array(
    z.object({
      id: z.string(),
      foodName: z.string(),
      ...MacroFields,
      restaurantId: z.string(),
      restaurantName: z.string(),
      restaurantAddress: z.string().optional(),
    }),
  ).max(200).default([]),
  // For regeneration: the plan the user wants something different from.
  previousPlan: z.array(z.object({ slotId: z.string(), dishName: z.string() })).optional(),
});

// ---------------------------------------------------------------------
// Claude call helpers
// ---------------------------------------------------------------------

async function callClaude({ system, content, schema }) {
  if (!client) {
    throw new AiRouteError(503, 'AI_NOT_CONFIGURED', 'AI features are not configured on the server.');
  }

  let response;
  try {
    response = await client.beta.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 16000,
      betas: [FALLBACK_BETA],
      fallbacks: 'default',
      output_config: { effort: CLAUDE_EFFORT, format: zodOutputFormat(schema) },
      system,
      messages: [{ role: 'user', content }],
    });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      throw new AiRouteError(429, 'AI_BUSY', 'The AI service is busy right now. Please try again in a moment.');
    }
    if (error instanceof Anthropic.BadRequestError) {
      console.error('Claude rejected the request:', error.message);
      throw new AiRouteError(400, 'AI_BAD_REQUEST', 'The AI service could not process this request.');
    }
    if (error instanceof Anthropic.APIError) {
      // Covers auth errors, 5xx, timeouts and connection failures.
      console.error(`Claude API error ${error.status ?? ''}:`, error.message);
      throw new AiRouteError(503, 'AI_UNAVAILABLE', 'The AI service is temporarily unavailable.');
    }
    throw error;
  }

  // Check why Claude stopped before reading the content.
  if (response.stop_reason === 'refusal') {
    console.warn('Claude declined request:', response.stop_details);
    throw new AiRouteError(422, 'AI_REFUSED', 'The AI could not help with this request.');
  }
  if (response.stop_reason === 'max_tokens') {
    throw new AiRouteError(502, 'AI_INVALID_RESPONSE', 'The AI returned an incomplete result. Please try again.');
  }

  // Validate against the schema so unvalidated AI output never reaches the app.
  const text = response.content.find((block) => block.type === 'text')?.text;
  let parsed;
  try {
    parsed = schema.safeParse(JSON.parse(text));
  } catch {
    parsed = { success: false, error: new Error('Response was not valid JSON') };
  }
  if (!parsed.success) {
    console.error('Invalid structured output from Claude:', parsed.error.message);
    throw new AiRouteError(502, 'AI_INVALID_RESPONSE', 'The AI returned an invalid result. Please try again.');
  }
  return parsed.data;
}

function imageBlock({ imageBase64, mediaType }) {
  const data = imageBase64.replace(/^data:[^;]+;base64,/, '').replace(/\s/g, '');
  if (Buffer.byteLength(data, 'base64') > MAX_IMAGE_BYTES) {
    throw new AiRouteError(413, 'IMAGE_TOO_LARGE', 'Image is too large. Please compress it to under 5 MB.');
  }
  return { type: 'image', source: { type: 'base64', media_type: mediaType, data } };
}

function parseRequest(schema, body) {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new AiRouteError(400, 'INVALID_REQUEST', result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  }
  return result.data;
}

const round = (n) => Math.round(n * 10) / 10;

// ---------------------------------------------------------------------
// Feature functions
// ---------------------------------------------------------------------

// SRS 7.2.4 – Capture Restaurant Menu
async function extractMenu(image) {
  const result = await callClaude({
    system:
      'You read photographs of restaurant, hawker-stall and food-court menus in Singapore. ' +
      'Extract every dish that is legibly written. Do not invent dishes that are not on the menu. ' +
      'Break each dish into generic constituent foods so it can be matched against the USDA FoodData Central database.',
    content: [imageBlock(image), { type: 'text', text: 'Extract the dishes from this menu.' }],
    schema: MenuExtractionSchema,
  });

  if (!result.legible) {
    throw new AiRouteError(422, 'IMAGE_ILLEGIBLE', 'The menu could not be read. Please take a clearer photo.');
  }
  if (result.items.length === 0) {
    throw new AiRouteError(422, 'NO_ITEMS_FOUND', 'No dishes were found on this menu. Please retake the photo.');
  }
  // Nutrition is filled in afterwards from USDA FoodData Central; nothing here is verified yet.
  return { items: result.items.map((item) => ({ ...item, verified: false })) };
}

// SRS 7.3.2 – Log Meal by Photo
async function analyzeMealPhoto(image) {
  const result = await callClaude({
    system:
      'You identify foods in meal photographs, including Singaporean hawker dishes, and estimate portion sizes ' +
      'and nutrition. List each distinct food separately. Use the plate, bowl or utensils for scale. ' +
      'Report estimates honestly and lower the confidence when the portion or dish is unclear.',
    content: [imageBlock(image), { type: 'text', text: 'Identify the foods in this meal and estimate their nutrition.' }],
    schema: MealPhotoSchema,
  });

  if (!result.identified || result.foods.length === 0) {
    throw new AiRouteError(422, 'FOOD_NOT_IDENTIFIED', 'No food could be identified. You can log this meal manually.');
  }
  // AI values are estimates until the user reviews them and USDA data corroborates them.
  const foods = result.foods.map((food) => ({ ...food, verified: false }));
  const totals = foods.reduce(
    (t, f) => ({ calories: t.calories + f.calories, protein: t.protein + f.protein, carbs: t.carbs + f.carbs, fat: t.fat + f.fat }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );
  return { foods, totals: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, round(v)])) };
}

// SRS 7.4.1 / 7.4.3 – Generate or Regenerate AI Daily Meal Plan
async function generateMealPlan(req) {
  const restaurantSlots = req.slots.filter((s) => s.locationType === 'restaurant');
  if (restaurantSlots.length > 0 && req.candidates.length === 0) {
    throw new AiRouteError(422, 'INSUFFICIENT_OPTIONS', 'No nearby restaurant has saved menu items with calorie data yet. Capture a restaurant menu first, or switch those meals to Home.');
  }

  const candidatesById = new Map(req.candidates.map((c) => [c.id, c]));

  const prompt = [
    `Remaining calorie budget for today: ${req.remainingCalories} kcal.`,
    `Dietary preferences and restrictions (must be respected): ${req.dietaryPreferences.join(', ') || 'none'}.`,
    `Foods or dishes to exclude: ${req.exclusions.join(', ') || 'none'}.`,
    req.feedback ? `User feedback: ${req.feedback}` : null,
    req.previousPlan?.length
      ? `The user asked for a different plan. Previous plan, which should not be repeated:\n${req.previousPlan.map((m) => `- ${m.slotId}: ${m.dishName}`).join('\n')}`
      : null,
    '',
    'Plan exactly one meal for each of these slots:',
    ...req.slots.map((s) => `- slotId "${s.id}" (${s.name}, ${s.startTime}-${s.endTime}): ${s.locationType}`),
    '',
    'Candidate restaurant dishes (JSON). For restaurant slots, choose only from this list, set candidateId to its id and copy its nutrition values exactly:',
    JSON.stringify(req.candidates),
    '',
    'For home slots, suggest a realistic home-cooked dish, set candidateId to null, and estimate its nutrition.',
    'Keep the total calories of all meals at or below the remaining budget.',
  ].filter((line) => line !== null).join('\n');

  const result = await callClaude({
    system:
      'You are the meal-planning assistant in MealCare, a nutrition app for users in Singapore. ' +
      'You build a daily plan that fits the user\'s calorie budget and dietary restrictions. ' +
      'Never violate a dietary restriction. Never invent restaurant dishes or change their nutrition values.',
    content: prompt,
    schema: MealPlanSchema,
  });

  // Validate the structure and totals before the plan reaches the app (SRS 7.4.1).
  const slotIds = new Set(req.slots.map((s) => s.id));
  const seen = new Set();
  const meals = result.meals.map((meal) => {
    const slot = req.slots.find((s) => s.id === meal.slotId);
    if (!slotIds.has(meal.slotId) || seen.has(meal.slotId)) {
      throw new AiRouteError(502, 'AI_INVALID_RESPONSE', 'The AI returned a plan with unknown or duplicate meals.');
    }
    seen.add(meal.slotId);

    if (slot.locationType === 'restaurant') {
      const candidate = meal.candidateId && candidatesById.get(meal.candidateId);
      if (!candidate) {
        throw new AiRouteError(502, 'AI_INVALID_RESPONSE', 'The AI recommended a dish that is not on a stored menu.');
      }
      // Stored menu values are authoritative.
      return {
        slotId: meal.slotId,
        source: 'restaurant',
        candidateId: candidate.id,
        dishName: candidate.foodName,
        portion: meal.portion,
        calories: candidate.calories,
        protein: candidate.protein,
        carbs: candidate.carbs,
        fat: candidate.fat,
        restaurantId: candidate.restaurantId,
        restaurantName: candidate.restaurantName,
        restaurantAddress: candidate.restaurantAddress ?? null,
        reason: meal.reason,
        estimated: false,
      };
    }
    return {
      slotId: meal.slotId,
      source: 'home',
      candidateId: null,
      dishName: meal.dishName,
      portion: meal.portion,
      calories: meal.calories,
      protein: meal.protein,
      carbs: meal.carbs,
      fat: meal.fat,
      reason: meal.reason,
      estimated: true,
    };
  });

  if (seen.size !== slotIds.size) {
    throw new AiRouteError(502, 'AI_INVALID_RESPONSE', 'The AI returned an incomplete plan. Please try again.');
  }

  const totals = meals.reduce(
    (t, m) => ({ calories: t.calories + m.calories, protein: t.protein + m.protein, carbs: t.carbs + m.carbs, fat: t.fat + m.fat }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );
  // Allow a 5% margin for home-meal estimates.
  if (totals.calories > req.remainingCalories * 1.05) {
    throw new AiRouteError(502, 'AI_INVALID_RESPONSE', 'The generated plan exceeds your calorie budget. Please try again.');
  }

  return {
    meals: req.slots.map((s) => meals.find((m) => m.slotId === s.id)),
    totals: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, round(v)])),
    notes: result.notes,
  };
}

// ---------------------------------------------------------------------
// Express router
// ---------------------------------------------------------------------

// Rejects requests without a valid Firebase ID token (SRS 6.4).
async function requireFirebaseAuth(req, res, next) {
  const match = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  if (!match) {
    return res.status(401).json({ success: false, code: 'UNAUTHENTICATED', message: 'Sign in required.' });
  }
  try {
    req.user = await admin.auth().verifyIdToken(match[1]);
    next();
  } catch (error) {
    return res.status(401).json({ success: false, code: 'UNAUTHENTICATED', message: 'Session expired. Please sign in again.' });
  }
}

function handler(fn) {
  return async (req, res) => {
    try {
      const data = await fn(req);
      res.json({ success: true, ...data });
    } catch (error) {
      if (error instanceof AiRouteError) {
        return res.status(error.status).json({ success: false, code: error.code, message: error.message });
      }
      console.error(`Unexpected error in ${req.path}:`, error);
      res.status(500).json({ success: false, code: 'INTERNAL', message: 'Something went wrong. Please try again.' });
    }
  };
}

const router = express.Router();
// Images arrive as base64, so these routes need a larger body limit than the global parser.
router.use(express.json({ limit: '8mb' }));
router.use(requireFirebaseAuth);

router.post('/extract-menu', handler((req) => extractMenu(parseRequest(ImageRequestSchema, req.body))));
router.post('/analyze-meal-photo', handler((req) => analyzeMealPhoto(parseRequest(ImageRequestSchema, req.body))));
router.post('/meal-plan', handler((req) => generateMealPlan(parseRequest(MealPlanRequestSchema, req.body))));

if (!client) {
  console.warn('ANTHROPIC_API_KEY is not set in project/.env – /ai routes will return 503 until it is added.');
}

module.exports = { router, extractMenu, analyzeMealPhoto, generateMealPlan };
