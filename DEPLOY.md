# Deploying Noah's Pokemon Birthday App

## Vercel (frontend)

The app is a static site. Deploy it to Vercel as follows:

1. **Push your code to GitHub** (if you haven’t already).

2. **Connect the repo to Vercel**
   - Go to [vercel.com](https://vercel.com) and sign in.
   - Click **Add New… → Project** and import your GitHub repo.
   - Vercel will detect the project; the repo root is the app (no build step).

3. **Deploy**
   - Click **Deploy**. Vercel will use the existing `vercel.json` (static, no build).
   - Your site will be live at `https://<your-project>.vercel.app`.

4. **Optional: custom domain**  
   In the project’s **Settings → Domains**, add your domain.

---

## InstantDB (realtime backend)

InstantDB is already configured for this app:

- **App ID** is set in `data/config.json`: `instantAppId` (e.g. `c3ff5491-db2a-4c19-a43b-15a56d52ed8a`).
- The frontend connects to that app when the site is loaded (from Vercel or locally). There is no separate “deploy” step for InstantDB.

If you haven’t created an InstantDB app yet:

1. Go to [instantdb.com](https://instantdb.com) and sign in.
2. Create a new app and copy its **App ID**.
3. Put that ID in `data/config.json` as `"instantAppId": "YOUR_APP_ID"`.
4. Redeploy (or refresh) the frontend. The app will sync team status and station occupancy in real time across devices.

**Note:** The app uses entities such as `team_statuses`, `station_occupancy`, `team_current_assignment`, and `team_station_progress`. InstantDB can create these when the app first runs; no schema file is required unless you want type safety in a separate project.
