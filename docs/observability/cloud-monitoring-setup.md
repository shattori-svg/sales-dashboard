# Cloud Monitoring Setup

GCP 側で一度だけ実施する設定手順。コードで提供するエンドポイント (`/healthz` `/readyz` `/api/health/freshness`) と構造化ログ (`jsonPayload.event`) を利用する。

## 推奨ルート

| 項目 | 推奨手段 | 理由 |
|---|---|---|
| Section 1: 通知チャンネル | `gcloud` | フラグ指定が安定している |
| Section 2: Uptime Check | `gcloud` or GUI どちらでも | |
| Section 3: ログベースメトリクス | `gcloud` | 単純な CLI で作れる |
| **Section 4: Alerting Policies** | **Console GUI** | `gcloud alpha monitoring policies create` のフラグ指定は gcloud のバージョンで壊れやすい。GUI が確実 |
| Section 5: 環境変数 | `gcloud` | |

Cloud Shell を開いて Section 1→2→3→5 を gcloud で一気に実行 → Section 4 は Console GUI で作成、という流れが最短。

## 前提

- Cloud Run サービスが `asia-northeast1` にデプロイ済み
- 通知先メール: `s.hattori@g.oic-sys.net`
- 以下の `$PROJECT_ID` と `$SERVICE` を環境に合わせて置換すること

```bash
export PROJECT_ID=<your-gcp-project-id>
export SERVICE=<cloud-run-service-name>
export REGION=asia-northeast1
export NOTIFY_EMAIL=s.hattori@g.oic-sys.net
export SERVICE_URL=$(gcloud run services describe $SERVICE --region=$REGION --format='value(status.url)')
```

---

## 1. 通知チャンネル（Email）

```bash
gcloud alpha monitoring channels create \
  --display-name="Sales Dashboard Email" \
  --type=email \
  --channel-labels=email_address=$NOTIFY_EMAIL

# 作成後の channel ID を控える
gcloud alpha monitoring channels list --filter="displayName:Sales Dashboard Email" --format="value(name)"
# → projects/$PROJECT_ID/notificationChannels/XXXXXXXXXX
export CHANNEL=<上記 name の値>
```

---

## 2. Uptime Check（サーバー失活監視）

- ライブネス（`/healthz`）— プロセス死活
- データ未着（`/api/health/freshness`）— 直近アップロードが閾値を超えたら 503 を返すので、同じ機構で検知できる

Console での作成が簡単（`Monitoring → Uptime checks → Create`）。CLI でやる場合:

```bash
# /healthz: 1分おき、3地域から
gcloud monitoring uptime create "sales-dashboard-healthz" \
  --resource-type=uptime-url \
  --resource-labels=host=${SERVICE_URL#https://},project_id=$PROJECT_ID \
  --path="/healthz" \
  --period=1 \
  --timeout=10

# /api/health/freshness: 営業時間中に Cloud Scheduler が叩くほうが柔軟だが、
# Uptime Check でも OK。まずはこちらで運用し、閾値が合わなければ Scheduler に切替。
gcloud monitoring uptime create "sales-dashboard-freshness" \
  --resource-type=uptime-url \
  --resource-labels=host=${SERVICE_URL#https://},project_id=$PROJECT_ID \
  --path="/api/health/freshness" \
  --period=5 \
  --timeout=15
```

**Alerting Policy（Uptime 失敗 → メール）** は Section 4 で Console GUI からまとめて作成する。Uptime Check 作成時に表示される「Create alerting policy」ボタンから作るのが最短。

---

## 3. ログベースメトリクス

コード側は `jsonPayload.event` ラベルを使って書いている（例: `upload_failed`, `export_failed`, `parse_failed`, `data_stale`, `auth_failed`, `db_error`, `unhandled_express_error`）。

以下のメトリクスを作成する:

