# Sales Report API — CSV Format Specification (English)

This document defines the CSV format for uploading daily sales data to the Sales Report app via Setup upload or `POST /api/upload` (multipart/form-data, field name `files`).

---

## 1. Overview

| Item | Specification |
|------|---------------|
| **Character encoding** | UTF-8 (BOM optional) |
| **Delimiter** | Comma (`,`) |
| **Line break** | CRLF or LF |
| **Header row** | Row 1: column names (exactly as listed below) |
| **Column order** | Business date → Store → Department → Time → Metrics (see §2) |

---

## 2. Column Definitions (order: Business date → Store → Department → Time → Metrics)

| Order | Column name | Required | Type | Description |
|-------|--------------|----------|------|-------------|
| 1 | **Business_Date** | Yes | Date | Business date. Format: `YYYY-MM-DD` |
| 2 | **Store_Id** | Yes | String | Store identifier (e.g. `1001`). Used to support multiple stores in one file. |
| 3 | **Department_Code** | Yes | String | Department code. `00` = store total; `01`–`06` = department (see table below). |
| 4 | **Start_Time** | No | Time | Start of time slot. Format: `HH:MM` or 4-digit (`0000`, `0100`, `2300`). Leave empty for daily total row. |
| 5 | **End_Time** | No | Time | End of time slot. Format: `HH:MM` or 4-digit (`0000`, `0100`, `2300`). Leave empty for daily total row. |
| 6 | **Net_Sales** | Yes | Numeric | Net sales (Baht). |
| 7 | **Gross_Sales** | No | Numeric | Gross sales (Baht). |
| 8 | **Quantity_Sold** | No | Numeric | Quantity sold. |
| 9 | **Receipt_Count** | No | Numeric | Receipt count. Recommended for Total (00) rows; may be empty for department rows, but department values are also accepted. |

---

## 3. Department Code Mapping

| Code | Department |
|------|------------|
| 00 | Store total (use with empty Start_Time/End_Time for daily total row; use with time slots for hourly total). |
| 01 | Grocery |
| 02 | Fruit & Vegetable |
| 03 | Fish & Seafood |
| 04 | Meat |
| 05 | Delicatessen |
| 06 | Store Management |

---

## 4. Data Rules

- **Daily total row**: One row per store per day with **Start_Time** and **End_Time** empty, **Department_Code** = `00`, and daily aggregates in Net_Sales, Quantity_Sold, Receipt_Count.
- **Hourly rows**: For each time slot (e.g. 09:00–10:00, 10:00–11:00), include:
  - One row with Department_Code = `00` (hourly total; Receipt_Count populated when applicable).
  - Rows with Department_Code = `01`–`06` for per-department breakdown (Receipt_Count may be empty or populated).
- **Time slots**: Use 24 hourly slots in `HH:MM` format (e.g. `00:00`–`01:00`, `01:00`–`02:00`, … , `23:00`–`00:00`). For integration during 09:00–23:00, only the relevant slots need to be present.
- **Multiple stores**: Include all stores in the same CSV; distinguish by **Store_Id**. Each store should have its own daily total row and hourly/department rows.

---

## 5. Header Row (exact — order: business date, store, department, time, metrics)

```
Business_Date,Store_Id,Department_Code,Start_Time,End_Time,Net_Sales,Gross_Sales,Quantity_Sold,Receipt_Count
```

---

## 6. Row Order Example

1. Daily total: one row per store (Start_Time, End_Time empty, Department_Code 00).
2. Hourly totals: for each time slot, one row with Department_Code 00 and Receipt_Count.
3. Hourly by department: for each time slot, rows with Department_Code 01–06 (Receipt_Count may be empty or populated).

---

## 7. Sample Data

See `docs/csv-format-sample.csv` for a sample file (one store, selected time slots and departments).

Example snippet:

```csv
Business_Date,Store_Id,Department_Code,Start_Time,End_Time,Net_Sales,Gross_Sales,Quantity_Sold,Receipt_Count
2026-02-26,1001,00,,,2037923.92,2121568.6,13968,1765
2026-02-26,1001,00,10:00,11:00,83911.34,86808.7,527,61
2026-02-26,1001,00,11:00,12:00,340675.57,355155.7,2253,239
2026-02-26,1001,01,10:00,11:00,12397.16,,186,
2026-02-26,1002,00,,,1500000,1560000,10000,1200
```

---

## 8. Revision History

| Date | Description |
|------|-------------|
| 2026-02 | Initial English version. |
