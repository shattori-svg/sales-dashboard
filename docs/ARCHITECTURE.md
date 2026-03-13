# アーキテクチャ概要

LOPIA Thailand Sales Dashboard の現行システム構成です（2026-03 時点）。

---

## 1. 全体構成（レイヤー）

```
┌─────────────────────────────────────────────────────────────────┐
│  クライアント（ブラウザ）                                            │
│  index.html / login.html / app.js / i18n.js / style.css           │
│  upload.html / upload.js                                            │
│  Chart.js (CDN)                                                     │
└───────────────────────────────┬─────────────────────────────────┘
                                │ HTTP/HTTPS
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  サーバー（Node.js + Express）                                      │
│  server.js  … 認証・認可 / API / 静的配信                           │
│  parser.js  … Excel/CSV 解析                                        │
│  ai-gemini.js … AI 分析・予測                                       │
└───────────────────────────────┬─────────────────────────────────┘
                                │
                    ┌───────────┴───────────┐
                    ▼                       ▼
┌───────────────────────────┐   ┌───────────────────────────┐
│  SQLite (db.js)           │   │  Supabase (db-supabase.js)│
│  data/sales.db            │   │  env: SUPABASE_*          │
│  reports / masters / users│   │  reports / masters / users│
└───────────────────────────┘   └───────────────────────────┘
```

- **フロント**: バニラ JS。メイン画面は「店別速報」「全店速報」の 2 タブ構成。
- **バックエンド**: Express 単体アプリ。認証、各種 API、アップロード、AI API を提供。
- **データ**: 環境変数で SQLite または Supabase を切り替え（同時利用しない）。
- **多店舗**: `reports` は `(store_id, business_date)` で一意。営業時間は店舗別に `masters` の `bh:{storeId}` で管理。

---

## 2. 認証・認可

### 認証方式

| モード | 概要 |
|------|------|
| ローカル認証 | ユーザー/パスワード + `express-session` |
| 外部認証（Entra ID） | `EXTERNAL_AUTH_MODE` 有効時に Microsoft サインイン |

### 主要ルール

- `/`, `/setup`, `/api/*` は認証対象（静的アセットと一部例外を除く）。
- 未ログイン時は HTML リクエストをログイン導線へ、API は `401 Unauthorized`。
- 管理者 API は `requireAdmin` で保護し、未許可時は `403 Forbidden`。
- **例外**: `POST /api/upload` のみ、連携用途で未認証アクセスを許可。

---

## 3. サーバー側の主なファイル

| ファイル | 役割 |
|----------|------|
| `server.js` | Express アプリ本体。認証ミドルウェア、API ルート、アップロード、AI API。 |
| `parser.js` | Excel/CSV の解析。BusinessDate、時間別、部門別、日計行を抽出。 |
| `db.js` | SQLite 実装（`reports`/`masters`/`users`）。 |
| `db-supabase.js` | Supabase 実装。`db.js` と同等インターフェース。 |
| `ai-gemini.js` | AI 分析・予測ロジック。 |

---

## 4. API 一覧（主要）

| メソッド | パス | 説明 |
|----------|------|------|
| GET | `/health` | ヘルスチェック。 |
| GET/POST | `/login`, `/logout` | ログイン/ログアウト。 |
| GET | `/api/auth/status` | ログイン状態・ロール・ユーザー設定を返却。 |
| PUT | `/api/me/preferences` | 自分の表示設定（店舗/部門/通貨/言語）を保存。 |
| POST | `/api/bootstrap-admin` | 初期管理者作成（ユーザー未登録時のみ）。 |
| GET/PUT | `/api/stores` | 店舗一覧取得 / 店舗マスタ更新（PUT は管理者）。 |
| GET/PUT | `/api/business-hours` | 店舗別営業時間の取得 / 更新（PUT は管理者）。 |
| GET | `/api/dates` | 保存済み営業日一覧（店舗指定可）。 |
| GET | `/api/report` | 参照日を基準に today / yesterday / lastWeek を返却。 |
| GET | `/api/daily-summary` | 日次集計 API（後方互換用途）。 |
| POST | `/api/upload` | Excel/CSV 複数アップロード取り込み。 |
| GET | `/api/upload-log` | アップロード履歴（管理者）。 |
| GET | `/api/users` | ユーザーマスタ一覧（管理者）。 |
| POST | `/api/users` | ユーザー新規作成（管理者）。 |
| PUT | `/api/users/:id` | ユーザー更新（管理者）。 |
| DELETE | `/api/users/:id` | ユーザー削除（管理者）。 |
| GET | `/api/ai/status` | AI 利用可否。 |
| GET | `/api/ai/analyze` | AI コメント生成。 |
| GET | `/api/ai/forecast` | 日次予測。 |
| GET | `/api/ai/today` | 当日サマリー AI。 |
| GET | `/api/ai/hourly-forecast` | 時間別予測。 |

---

## 5. クライアント側の主なファイル

| ファイル | 役割 |
|----------|------|
| `index.html` | メイン画面。店別速報 / 全店速報タブ、KPI カード、テーブル、グラフ。 |
| `app.js` | 状態管理、API 呼び出し、表示言語反映、KPI/ランキング描画。 |
| `i18n.js` | 多言語辞書（ja/en/th）と `data-i18n` 反映。 |
| `style.css` | レスポンシブ UI（モバイルメニュー、カード、フィルタ表示）。 |
| `login.html` | ログイン画面。 |
| `upload.html` / `upload.js` | 設定画面（ファイル取り込み、ユーザーマスタ、店舗別営業時間）。 |

---

## 6. データフロー（概要）

1. **取り込み**  
   連携元または Setup 画面から `POST /api/upload` に Excel/CSV を送信し、`business_date` 単位で保存。

2. **店別速報（メイン）**  
   `GET /api/report` で today / yesterday / lastWeek を取得し、KPI・時間帯テーブル・比較値（DoD/WoW）を描画。

3. **全店速報**  
   店舗一覧 + 各店の `referenceDate` データを集約してランキング表示。DoD/WoW 列を含み、ソート可能。

4. **設定反映**  
   `PUT /api/me/preferences` またはユーザーマスタ更新後、フロント状態を即時反映。

---

## 7. 技術スタック

| 分類 | 技術 |
|------|------|
| ランタイム | Node.js 18+ |
| サーバー | Express |
| 認証 | express-session / Entra ID 連携 |
| アップロード | Multer（メモリ保存、最大 10 ファイル） |
| 解析 | xlsx + CSV parser（`parser.js`） |
| DB | better-sqlite3 または `@supabase/supabase-js` |
| フロント | バニラ JS + Chart.js |
| 設定 | dotenv |

---

## 8. デプロイ補足

- ポート: `process.env.PORT`（既定 `3333`）。
- 本番では `SESSION_SECRET`、認証系環境変数、DB 接続情報を必ず設定。
- Cloud Run 等で複数インスタンス運用する場合は Supabase 推奨。
- 詳細は `docs/PRODUCTION_DEPLOY.md` とルートの `DEPLOY.md` を参照。
