# NutritionApp

NutritionApp is an Expo React Native app for tracking meals, planning daily nutrition, finding nearby restaurants, saving favorite restaurants, and logging menu items with nutrition information.

The mobile app is in the `project` folder. The project also includes a small Express server used for email OTP verification and password reset support.

## Features

- Email/password authentication with Firebase Auth
- OTP email verification flow
- User profile setup with calorie target calculation
- Dashboard for daily calories and macros
- Meal logging and meal history
- Nearby restaurant search using Google Maps/Places
- Restaurant details, favorites, directions, and user-added menu items
- Nutrition lookup for food items using USDA FoodData Central
- AI meal plan generation
- Light/dark theme support

## Tech Stack

- Expo SDK 57
- React Native
- Expo Router
- Firebase Auth
- Cloud Firestore
- Firebase Admin SDK
- Express
- Nodemailer
- Google Maps / Places / Directions APIs
- USDA FoodData Central API

## Project Structure

```txt
NutritionApp-1/
  project/
    app/                 Expo Router screens
      (auth)/            Login, signup, OTP, profile setup
      (app)/             Dashboard, meals, restaurants, settings
    components/          Reusable UI components
    context/             Theme context
    server/              Express OTP/password reset server
    types/               TypeScript types
    utils/               Shared utilities
    firebaseConfig.ts    Firebase client configuration
    package.json         App scripts and dependencies
```

## Requirements

- Node.js
- npm
- Expo Go on your phone, compatible with the project Expo SDK
- Firebase project
- Cloud Firestore database
- Google Maps Platform API key
- USDA FoodData Central API credentials
- Gmail app password or another email provider for OTP emails

## Group Member Quick Start

Clone the repository, then open a terminal in its root folder. Install Node.js 22.20 or newer and npm.

Receive these files privately from the group and place them at these exact paths:

| File | Needed for |
| --- | --- |
| `project/.env` | Main app API configuration and email server credentials |
| `project/server/serviceAccountKey.json` | Firebase Admin access for the OTP/password-reset server |
| `meal rec test/.env` | Optional standalone meal recommendation script only |

The service account must belong to the Firebase project configured in `project/.env`. Group members using the shared project do not need to create another Firebase project or generate another service account key. Only share Admin credentials with members who need to run the server.

`project/server/serviceAccountKey.json.json` and the `project/*firebase-adminsdk*.json` files are not loaded by the server and do not need to be shared for setup. Keep them private. Windows may hide filename extensions: ensure the required server file ends in `.json` once, not `.json.json`.

1. Place the private files as listed above. Do not overwrite a populated `.env` with the blank template.
2. From the repository root, run `cd project`, then `npm install`.
3. For phone testing, set `EXPO_PUBLIC_SERVER_URL` in `project/.env` to the server computer's LAN address, for example `http://192.168.1.100:4000`. The phone and computer must be on the same network and port 4000 must be reachable. Use `http://localhost:4000` when testing in a browser on the server computer.
4. In this terminal, start the email server with `node server/server.js`.
5. In a second terminal at the repository root, run `cd project`, then `npx expo start --clear`. Scan the QR code with compatible Expo Go, or press `w` for web.
6. Optional: in a separate terminal at the repository root, run `cd "meal rec test"`, `npm install`, then `node meal-recommendation.mjs`.

Only the private files above need separate sharing; source code and blank `.env.example` templates come from GitHub. Share secrets through a private channel, never in GitHub issues or public chat. These files are ignored by Git; do not use `git add -f` to include them.

The setup below also describes configuration for anyone creating their own Firebase project.

## Setup

Install dependencies from the app folder:

```powershell
cd project
npm install
```

Use Node.js 22.20 or newer. Copy the safe template, then fill in the values shared privately by your group:

```powershell
Copy-Item .env.example .env
```

If you already received `project/.env`, place it in the `project` folder instead of overwriting it. Expo loads the `EXPO_PUBLIC_*` settings automatically. The email server loads the same file using Node's built-in environment loader. Existing shell environment variables take priority for the server.

Do not commit `.env`. Commit `.env.example`, which contains names only.

Enable Email/Password auth in Firebase:

```txt
Firebase Console > Authentication > Sign-in method > Email/Password > Enable
```

Create Cloud Firestore:

```txt
Firebase Console > Firestore Database > Create database
```

For local testing, Firestore rules can allow authenticated users:

