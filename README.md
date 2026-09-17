# Pulse — Vercel fixed deployment package

This package is intentionally structured as:

- static frontend files at the project root
- Vercel Functions only inside `/api`
- shared server-only modules inside `/lib`

There is no `server.mjs`, no `start` script, and the browser bundle is named `pulse-client.js` so Vercel does not auto-detect it as a Node application entry point.

## Vercel settings

Framework Preset: **Other**
Build Command: **leave empty**
Output Directory: **leave empty**
Root Directory: **leave empty / project root**

Required environment variables:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `SESSION_SECRET`
- `APP_URL=https://pulse-health-rho.vercel.app`

Google OAuth redirect URI:

`https://pulse-health-rho.vercel.app/api/oauth/callback`


## Activity rollup fix (v2)
This build fixes daily activity metrics returning zero. Google Health API `dailyRollUp` returns the date under `civilStartTime.date` / `civilEndTime.date`; the earlier build looked for `start.date`, so valid rollups were received but never assigned to a day. This version maps those fields correctly and bumps the PWA shell cache. check-
