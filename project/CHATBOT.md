# MealCare app help

A small chat icon at the top of every signed-in screen opens MealCare Help. It answers feature and navigation questions using the app reference in `server/app-help.md`, with conversation follow-ups, starter questions, clear conversation, loading, errors and retry. The assistant cannot read personal account data or perform actions. Messages are kept in memory; signing out clears them.

## Local setup

Add these values to the ignored `project/.env`:

```dotenv
OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=gpt-4.1-mini
```

The key is server-only: never use an `EXPO_PUBLIC_` prefix for it. An OpenAI API account with API billing is required. Restart `npm run dev` from `project` after changing configuration. This starts Expo, the analytics worker and the authenticated chat server on port 4001. Existing Firebase Admin credentials used by the analytics worker also verify chat sign-in tokens.

For a physical phone, set `EXPO_PUBLIC_CHATBOT_URL=http://YOUR_COMPUTER_LAN_IP:4001` and use the same network. Without an override, web uses its current hostname and native uses the Expo development host. The standalone server command is `npm run chatbot:server`. If changing `CHATBOT_PORT`, set the frontend URL to the same port. Production needs a deployed HTTPS server and an HTTPS frontend URL; localhost development does not deploy it.

## Verification

Run `npm run chatbot:test` for authenticated route, grounding, model restrictions, validation, provider error, missing-key and rate-limit tests. These use a mock OpenAI response and do not spend API credits.

With a configured key, sign in, tap the top chat icon, ask “How do I add a planned meal?”, then ask a follow-up. Verify a useful answer, close/reopen conversation, Clear, sign-out clearing, dark theme, and navigation between screens. Ask about your account totals: the assistant should explain where to find them rather than claim access. Stop the chat server to check connection error and Retry.

## Backend

`POST /api/chat` requires a Firebase ID token and at most 12 user/assistant messages, each up to 3,000 characters. Only the official OpenAI Responses API is used, with `store: false`, a 45-second timeout, a 700-token output budget and 30 requests per user per five minutes. Prompts and tokens are not logged. OpenAI retention policies still apply; `store: false` is not a promise of zero data retention. Update the reference file when app features change and restart the server. Model output remains probabilistic; grounding reduces invention but cannot guarantee every answer.
