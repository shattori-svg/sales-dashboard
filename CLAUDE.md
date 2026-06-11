# sales-dashboard — 開発ガイド

## プロジェクト概要

LOPIA Thailand の売上ダッシュボード。CSV または Excel をアップロードすると
時間別・部門別・商品別の売上を可視化する Node.js/Express 単一ページアプリ。

- **フロントエンド**: `index.html` / `app.js` / `style.css`（バニラJS + Chart.js）
- **バックエンド**: `server.js`（Express）、`parser.js`（CSV/Excel解析）、`db.js`（SQLite）
- **認証**: セッションベースパスワード認証 または Microsoft Entra ID（Azure AD）外部認証
- **デフォルトポート**: 3333

---

## ローカル開発セットアップ

### 環境変数（`.env`）

```
DB_PROVIDER=sqlite          # ローカル開発は sqlite 固定
GEMINI_API_KEY=...          # AI分析・予測機能（省略可）
```

`DB_PROVIDER=sqlite` のとき `better-sqlite3` を使用。Supabase/PostgreSQLクライアントは初期化されない。

### サーバー起動

```bash
# dotenvx が利用可能な場合
node -r dotenvx/config server.js

# dotenvx が使えない場合（環境変数を直接渡す）
DB_PROVIDER=sqlite GEMINI_API_KEY=xxx node server.js
```

### ポート競合（EADDRINUSE）の解消

```powershell
netstat -ano | findstr :3333
powershell -Command "Stop-Process -Id <PID> -Force"
```

※ `taskkill /F /PID` はスラッシュの扱いで失敗することがある。

---

## DB プロバイダー

| `DB_PROVIDER` | 使用モジュール | 用途 |
|---|---|---|
| `sqlite` | `db.js` + `better-sqlite3` | ローカル開発 |
| `supabase` | `db-supabase.js` | Supabase（クラウド） |
| `postgres` | `db-postgres.js` | Cloud SQL / 生PostgreSQL |

---

## アーキテクチャ上の重要な決定事項

### DoD/WoW 当日部分比較

比較用の timeKey セットは `rowsHourly`（netSales > 0 のスロット）から構築する。
`todayHourly`（全スロット、売上0含む）を使ってはいけない。

```javascript
// OK
var rowsHourly = (todayHourly || []).filter(h => (h.netSales || 0) > 0);
var todayKeySet = {};
rowsHourly.forEach(h => { todayKeySet[h.timeKey] = true; });
if (yesterdayHourly) yesterdayHourly = yesterdayHourly.filter(h => todayKeySet[h.timeKey]);
```

**理由:** `total.hourly` には売上0のスロットも含まれる。全スロットをキーにすると
昨日の全日データが絞り込まれず、当日部分÷昨日全日 になって DoD が過小評価される。

### 時間帯セレクタは廃止

売上があるスロットを自動的に全件表示する。`startTime='00:00'`, `endTime='24:00'` に固定。
ユーザーに手動設定させない。

### byProduct 二重カウント防止

CSV の商品行（`Item_Code` あり）は `byProduct` のみに集計し、
`byDepartment` には加算しない（部門合計行が既に部門売上を持つため）。

```javascript
if (itemCode && deptName) {
  byProduct[itemCode].totalNetSales += netSales; // byDept には加算しない
} else if (deptName && byDept[deptName]) {
  // 既存の部門行処理
}
```

### ブラウザキャッシュ無効化

`server.js` で `.js/.css/.html` に `Cache-Control: no-store` を設定済み。
「コードを直したのに動かない」場合は `Ctrl+Shift+R`（強制リロード）を試す。

### 最終更新時間の表示

`db.js` の `getReport()` は `created_at`（アップロード日時）を `_updatedAt` として返す。
`app.js` の `updateAutoRefreshStatus()` はこの値を使って「最終更新: HH:MM」を表示する。
`new Date()`（現在時刻）は使わない。

```javascript
var ts = state.today && state.today._updatedAt;
// SQLite は "2026-03-17 08:42:11"（UTC）形式なので 'T' + 'Z' を補う
var d = new Date(ts.indexOf('T') === -1 ? ts.replace(' ', 'T') + 'Z' : ts);
```

### 自動リフレッシュ

今日の日付が選択されているときのみ、5分ごとにサイレントリフレッシュ（`silentRefreshReport()`）が動く。
日付が過去のときは `startAutoRefresh()` は即リターンする。

