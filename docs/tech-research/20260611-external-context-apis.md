# 技術調査レポート: デイリーブリーフ「外部要因（情勢）」のデータソースAPI

- **調査日**: 2026-06-11
- **調査対象**: PredictHQ, Nager.Date, Calendarific, Open-Meteo (Weather/Air Quality), GDACS, NewsData.io, GNews, NewsAPI
- **調査コンテキスト**: バンコクのスーパー1店舗の日次売上ブリーフに、天気・曜日・祝日・イベント・情勢などの外部要因を自動付与したい。Node.js (Cloud Run) から日次バッチで取得する前提。特に「生ニュースをLLMに渡して売上の因果を説明させる」approachのリスクを評価。

---

## 結論サマリ

「情勢」を一括りのAPIで取るのは不可。**構成要素に分解**すると、信頼できる無料APIで取れるものと、APIはあるが因果説明に使うべきでないものに分かれる。

| 要因 | 推奨ソース | 料金 | 認証 | 商用 | 信頼性 |
|---|---|---|---|---|---|
| 曜日・給料日 | 日付から算出 | — | — | — | ◎ |
| 祝日 | Nager.Date | 無料 | 不要 | 可 | ◎ |
| 天気 | Open-Meteo Weather | 無料(CC-BY) | 不要 | 可(帰属表示) | ◎ |
| 大気質 PM2.5 | Open-Meteo Air Quality | 無料(CC-BY) | 不要 | 可(帰属表示) | ◎ |
| 災害・洪水・台風 | GDACS | 無料 | 不要 | 可 | ◎ |
| イベント（祭・スポーツ・学校休暇） | PredictHQ | 14日無料→有料 | APIキー | 可 | ◎(本命だが有料) |
| ニュース・地政学一般 | NewsData.io 等 | 無料枠あり | APIキー | 一部可 | △(因果推論は✗) |

---

## カテゴリ別詳細

### 1. 祝日 — Nager.Date（推奨）/ Calendarific
- **Nager.Date**: 100カ国以上、`https://date.nager.at/api/v3/PublicHolidays/2026/TH`。APIキー不要・無料・商用可・オフライン利用も可。タイ対応。
- **Calendarific**: 2026年タイ34祝日。JSON。無料枠＋有料。APIキー必要。
- 採用: **Nager.Date**（キー不要・商用可）。仏教祭日や振替休日の網羅性だけ初回に実データ確認。
- 給料日（月末・15日など買い控え/購買サイクル）は日付からコードで算出可。

### 2. 天気 — Open-Meteo Weather API（推奨）
- 無料、APIキー不要、登録不要。CC BY 4.0 で**商用利用可（帰属表示要）**。非商用は1万call/日まで無料。過去実績（archive）・予報とも取得可。バンコク座標で日次取得。
- 採用: **Open-Meteo**。Cloud Run 日次バッチと相性良。

### 3. 大気質 PM2.5 — Open-Meteo Air Quality API（推奨）
- 同上のOpen-Meteoファミリー。PM2.5含む。`past_days` 最大92日。CC BY 4.0・商用可。
- バンコクはPM2.5が客足に影響する季節があり、外部要因として妥当。
- 採用: **Open-Meteo Air Quality**（天気と同basis）。

### 4. 災害・洪水・台風 — GDACS（推奨）
- Global Disaster Alert and Coordination System。**APIキー不要・無料・公的**。地震/津波/洪水/森林火災/熱帯低気圧/火山/干ばつの7種。直近4日・最大100件をGeoJSON。
- `…/geteventlist/SEARCH` で取得、`eventtype=FL`(洪水)等＋地理パラメータでタイをフィルタ、Red/Orange/Greenの警報レベル付き。
- 採用: **GDACS**。「近隣で洪水警報→客足減」のような確度の高い文脈を構造化データで取得できる。

