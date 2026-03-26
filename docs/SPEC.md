# LOPIA Thailand Sales Dashboard — システム仕様書

> 作成: 2026-03 / 対象バージョン: 現行 develop ブランチ

---

## 目次

1. [システム概要](#1-システム概要)
2. [アーキテクチャ](#2-アーキテクチャ)
3. [認証・認可](#3-認証認可)
4. [データモデル](#4-データモデル)
5. [CSVフォーマット仕様](#5-csvフォーマット仕様)
6. [APIエンドポイント](#6-apiエンドポイント)
7. [画面仕様](#7-画面仕様)
8. [フロントエンド設計](#8-フロントエンド設計)
9. [デプロイ・環境変数](#9-デプロイ環境変数)

---

## 1. システム概要

LOPIA Thailand 全店舗の売上データを可視化するダッシュボード。
LS-Central から出力される CSV または Excel ファイルをアップロードすると、
時間別・部門別・商品別の売上を即時に閲覧できる。

### 主要機能

| 機能 | 説明 |
|---|---|
| 店別速報 | 選択した店舗・日付の KPI・時間別テーブル・グラフを表示 |
| 全店速報 | 全店舗の当日（または任意日）売上をランキング形式で比較 |
| 商品別ランキング | SKU（バーコード）レベルの売上ランキング |
| AIレポート | Gemini API を使った売上コメント・時間帯予測 |
| 設定 | ファイルアップロード、ユーザー管理、店舗別営業時間 |

### 比較軸

- **DoD（Day over Day）**: 前日との比較（データが存在する場合のみ表示）
- **WoW（Week over Week）**: 前週同曜日との比較（データが存在する場合のみ表示）
- DoD/WoW は当日の売上済み時間帯のみで比較する（売上0スロットを含めない）

---

## 2. アーキテクチャ

```
ブラウザ
  index.html / app.js / style.css / i18n.js    ← バニラJS + Chart.js（CDN）
  login.html
  upload.html / upload.js
        │ HTTP/HTTPS
        ▼
サーバー（Node.js + Express）
  server.js   ── 認証・認可 / API / 静的配信
  parser.js   ── CSV/Excel 解析
  ai-gemini.js── AI 分析・予測（Gemini API）
        │
   ┌────┴────┐
   ▼         ▼
db.js      db-supabase.js / db-postgres.js
（SQLite）  （Supabase / Cloud SQL）
```

### ファイル構成

| ファイル | 役割 |
|---|---|
| `server.js` | Express 本体。認証・API・ファイル配信 |
| `parser.js` | CSV/Excel 解析。`parseCsv()` / `parseSheet()` |
| `db.js` | SQLite 実装（ローカル開発用） |
| `db-supabase.js` | Supabase 実装 |
| `db-postgres.js` | PostgreSQL 実装（Cloud SQL） |
| `ai-gemini.js` | Gemini API を使った分析・予測 |
| `entra-auth.js` | Microsoft Entra ID 認証ヘルパー |
| `index.html` | メイン画面 |
| `app.js` | フロントエンド全ロジック（約3000行） |
| `i18n.js` | 多言語辞書（ja / en / th） |
| `style.css` | スタイルシート（ライトテーマ） |
| `login.html` | ログイン画面 |
| `upload.html` / `upload.js` | セットアップ画面 |

### 技術スタック

| 分類 | 技術 |
|---|---|
| ランタイム | Node.js 18+ |
| サーバー | Express |
| 認証 | express-session / Microsoft Entra ID |
| ファイルアップロード | Multer（メモリ保存、最大 10 ファイル） |
| ファイル解析 | xlsx（Excel）+ 自前 CSV パーサー（`parser.js`） |
| DB | better-sqlite3 / @supabase/supabase-js / pg |
| AI | Google Gemini API（`ai-gemini.js`） |
| フロントエンド | バニラ JS + Chart.js（CDN） |

### データフロー

1. **速報取り込み**: LS-Central / Setup 画面 → `POST /api/upload` → `parser.js` → `saveReport()` → `reports` テーブル
2. **確定値取り込み**: ERP 自動送信 → `POST /api/upload/final`（Basic 認証） → `parser.js` → `saveConfirmedReport()` → `confirmed_reports` テーブル
3. **店別速報**: `GET /api/report?referenceDate&storeId` → `reports` テーブル → KPI・時間別テーブル・グラフを描画
4. **確定値**: `GET /api/confirmed?referenceDate&storeId` → `confirmed_reports` テーブル → 確定値タブに表示
5. **全店速報**: `GET /api/allstores?referenceDate&department` → 全店舗サマリーをランキングテーブルで表示
6. **商品別**: `byProduct` データを `GET /api/report` から取得してランキング表示
7. **AI**: `GET /api/ai/analyze` / `/forecast` → Gemini API → テキスト・グラフ生成

---

## 3. 認証・認可

### 認証モード

| モード | 条件 | 説明 |
|---|---|---|
| ローカル認証 | デフォルト | ユーザー/パスワード + `express-session` |
| Entra ID 外部認証 | `AZURE_*` 環境変数が設定済みの場合 | Microsoft サインインにリダイレクト |

### 保護対象

- `/`、`/setup`、`/api/*` は認証必須
- 静的アセット（`.js`、`.css`、`.html`）は認証不要
- **例外1**: `POST /api/upload` は未認証でもアクセス可能（LS-Central からの自動送信用）
- **例外2**: `POST /api/upload/final` は **HTTP Basic 認証**で保護（ERP 専用アカウント）

### ERP 向け Basic 認証

| 環境変数 | 説明 |
|---|---|
| `ERP_UPLOAD_USERNAME` | ERP 用ユーザー名 |
| `ERP_UPLOAD_PASSWORD` | ERP 用パスワード |

両変数が未設定の場合、Basic 認証は無効（セッション管理者権限のみ許可）。

### ロール

| ロール | 権限 |
|---|---|
| 一般ユーザー | 閲覧、自分の設定変更 |
| 管理者（`isAdmin: true`）| 上記 + ユーザー管理・店舗マスタ・アップロードログ |

### セッション

- Cookie名: `sales_report_sid`
- セッションシークレット: `SESSION_SECRET` 環境変数（未設定時はデフォルト値）

---

## 4. データモデル

### `reports` テーブル（速報）

| カラム | 型 | 説明 |
|---|---|---|
| `store_id` | TEXT | 店舗ID（例: `1001`） |
| `business_date` | TEXT | 営業日（YYYY-MM-DD） |
| `data` | JSON | 解析済みレポートデータ（後述） |
| `created_at` | DATETIME | アップロード日時（UTC）。再アップロードで更新 |

ユニーク制約: `(store_id, business_date)`

### `confirmed_reports` テーブル（確定値）

| カラム | 型 | 説明 |
|---|---|---|
| `store_id` | TEXT | 店舗ID（例: `1001`） |
| `business_date` | TEXT | 営業日（YYYY-MM-DD） |
| `data` | JSON | 確定値データ（後述） |
| `created_at` | DATETIME | 受信日時（UTC）。再送時は上書き |

ユニーク制約: `(store_id, business_date)`

- `reports`（速報）と `confirmed_reports`（確定値）は独立したテーブルで、互いに上書きしない
- 速報は当日リアルタイム監視用。確定値はレジ締め後の確定数字

### `data` JSON 構造（速報 / `reports`）

```json
{
  "businessDate": "2026-03-16",
  "storeId": "1001",
  "total": {
    "totalRow": { "netSales": 850000, "grossSales": 890000, "quantitySold": 4200, "receiptCount": 520 },
    "hourly": [
      { "timeKey": "10:00-11:00", "netSales": 45000, "grossSales": 47000,
        "quantitySold": 230, "receiptCount": 68 }
    ]
  },
  "byDepartment": {
    "Grocery": {
      "hourly": [ { "timeKey": "10:00-11:00", "netSales": 18000, ... } ]
    }
  },
  "byProduct": {
    "4901234567890": {
      "itemCode": "4901234567890",
      "departmentCode": "01",
      "departmentName": "Grocery",
      "totalNetSales": 45000,
      "totalQuantitySold": 150
    }
  },
  "_updatedAt": "2026-03-16 08:42:11"
}
```

### `data` JSON 構造（確定値 / `confirmed_reports`）

```json
{
  "businessDate": "2026-03-16",
  "storeId": "1001",
  "total": {
    "totalRow": {
      "netSales": 838800, "grossSales": 880740,
      "quantitySold": 5171, "receiptCount": 984,
      "discountAmount": 15000, "costAmount": 620000
    }
  },
  "byDepartment": {
    "Grocery": {
      "daily": {
        "netSales": 335520, "grossSales": 352296,
        "quantitySold": 2068,
        "discountAmount": 6000, "costAmount": 248000
      }
    }
  },
  "byProduct": {
    "4901234567890": {
      "itemCode": "4901234567890",
      "departmentCode": "01",
      "departmentName": "Grocery",
      "totalNetSales": 5000,
      "totalQuantitySold": 50,
      "discountAmount": 200,
      "costAmount": 3800
    }
  },
  "_updatedAt": "2026-03-16 23:15:00"
}
```

- 確定値には `hourly`（時間別）は含まない
- `discountAmount`（値引き額）・`costAmount`（売上原価 / COGS）は確定値専用フィールド
- `_updatedAt` は `getConfirmedReport()` が `created_at` から付与（DB には保存しない）

### `masters` テーブル

| キー | 内容 |
|---|---|
| `stores` | 店舗マスタ（JSON配列） |
| `exchange` | THB→JPY 為替レート |
| `bh:{storeId}` | 店舗別営業時間（開店・閉店時刻） |

### `users` テーブル

| カラム | 型 |
|---|---|
| `id` | INTEGER PRIMARY KEY |
| `username` | TEXT UNIQUE |
| `password_hash` | TEXT |
| `is_admin` | INTEGER（0/1） |
| `preferred_store` | TEXT |
| `preferred_department` | TEXT |
| `preferred_currency` | TEXT（`THB` or `JPY`） |
| `preferred_language` | TEXT（`ja`/`en`/`th`） |

---

## 5. CSVフォーマット仕様

詳細は `docs/CSV_FORMAT.md` を参照。

### ヘッダー

**速報（`POST /api/upload`）:**
```
Business_Date,Store_Id,Department_Code,Start_Time,End_Time,Net_Sales,Gross_Sales,Quantity_Sold,Receipt_Count[,Item_Code]
```

**確定値（`POST /api/upload/final`、ERP 自動送信）:**
```
Business_Date,Store_Id,Department_Code,Net_Sales,Gross_Sales,Quantity_Sold,Receipt_Count,Discount_Amount,Item_Code,Cost_Amount
```

- `Discount_Amount`（値引き額）・`Cost_Amount`（売上原価 / COGS）は **確定値フォーマット専用**
- 確定値フォーマットは**日計行のみ**。`Start_Time`・`End_Time` 列は存在しない
- `Item_Code` は速報フォーマットで省略可（後方互換）
- `Item_Name` は不要（商品マスタからマッピング）

### 部門コード

| コード | 部門名（英語） | 日本語 |
|---|---|---|
| 00 | 店舗合計 | 店舗合計 |
| 01 | Grocery | 食品 |
| 02 | Fruit & Vegetable | 青果 |
| 03 | Fish & Seafood | 鮮魚 |
| 04 | Meat | 精肉 |
| 05 | Delicatessen | 惣菜 |
| 06 | Store Management | 店舗管理 |

### 行の種類と処理（速報）

| Department_Code | Start_Time | Item_Code | 処理先 |
|---|---|---|---|
| 00 | 空 | 空 | 日計合計行（`total.totalRow`） |
| 00 | あり | 空 | 時間別合計行（`total.hourly[]`） |
| 01–06 | 空 | 空 | 時間別部門行（`byDepartment[name].hourly[]`） |
| 01–06 | あり | 空 | 時間別部門行（`byDepartment[name].hourly[]`） |
| 01–06 | 空 | あり | 商品日計行（`byProduct[itemCode]` のみ・**byDepartment には加算しない**） |

### 行の種類と処理（確定値）

| Department_Code | Start_Time | Item_Code | 処理先 | Discount_Amount | Cost_Amount |
|---|---|---|---|---|---|
| 00 | 空 | 空 | 合計日計（`total.totalRow`） | ◯ | ◯ |
| 01–06 | 空 | 空 | 部門日計（`byDepartment[name].daily`） | ◯ | ◯ |
| 01–06 | 空 | JAN コード | 商品日計（`byProduct[itemCode]`） | ◯ | ◯ |

> 確定値フォーマットに時間別行（`Start_Time` あり）は存在しない

### 時間フォーマット

`HH:MM`（`10:00`）または4桁（`1000`）の両方を受け付ける。

### 文字コード

UTF-8（BOM あり可）。区切り: カンマ。

---

## 6. APIエンドポイント

### 認証系

| メソッド | パス | 説明 |
|---|---|---|
| GET | `/login` | ログイン画面 |
| POST | `/login` | ログイン処理 |
| GET/POST | `/logout` | ログアウト |
| POST | `/auth/callback` | Entra ID コールバック |
| GET | `/api/auth/status` | ログイン状態・ロール・ユーザー設定 |
| POST | `/api/bootstrap-admin` | 初期管理者作成（ユーザー未登録時のみ） |

### データ取得

| メソッド | パス | 認証 | 説明 |
|---|---|---|---|
| GET | `/api/report` | 必要 | `?referenceDate=YYYY-MM-DD&storeId=xxx` → today/yesterday/lastWeek |
| GET | `/api/dates` | 必要 | `?storeId=xxx` → アップロード済み日付一覧 |
| GET | `/api/stores` | 必要 | 店舗マスタ一覧 |
| GET | `/api/business-hours` | 必要 | `?storeId=xxx` → 営業時間 |
| GET | `/api/daily-summary` | 必要 | 日次集計（複数日） |
| GET | `/api/allstores` | 必要 | 全店舗の当日サマリー |
| GET | `/api/upload-log` | 管理者 | アップロード履歴 |

### 確定値取得

| メソッド | パス | 認証 | 説明 |
|---|---|---|---|
| GET | `/api/confirmed` | 必要 | `?referenceDate=YYYY-MM-DD&storeId=xxx` → 確定値レポート（`confirmed_reports` テーブル） |
| GET | `/api/confirmed/dates` | 必要 | `?storeId=xxx` → 確定値が存在する日付一覧 |

### データ更新

| メソッド | パス | 認証 | 説明 |
|---|---|---|---|
| POST | `/api/upload` | **不要** | CSV/Excel アップロード（速報・最大10ファイル） |
| POST | `/api/upload/final` | **Basic 認証** | 確定値アップロード（ERP自動送信用・`confirmed_reports` テーブルに保存） |
| PUT | `/api/me/preferences` | 必要 | 自分の表示設定を保存 |
| PUT | `/api/stores` | 管理者 | 店舗マスタ更新 |
| PUT | `/api/business-hours` | 管理者 | 店舗別営業時間更新 |
| GET | `/api/users` | 管理者 | ユーザー一覧 |
| POST | `/api/users` | 管理者 | ユーザー作成 |
| PUT | `/api/users/:id` | 管理者 | ユーザー更新 |
| DELETE | `/api/users/:id` | 管理者 | ユーザー削除 |

### AI

| メソッド | パス | 説明 |
|---|---|---|
| GET | `/api/ai/status` | AI 利用可否（`{ available: bool }`） |
| GET | `/api/ai/analyze` | `?referenceDate&storeId&department&lang` → 売上コメント |
| GET | `/api/ai/forecast` | `?referenceDate&storeId&department&lang` → 日次予測 |
| GET | `/api/ai/today` | 当日サマリー AI |
| GET | `/api/ai/hourly-forecast` | 時間別予測 |

### `/api/report` レスポンス形式

```json
{
  "referenceDate": "2026-03-16",
  "today": { ...data JSON... },
  "yesterday": { ...data JSON... } | null,
  "lastWeek": { ...data JSON... } | null
}
```

---

## 7. 画面仕様

### タブ構成

| タブ | ID | データソース | 表示条件 |
|---|---|---|---|
| 店別速報 | `hourly` | `reports`（速報） | 常時（デフォルト） |
| 全店速報 | `allstores` | `reports`（速報） | 常時 |
| 確定値 | `confirmed` | `confirmed_reports`（確定値） | 常時（データなし時は空メッセージ） |
| 商品別 | `products` | `reports`（速報）または `confirmed_reports` | 常時 |
| AIレポート | `ai` | `reports`（速報） | 常時（AI 未設定時は通知表示） |

設定（`setup`）・ユーザー管理（`users`）はヘッダーリンクからアクセス。

---

### 7-1. 店別速報（hourly タブ）

#### フィルター

| 項目 | 種別 | 説明 |
|---|---|---|
| 店舗 | セレクト | 店舗マスタから動的生成 |
| 部門 | セレクト | Total / Grocery / Fruit & Vegetable / … |
| 日付 | 日付入力 | アップロード済み日付から選択 |
| 通貨 | セレクト | THB / JPY（為替レート自動適用） |

#### KPI カード（10枚）

| カード | 表示条件 |
|---|---|
| 純売上高（プライマリ） | 常時 |
| 販売数量 | 常時 |
| レシート数 | Total のみ |
| Sales per Hour | 常時 |
| Transaction per Hour | Total のみ |
| Unit Per Transaction | 常時 |
| Average Transaction Price | Total のみ |
| Average Selling Price | 常時 |
| 構成比 | 部門選択時のみ |
| 店内ランキング | 部門選択時のみ |

各カードに DoD / WoW のトレンドバッジを表示（前日・前週データが存在する場合）。

#### 時間別テーブル

| 列 | 説明 |
|---|---|
| 時間帯 | `HH:MM` 形式 |
| 純売上高 | 当日値（THB or JPY） |
| DoD | 対前日差額・変化率 |
| WoW | 対前週同曜日差額・変化率 |
| 販売数量 | — |
| レシート数 | Total のみ |

- 総計行はフッターに表示
- 時間帯は売上 > 0 のスロットのみ表示（固定時間帯セレクタは廃止）

#### グラフ（Chart.js）

| グラフ | 種類 | 説明 |
|---|---|---|
| 時間別純売上高 | 棒グラフ | 今日・昨日・先週を並列表示 |
| 時間別レシート数 | 棒グラフ | 同上 |
| 累計売上高予測 | 折れ線 | 実績＋AI予測（信頼区間バンド付き） |
| 累計レシート数予測 | 折れ線 | 同上 |

グラフカラー（ライトテーマ）:

| 系列 | 色 |
|---|---|
| 今日 | `rgba(29,78,216,0.80)` / インディゴブルー |
| 昨日 | `rgba(251,146,60,0.70)` / オレンジ |
| 先週 | `rgba(156,163,175,0.55)` / グレー |
| 予測ライン | `rgb(217,119,6)` / アンバー |
| 実績累計 | `rgb(29,78,216)` / インディゴ |

#### 部門別構成比（インサイトスプリット）

- 左側: 部門別アコーディオン（部門ごとに時間別内訳を展開可能）
- 右側: 商品内訳 Top 10（選択部門が Total 以外の場合に表示）
- 両カラムは同じ高さに揃え、商品内訳側はオーバーフロー時スクロール

部門別カラーテーマ:

| 部門 | 背景色 | アクセント |
|---|---|---|
| Grocery | `#fefce8` | `#a16207`（黄） |
| Fruit & Vegetable | `#eef9f0` | `#22a352`（緑） |
| Fish & Seafood | `#eef8ff` | `#0284c7`（水色） |
| Meat | `#fff0f6` | `#db2777`（ピンク） |
| Delicatessen | `#fff5eb` | `#ea580c`（オレンジ） |
| Store Management | `#ffffff` | `#6b7280`（グレー） |

---

### 7-2. 全店速報（allstores タブ）

- 全店舗の選択日・選択部門の売上をランキングテーブルで表示
- 列: 順位・店舗名・純売上高・販売数量・レシート数・DoD・WoW
- ソート: 純売上高 / 販売数量 / レシート数 / 店舗名 / DoD / WoW

---

### 7-3. 商品別（products タブ）

- `byProduct` データが存在する場合のみランキングを表示
- フィルター: 店舗・日付・部門・ソートキー・表示件数（デフォルト 20 件）
- 列: 順位・商品コード・商品名・販売数量・純売上高・構成比・DoD・WoW
- データなし時: `Item_Code` 列が含まれていない旨のヒントを表示

---

### 7-4. 確定値（confirmed タブ）

ERP からレジ締め後に送信される確定データを表示する。速報（`hourly` タブ）とは独立したビュー。

#### フィルター

| 項目 | 説明 |
|---|---|
| 店舗 | 店舗マスタから動的生成 |
| 日付 | 確定値が存在する日付から選択 |
| 通貨 | THB / JPY |

#### 表示内容

| セクション | 内容 |
|---|---|
| KPI サマリー | 確定純売上・粗売上・値引き額・売上原価・販売数量・レシート数 |
| 部門別一覧 | 部門ごとの確定純売上・値引き額・売上原価 |
| 商品別ランキング | JAN コード単位の販売数量・純売上・値引き額・売上原価（Top N） |

- 確定値データが存在しない日付はメッセージを表示
- 速報と比較できるよう、同日の速報純売上を小さく併記（任意）

---

### 7-5. AIレポート（ai タブ）

- Gemini API が未設定の場合は通知を表示し入力欄を非活性化
- 売上コメント（テキスト）と時間帯別売上予測（グラフ）を生成
- 対応言語: ja / en / th

---

### 7-5. セットアップ（upload ページ）

- ファイルアップロード: Excel（.xlsx/.xls）または CSV。複数ファイル同時可。最大 10 ファイル
- ユーザー管理（管理者のみ）: ユーザー一覧・作成・編集・削除
- 店舗マスタ（管理者のみ）: 店舗名・ID の更新
- 営業時間（管理者のみ）: 店舗別の開店・閉店時刻

---

## 8. フロントエンド設計

### デザインシステム

| 項目 | 値 |
|---|---|
| テーマ | ライト（白背景） |
| プライマリフォント | Plus Jakarta Sans |
| 数値フォント | DM Mono（等幅） |
| 日本語フォント | Noto Sans JP |
| アクセントカラー | `#1d4ed8`（インディゴブルー） |
| 背景色 | `#f4f6f9` |
| カード背景 | `#ffffff` |
| 成功色 | `#15803d`（緑） |
| エラー色 | `#dc2626`（赤） |

### 状態管理（`state` オブジェクト）

```javascript
state = {
  today: { ...data },        // 当日レポート（_updatedAt 含む）
  yesterday: { ...data },    // 前日レポート
  lastWeek: { ...data },     // 前週レポート
  referenceDate: 'YYYY-MM-DD',
  currency: 'THB',           // 表示通貨
  exchangeRate: 4.92,        // THB→JPY レート
  lang: 'ja'                 // 表示言語
}
```

### 多言語対応

`i18n.js` で ja / en / th の3言語を管理。
HTML 要素の `data-i18n` 属性に翻訳キーを指定し、`applyI18n()` で一括反映。

### 通貨変換

`currency-select` で THB/JPY を切り替え。JPY 表示時は `exchangeRate` を乗じて換算。
為替レートは `GET /api/stores` レスポンスの `exchangeRate` フィールドから取得。

### ユーザー設定の自動反映

ログイン後 `GET /api/auth/status` で取得した `preferredStore`・`preferredDepartment` を
以下のセレクトに反映（`applyUserPreferences()`）:

- `store-select`、`ai-store-select`
- `department-select`、`ai-department-select`、`products-dept-filter`

### 自動リフレッシュ

- 今日の日付が選択されているときのみ有効
- 5分ごとにサイレントリフレッシュ（`silentRefreshReport()`）
- スピナーを表示せず状態だけ更新し `renderReport()` を再呼び出し
- 「最終更新」表示は `state.today._updatedAt`（ファイルアップロード日時）を使用

### 最終更新時間の表示ルール

- `_updatedAt` は SQLite の `created_at`（UTC文字列 `"YYYY-MM-DD HH:MM:SS"`）
- ブラウザのローカルタイムに変換して `HH:MM` 形式で表示
- **`new Date()`（現在時刻）は使わない**

---

## 9. デプロイ・環境変数

### 必須環境変数

| 変数 | 説明 |
|---|---|
| `DB_PROVIDER` | `sqlite` / `supabase` / `postgres` |

### オプション環境変数

| 変数 | 説明 |
|---|---|
| `PORT` | リスニングポート（デフォルト `3333`） |
| `SESSION_SECRET` | セッション署名キー（本番は必ず設定） |
| `GEMINI_API_KEY` | AI分析・予測機能 |
| `SUPABASE_URL` | Supabase URL（`DB_PROVIDER=supabase` 時） |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase サービスロールキー |
| `DATABASE_URL` | PostgreSQL 接続文字列（`DB_PROVIDER=postgres` 時） |
| `AZURE_CLIENT_ID` | Entra ID アプリID |
| `AZURE_CLIENT_SECRET` | Entra ID シークレット |
| `AZURE_TENANT_ID` | Entra ID テナントID |
| `ERP_UPLOAD_USERNAME` | ERP 確定値送信用 Basic 認証ユーザー名 |
| `ERP_UPLOAD_PASSWORD` | ERP 確定値送信用 Basic 認証パスワード |

### デプロイ先

| 環境 | DB | 詳細 |
|---|---|---|
| ローカル開発 | SQLite | `DB_PROVIDER=sqlite` |
| Cloud Run / Fly.io | Supabase or Cloud SQL | 詳細は `docs/PRODUCTION_DEPLOY.md` |
| Supabase | Supabase | 詳細は `docs/SUPABASE_SETUP.md` |

### キャッシュ無効化

`server.js` で `.js`・`.css`・`.html` に `Cache-Control: no-store` を設定済み。
変更が反映されない場合は `Ctrl+Shift+R`（強制リロード）で解決。
