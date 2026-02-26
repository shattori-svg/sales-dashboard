# 本番環境デプロイ（推奨構成）

守屋さんアドバイスを反映した、**多数アクセスにも耐える本番構成**のガイドです。

---

## 1. なぜ Render 単体 + SQLite では不足か

| 課題 | 説明 |
|------|------|
| **Render 単体** | アクセス集中時にスケールしづらく、落ちたり遅くなりやすい。前段にリバースプロキシがない。 |
| **SQLite** | 単一ファイルDBのため、複数インスタンスで共有できない。レプリカを増やしてもDBがボトルネックになる。本番の永続化・冗長化に不向き。 |

**結論**: 本番では **前段に nginx**、**DB は Supabase（または Azure SQL / Cloud SQL）**、**ホストは Azure Web App または Google Cloud** とする構成を推奨します。

---

## 2. 推奨本番アーキテクチャ

```
                   インターネット
                         │
                         ▼
              ┌──────────────────────┐
              │  nginx (リバースプロキシ)  │  ← SSL終端・静的配信・負荷分散
              │  (Azure VM / GCE 等)   │
              └───────────┬────────────┘
                          │
                          ▼
              ┌──────────────────────┐
              │  Node.js (Express)    │  ← Azure Web App / Cloud Run 等
              │  server.js            │
              └───────────┬────────────┘
                          │
                          ▼
              ┌──────────────────────┐
              │  Supabase (PostgreSQL)│  ← 本番は SQLite を使わない
              │  または Azure SQL /   │
              │  Cloud SQL            │
              └──────────────────────┘
```

- **nginx**: リバースプロキシ・SSL終端・必要ならキャッシュ・複数 Node インスタンスへの振り分け。
- **アプリ**: Azure Web App または Google Cloud（Cloud Run / GCE）で Node を実行。
- **DB**: 本番では **Supabase**（既存の `db-supabase.js` を利用）を推奨。Azure/GCP に寄せる場合は Azure SQL や Cloud SQL の利用も可（その場合はアダプタ実装が必要）。

---

## 3. 本番で変更すべき点

### 3.1 DB を SQLite から Supabase に切り替える

- 本番環境の **環境変数** に必ず設定する:
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
- 設定後はアプリは自動的に **Supabase** を使い、SQLite は使いません（`server.js` の既存ロジックのまま）。
- テーブル定義は `supabase-reports-table.sql` および `docs/SUPABASE_SETUP.md` を参照。

### 3.2 前段に nginx を置く

- 同じサーバー（VM）で Node の前に nginx を立てる、または nginx 用 VM と App 用を分けても可。
- 例: クライアント → nginx (443) → Node (localhost:3333)。

---

## 4. nginx の例（リバースプロキシ）

Node がローカルで `3333` で待ち受けている場合の最小例です。

```nginx
# /etc/nginx/sites-available/sales-reports など
upstream node_backend {
    server 127.0.0.1:3333;
    # 複数インスタンスにする場合:
    # server 127.0.0.1:3333;
    # server 127.0.0.1:3334;
}

server {
    listen 80;
    server_name your-domain.com;
    # HTTPS にする場合は Let's Encrypt 等で証明書を設定し、443 で listen

    location / {
        proxy_pass http://node_backend;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

- SSL を使う場合は `listen 443 ssl` と `ssl_certificate` / `ssl_certificate_key` を追加してください。

---

## 5. Azure Web App にデプロイする

1. Azure Portal で **Web アプリ**（Linux + Node 18）を作成。
2. **デプロイ**は GitHub Actions または Azure の「Git からのデプロイ」でこのリポジトリを指定。
3. **設定** → **アプリケーション設定**で以下を追加:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `LOGIN_PASSWORD`（必要なら `LOGIN_USER`）
   - `NODE_ENV` = `production`
4. **設定** → **全般**で「スタートアップコマンド」を `npm start` に（未設定の場合は `npm start` が使われることが多いです）。
5. カスタムドメインや TLS は Azure 側で設定。**前段に nginx を置く場合は**、nginx を別 VM や Azure の Front Door / Application Gateway で構成し、その向こうに Web App を置く形にします。

---

## 6. Google Cloud にデプロイする

### 6.1 Cloud Run（コンテナ）— Git 経由が推奨

**通常の運用（Git 経由）**

1. コードをコミットして `main` に push する。
2. Cloud Build のトリガーが設定されていれば、自動でビルド・Cloud Run へデプロイされる。
3. ビルド状況は **Cloud Console** → **Cloud Build** → **履歴** で確認。

詳細なコマンド例・トリガー初回設定は、ルートの **[DEPLOY.md](../DEPLOY.md)** の「デプロイ手順（Git 経由）」を参照してください。

**技術メモ**

- リポジトリに **Dockerfile** があるため、Cloud Build でイメージをビルドし、Cloud Run にデプロイできる。
- Cloud Run の **環境変数**（変数とシークレット）に `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `LOGIN_PASSWORD` 等を設定する。
- 本番では **Supabase** を使い、SQLite は使わない（Cloud Run のディスクは一時的であるため）。

### 6.2 GCE（VM）で Node + nginx

- 1 台の VM に nginx と Node を両方入れる場合:
  - nginx を 80/443 で待ち受け、`proxy_pass` で `http://127.0.0.1:3333` に転送。
  - Node は systemd や PM2 で常時起動。`PORT=3333` で listen。
- 環境変数は VM の `.env` や systemd の `Environment=` で設定。本番 DB は Supabase に統一。

---

## 7. まとめ（守屋さんアドバイス反映）

| 項目 | 推奨 |
|------|------|
| **ホスト** | Azure Web App または Google Cloud（Cloud Run / GCE）で本番確定 |
| **前段** | nginx でリバースプロキシ（多数アクセス対策） |
| **DB** | 本番は **SQLite を使わず Supabase**（既存コードのまま利用可能） |
| **Render** | 簡易・検証用には可。本番・多アクセス用途では上記構成を推奨 |

- **Git 経由のデプロイ手順**（push から Cloud Run まで）: ルートの **DEPLOY.md** の「デプロイ手順（Git 経由）」を参照。
- 簡易ホスティング（Render / Railway / Fly.io）も **DEPLOY.md** に記載。
