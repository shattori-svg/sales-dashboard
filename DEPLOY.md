# Deploying to the cloud

This app can run on any Node.js host. Below are steps for common platforms.

## Prerequisites

- Git repository (e.g. GitHub) with this project
- Node.js 18+ (set in `package.json` engines)

The app uses **SQLite** (`data/sales.db`). On many PaaS platforms the filesystem is **ephemeral**: data is lost when the instance restarts or redeploys. For persistent data, use a platform that offers persistent disk or consider switching to a managed database later.

---

## Render

1. Go to [render.com](https://render.com) and sign in (GitHub).
2. **New** → **Web Service**.
3. Connect your Git repo and select this project.
4. Settings:
   - **Build command:** `npm install`
   - **Start command:** `npm start`
   - **Instance type:** Free or paid (Free has cold starts).
5. **Advanced** → add **Disk** if you want persistent SQLite (paid; mount path e.g. `/data` and set `DATA_DIR=/data` if you add support for it).
6. Deploy. Your app will be at `https://<name>.onrender.com`.

**Health check (optional):** In Render dashboard, set **Health Check Path** to `/health`.

---

## Railway

1. Go to [railway.app](https://railway.app) and sign in (GitHub).
2. **New Project** → **Deploy from GitHub** → select this repo.
3. Railway detects Node and uses `npm start`. If not, set **Start Command** to `npm start`.
4. Deploy. Open **Settings** → **Networking** → **Generate Domain** to get a public URL.

**Persistent data:** Add a **Volume** and mount it (e.g. at `/data`). In the service, set env **DATA_DIR** = `/data` so the SQLite file is stored on the volume.

---

## Fly.io

1. Install [flyctl](https://fly.io/docs/hands-on/install-flyctl/) and run `fly auth login`.
2. In the project folder:
   ```bash
   fly launch
   ```
   Answer prompts (app name, region). Do not add a database when asked.
3. Ensure `fly.toml` has:
   - `[http_service]` with `internal_port = 3333` (or use `PORT`; Fly sets it).
   - Or set `PORT = 3333` in `[env]` and use `process.env.PORT` (already used).
4. Deploy:
   ```bash
   fly deploy
   ```
5. Open the app: `fly open`.

**Persistent volume (optional):** Create a volume and mount it so `data/` lives on the volume (see [Fly.io volumes](https://fly.io/docs/reference/volumes/)).

---

## Environment variables

| Variable | Description |
|----------|-------------|
| `PORT`    | Set by the platform; the app uses it automatically. |
| `NODE_ENV` | Set to `production` on most platforms. |
| `DATA_DIR` | Optional. Directory for SQLite file (e.g. `/data` when using a persistent volume). |
| `SUPABASE_URL` | If set with `SUPABASE_SERVICE_ROLE_KEY`, the app uses Supabase instead of SQLite. |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase project **service_role** key (server-side only). See `docs/SUPABASE_SETUP.md`. |

---

## After deployment

1. Open the app URL in a browser.
2. Use **Input** to upload Excel files and generate reports.
3. Use **時間別集計** and **日別集計** tabs to view data.

If the platform uses an ephemeral filesystem, uploaded data will disappear on restart; use a persistent disk or external database for long-term storage.
