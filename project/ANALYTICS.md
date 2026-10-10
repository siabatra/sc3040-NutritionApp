# Required MealCare analytics

Implements UC15 and SRS sections 7.5.1 and 10.5: daily/weekly/monthly/yearly saved-plan comparisons, confirmed adherence, macro gaps, nutritional/adherence trends, calorie breakdown by meal type, and nightly precomputed summaries. Existing meal counts, macro distribution, meal locations, and history navigation remain available.

The app offers Daily, Weekly, Monthly and Yearly periods with historical navigation. Yearly means January through December of the selected calendar year. Each view reads a precomputed summary; it never scans raw history on the device. Daily is selected initially.

## Data and calculation rules

- All reporting dates use Asia/Singapore. Weeks start Monday; months and years are calendar periods. Summaries include today as an incomplete day and exclude future dates.
- Saved plans remain in `users/{uid}/plans/{YYYY-MM-DD}`. Logging a plan creates a meal with `planId` and `slotId`, retaining the slot's original `menuItem` and recording its `loggedMealId`. A transaction prevents double logging; deleting that log clears its completion link. Regenerating/saving preserves completed slots.
- `actual` includes all recorded intake in the period. `planned` and `comparableActual` compare only dates with identifiable saved meals. Gaps are recorded minus planned: positive means recorded excess, negative means recorded shortfall. Unplanned days do not inflate the comparison.
- Confirmed adherence = distinct identifiable planned slots matched one-to-one to same-day recorded meals with the planned food name and all four nutrition values; manual logs also match the meal type. It measures confirmed matches, not a medical outcome or proof of non-adherence. Missing or non-matching logs remain unconfirmed. Edited dishes/quantities may cease to match.
- A missing log is unknown intake, not a confirmed skipped meal. Daily averages are per logged day. Missing/invalid nutrition fields mark totals as partial and disable affected comparisons instead of claiming zero.
- Older prototype plans whose `menuItem` was erased cannot be reconstructed reliably. Their unknown planned values are excluded; gaps/adherence for identifiable slots remain visible and are labelled partial. Older UTC-based plan IDs are interpreted as their saved calendar date; new plans have an explicit Singapore reporting date.
- Rollups are stored at `users/{uid}/analytics/{day|week|month|year}-{startDate}`. The mobile analytics service reads a selected summary only and never scans raw meal history as a fallback. It shows available metrics, unavailable-metric explanations, errors/retry, and update timestamps.

## Backend

`functions/index.js` exports:

- `nightlyAnalyticsRollup`: runs at 01:00 Asia/Singapore and queues a private per-user task.
- `rebuildUserAnalytics`: creates initial historical rollups once; thereafter rebuilds current/just-closed and dirty weekly/monthly periods.
- `markMealAnalyticsDirty` / `markPlanAnalyticsDirty`: record periods affected by additions, edits, moved dates, or deletions. Both before/after dates are included. Dirty markers changed during aggregation remain for the next run.
- `removeProfileAnalytics` / `removeDeletedAccountAnalytics`: remove derived analytics on profile/account deletion. Tasks check account existence before rebuilding.

The initial backfill scans historical records on the backend only. Later jobs query affected periods. Cloud Tasks limits concurrent per-user rebuilds and retries failed work. Cloud credentials are obtained through Firebase Admin default credentials; no private key is packaged in these functions.

Per-user leases prevent overlapping rebuilds, and an older retry cannot overwrite a newer completed summary.

## Deploy to the intended Firebase project

The repository now contains deployment configuration, rules, indexes and a dedicated `analytics` functions codebase. Nothing is deployed automatically. Use the same Firebase project as the mobile app, with billing and permission to deploy Functions, Scheduler and Tasks.

From `project/functions`:

```powershell
npm ci
npx firebase login
npx firebase deploy --project YOUR_FIREBASE_PROJECT_ID --only functions:analytics,firestore:rules,firestore:indexes
```

