# Deploying to the cloud

このアプリは任意の Node.js ホストで動作します。以下は代表的なプラットフォームの手順です。

---

## デプロイ手順（Git 経由・推奨）

本番で **Google Cloud Run** を使う場合、Git に push するだけでデプロイできます。

### 1. 日々のデプロイ（コードを反映するとき）

アプリの変更をコミットして `main` に push します。Cloud Build トリガーを設定済みなら、push 後に自動でビルド・デプロイされます。

```bash
# 変更をステージ（*.xlsx / *.csv は .gitignore で除外されます）
git add .gitignore app.js server.js index.html parser.js ...
# または一括: git add -A   （不要なファイルは .gitignore で除外）

git status   # 確認

git commit -m "説明メッセージ"
git push origin main
```

**PowerShell（Windows）の例:**

```powershell
cd "c:\path\to\Sales_reports"
git add .gitignore app.js server.js index.html
git commit -m "機能追加: ..."
git push origin main
```

- ビルド状況: [Google Cloud Console](https://console.cloud.google.com/) → **Cloud Build** → **履歴**
- デプロイ先: **Cloud Run** → 対象サービス → **URL** で確認

### 2. 初回のみ: Cloud Build トリガーの設定

Git push で自動デプロイするには、GCP でトリガーを 1 回だけ作成します。

1. [Cloud Console](https://console.cloud.google.com/) でプロジェクトを選択。
2. **Cloud Build** → **トリガー** → **トリガーを作成**。
3. 設定例:
   - **名前**: 任意（例: `deploy-sales-report`）
   - **イベント**: ブランチに push したとき
   - **ソース**: このリポジトリ（GitHub 連携済み）
   - **ブランチ**: `^main$`
   - **構成**: **Cloud Build 構成ファイル（リポジトリに含まれる）** を選び、`cloudbuild.yaml` を指定（ルートにあります）。
4. 保存後、上記「1. 日々のデプロイ」の push で自動デプロイされます。

`cloudbuild.yaml` ではサービス名・リージョンの既定値が `lopia-thailand-sales-manage` / `asia-northeast1` です。変更する場合はファイル内の `_SERVICE_NAME` と `_REGION` を編集するか、トリガーの「 substitution 変数」で上書きできます。

---

## 本番・多数アクセス時（推奨構成）

**守屋さんアドバイス**: Render だけだと多数アクセスで負荷がかかるため、本番では次の構成を推奨します。

- **前段に nginx**（リバースプロキシ・SSL終端）
- **DB は SQLite にしない** → **Supabase** を使う（環境変数 `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` を設定）
- **ホストは Azure Web App または Google Cloud** で本番化

詳細は ** [docs/PRODUCTION_DEPLOY.md](docs/PRODUCTION_DEPLOY.md)** を参照してください。

---

## 前提

- このプロジェクトの **Git リポジトリ**（GitHub 等）があること
- Node.js 18+（`package.json` の engines を参照）

**SQLite**（`data/sales.db`）はローカル・検証向けです。本番や複数インスタンスでは **Supabase** を利用してください（下記 Environment variables 参照）。PaaS の一時ディスクでは SQLite のデータは再起動で消える場合があります。

**注意**: `.gitignore` で `*.xlsx` / `*.csv` を除外しているため、レポート用ファイルは push されません。デプロイに含めたいファイルだけ `git add` してください。

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

**A) Git 経由（推奨）**  
上記「デプロイ手順（Git 経由）」のとおり、`main` に push すると Cloud Build が走り、Cloud Run に自動デプロイされます。トリガー未設定の場合は「初回のみ: Cloud Build トリガーの設定」を実施してください。

**B) 手動デプロイ**  
gcloud が使える環境で、リポジトリのルートで実行します。

```bash
gcloud config set project <あなたのプロジェクトID>
gcloud run deploy lopia-thailand-sales-manage --source . --region asia-northeast1 --allow-unauthenticated
```

- `--source .` でカレントディレクトリから Dockerfile を使ってビルドし、そのイメージを Cloud Run にデプロイします。
- プロジェクト名・リージョン（例: `asia-northeast1`）は環境に合わせて変更してください。
- **環境変数**: Cloud Run の **変数とシークレット** で `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `LOGIN_PASSWORD` 等を設定してください。

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

## デプロイ後

1. Cloud Run のサービス URL をブラウザで開く。
2. **Setup** から Excel/CSV をアップロードしてレポートを生成する。
3. **時間別集計**・**日別集計**・**週別集計** タブでデータを確認する。

一時ディスクの環境では再起動でアップロードデータが消えるため、本番では **Supabase** 等の永続 DB を利用してください。
