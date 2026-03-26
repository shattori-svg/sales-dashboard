# CSV 連携フォーマット / CSV Format Specification

この形式の CSV は、Setup 画面からのアップロードおよび `POST /api/upload` または `POST /api/upload/final`（multipart/form-data、`files` に CSV ファイル）で取り込みできます。

This CSV format is accepted by the Setup upload page and `POST /api/upload` / `POST /api/upload/final` (multipart/form-data, field name `files`).

---

## ヘッダー行 / Header Row

**速報（`POST /api/upload`）:**
```
Business_Date,Store_Id,Department_Code,Start_Time,End_Time,Net_Sales,Gross_Sales,Quantity_Sold,Receipt_Count[,Item_Code]
```

**確定値（`POST /api/upload/final`、ERP 自動送信）:**
```
Business_Date,Store_Id,Department_Code,Retail_Class,Division,Net_Sales,Gross_Sales,Quantity_Sold,Receipt_Count,Discount_Amount,Item_Code,Cost_Amount
```

`Discount_Amount`・`Cost_Amount` は確定値フォーマット専用。速報には含めない。

列の並び順: **売上日 → 店舗 → 部門 → 時間 → 実績値**
Column order: **Business date → Store → Department → Time → Metrics**

---

## 列定義 / Column Definitions

| 列名 / Column | 型 / Type | 必須 / Req | 説明 / Description |
|---|---|---|---|
| `Business_Date` | `YYYY-MM-DD` | ◯ | 営業日 / Business date |
| `Store_Id` | 文字列 / String | ◯ | 店舗コード（例: `1001`）/ Store code |
| `Department_Code` | `00`〜`06` | ◯ | 部門コード（下表参照）/ Department code |
| `Start_Time` | `HH:MM` / 空 | △ | 時間帯の開始。日計行・商品行は空白 / Start of time slot; empty for daily/product rows |
| `End_Time` | `HH:MM` / 空 | △ | 時間帯の終了。日計行・商品行は空白 / End of time slot; empty for daily/product rows |
| `Net_Sales` | 整数 / Integer | ◯ | 純売上（値引き後）/ Net sales (after discount) |
| `Gross_Sales` | 整数 / Integer | △ | 粗売上（値引き前）/ Gross sales (before discount) |
| `Quantity_Sold` | 整数 / Integer | △ | 販売数量 / Quantity sold |
| `Receipt_Count` | 整数 / Integer | △ | 客数。部門行・商品行は `0` 可 / Receipt count; `0` allowed for dept/product rows |
| `Discount_Amount` | 整数 / Integer | △ | **★新規** 値引き額（正数）。列ごと省略可 / Discount amount (positive). Entire column may be omitted. |
| `Item_Code` | 文字列 / String | △ | 商品コード（JAN 13桁）。商品行のみ記入 / Product code (JAN 13-digit). Product rows only. |
| `Retail_Class` | 文字列（2桁）/ String (2-digit) | △ | **確定値専用** 大分類コード（例: `11`）。大分類・中分類・商品行のみ記入 / **Final only** Major category code. Category, subcategory, and product rows only. |
| `Division` | 文字列（4桁）/ String (4-digit) | △ | **確定値専用** 中分類コード（例: `1103`）。中分類・商品行のみ記入 / **Final only** Medium category code. Subcategory and product rows only. |
| `Discount_Amount` | 整数 / Integer | △ | **確定値専用** 値引き額（正数）/ **Final only** Discount amount (positive). |
| `Cost_Amount` | 整数 / Integer | △ | **確定値専用** 売上原価（COGS）。合計・部門・分類・商品の各日計行に記入 / **Final only** Cost of goods sold. Included in total, dept, category, and product daily rows. |

> ◯=必須 △=任意（空白可）　★新規=ERP確定値連携で追加 / ◯=required △=optional ★new=added for ERP final-value integration

`Item_Name` 列は不要です。商品名は商品マスタからマッピングします。
`Item_Name` column is not required. Product names are mapped from the product master.

---

## 部門コード / Department Codes

