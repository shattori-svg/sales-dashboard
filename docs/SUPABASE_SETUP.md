# Supabase 接続設定

このアプリを Supabase（PostgreSQL）に接続する手順です。環境変数を設定すると、SQLite の代わりに Supabase が使われます。

## 1. Supabase プロジェクトの作成

1. [supabase.com](https://supabase.com) にサインインし、**New project** でプロジェクトを作成します。
2. プロジェクトの **Settings** → **API** で次を控えます：
   - **Project URL**（例: `https://xxxxx.supabase.co`）
   - **service_role** キー（**Project API keys** の `service_role`。秘密鍵のためサーバー以外で公開しないでください）

## 2. テーブルの作成

Supabase ダッシュボードの **SQL Editor** で、プロジェクト直下の `supabase-reports-table.sql` を実行してください。`reports` に加え、ビジネスアワー用の `masters` テーブルも作成されます。

```sql
-- レポート保存用テーブル（business_date をキーに 1 日 1 行）
create table if not exists public.reports (
  business_date text primary key,
  data jsonb not null,
  created_at timestamptz default now()
);

-- RLS を有効にする場合、service_role は RLS をバイパスするためこのままで可。
-- アプリはサーバー側で service_role のみ使用する想定です。
alter table public.reports enable row level security;

-- 必要に応じてポリシーを追加（例: 全レコードを service_role のみ操作）
create policy "Service role full access"
  on public.reports
  for all
  to service_role
  using (true)
  with check (true);
```

## 3. 環境変数の設定

サーバーを起動する環境で、次の 2 つを設定します。

| 変数名 | 説明 |
|--------|------|
| `SUPABASE_URL` | プロジェクトの Project URL（例: `https://xxxxx.supabase.co`） |
| `SUPABASE_SERVICE_ROLE_KEY` | API の **service_role** キー（Secret key） |

### ローカル（例: PowerShell）

```powershell
$env:SUPABASE_URL = "https://xxxxx.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
npm start
```

### .env ファイル（推奨）

プロジェクト直下に `.env` を作成し、**リポジトリにコミットしないでください**（`.gitignore` に含まれています）。

```
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

`.env` を読み込むには、起動前に [dotenv](https://www.npmjs.com/package/dotenv) を使います（本番では各ホスティングの「環境変数」で設定します）。

### 本番環境（Render / Railway など）

**本番と Supabase がつながらない**場合は、デプロイ先のダッシュボードで次の 2 つを環境変数として追加してください。`.env` は本番サーバーには存在しないため、必ずホスティング側で設定します。

| キー | 値 |
|------|-----|
| `SUPABASE_URL` | あなたの Project URL（例: `https://xkkntqzwkekcsimxszvc.supabase.co`） |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase の **Settings → API** でコピーした **service_role** キー |

- **Render:** ダッシュボードで該当の **Web Service** を開く → **Environment** → **Add Environment Variable** で上記 2 つを追加 → **Save Changes** 後、必要なら **Manual Deploy** で再デプロイ。
- **Railway:** プロジェクト → 該当サービス → **Variables** で上記 2 つを追加。保存すると自動で再デプロイされます。
- **Vercel / その他:** 同様に「Environment Variables」や「設定 → 環境変数」で `SUPABASE_URL` と `SUPABASE_SERVICE_ROLE_KEY` を追加してください。

設定後、本番 URL でアプリを開き、Excel をアップロードして動作を確認します。Supabase の **Table Editor → reports** にレコードが増えていれば接続できています。

### dotenv を使う場合（ローカル）

```bash
npm install dotenv
```

`server.js` の先頭（先頭行の直後）に追加：

```js
require('dotenv').config();
```

## 4. 動作確認

1. 環境変数を設定して `npm start` でサーバーを起動します。
2. コンソールに `Database: Supabase` と出ていれば Supabase 接続です。
3. ブラウザでアプリを開き、**Input** タブから Excel をアップロードして「Generate Report」を実行します。
4. Supabase ダッシュボードの **Table Editor** → **reports** で、`business_date` と `data` にレコードが入っていることを確認します。

## 注意

- **SUPABASE_URL** と **SUPABASE_SERVICE_ROLE_KEY** の両方が設定されているときだけ Supabase が使われます。どちらかが無い場合は従来どおり SQLite（`data/sales.db`）が使われます。
- `service_role` キーは権限が強いため、サーバー側の環境変数だけで使い、フロントエンドや公開リポジトリには含めないでください。