| 名前 | フィルタ | 用途 |
|---|---|---|
| `upload_failed_count` | `resource.type="cloud_run_revision" AND jsonPayload.event="upload_failed"` | 要件3: 取り込みエラー |
| `parse_failed_count` | `resource.type="cloud_run_revision" AND jsonPayload.event="parse_failed"` | 要件3補助 |
| `export_failed_count` | `resource.type="cloud_run_revision" AND jsonPayload.event="export_failed"` | 要件4: 帳票出力エラー |
| `data_stale_count` | `resource.type="cloud_run_revision" AND jsonPayload.event="data_stale"` | 要件2: データ未着 |
| `unhandled_error_count` | `resource.type="cloud_run_revision" AND jsonPayload.event="unhandled_express_error"` | 要件6: その他エラー |
| `db_error_count` | `resource.type="cloud_run_revision" AND jsonPayload.event="db_error"` | DB障害 |

CLI 例（`upload_failed_count`）:

```bash
gcloud logging metrics create upload_failed_count \
  --description="Count of upload_failed events from sales-dashboard" \
  --log-filter='resource.type="cloud_run_revision" AND resource.labels.service_name="'$SERVICE'" AND jsonPayload.event="upload_failed"'
```

同じパターンで残りを作成する。

---

## 4. Alerting Policies

> **注意**: 現行の `gcloud alpha monitoring policies create` はフラグ指定の構文がバージョンごとに変わり、`--comparison` `--threshold-value` 等が認識されないケースがある。**Console GUI での作成を推奨**。どうしても CLI で完結させたい場合は末尾の「YAML + `--policy-from-file`」方式を使う。

通知チャンネルは Section 1 で作成した `Sales Dashboard Email` を全ポリシーに紐付ける。

### 4-0. 共通手順（GUI）

1. https://console.cloud.google.com/monitoring/alerting/policies を開く
2. `+ CREATE POLICY`
3. **Select a metric** で対象メトリクスを選ぶ（各項目で後述）
4. **Configure trigger** で `Threshold` `Above` など閾値を設定
5. **Notifications and name**
   - Notification channels: `Sales Dashboard Email` を選択
   - Alert policy name: 各項目の推奨名を設定
6. `Create policy` で保存

### 4-1. アップロード失敗（要件3）

- Metric: `Cloud Run Revision → Logging → logging/user/upload_failed_count`
- Condition: `Threshold / Above / 0`
- Rolling window: `5 min`
- Policy name: `[HIGH] Upload failed`

### 4-2. 帳票出力失敗（要件4）

- Metric: `logging/user/export_failed_count`
- 条件は 4-1 と同じ
- Policy name: `[HIGH] Export failed`

### 4-3. その他エラー（要件6）

- Metric: `logging/user/unhandled_error_count`
- Condition: `Above / 5`（アラート疲れ対策で運用開始は緩めに）
- Rolling window: `5 min`
- Policy name: `[WARN] Unhandled errors`

### 4-4. データ未着（要件2）

- Metric: `logging/user/data_stale_count`
- Condition: `Above / 0`
- Rolling window: `5 min`
- Policy name: `[HIGH] Sales data stale`
- 補足: `/api/health/freshness` が 503 を返すたびに `data_stale` ログが出るので、Section 2 で作った Uptime Check（`sales-dashboard-freshness`）の失敗アラートと重複する。どちらか片方だけ有効化すれば十分。

### 4-5. Uptime Check 失敗（要件1: サーバー失活）

- Metric の代わりに **Select a resource → Uptime check** から `sales-dashboard-healthz` を選択
- Condition: `Any uptime check for this resource is failing`
- Policy name: `[CRIT] /healthz down`
- Section 2 の Uptime Check 一覧画面から「Create alerting policy」で作るのが最短

### 4-6. CPU使用率（要件5）

- Metric: `Cloud Run Revision → Container → Container CPU utilization`
- Filter: `service_name = lopia-thailand-sales-manage`
- Aggregator: `mean`
- Condition: `Above / 0.8`（80%）
- Rolling window: `5 min`
- Policy name: `[WARN] CPU > 80% for 5m`

### 4-7. メモリ使用率（要件5）

- Metric: `Cloud Run Revision → Container → Container memory utilization`
- 他は 4-6 と同じ
- Policy name: `[WARN] Memory > 80% for 5m`