```js
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

## Firebase Admin Setup

The OTP server requires a Firebase Admin service account key.

1. Open Firebase Console.
2. Go to Project Settings.
3. Open Service accounts.
4. Generate a new private key.
5. Save it as:

```txt
project/server/serviceAccountKey.json
```

Do not commit this file. It is already ignored by `.gitignore`.

## OTP Email Server

The server runs on port `4000`.

Set `EMAIL_USER` and `EMAIL_PASS` in `project/.env`, then start the server from `project`:

```powershell
node server/server.js
```

The server should print:

```txt
Firebase Admin SDK initialized successfully.
OTP server listening at http://localhost:4000
```

If testing on a physical phone, set `EXPO_PUBLIC_SERVER_URL` in `project/.env` to your computer's local network address and port 4000. Reload the app after changing environment settings.

## API Configuration

Set these variables in `project/.env`:

- `EXPO_PUBLIC_FIREBASE_*`: Firebase web app configuration.
- `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY`: Google Places and Directions API key.
- `EXPO_PUBLIC_USDA_API_KEY`: USDA FoodData Central API key used by the nutrition utility.
- `EXPO_PUBLIC_DEEPSEEK_API_KEY`: current client-side meal planning integration.
- `EXPO_PUBLIC_SERVER_URL`: email server address.
- `EMAIL_USER` and `EMAIL_PASS`: server-only email credentials; never add an `EXPO_PUBLIC_` prefix.

The standalone `meal rec test/meal-recommendation.mjs` uses its own `meal rec test/.env` (copy its `.env.example`). It has a different Firebase project configuration. Run `npm install` in that directory and then `node meal-recommendation.mjs`; the script loads the adjacent `.env` regardless of your working directory.

**Client-side limitation:** Expo includes all referenced `EXPO_PUBLIC_*` values in the built app. Ignoring `.env` protects source control, but does not hide those values from app users. The DeepSeek integration needs an authenticated backend before distributing the app with a private provider key. Firebase client configuration is designed for client use; protect the database with appropriate Security Rules and restrict Google API keys. See [Expo environment variable security](https://docs.expo.dev/guides/environment-variables/#security-considerations).

## Firestore Indexes

Some screens require composite indexes for `mealLogs`.

Create these indexes if Firebase shows an index error:

```txt
Collection ID: mealLogs
Fields:
userId Ascending
date Descending
__name__ Descending
```

```txt
Collection ID: mealLogs
Fields:
userId Ascending
date Ascending
__name__ Ascending
```

Firebase usually provides a direct link in the error log. Open the link, create the index, and wait until the status is `Enabled`.

## Running The App

Open each terminal at the repository root before running these commands.

Start the OTP server in one terminal:

```powershell
cd project
node server/server.js
```

Start Expo in another terminal:

```powershell
cd project
npx expo start --clear
```

Then scan the QR code with Expo Go.

## Useful Scripts

```powershell
npm run dev
```

Starts the Expo development server.

```powershell
npm run build:web
```

Exports the web build.

```powershell
npm run lint
```

Runs Expo linting.

## Notes For Expo Go

Remote push notification support from `expo-notifications` is not available in Expo Go for newer SDK versions. Use a development build if notification functionality is required.

## Before Pushing To GitHub

Check that no private keys or API secrets are committed:

- Firebase Admin service account JSON files
- Gmail app passwords
- Google Maps API keys
- USDA FoodData Central API keys
- AI provider API keys

If any secret was committed or shared, rotate it in the provider dashboard before making the repository public.


## Private Files and Existing Git History

Share `project/.env` and, if needed, `meal rec test/.env` through a private channel. The server also needs `project/server/serviceAccountKey.json`, shared separately and kept private. Other local Firebase Admin JSON copies must remain private too.

Do not push `.env` variants, service account JSON, email passwords, signing keys, credentials in `.npmrc`, logs containing emails or verification codes, or generated builds containing keys. The root `.gitignore` covers these common paths. Never include real user health records, locations, or account exports in fixtures or screenshots you publish.

The current Git commit already contains a DeepSeek key and Gmail app password. Rotate exposed credentials before publishing; moving them into `.env` does not remove them from earlier commits. Older commits can contain additional credentials. Clean the history before sharing this existing repository, or publish a fresh repository containing only reviewed source files. Do not copy `.git` into a fresh repository.

`meal rec test/node_modules` and root `.expo` files were already tracked before these ignore rules. Ignore rules do not untrack existing files; omit these generated directories from a fresh repository.

The email server's existing `/reset-password` endpoint accepts an email and new password without requiring proof of OTP verification. This is separate from the configuration changes and must be fixed before exposing that server publicly.
