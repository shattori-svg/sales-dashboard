# Deploying to the cloud

This app can run on any Node.js host. Below are steps for common platforms.

## 本番・多数アクセス時（推奨）

**守屋さんアドバイス**: Render だけだと多数アクセスで負荷がかかるため、本番では次の構成を推奨します。

- **前段に nginx**（リバースプロキシ・SSL終端）
- **DB は SQLite にしない** → **Supabase** を使う（環境変数 `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` を設定）
- **ホストは Azure Web App または Google Cloud** で本番化

詳細は ** [docs/PRODUCTION_DEPLOY.md](docs/PRODUCTION_DEPLOY.md)** を参照してください。

---

## Prerequisites

- Git repository (e.g. GitHub) with this project
- Node.js 18+ (set in `package.json` engines)

**SQLite** (`data/sales.db`) はローカル・検証向け。本番や複数インスタンスでは **Supabase** を利用してください（下記 Environment variables 参照）。PaaS の一時ディスクでは SQLite のデータは再起動で消える場合があります。

---

## Render（簡易・検証向け）

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

## Google Cloud Run

**A) リポジトリ連携（推奨）**  
GitHub に Cloud Build トリガーを設定している場合、main に push すると自動でビルド・デプロイされます。

```bash
git add -A
git commit -m "your message"
git push origin main
```

**B) 手動デプロイ**  
[Google Cloud SDK](https://cloud.google.com/sdk/docs/install) をインストール後、プロジェクトで:

```bash
gcloud config set project lopia-thailand-sales-manage
gcloud run deploy lopia-thailand-sales-manage --source . --region asia-northeast1
```

環境変数（Supabase 等）は Cloud Run の「変数とシークレット」で設定してください。

---

## Environment variables

| Variable | Description |
|----------|-------------|
| `PORT`    | Set by the platform; the app uses it automatically. |
| `NODE_ENV` | Set to `production` on most platforms. |
| `DATA_DIR` | Optional. Directory for SQLite file (e.g. `/data` when using a persistent volume). |
| `SUPABASE_URL` | If set with `SUPABASE_SERVICE_ROLE_KEY`, the app uses Supabase instead of SQLite. |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase project **service_role** key (server-side only). See `docs/SUPABASE_SETUP.md`. |
| `LOGIN_PASSWORD` | If set, access is restricted; users must log in with this password (and optionally `LOGIN_USER`). |
| `LOGIN_USER` | Optional. When set, login requires this username and `LOGIN_PASSWORD`. |
| `SESSION_SECRET` | Optional. Secret for session cookie (defaults to `LOGIN_PASSWORD` if not set). |

---

## After deployment

1. Open the app URL in a browser.
2. Use **Input** to upload Excel files and generate reports.
3. Use **時間別集計** and **日別集計** tabs to view data.

If the platform uses an ephemeral filesystem, uploaded data will disappear on restart; use a persistent disk or external database for long-term storage.