Compare `project/firestore.rules` with any existing deployed rules before replacing them. This repository previously had no rules file. The new rules preserve the prototype's authenticated shared restaurant writes, restrict meal records/plans to their owners, and make rollups owner-readable/backend-writable. Do not retain an overlapping catch-all authenticated write rule: it would override analytics write restrictions.

The scheduler's runtime service account needs permission to enqueue the rebuild task and use the task's invoking service account. The invoking account needs permission to invoke the task function. Follow the [Firebase task queue IAM instructions](https://firebase.google.com/docs/functions/task-functions#iam_permissions); enable the Cloud Tasks API if prompted. The schedule uses Firebase's [scheduled-functions API](https://firebase.google.com/docs/functions/schedule-functions).

Wait for Firestore indexes to become ready. Run the Scheduler job once in the Google Cloud console to populate the first summaries, or wait until the nightly run. Task completion may take longer than the scheduler itself.

For an explicit local maintenance/backfill, authenticate using Application Default Credentials or set `GOOGLE_APPLICATION_CREDENTIALS` to an existing private Admin key outside the functions source, then:

```powershell
$env:GCLOUD_PROJECT = 'YOUR_FIREBASE_PROJECT_ID'
npm run backfill -- OPTIONAL_USER_UID
```

Omitting the UID processes all existing user profiles. This command writes Firestore summaries and is not run by the mobile application.

## Verify locally

From `project/functions`:

```powershell
npm test
npm run test:rules
```

The rules suite requires Java and uses only the `demo-mealcare-analytics` emulator project. It verifies ownership, backend-only analytics writes, real frontend persistence transactions, concurrent logging, preserved completed plans, historical changes/deletions, and derived-data cleanup.

To run the mobile/web app against local Auth/Firestore instead of the live database:

```powershell
# Terminal 1, project/functions
npx firebase emulators:start --project demo-mealcare-analytics --only firestore,auth

# Terminal 2, project
$env:EXPO_PUBLIC_USE_FIREBASE_EMULATORS = 'true'
npx expo start --web
```

This opt-in flag works only in development and selects a demo Firebase configuration. On a phone, set `EXPO_PUBLIC_FIREBASE_EMULATOR_HOST` to the computer's LAN IP and configure the emulator listen host accordingly. Remove the flag and restart Expo to return to the configured Firebase project. Local emulators do not automatically run the cloud schedule; use the explicit backfill command against the emulator to populate test summaries.

For release acceptance, measure dashboard rendering after deployment under the team's network/device conditions against the SRS's 3-second target. Local functional tests do not establish production latency or the 1,000-concurrent-user requirement.


Personalised insights are generated by the backend for calorie-target comparisons, macro energy distribution (4/4/9 kcal per gram), breakfast logging and restaurant frequency. Breakfast counts distinct days, not duplicate meal entries. Calorie comparisons use logged days and the profile target captured at each summary update; they describe recorded intake, not complete intake. Missing nutrients suppress affected comparisons, and absent breakfast logs never imply skipped meals. Unknown meal locations are explicitly counted.

The first rebuild after this update backfills existing historical summaries with insights (`insightsVersion: 1`). Current periods refresh nightly, including the current profile target; historical targets remain summary snapshots until those periods are rebuilt. Three-month and year views combine saved insight statistics and recalculate observations for the whole available window. Missing monthly summaries are labelled as partial. Deploy the updated functions and run the existing backfill command to make insights available immediately; otherwise the nightly job performs the upgrade.


## Requirement audit and remaining release verification

All listed functional requirements now have frontend and backend support. Macro comparisons show planned, recorded and gram differences together. A dedicated recorded-minus-planned deviation chart complements the actual, plan comparison and adherence charts. New backend summaries persist daily deviations; older summaries derive the same values from their precomputed daily totals without reading raw logs.

The three-second rendering acceptance target remains a release verification item, not an established result. Test a deployed production build on the target device and network: start timing when the weekly/monthly analytics screen or a historical period is selected; stop when the summary and charts are visible. Record device, build, network, period, logged/planned days, cold/warm state and elapsed time. Run at least five cold and five warm trials per weekly/monthly view, including dense historical periods, and record each result against 3 seconds. Test retrieval failure/retry separately. Development bundling and emulator timings do not establish production render performance.


## Local generation when cloud functions are unavailable

A summary does not get generated by opening the analytics screen. The configured Firebase project had no rollups and its Cloud Functions API was disabled when diagnosed. The initial live backfill has now been run.

From `project`, use `npm run analytics:backfill` to regenerate all summaries immediately, or `npm run analytics:worker` to regenerate on startup and every 60 seconds while testing. Keep the worker process running; it does not install a Windows service or survive computer shutdown. These are backend commands, never client-side history scans. The local job rebuilds all historical periods so edits/deletions work even without deployed dirty triggers. The production cloud job continues to use affected-period rebuilds.

Local commands use `GCLOUD_PROJECT` or the app's Firebase project setting in `.env`, and Application Default Credentials. If no credential path is provided, they use the single existing Firebase Admin key in the project directory. No credentials are printed or included in the app bundle. Set `GOOGLE_APPLICATION_CREDENTIALS` explicitly when multiple keys exist. For emulator use, set `GCLOUD_PROJECT=demo-mealcare-analytics` and `FIRESTORE_EMULATOR_HOST` explicitly.

Enable and deploy Cloud Functions/Scheduler/Tasks using the deployment instructions above for generation independent of your computer. Today is included as an incomplete day.

The analytics screen polls saved summaries every 30 seconds while focused. With the local worker running, new meals normally appear within approximately 90 seconds; cloud-only generation retains its nightly schedule. Reopening the screen also reloads its summary. Today's planned meals may include meals not yet eaten, so current-day adherence is provisional.


Updated comparison handling: missing legacy slots no longer hide comparisons for identifiable saved meals. These gaps/adherence are explicitly partial and exclude unknown planned details. Confirmed adherence accepts same-day exact food/nutrition matches from manual logs when the meal type also matches; logs linked to another plan are excluded, and one recorded meal confirms at most one slot. Single-date charts show real values as bars with a prompt to add more dates; no artificial dates or fabricated planned values are added. A period with no saved plan still cannot provide a saved-plan gap or adherence percentage.


Live updates now use Firestore subscriptions on both screens: the dashboard subscribes to today's logs, profile and saved plan, and derives remaining calories/macros from those totals. The analytics screen subscribes to selected rollup documents, including combined monthly windows, and unsubscribes on navigation. The local worker watches meal/plan changes and rebuilds the affected user's summaries after a short debounce, with a one-minute repair pass. Keep that backend process running. Single-date charts show bars with an explanatory message; no plan values are invented when a saved plan is missing.

`npm run dev` now starts both Expo and the live analytics backend worker. You do not need to remember a separate worker terminal for normal local testing. Restart the dev command after this update; the backend needs its existing local Admin credential or configured ADC.


If plan comparisons show unavailable: check that a meal plan was actually saved under the same account and on the same reporting date as the meal log. Generating a plan without pressing Save Plan does not provide a persisted comparison baseline. The app now shows recorded intake alongside an explicit missing-plan explanation and a direct create/save-plan action. A single valid meal is sufficient for recorded charts; a single valid saved planned meal is sufficient for comparisons and adherence. All four trend cards render a single date as bars, with a prompt to add more data. The first rebuild upgrades existing summaries to include daily and calendar-year documents (`periodVersion: 2`).

If DeepSeek returns HTTP 402 (insufficient balance), Plan My Day now opens manual home-meal entry with a clear explanation. Add dish/calorie/macro values from your recipe or label, add the planned meal, then Save Plan. Manual entry also works without calling AI. This supplies a real saved-plan baseline without inventing nutrition. Generated duplicate snack slots now receive distinct IDs so all snacks are retained in analytics.

Manual entry now persists immediately through Add and save planned meal, with a saving state, duplicate-click guard and visible confirmation/error. A separate Save Plan press is not required for manual additions. A planned meal contributes to planned totals; it is not counted as recorded intake until logged.
