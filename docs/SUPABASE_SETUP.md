# Supabase 接続設定（develop 環境）

このドキュメントは、`develop` 実行環境で Supabase を使い続けるための設定手順です。  
`production` を Cloud SQL にする手順は `docs/PRODUCTION_DEPLOY.md` を参照してください。

## 1. DB_PROVIDER を明示する

DB接続先は `DB_PROVIDER` で決まります。

| 環境 | DB_PROVIDER | 実際の接続先 |
|------|-------------|--------------|
| develop | `supabase` | Supabase |
| production | `postgres` | Cloud SQL (PostgreSQL) |

develop 環境では必ず `DB_PROVIDER=supabase` を設定してください。

## 2. Supabase プロジェクト情報を確認

1. [supabase.com](https://supabase.com) で対象プロジェクトを開く
2. **Settings** → **API** から以下を取得
   - `SUPABASE_URL`（Project URL）
   - `SUPABASE_SERVICE_ROLE_KEY`（service_role、秘密情報）

## 3. テーブル作成

Supabase SQL Editor で以下を実行します。

- `sql/supabase-reports-table.sql`
- `sql/supabase-users-table.sql`

## 4. 環境変数（develop）

| 変数名 | 必須 | 説明 |
|--------|------|------|
| `DB_PROVIDER` | 必須 | `supabase` |
| `SUPABASE_URL` | 必須 | Supabase Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | 必須 | service_role key |

### PowerShell 例

```powershell
$env:DB_PROVIDER = "supabase"
$env:SUPABASE_URL = "https://xxxxx.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY = "your_service_role_key"
npm start
```

### `.env` 例（ローカル）

```
DB_PROVIDER=supabase
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

## 5. 動作確認

1. `npm start` を実行
2. 起動ログが `Database: Supabase` になることを確認
3. 画面でログインし、レポート表示と設定保存が成功することを確認
4. 必要なら Excel アップロードを実行し、Supabase `reports` にデータが増えることを確認

## 注意

- `service_role` は強い権限を持つため、サーバー環境変数のみで管理してください。
- `production` はこの設定を使わず、Cloud SQL 用の `DB_PROVIDER=postgres` を利用します。
