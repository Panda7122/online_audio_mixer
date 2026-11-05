# 線上混音器 Online Audio Mixer

在瀏覽器中執行的多軌混音器：上傳或錄製音軌，進行編輯、音量平衡、聲像、EQ、壓縮、殘響與延遲處理，最後匯出 WAV。每個效果模組都有針對不同曲風與樂器的預設，可以一鍵自動調整。介面支援繁體中文與英文。

*A browser-based multitrack mixer with genre/instrument presets, auto-mix, bilingual UI (zh-TW / EN), a Node.js backend for storing projects with audio, and a fully working offline mode.*

---

## 功能

| 類別 | 內容 |
|---|---|
| 音軌編輯 | 上傳（按鈕或拖放）、麥克風錄音（疊錄、延遲補償）、拖曳移動／修剪、淡入淡出、片段增益、標準化、反轉、在播放頭分割、複製、排序、靜音／獨奏、對齊拍子 |
| 音量平衡 | 推桿 + 依角色與曲風的**自動音量**（量測響度後對齊目標音量） |
| 聲像 | 自動聲像（主唱／大鼓／貝斯置中，吉他／鍵盤／和聲左右分散），立體聲寬度：依曲風／寬廣／LCR／單聲道 |
| EQ | 7 段（高通、低頻架、3 段峰值、高頻架、低通），可拖曳的頻率響應曲線；人聲、鼓、貝斯、吉他、鍵盤等預設 |
| 壓縮 | 門檻、比例、起始、釋放、膝點、補償增益與增益衰減表；人聲／饒舌／鼓／貝斯／匯流排／限幅器預設 |
| 殘響／延遲 | 推桿後傳送效果；房間、大廳、板式、饒舌短殘響；節拍同步延遲（1/4、附點 1/8、三連音）、Slapback、Dub |
| 自動混音 | 曲風範本：流行、嘻哈／饒舌、搖滾、EDM、抒情／木吉他、Podcast，可選擇要自動調整的模組 |
| 儲存 | 本機：設定檔 `.json` 下載／上傳（整個專案或單一音軌）。伺服器：專案（設定 + 音訊）與個人預設 |
| 匯出 | 離線算繪成 16-bit 立體聲 `mixdown.wav`（總輸出含限幅器） |
| 說明 | 頁面內建完整使用說明（右上角「使用說明」），可切換中文／英文 |

## 專案結構（前後端分離）

```
online_audio_mixer/
├── frontend/                 # 靜態前端（HTML/CSS/原生 JS，無需建置）
│   ├── index.html
│   ├── css/style.css
│   └── js/
│       ├── config.js         # 後端 API 位址設定
│       ├── api.js            # 後端 API 用戶端
│       ├── i18n.js           # 中英文字串與使用說明
│       ├── presets.js        # EQ／壓縮／殘響／延遲／音量／聲像預設與曲風範本
│       ├── dsp.js            # Web Audio 處理：通道、總輸出、排程、分析、WAV 編碼
│       └── app.js            # 介面、播放、錄音、編輯、儲存／載入、匯出
└── backend/                  # Node.js + Express REST API
    ├── package.json
    ├── src/
    │   ├── server.js         # 進入點：API + （可選）提供前端靜態檔
    │   ├── config.js         # 環境變數設定
    │   ├── storage.js        # 檔案系統儲存（專案、音訊、個人預設）
    │   └── routes/
    │       ├── projects.js   # /api/projects
    │       ├── audio.js      # /api/audio
    │       └── presets.js    # /api/strip-presets
    └── test/api.test.js      # API 整合測試
```

- **前端**負責所有音訊處理（Web Audio API），不依賴後端也能完整使用（離線模式）。
- **後端**負責資料保存：專案設定、上傳的音訊檔、個人預設。

## 快速開始

需求：Node.js 18.17 以上、現代瀏覽器（Chrome、Edge、Firefox、Safari）。

```bash
cd backend
npm install
npm start
```

開啟 <http://localhost:3000>。後端會同時提供前端頁面，頁面右上角會顯示「已連線伺服器」。

### 只使用前端（離線模式）

前端是純靜態檔案，可以用任何靜態伺服器提供：

```bash
cd frontend
python3 -m http.server 8080
```

開啟 <http://localhost:8080>。除了「儲存到伺服器／從伺服器開啟」與個人預設外，所有功能都能使用。

> 錄音需要瀏覽器的「安全環境」：請透過 `http://localhost` 或 `https://` 開啟頁面。

### 前後端分開部署

1. 在 `frontend/js/config.js` 設定後端位址：
   ```js
   window.MIXER_CONFIG = { apiBase: 'http://localhost:3000' };
   ```