### 4-8. 5xx エラー率（要件6）

- Metric: `Cloud Run Revision → Request → Request count`
- Filter 追加: `response_code_class = 5xx`
- Aggregator: `rate`
- Condition: `Above / 0.01`（1%）
- Rolling window: `5 min`
- Policy name: `[HIGH] 5xx rate > 1% for 5m`
- 補足: 正確な 5xx率を取りたい場合は log-based metric で `5xx_count / total_count` を算出する方法もあるが、初期値はこれで十分。

---

### 4-X. CLI で作りたい場合（YAML + `--policy-from-file`）

`gcloud alpha monitoring policies create` のフラグ指定は壊れやすいため、YAML で定義するのが現行の正攻法。

例: アップロード失敗アラート

```bash
# 通知チャンネルの ID を取得
CHANNEL=$(gcloud alpha monitoring channels list \
  --filter='displayName:"Sales Dashboard Email"' \
  --format='value(name)')

cat > upload-failed-policy.yaml <<EOF
displayName: "[HIGH] Upload failed"
combiner: OR
conditions:
  - displayName: "upload_failed_count > 0 in 5m"
    conditionThreshold:
      filter: 'metric.type="logging.googleapis.com/user/upload_failed_count" AND resource.type="cloud_run_revision"'
      comparison: COMPARISON_GT
      thresholdValue: 0
      duration: 0s
      aggregations:
        - alignmentPeriod: 300s
          perSeriesAligner: ALIGN_SUM
notificationChannels:
  - ${CHANNEL}
EOF

gcloud alpha monitoring policies create --policy-from-file=upload-failed-policy.yaml
```

他のポリシーも同じ構造で、`filter`・`thresholdValue`・`aggregations` を差し替えるだけ。GUI で1件作ってから `gcloud alpha monitoring policies describe POLICY_ID --format=yaml` でエクスポートし、それをテンプレートに流用するのが最も安全。

---

## 5. 環境変数

Cloud Run デプロイ時にセットする。

| 変数 | 用途 | 既定値 |
|---|---|---|
| `LOG_LEVEL` | `info` / `warn` / `error`。本番は `info` 推奨 | `info` |
| `STALE_THRESHOLD_SECONDS` | `/api/health/freshness` が stale と判定する経過秒数 | `7200` (2時間) |
| `NODE_ENV` | `production` にすると内部で prod モード扱い | （未設定）|

```bash
gcloud run services update $SERVICE --region=$REGION \
  --set-env-vars="LOG_LEVEL=info,STALE_THRESHOLD_SECONDS=7200,NODE_ENV=production"
```

---

## 6. 動作確認

### デプロイ直後

```bash
curl -sSf "$SERVICE_URL/healthz"
# → {"ok":true}

curl -sS "$SERVICE_URL/readyz"
# → {"ok":true,"db":"..."}

curl -sS "$SERVICE_URL/api/health/freshness"
# → {"ok":true,"stale":false,"latestUploadAt":"...","ageSeconds":...}
```

### ログ確認

```bash
# 構造化ログが JSON として出ているか
gcloud logging read \
  "resource.type=cloud_run_revision AND resource.labels.service_name=$SERVICE AND jsonPayload.event=*" \
  --limit=5 --format=json

# アップロード失敗イベントだけ抽出
gcloud logging read \
  "jsonPayload.event=upload_failed" \
  --limit=10
```

### アラート疎通テスト

1. `STALE_THRESHOLD_SECONDS=1` に一時変更してデプロイ → `/api/health/freshness` が 503 になる
2. 5分以内に「[HIGH] ..」のメールが届くことを確認
3. `STALE_THRESHOLD_SECONDS=7200` に戻す

---

## 7. アラート調整の指針

- 運用開始後 1〜2週間は閾値を緩め（`> 5 in 5m`）で様子見
- 誤報が続く系統は閾値を上げ、取りこぼしが発生した系統は下げる
- Slack 通知に切り替えたい場合: `gcloud alpha monitoring channels create --type=slack --channel-labels=channel_name=#alerts,auth_token=...`
