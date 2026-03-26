# Cloud SQL 移行 Runbook（productionのみ）

このRunbookは以下の運用前提です。

- develop: Supabase 継続 (`DB_PROVIDER=supabase`)
- production: Cloud SQL へ切替 (`DB_PROVIDER=postgres`)
- 切替方式: 短時間メンテナンスあり

## 1. 事前準備

1. Cloud SQL インスタンスを作成（PostgreSQL）
2. DB/ユーザー作成
3. `sql/cloudsql-schema.sql` を適用
4. Cloud Run から接続可能なネットワーク/認証を準備
5. production のメンテナンス時間を確保

## 2. 事前リハーサル（必須）

本番前に同じ流れを検証環境で最低1回実行します。

### 2.1 エクスポート（Supabase）

```bash
pg_dump "$SUPABASE_DATABASE_URL" \
  --data-only \
  --table=public.reports \
  --table=public.masters \
  --table=public.users \
  --column-inserts \
  --no-owner \
  --no-privileges \
  > supabase-data.sql
```

### 2.2 インポート（Cloud SQL）

```bash
psql "$CLOUDSQL_DATABASE_URL" -f supabase-data.sql
```

### 2.3 件数照合

```sql
SELECT 'reports' AS table_name, COUNT(*) AS rows FROM reports
UNION ALL
SELECT 'masters' AS table_name, COUNT(*) AS rows FROM masters
UNION ALL
SELECT 'users' AS table_name, COUNT(*) AS rows FROM users;
```

### 2.4 サンプル整合性確認

```sql
-- 最新営業日（store別）
SELECT store_id, MAX(business_date) AS latest_business_date
FROM reports
GROUP BY store_id
ORDER BY store_id;

-- 管理者ユーザー件数
SELECT COUNT(*) AS admin_count
FROM users
WHERE role = 'admin';

-- 為替レートマスタ
SELECT key, value
FROM masters
WHERE key = 'exchange_rate';
```

SQLファイルとしては `sql/migration-verify.sql` も利用できます。

## 3. 本番切替手順

1. メンテナンス開始（アップロード停止、書き込み停止）
2. Supabase から `reports` / `masters` / `users` をエクスポート
3. Cloud SQL にインポート
4. 件数照合 + サンプル整合性確認
5. production Cloud Run の環境変数を更新
6. 新Revisionデプロイ
7. production トラフィック切替
8. メンテナンス終了

## 4. Cloud Run 環境変数更新例

### 4.1 develop（変更しない）

```bash
gcloud run services update SALES_DASHBOARD_DEVELOP \
  --region=REGION \
  --update-env-vars=DB_PROVIDER=supabase,SUPABASE_URL=SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY=SUPABASE_SERVICE_ROLE_KEY
```

### 4.2 production（Cloud SQLへ切替）

```bash
gcloud run services update SALES_DASHBOARD_PRODUCTION \
  --region=REGION \
  --update-env-vars=DB_PROVIDER=postgres,DATABASE_URL=DATABASE_URL,PGSSLMODE=require
```

必要に応じて `SESSION_SECRET`、`ENTRA_*` など既存必須変数も同時に設定します。

## 5. 切替直後チェック

- `/health` が 200
- Entra ログイン成功
- `/api/auth/status` 正常
- `/api/report` 正常
- `/api/me/preferences` 保存成功
- `/api/upload` 成功
- FX更新ログがエラーなし

## 6. ロールバック

production 障害時は即時で以下を実施:

1. `DB_PROVIDER=supabase` に戻す
2. `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` を再設定
3. 旧Revisionへトラフィック切替

develop は Supabase 継続のため、通常は変更不要です。
