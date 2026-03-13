# LS-Central Integration with the Sales Report App

Main options for integrating LS-Central with this app (Daily Sales Report). Choose based on your environment (on-prem/cloud, permissions, and operations).

---

## 1. Scheduled Run + Shared Folder (Simple)

**Flow:**  
LS-Central’s scheduler runs “Daily Sales Report (Hourly Sales by Department)” on a schedule and outputs Excel to a **shared folder** → this app watches that folder and imports the files.

**LS-Central side:**
- Schedule the report job in the job queue (e.g. daily at 24:00).
- Set the report output to a shared folder (UNC path) accessible from the app server.

**This app (to be implemented):**
- Watch a configured folder at a fixed interval (e.g. using `chokidar`).
- When a new `.xlsx` appears, read it and, when today’s, yesterday’s, and last week’s files are all present, update the report data (in-memory/JSON storage, etc.).

**Pros:** Reuses existing “export to Excel” workflow.  
**Cautions:** Define shared folder permissions, path, and file naming rules.

---

## 2. Send Files from LS-Central via HTTP (Recommended)

**Flow:**  
After LS-Central runs the report, it **POSTs** the generated Excel to **this app’s API**.

**LS-Central side:**
- After the report runs, add logic to send the generated file via HTTP POST.
  - **On-prem:** Custom Codeunit calling an HTTP client (e.g. .NET `HttpClient` via COM, or NAV/BC HTTP features) to send multipart to this app’s `POST /api/upload`.
  - **Cloud / Power Automate:** Export the report to Excel → use the “HTTP” action in a flow to POST the file to this app’s URL.
- Send right after the report runs or when the scheduled job completes.

**This app (current behavior):**
- Existing `POST /api/upload` can be used as-is.
- For integration compatibility, this endpoint currently accepts unauthenticated POST.
- If you need tighter security, restrict by network (Cloud Run ingress/VPC/WAF/IP allowlist) or add a shared secret/header validation at application layer.
- Define rules for treating received files as “today”, “yesterday”, “last week” (by filename or date parameters) and have the front end show the latest data.

**Pros:** No shared folder; easy to use from cloud.  
**Cautions:** LS-Central must implement HTTP send or Power Automate must be configured.

---

## 3. OData / Web Service Data Fetch (Custom Work Required)

**Flow:**  
If the report’s source data is **exposed via OData** in LS-Central, this app can call OData on a schedule and build the same report structure (by time slot and department).

**LS-Central side:**
- Per the documentation, OData is used by publishing a “Page” or “Query” as a web service.
- You need a Page/Query that returns the **source data** for “Daily Sales Report (Hourly Sales by Department)” (time slot, department, sales, etc.) and expose it via OData. Create and publish it if not available out of the box.
- Configure authentication (Basic, OAuth, etc.).

**This app (to be implemented):**
- Call the OData URL on a schedule (cron or node-cron).
- Transform the returned JSON into the shape expected by the current `parser.js` (time slots, Gross/Net, quantity, receipt count, etc.).
- Store the result as “today”, “yesterday”, “last week” and have the existing Output tab use that data.

**Pros:** No Excel in the middle; direct data integration.  
**Cautions:** Design of published objects, permissions, and data shape. Availability depends on LS-Central version and license.

---

## 4. Keep Manual Upload, Automate Only “Scheduled Run” (Closest to Current)

**Flow:**  
Only **scheduled report run and Excel export** are automated in LS-Central. This app continues to be used with “user uploads files to view”.

**LS-Central side:**
- Scheduler runs the report daily and saves to a folder with a date in the filename (e.g. `Daily_Sales_Report_20260224.xlsx`).
- Operation: choose the three files (today, yesterday, last week) and upload them in this app.

**This app:**  
No changes. Keep using “upload 3 files in the Input tab and generate report”.

**Pros:** No implementation; works with current process.  
**Cons:** Upload remains manual.

---

## Implementation Priority Overview

| Method                 | Effort   | LS-Central changes     | Recommendation |
|------------------------|----------|------------------------|----------------|
| 2. HTTP POST           | Medium   | Add send logic         | ★★★            |
| 1. Shared folder watch | Medium   | Set output path        | ★★             |
| 3. OData fetch         | High     | Publish Page/Query     | ★ (evaluate)   |
| 4. Manual only         | None     | Schedule only          | ★★             |

---

## Next Steps

- **“We want LS-Central to send files on a schedule”**  
  → Prefer method 2: use `POST /api/upload` and define operational security controls (network restriction and/or app-level shared secret), then store files by date.
- **“We already output to a shared folder”**  
  → Implement method 1 (folder watch) in this app and auto-load the latest files from that folder.

If you have chosen a method, a concrete implementation outline (API spec, folder watch example, etc.) can be provided for that option.
