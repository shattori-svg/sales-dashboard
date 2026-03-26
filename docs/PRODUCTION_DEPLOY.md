# 本番環境デプロイ（production=Cloud SQL / develop=Supabase）

本ドキュメントは、以下の運用を前提にしています。

- develop 実行環境: **Supabase**
- production 実行環境: **Cloud SQL (PostgreSQL)**

---

## 1. 構成方針

| 項目 | develop | production |
|------|---------|------------|
| DB_PROVIDER | `supabase` | `postgres` |
| DB | Supabase | Cloud SQL (PostgreSQL) |
| 目的 | 開発・検証 | 本番運用 |

Cloud Run は環境ごとにサービスを分けるか、同一サービス内で環境別Revision運用を行ってください。

---

## 2. production アーキテクチャ（最終）

```
インターネット
   │
   ▼
Cloud Run (Node.js / Express)
   │
   ├─ Microsoft Entra ID（認証）
   ├─ Frankfurter API（為替更新）
   └─ Cloud SQL for PostgreSQL（本番DB）
```

---

## 3. Cloud SQL の準備

1. Cloud SQL で PostgreSQL インスタンスを作成
2. DB とユーザーを作成
3. `sql/cloudsql-schema.sql` を適用
4. Public IP + SSL/TLS 接続を有効化（今回の運用前提）

---

## 4. 環境変数（production）

production では次を設定します。

| 変数名 | 必須 | 説明 |
|--------|------|------|
| `DB_PROVIDER` | 必須 | `postgres` |
| `DATABASE_URL` | 必須 | `postgres://USER:PASSWORD@HOST:5432/DB?sslmode=require` |
| `PGSSLMODE` | 推奨 | `require` |
| `SESSION_SECRET` | 必須 | セッション秘密鍵 |
| `ENTRA_*` | 必須 | Entra 認証設定一式 |

production では `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` を設定しないでください。

---

## 5. 環境変数（develop）

develop は従来どおり Supabase を使用します。

| 変数名 | 必須 | 説明 |
|--------|------|------|
| `DB_PROVIDER` | 必須 | `supabase` |
| `SUPABASE_URL` | 必須 | Supabase URL |
| `SUPABASE_SERVICE_ROLE_KEY` | 必須 | service_role key |

---

## 6. データ移行（Supabase -> Cloud SQL, productionのみ）

### 6.1 事前リハーサル（推奨）

本番切替前に同手順をステージング/検証で実施してください。

- スキーマ適用
- データエクスポート
- データインポート
- 件数照合

### 6.2 本番切替（短時間停止あり）

1. メンテナンス開始（アップロード停止）
2. Supabase からデータをエクスポート（対象: `reports`, `masters`, `users`）
3. Cloud SQL へインポート
4. 件数照合とサンプル検証
5. production の環境変数を `DB_PROVIDER=postgres` にして新Revisionへデプロイ
6. production トラフィックを新Revisionへ切替

---

## 7. データ移行コマンド例（参考）

環境に応じて調整してください。

```bash
# Supabase から data-only dump
pg_dump "$SUPABASE_DATABASE_URL" \
  --data-only \
  --table=public.reports \
  --table=public.masters \
  --table=public.users \
  --column-inserts \
  --no-owner \
  --no-privileges \
  > supabase-data.sql

# Cloud SQL へ投入
psql "$CLOUDSQL_DATABASE_URL" -f supabase-data.sql
```

---

## 8. 検証チェックリスト（切替直後）

- `/health` が 200
- Entra ログイン成功
- `/api/auth/status` が想定どおり
- `/api/report` が today / yesterday / lastWeek を返す
- `/api/me/preferences` 更新成功
- `/api/upload` で新規データ登録成功
- FX更新ログが正常

---

## 9. ロールバック

production で障害時は、以下で即時ロールバックします。

1. production 環境変数を `DB_PROVIDER=supabase` に戻す
2. `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` を再設定
3. 旧Revisionへトラフィック切替

develop は常に Supabase 継続のため、原則影響しません。

---

## 10. 補足

- 詳細な develop 側設定: `docs/SUPABASE_SETUP.md`
- 本番切替Runbook: `docs/CLOUDSQL_MIGRATION_RUNBOOK.md`