### 商品別粗利率（COGS）は BC ValueEntries から翌朝マージ

商品別の粗利率は**実際原価（COGS）**で計算する。データソースは BC 標準 Web サービス
`ValueEntries`（`Item_Ledger_Entry_Type='Sale'` の `Cost_Amount_Actual`、符号反転して正値に）。
Value Entry は LS Central のステートメント記帳後（≒翌朝）にしか存在しないため、
売上フィード（当日・毎時）とは別に **get-item-sales の `src/syncCosts.js` が毎朝
「昨日」分を取得**し、`POST /api/upload/item-costs` で既存レポートの
`byProduct[*].costAmount` にマージする。

- `costAmount` が無い/0 の商品は「原価未取込」として UI では `-` 表示（0%と区別する）
- マージは上書き（再実行安全）。BC の原価調整ジョブ後の再取込にも使える
- `/api/upload/item-costs` は `is_final` フラグを保持したまま保存する
- ItemSalesPage（売上フィードの OData ページ）にはコスト系フィールドが**公開されていない**
  （2026-06-10 に $metadata で確認済み）。コストを売上フィードに混ぜようとしない
- ⚠️ BC のアイテム原価マスタに入力不備があり、原価>>売価の商品が存在
  （例: ケース原価が単品原価として登録）。粗利率が大きな負値になるのはダッシュボードの
  バグではなく BC マスタのデータ品質問題

### シェルはサイドバー構造・ナビボタンの contract

`index.html` は `.app-shell`（grid: サイドバー 236px + メイン列）。**ナビボタンは
`class="tab"` + `data-tab` を必ず維持する** — `app.js` の `switchTab()` がこのセレクタで
全タブ・パネルを切り替えるため。モバイル(<1024px)はサイドバーが横スクロールナビに
CSS だけで変形する（ドロワーJSなし）。ヘッダーの表示中ビュー名は `#header-page-title`
（`switchTab` と `languageChange` イベントで更新）。

### セキュリティ前提（2026-06 強化済み）

- **本番では `SESSION_SECRET` 必須**（未設定なら起動失敗）。Secret Manager `session-secret`
  から注入。変更すると全ユーザーのセッションが無効化される
- API キー/ERP Basic 認証は `timingSafeEqualStr()` で定数時間比較
- `/login`・`/api/bootstrap-admin` にインメモリレートリミッタ（15分20回/IP）
- 大きいJSONを受けるルートは `LARGE_JSON_ROUTES` でグローバル `express.json()`(100kb) を
  バイパスする。新たに大きいペイロードのルートを足すときはここに追加すること

### 監査ログ

管理操作の監査証跡は `masters` テーブルの `audit_log` キーに上限2000件のJSON配列で保存
（3バックエンド共通・DDL不要）。記録は `audit(req, action, detail)`（fire-and-forget、
失敗してもリクエストは壊さない）。閲覧は `GET /api/audit-log`（admin）と /setup の
「監査ログ」タブ。記録対象: login/login_failed/logout/bootstrap_admin/user_*/
stores_update/exchange_rate_update/business_hours_update/product_master_import。

### jest がハングする場合

このマシンでは jest のワーカー終了処理が稀にハングする（テスト自体は数秒で全合格）。
`npx jest --testPathPatterns=tests/ --runInBand --forceExit` で回避できる。

### 部門別「買い上げ点数」の分母は全店レシート数

`computeSummary()` の `receiptByTimeKey`（全店の時間帯別客数マップ）を部門表示でも渡し、
`h.receiptCount`（部門固有の客数）より優先する。

```javascript
// computeSummary 内
var rc = (receiptByTimeKey && receiptByTimeKey[h.timeKey] != null)
  ? receiptByTimeKey[h.timeKey]          // 全店客数を優先
  : (h.receiptCount != null ? h.receiptCount : 0);
```

**理由:** LS-Central の CSV/Excel では部門行の `receiptCount` が部門固有の取引件数になる。
鮮魚部など「1取引1点」になりやすい部門では `qty/dept_receipts ≈ 1.0` となり正しくない。
正しい「部門別買い上げ点数」は `部門販売数 / 全店客数`（例: 901 / 1260 ≈ 0.7）。

