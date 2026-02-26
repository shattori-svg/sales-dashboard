# アーキテクチャ概要

LOPIA Thailand Sales Report のシステム構成です。

---

## 1. 全体構成（レイヤー）

```
┌─────────────────────────────────────────────────────────────────┐
│  クライアント（ブラウザ）                                            │
│  index.html / login.html / app.js / i18n.js / style.css           │
│  Chart.js (CDN)                                                   │
└───────────────────────────────┬─────────────────────────────────┘
                                │ HTTP/HTTPS
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  サーバー（Node.js + Express）                                      │
│  server.js  … ルーティング・認証・API・静的配信                        │
│  parser.js  … Excel 解析（xlsx）                                    │
└───────────────────────────────┬─────────────────────────────────┘
                                │
                    ┌───────────┴───────────┐
                    ▼                       ▼
┌───────────────────────────┐   ┌───────────────────────────┐
│  SQLite (db.js)           │   │  Supabase (db-supabase.js)│
│  data/sales.db            │   │  env: SUPABASE_*          │
│  reports, masters         │   │  reports テーブル          │
└───────────────────────────┘   └───────────────────────────┘
```

- **フロント**: 静的 HTML/CSS/JS。フレームワークなし。Chart.js でグラフ描画。
- **バックエンド**: Express 単体アプリ。REST API と静的ファイル配信。
- **データ**: 環境変数で **SQLite** または **Supabase** のどちらかを利用（同時には使わない）。
- **多店舗**: `reports` は `(store_id, business_date)` で一意。店舗マスタは `masters` のキー `stores`（JSON 配列 `[{ "id": "S001", "name": "店舗名" }]`）。未設定時は `default` 1 店舗のみ。営業時間は店舗別に `masters` の `bh:{storeId}` で保存可能。

---

## 2. 認証

| 条件 | 動作 |
|------|------|
| `LOGIN_PASSWORD` 未設定 | 認証なし。全ルートそのままアクセス可能。 |
| `LOGIN_PASSWORD` 設定 | ログイン必須。セッション（express-session）で管理。 |

- **ログイン**: `POST /login`（ユーザー名・パスワード）。成功でセッション付与し `/` へリダイレクト。
- **ログアウト**: `GET /logout` または `POST /logout` でセッション破棄し `/login` へ。
- **保護対象**: `/`, `/setup`, `/api/*`。未ログイン時は HTML は `/login` へ、API は 401。`/upload` は `/setup` へリダイレクト。
- **公開**: `/health`, `/login`（認証有効時はログイン画面のみ公開）。

---

## 3. サーバー側の主なファイル

| ファイル | 役割 |
|----------|------|
| **server.js** | Express アプリ。セッション・認証ミドルウェア、静的配信、全 API ルート、日付計算・日別集計ロジック。 |
| **parser.js** | Excel（xlsx）から BusinessDate・時間別・部門別データを抽出。`parseSheet()` を server が利用。 |
| **db.js** | SQLite（better-sqlite3）。`reports`（日付→JSON）、`masters`（キー・値）。`saveReport`, `getReport`, `getAvailableDates`, 営業時間の取得・保存。 |
| **db-supabase.js** | Supabase 利用時。同じインターフェースで `reports` テーブルと masters 相当を操作。 |

---

## 4. API 一覧

| メソッド | パス | 説明 |
|----------|------|------|
| GET | /health | 死活確認。常に 200。 |
| GET | /login | ログイン画面（認証有効時）。 |
| POST | /login | ログイン処理。 |
| GET/POST | /logout | ログアウト。 |
| GET | /api/stores | 店舗一覧（id, name）。クエリ不要。 |
| GET | /api/dates | 保存済み business_date 一覧。`storeId` で店舗指定。 |
| GET | /api/report | `referenceDate`・`storeId` で当日・前日・前週のレポートを返す。 |
| GET | /api/daily-summary | `referenceDate`・`storeId`・`startDate` または `days` で日別サマリー。 |
| GET | /api/business-hours | 営業時間取得。`storeId` で店舗別（未指定時は default）。 |
| PUT | /api/business-hours | 営業時間保存。`storeId` クエリで店舗別。 |
| POST | /api/upload | 複数 Excel アップロード。body に `storeId` で店舗指定。 |

---

## 5. クライアント側の主なファイル

| ファイル | 役割 |
|----------|------|
| **index.html** | メイン画面。タブ（時間別・日別・週別）、日付・ドロップダウン・CSV 出力、グラフ用 canvas。 |
| **login.html** | ログイン画面（ユーザー名・パスワード送信）。 |
| **app.js** | 状態管理、API 呼び出し、テーブル・グラフ描画、タブ切替、CSV エクスポート、401 時は `/login` へ遷移。 |
| **i18n.js** | 多言語（ja/en/th）。キーから文言取得、`data-i18n` による DOM 更新。 |
| **style.css** | レイアウト・コンポーネント・レスポンシブ。 |
| **upload.html / upload.js** | 設定ページ（`/setup`）。アップロード・店舗マスター・営業時間。 |

---

## 6. データの流れ（概要）

1. **アップロード**  
   ユーザーが Excel を選択 → `POST /api/upload` → parser が解析 → DB に `business_date` 単位で保存 → クライアントは日付一覧を取得し「時間別」などで表示。

2. **時間別集計**  
   日付・部門・時間帯を選択 → `GET /api/report?referenceDate=...` → 当日・前日・前週のレポートを取得 → テーブルと Chart.js で表示。

3. **日別集計**  
   開始日・終了日を指定 → `GET /api/daily-summary?referenceDate=...&startDate=...` → 指定期間の日別サマリーを取得 → 部門別売上・構成比・期間合計・主要指標を表示。

4. **週別集計**  
   週終了日・週数を指定 → サーバー側で週単位に集計（日別データを利用）→ 週別 Net Sales・部門別・構成比を表示。

---

## 7. 技術スタック

| 分類 | 技術 |
|------|------|
| ランタイム | Node.js 18+ |
| サーバー | Express |
| 認証 | express-session（メモリセッション） |
| アップロード | Multer（メモリ保存、10MB まで） |
| Excel 解析 | xlsx |
| DB | better-sqlite3 **または** @supabase/supabase-js |
| フロント | バニラ JS、Chart.js（CDN） |
| 設定 | dotenv（.env） |

---

## 8. デプロイ

- ポート: `process.env.PORT`（既定 3333）。
- 認証: 本番では `LOGIN_PASSWORD`（と必要に応じて `LOGIN_USER`）を環境変数で設定。
- DB: ローカルは SQLite（`data/` または `DATA_DIR`）。**本番・多数アクセス時は SQLite を使わず Supabase を利用**（複数インスタンス・永続化に有利）。
- **本番推奨**: 前段に nginx、ホストは Azure Web App または Google Cloud。詳しくは **docs/PRODUCTION_DEPLOY.md** を参照。
- 簡易デプロイ手順はルートの **DEPLOY.md** を参照。