### 5. 需要影響イベント — PredictHQ（本命だが有料）
- demand intelligence専業。18-19カテゴリ（スポーツ・コンサート・会議・**学校休暇**・宗教行事・観察日・悪天候など）。「需要変動の60%超を説明」と謳う。バンコクのイベント（例: Bangkok International Motor Show）も予測来場/消費額付きでカバー。
- 料金: **14日間フルアクセス無料トライアル**（要サインアップ・APIキー）。以降は個別見積りの有料（公開価格なし）。
- 評価: 「情勢」のうち**売上に効く構造化イベント**を最も正確に取れる唯一の専業ソース。ただしコスト未知＝小規模1店舗にはオーバースペック/割高の可能性。
- 代替: 学校休暇・宗教行事の一部は祝日API＋タイ学事暦の手動データで近似可能。大型イベントは手動入力でも当面回せる。

### 6. ニュース・地政学一般 — 採用注意（因果推論には使わない）
- **NewsData.io**: 89言語・国/カテゴリ/キーワードフィルタ。無料枠は商用可と明記。有料 $199.99〜。
- **GNews**: 無料100req/日だが**商用不可（開発/テスト限定）**。
- **NewsAPI**: 無料枠は商用不可。
- ⚠️ **リスク（調査で裏付け）**: LLMにニュース見出しを渡して売上の因果を説明させると、相関を因果と誇張する「causality illusion」が既知。特に見出し生成系のタスクで顕著で、確信度が高いほど誤り（spurious correlation由来のハルシネーションはスケールしても消えず、確信度ベースの検出も誤誘導される）。1店舗の日次売上を国政ニュースで説明するのは典型的な疑似相関。
- 推奨: **ニュースから売上の因果をLLMに生成させない**。どうしても出すなら「関連ニュース（参考・因果ではない）」として分析セクションと明確に分離するか、運営の手動入力に留める。

---

## 総合判断（推奨構成）

**「外部要因」= 構造化された事実APIの集合**として実装し、LLMには「これらの事実を踏まえて言及する」だけをさせる（数値・因果はコード/事実APIが担保、LLMは説明のみ — 既存ブリーフの設計原則と一致）。

- **第1段（すぐ・無料・キー不要）**: 曜日・給料日（算出）＋ Nager.Date（祝日）＋ Open-Meteo（天気・PM2.5）＋ GDACS（災害）。外部依存は全て無料・キー不要・商用可。Cloud Run 日次バッチに追加。取得失敗時はその要因をスキップする設計（フォールバック）。
- **第2段（任意・有料評価）**: PredictHQ を14日トライアルで費用対効果を検証。学校休暇・大型イベントの寄与が大きければ採用、割高なら手動イベント入力で代替。
- **ニュース/地政学**: 自動の因果説明には**使わない**。必要時は手動入力欄（運営が把握した事象をその日だけ付与）を推奨。

### リスク・留意
- 外部APIごとに障害・レート制限・スキーマ変更の可能性 → 各要因は「取れたら付与、ダメならスキップ」で本体ブリーフを止めない。
- Open-Meteo / GDACS は無料だが帰属表示・公正利用の範囲を遵守。
- LLMプロンプトでは外部要因を「事実コンテキスト」として与え、「断定を避ける／因果は推定と明示」のルールを固定。

### 情報源
- [PredictHQ Pricing / Docs](https://www.predicthq.com/apis) ・ [14-day trial](https://docs.predicthq.com/webapp-support/api-plans-pricing-and-billing/learn-about-our-14-day-trial)
- [Nager.Date API](https://date.nager.at/API) ・ [Calendarific TH 2026](https://calendarific.com/holidays/2026/TH)
- [Open-Meteo Air Quality API](https://open-meteo.com/en/docs/air-quality-api) ・ [Open-Meteo](https://open-meteo.com/)
- [GDACS API quickstart](https://www.gdacs.org/Documents/2025/GDACS_API_quickstart_v1.pdf) ・ [GDACS](https://www.gdacs.org/)
- [NewsData.io pricing](https://newsdata.io/pricing) ・ [GNews pricing](https://gnios.io/pricing) ・ [NewsAPI pricing](https://newsapi.org/pricing)
- [arXiv 2410.11684 — Illusion of Causality in LLMs](https://arxiv.org/pdf/2410.11684) ・ [arXiv 2511.07318 — Spurious Correlations & Hallucination](https://arxiv.org/abs/2511.07318)
