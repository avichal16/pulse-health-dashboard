# Pulse V2 — Health + Strength Training

Pulse V2 keeps the existing Google Health / Fitbit Air integration and adds a complete mobile-first strength training workflow.

## New in V2

- Rolling 30-day HRV, resting-HR and sleep baselines for Recovery
- 30-day Recovery, Sleep and Activity charts
- Push / Pull / Legs templates plus custom routines
- Exact exercise logging: weight, reps and optional RPE
- Previous-session set prefill
- 90-second rest timer after a completed set
- Automatic estimated 1RM PR detection
- Progressive-overload suggestions based on the latest session
- Weekly workout / set goals and streaks
- Weekly muscle-group working-set volume
- 7-day and 28-day Pulse Load
- Strength volume and improvement analytics
- Recovery × strength-performance observations once enough data exists
- Strength workout details matched with overlapping Fitbit exercise summaries
- On-demand heart-rate telemetry around each logged set completion
- JSON export of the local strength log

## Data storage

Google Health data is read on sync and is not stored in a server database. Strength logs, routines and goals are stored in browser localStorage in this version. Use Settings → Export training log for backups.

## Deploying over your existing GitHub/Vercel app

1. Unzip this package.
2. In your existing `pulse-health-dashboard` GitHub repository, choose **Add file → Upload files**.
3. Drag **all files and folders inside this package** into the upload area. GitHub will replace changed files and add the new `api/heart-rate.mjs` route.
4. Commit with a message such as `Pulse V2 training and personalization`.
5. Your existing connected Vercel project should deploy automatically. Keep **Framework Preset = Other** and the root/build/output settings as they are now.
6. Wait for Vercel to show **Ready**.
7. Open the production URL, refresh once, and tap **Sync**.

No new Google OAuth scopes are required. V2's heart-rate detail uses the existing read-only health metrics scope already authorized.

## Notes

- The first time you log a strength exercise there is no progression history. From session two onward, Pulse can prefill the prior working sets.
- Estimated 1RM uses the Epley formula and is intended for trend tracking, not a guarantee of an actual one-rep max.
- Set-level Fitbit heart rate uses samples from approximately the minute around the set-completion timestamp because Pulse does not ask you to tap a separate “start set” button.
- Recovery-performance correlations are observational. They do not establish causation.


## V2.1 UX fixes
- Sleep now has an explicit 7-day / 30-day trend chart with average, personal baseline and nights-tracked summary.
- Charts are created when their tab becomes visible, fixing blank/zero-width charts on hidden tabs.
- Accidental workouts can be discarded without completing a set. Finish now offers to discard an empty workout instead of blocking.
- The workout logger includes an explicit Discard workout action, while closing a workout with completed sets keeps it resumable.