2. 啟動後端時允許前端的來源（CORS），並可關閉後端提供的前端靜態檔：
   ```bash
   CORS_ORIGIN=http://localhost:8080 SERVE_FRONTEND=false npm start
   ```

## 後端設定（環境變數）

| 變數 | 預設值 | 說明 |
|---|---|---|
| `PORT` | `3000` | 監聽埠 |
| `HOST` | `127.0.0.1` | 監聽位址。API 沒有身分驗證，預設只接受本機連線 |
| `STORAGE_DIR` | `backend/storage` | 專案、音訊與預設的儲存位置 |
| `SERVE_FRONTEND` | `true` | 是否一併提供 `frontend/` 靜態檔 |
| `FRONTEND_DIR` | `../frontend` | 前端目錄 |
| `CORS_ORIGIN` | （空，僅同源） | 允許跨來源存取的前端網址，以逗號分隔 |
| `MAX_UPLOAD_MB` | `200` | 單一音訊檔上傳上限（MB） |
| `MAX_JSON_MB` | `5` | JSON 請求大小上限（MB） |

## REST API

所有回應都是 JSON（下載音訊除外），錯誤格式為 `{ "error": "訊息" }`。

| 方法 | 路徑 | 說明 |
|---|---|---|
| GET | `/api/health` | 健康檢查，回傳 `{ ok, maxUploadMb }` |
| GET | `/api/projects` | 專案清單 `{ projects: [{ id, name, createdAt, updatedAt, trackCount }] }` |
| GET | `/api/projects/:id` | 取得專案 `{ id, name, createdAt, updatedAt, settings }` |
| POST | `/api/projects` | 建立專案，body：`{ name, settings }` → `201` |
| PUT | `/api/projects/:id` | 更新名稱和／或設定，body：`{ name?, settings? }` |
| DELETE | `/api/projects/:id` | 刪除專案，並刪除沒有其他專案使用的音訊 → `204` |
| POST | `/api/audio` | 上傳音訊（`multipart/form-data`，欄位 `file`，選填 `name`）→ `201 { id, name, size, mimeType, url }` |
| GET | `/api/audio/:id` | 下載音訊（支援 Range 請求） |
| DELETE | `/api/audio/:id` | 刪除音訊 → `204` |
| GET | `/api/strip-presets` | 個人預設清單 `{ presets: [{ id, name, role, createdAt, strip }] }` |
| POST | `/api/strip-presets` | 建立個人預設，body：`{ name, role, strip }` → `201` |
| DELETE | `/api/strip-presets/:id` | 刪除個人預設 → `204` |

`settings` 的格式與「儲存設定」下載的 `mix-settings.json` 相同：包含 `bpm`、`genre`、`master` 與 `tracks` 陣列。每條音軌包含名稱、角色、編輯參數、音量、聲像、`eq`、`comp`、`reverb`、`delay`，以及伺服器上的 `audioId`。

儲存方式（`STORAGE_DIR` 底下）：

```
projects/<id>.json      專案
audio/<id>.<ext>        音訊原始檔
audio/<id>.json         音訊中繼資料
strip-presets.json      個人預設
```

## 測試

```bash
cd backend
npm test
```

測試會使用暫存目錄啟動 API，涵蓋健康檢查、專案與音訊的完整流程、輸入驗證（格式、大小、檔案類型、路徑）與個人預設。

## 使用流程範例

1. 按「上傳音檔」匯入各分軌，系統會依檔名猜測角色（vocal、kick、bass、gtr、人聲、鼓…），必要時再手動修改。
2. 在「⚡ 自動混音」列選擇曲風，按「自動混音所有音軌」。
3. 選取音軌，在下方通道設定中微調；每個模組都有「預設」選單與「⚡ 自動」按鈕。
4. 「儲存到伺服器」保存整個專案（含音訊），或「儲存設定」下載參數檔。
5. 「匯出 WAV」輸出混音成品。

快捷鍵：`空白鍵` 播放／暫停、`Home` 回到開頭、`R` 錄音、`M`／`S` 靜音／獨奏、`B` 分割、`↑`／`↓` 切換音軌、`Ctrl+S` 儲存設定、`?` 使用說明。

## 注意事項

- 後端沒有使用者帳號與驗證，適合個人或區域網路使用。若要對外開放，請在前面加上反向代理與驗證機制。
- 殘響使用程式產生的脈衝響應（指數衰減雜訊），不是真實空間的取樣。
- 每條音軌包含一個片段；「分割」會把後半段放到新的音軌。
- 自動音量以平均響度為基礎，提供的是良好的起點，仍建議用耳朵確認。
