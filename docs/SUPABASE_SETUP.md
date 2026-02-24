# Supabase 接続設定

このアプリを Supabase（PostgreSQL）に接続する手順です。環境変数を設定すると、SQLite の代わりに Supabase が使われます。

## 1. Supabase プロジェクトの作成

1. [supabase.com](https://supabase.com) にサインインし、**New project** でプロジェクトを作成します。
2. プロジェクトの **Settings** → **API** で次を控えます：
   - **Project URL**（例: `https://xxxxx.supabase.co`）
   - **service_role** キー（**Project API keys** の `service_role`。秘密鍵のためサーバー以外で公開しないでください）

## 2. テーブルの作成

Supabase ダッシュボードの **SQL Editor** で次の SQL を実行し、`reports` テーブルを作成します。

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

`.env` を読み込むには、起動前に [dotenv](https://www.npmjs.com/package/dotenv) を使うか、Render / Railway 等のクラウドではダッシュボードの **Environment** で上記 2 変数を追加します。

### dotenv を使う場合

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
