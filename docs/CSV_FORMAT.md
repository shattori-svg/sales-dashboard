# CSV 連携フォーマット

この形式の CSV は、Setup 画面からのアップロードおよび `POST /api/upload`（multipart/form-data、`files` に CSV ファイル）で取り込みできます。

## 列の並び順

**売上日 → 店舗 → 部門 → 時間 → 各実績値** の順とすること。

## ヘッダー（1行目）

```
Business_Date,Store_Id,Department_Code,Start_Time,End_Time,Net_Sales,Gross_Sales,Quantity_Sold,Receipt_Count
```

- **Business_Date**: 営業日（YYYY-MM-DD）
- **Store_Id**: 店舗ID（必須。例: 1001）
- **Department_Code**: 00＝店舗合計、01～06＝部門
- **Start_Time**, **End_Time**: 時間帯。`HH:MM`（例: 10:00, 11:00）または4桁（例: 0000, 0100, 1000, 2300）で指定。空欄の行は日計行
- **Net_Sales**, **Gross_Sales**: 正味売上・総売上（数値）
- **Quantity_Sold**: 販売数量
- **Receipt_Count**: レシート数（Total は推奨必須。部門行も値があれば取り込み可能、空欄でも可）

## 部門コード

| コード | 部門 |
|--------|------|
| 00 | 店舗合計（日計行は Start_Time/End_Time 空。時間帯別は各時間に 00 の行） |
| 01 | Grocery |
| 02 | Fruit & Vegetable |
| 03 | Fish & Seafood |
| 04 | Meat |
| 05 | Delicatessen |
| 06 | Store Management |

## 行の並び例

1. 日計 1 行（Start_Time, End_Time 空、Department_Code 00）
2. 時間帯別 Total（各時間帯ごとに Department_Code 00、Receipt_Count あり）
3. 時間帯別・部門別（01～06、`Receipt_Count` は空欄可／値があれば取り込み）

文字コード: UTF-8（BOM あり可）。区切り: カンマ。
