import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

try {
  loadEnvFile(fileURLToPath(new URL("./.env", import.meta.url)));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
if (!process.env.DEEPSEEK_API_KEY) throw new Error("Set DEEPSEEK_API_KEY in meal rec test/.env");

import OpenAI from "openai";
import readline from "readline";
import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs } from "firebase/firestore";

const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID,
  measurementId: process.env.FIREBASE_MEASUREMENT_ID
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const openai = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: "https://api.deepseek.com"
});

const mealTimes = [
  { name: "breakfast", start: "08:00", end: "10:00" },
  { name: "lunch",     start: "12:00", end: "14:00" },
  { name: "snack",     start: "15:00", end: "16:00" },
  { name: "dinner",    start: "18:00", end: "20:00" }
];

const LATITUDE = 1.355049655134308;
const LONGITUDE = 103.68518139204353;

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function ask(q) {
  return new Promise((res) => rl.question(q, res));
}

function getDistance(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => deg * (Math.PI / 180);
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

async function fetchNearbyMenuItems() {
  const snapshot = await getDocs(collection(db, "restaurants"));
  const nearbyItems = [];

  snapshot.forEach((doc) => {
    const data = doc.data();
    if (data.location) {
      const dist = getDistance(
        data.location.lat,
        data.location.lng,
        LATITUDE,
        LONGITUDE
      );
      if (dist < 2.0 && data.items) {
        for (const item of data.items) {
          nearbyItems.push({
            ...item,
            restaurantName: data.name,
            restaurantAddress: data.address || ""
          });
        }
      }
    }
  });

  return nearbyItems;
}

async function generateMealPlan(mealSettings, caloriesLeft, dietaryPreferences, feedback = "") {
  const menuItems = await fetchNearbyMenuItems();

  const availableByMeal = {};
  for (const [meal, setting] of Object.entries(mealSettings)) {
    if (setting === "restaurant") {
      const items = menuItems.map(
        (i) =>
          `${i.foodName} (${i.calories} kcal) from ${i.restaurantName} [Address: ${i.restaurantAddress}]`
      );
      availableByMeal[meal] = items.length
        ? items.join("\n")
        : "No dishes found";
    } else {
      availableByMeal[meal] = "User will cook at home. You can invent any realistic dish.";
    }
  }

  const dietLabels = dietaryPreferences.length
    ? dietaryPreferences.join(", ")
    : "None";

  const timeInstructions = mealTimes
    .map(
      (t) => `- ${t.name}: ${t.start} - ${t.end}`
    )
    .join("\n");

  const messages = [
    {
      role: "system",
      content: `You are a meal recommendation assistant. 
Only return answers in the format specified by the user. 
Never guess the calories for restaurant items; use the data provided.`
    },
    {
      role: "user",
      content: `
Generate a meal plan for today with these constraints:

**Calories Remaining**: ${caloriesLeft} kcal
**Dietary Preferences**: ${dietLabels}
**User Feedback**: ${feedback || "None"}

We have four guaranteed meals: breakfast, lunch, snack, dinner.
Time ranges:
${timeInstructions}

If you need to add an extra snack to fit leftover calories, do so at a healthy time after dinner or between existing meals.

For each meal, output in this format exactly:

---
**Meal**: <meal name>
**Time Range**: <time range>
**Dish**: <dish name>
**Calories**: <kcal>
**Restaurant**: <restaurant name or 'home'>
**Address**: <restaurant address or 'N/A'>
**Why this dish**: <short reason>
---

Available dishes per meal:

${Object.entries(availableByMeal)
  .map(
    ([meal, list]) => `\n🍽️ ${meal.toUpperCase()}:\n${list}`
  )
  .join("\n")}
`
    }
  ];

  const completion = await openai.chat.completions.create({
    model: "deepseek-chat",
    messages
  });

  console.log(`\n🌟 Here's your meal plan:\n${completion.choices[0].message.content}`);
  return completion.choices[0].message.content;
}

async function main() {
  const totalCalories = parseInt(
    await ask("How many calories do you have remaining today? ")
  );

  const mealSettings = {};
  for (const t of mealTimes) {
    const setting = await ask(
      `For ${t.name}, do you want to eat at home or restaurant? (home/restaurant): `
    );
    mealSettings[t.name] = setting.toLowerCase() === "restaurant" ? "restaurant" : "home";
  }

  const prefInput = await ask(
    `Choose your dietary preferences (comma-separated numbers):
0: vegetarian
1: vegan
2: ketogenic
3: dairyFree
4: glutenFree
5: paleo
> `
  );
  const dietOptions = [
    "vegetarian",
    "vegan",
    "ketogenic",
    "dairyFree",
    "glutenFree",
    "paleo"
  ];
  const dietaryPrefs = prefInput
    .split(",")
    .map((x) => x.trim())
    .filter((x) => x !== "")
    .map((i) => dietOptions[parseInt(i, 10)])
    .filter(Boolean);

  let plan = await generateMealPlan(mealSettings, totalCalories, dietaryPrefs);

  while (true) {
    const action = await ask(
      "\n🔁 Do you want to [1] Regenerate full plan, [2] Swap one meal, or [Enter] to exit? "
    );
    if (action === "1") {
      const reason = await ask("Why do you want to regenerate the plan? (optional input): ");
      plan = await generateMealPlan(mealSettings, totalCalories, dietaryPrefs, reason);
    } else if (action === "2") {
      const swapMeal = await ask(
        "Which meal do you want to swap? (breakfast/lunch/snack/dinner): "
      );
      const reason = await ask("Any comments on why you're swapping " + swapMeal + "? (optional): ");

      const mealItems = mealSettings[swapMeal] === "restaurant"
        ? (await fetchNearbyMenuItems())
          .map(
            (i) => `${i.foodName} (${i.calories} kcal) from ${i.restaurantName} [Address: ${i.restaurantAddress}]`
          )
          .join("\n")
        : "User will cook at home. Be creative!";

      const messages = [
        {
          role: "system",
          content: `You are a meal swapping assistant. Only return the swapped meal in the format specified. 
Use only the provided calories from the data.`
        },
        {
          role: "user",
          content: `
I want to swap just one meal.

**Meal to swap**: ${swapMeal}
**Reason**: ${reason || "None"}
**Calories Remaining**: ${totalCalories}
**Dietary Preferences**: ${dietaryPrefs.join(", ") || "None"}
**Meal Setting**: ${mealSettings[swapMeal]}

Time range for ${swapMeal}:
${mealTimes.find((m) => m.name === swapMeal) ? `${mealTimes.find((m) => m.name === swapMeal).start} - ${mealTimes.find((m) => m.name === swapMeal).end}` : "N/A"}

Here are available dishes for this meal:
${mealItems}

Only return this format:
---
**Meal**: ${swapMeal}
**Time Range**: <time range>
**Dish**: <dish name>
**Calories**: <kcal>
**Restaurant**: <restaurant name or 'home'>
**Address**: <restaurant address or 'N/A'>
**Why this dish**: <reason>
---
`
        }
      ];

      const result = await openai.chat.completions.create({
        model: "deepseek-chat",
        messages
      });

      console.log(`\n✅ Swapped meal:\n${result.choices[0].message.content}`);
    } else {
      rl.close();
      break;
    }
  }
}

main();