`renderReport()` では `summaryReceiptToday = receiptToday`（isTotal に関わらず全店マップ）を渡す。
また `fallbackReceiptToday` は部門表示でも全店日計客数（`total.totalRow.receiptCount`）を維持し、
`null` で上書きしない。

---

## テスト

```bash
npm test   # jest --testPathPatterns=tests/
```

- `--testPathPattern`（単数形）は非推奨。`--testPathPatterns` を使う
- `parseSheet()` はヘッダーのみの Excel でも `null` を返さず空構造を返す

---

## CSVフォーマット

詳細は `docs/CSV_FORMAT.md` を参照。

```
Business_Date,Store_Id,Department_Code,Start_Time,End_Time,Net_Sales,Gross_Sales,Quantity_Sold,Receipt_Count[,Item_Code,Item_Name]
```

### 行の種類

| Department_Code | Item_Code | 処理 |
|---|---|---|
| 00 or "" | "" | 日計・時間別合計行 |
| 01–06 | "" | 時間別部門行 → `byDepartment` |
| 01–06 | "490..." | 商品行 → `byProduct` のみ |

`Item_Code` / `Item_Name` 列は省略可能（後方互換）。

### 部門コード

| コード | 部門名 |
|---|---|
| 00 | 店舗合計 |
| 01 | Grocery |
| 02 | Fruit & Vegetable |
| 03 | Fish & Seafood |
| 04 | Meat |
| 05 | Delicatessen |
| 06 | Store Management |

---

## フロントエンド構成

### タブ一覧

| タブ ID | 内容 |
|---|---|
| `hourly` | 時間別売上（メインダッシュボード）|
| `allstores` | 全店舗速報 |
| `products` | 商品別ランキング |
| `daily` | 日次集計 |
| `weekly` | 週次集計 |
| `ai` | AI分析・予測 |
| `setup` | ファイルアップロード |
| `users` | ユーザー管理 |

### デザインシステム

- **フォント**: `Plus Jakarta Sans`（UI）+ `DM Mono`（数値）+ `Noto Sans JP`（日本語フォールバック）
- **カラー**: ライトテーマ（白背景）。アクセントカラー `#1d4ed8`（インディゴブルー）
- **CSS変数**: `:root` で一元管理。ダークカラー（`#0c1117` 等）やアンバー（`#e8a838` 等）はライトテーマ化済みで使わない

### Chart.js カラー（`CHART_OPTS`）

ライト背景向けの配色。ダーク背景用の色（白系グリッド線 `rgba(255,255,255,...)` 等）は使わない。

```javascript
var CHART_OPTS = {
  color: '#6b7280',
  grid: 'rgba(0,0,0,0.06)',
  today:     { bg: 'rgba(29,78,216,0.80)',   border: 'rgb(29,78,216)' },
  yesterday: { bg: 'rgba(251,146,60,0.70)',  border: 'rgb(251,146,60)' },
  lastWeek:  { bg: 'rgba(156,163,175,0.55)', border: 'rgb(156,163,175)' },
  ...
};
```

### ユーザー設定の反映（`applyUserPreferences()`）

`department-select`・`ai-department-select`・`products-dept-filter` の3つに
`authState.preferredDepartment` を反映する。

---

## 主要APIエンドポイント

| メソッド | パス | 説明 |
|---|---|---|
| `POST` | `/api/upload` | CSV/Excel アップロード（認証不要） |
| `POST` | `/api/upload/item-costs` | 商品別COGSマージ（`{businessDate, storeId, costs:{itemCode:THB}}`、X-API-Key） |
| `GET` | `/api/report` | 売上レポート取得（`?referenceDate=YYYY-MM-DD&storeId=xxx`） |
| `GET` | `/api/dates` | アップロード済み日付一覧 |
| `GET` | `/api/stores` | 店舗一覧 |
| `GET` | `/api/ai/analyze` | AI分析テキスト生成 |
| `GET` | `/api/ai/forecast` | AI売上予測 |
| `GET` | `/api/allstores` | 全店舗当日サマリー |

---

## `_updatedAt` フィールド

`getReport()` が返すデータには `_updatedAt`（UTC ISO文字列）が付与される。
これはそのレポートの最終アップロード日時であり、フロントエンドの「最終更新」表示に使う。
`yesterday` / `lastWeek` の `_updatedAt` は表示に使わない（`today` のみ使用）。