| コード / Code | 部門名 / Department |
|---|---|
| `00` | 全店舗合計 / Store total |
| `01` | Grocery |
| `02` | Fruit & Vegetable |
| `03` | Fish & Seafood |
| `04` | Meat |
| `05` | Delicatessen |
| `06` | Store Management |

---

## 行の種類 / Row Types

### 速報（`POST /api/upload`）

| `Dept_Code` | `Start_Time` | `Item_Code` | 処理 / Processing |
|---|---|---|---|
| `00` | 空 | 空 | 日計合計行 / Daily total row (`total.totalRow`) |
| `00` | `HH:MM` | 空 | 時間別合計行 / Hourly total (`total.hourly[]`) |
| `01`〜`06` | 空 | 空 | 部門時間別行 / Dept hourly (`byDepartment[name].hourly[]`) |
| `01`〜`06` | `HH:MM` | 空 | 部門時間別行 / Dept hourly (`byDepartment[name].hourly[]`) |
| `01`〜`06` | 空 | JAN コード | 商品日計行 / Product daily (`byProduct[itemCode]` のみ — `byDepartment` には加算しない）|

### 確定値（`POST /api/upload/final`）

時間別行なし / No hourly rows.

| `Dept_Code` | `Category_Code` | `Subcategory_Code` | `Item_Code` | 処理 / Processing |
|---|---|---|---|---|
| `00` | 空 | 空 | 空 | 合計日計 / Total daily (`total.totalRow`・`discountAmount`・`costAmount` あり) |
| `01`〜`06` | 空 | 空 | 空 | 部門日計 / Dept daily (`byDepartment[name].daily`・`discountAmount`・`costAmount` あり) |
| `01`〜`06` | 2桁コード | 空 | 空 | 大分類日計 / Major category daily (`byCategory[code].daily`) |
| `01`〜`06` | 2桁コード | 4桁コード | 空 | 中分類日計 / Medium category daily (`bySubcategory[code].daily`) |
| `01`〜`06` | 2桁コード | 4桁コード | 商品コード | 商品日計 / Product daily (`byProduct[itemCode]`・`discountAmount`・`costAmount` あり) |

---

## 速報 vs 確定値 / Provisional vs Final

| エンドポイント | 用途 / Purpose | `is_final` |
|---|---|---|
| `POST /api/upload` | 速報（手動・LS-Central）/ Provisional | `false` |
| `POST /api/upload/final` | 確定値（ERP 自動送信）/ ERP final value | `true` |

確定値として保存されたデータはダッシュボードに「確定済み ✓」バッジを表示します。
Data saved as final will show a "Confirmed ✓" badge in the dashboard.

---

## サンプル / Sample

```csv
Business_Date,Store_Id,Department_Code,Start_Time,End_Time,Net_Sales,Gross_Sales,Quantity_Sold,Receipt_Count,Discount_Amount,Item_Code
2026-03-16,1001,00,,,838800,880740,5171,984,15000,
2026-03-16,1001,00,10:00,11:00,49500,51975,322,63,800,
2026-03-16,1001,00,11:00,12:00,73200,76860,451,88,1200,
2026-03-16,1001,01,,,335520,352296,2068,0,6000,
2026-03-16,1001,01,10:00,11:00,19800,20790,129,0,,
2026-03-16,1001,01,,,5000,5250,50,0,,4901234567890
2026-03-16,1002,00,,,750000,790000,4800,920,12000,
2026-03-16,1002,01,,,300000,315000,1850,0,4500,
```

---

## その他 / Notes

- 文字コード: UTF-8（BOM あり可）/ Character encoding: UTF-8 (BOM optional)
- 区切り文字: カンマ / Delimiter: comma
- 改行: CRLF または LF / Line break: CRLF or LF
- 時間フォーマット: `HH:MM`（`10:00`）または4桁（`1000`）の両方を受け付ける / Both `HH:MM` and 4-digit formats accepted
- 複数店舗: 1ファイルに全店舗の行を含めてよい / Multiple stores may be included in one file
