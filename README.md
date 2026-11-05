# 線上混音器 Online Audio Mixer

在瀏覽器中執行的多軌混音器：上傳或錄製音軌，進行編輯、音量平衡、聲像、EQ、壓縮、殘響與延遲處理，最後匯出 WAV。也可以用 **HTDemucs** 把混好的歌曲分離成人聲、鼓、貝斯等分軌。每個效果模組都有針對不同曲風與樂器的預設，可以一鍵自動調整。介面支援繁體中文與英文。

*A browser-based multitrack mixer with HTDemucs source separation, genre/instrument presets, auto-mix, bilingual UI (zh-TW / EN), a Node.js backend for storing projects with audio, and a fully working offline mode.*

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
| 樂器音軌與打譜 | 不需匯入音檔的樂器音軌（鋼琴、電鋼琴、風琴、吉他、貝斯、合成器、弦樂、鼓組，以 Web Audio 即時合成）。每個小節可開啟打譜編輯器（鋼琴捲簾／鼓格）：新增、移動、改長度、框選、力度、移調、量化、試聽 |
| 選取與剪貼 | 樂器音軌以小節選取，音訊軌用「範圍」工具選取時間範圍；剪下／複製／貼上／刪除／裁切，只能在同類型音軌之間貼上；復原／重做 |
| AI 音源分離 | 用 HTDemucs 把音檔分離成人聲／鼓／貝斯／其他（6 軌模型另有吉他／鋼琴），分軌自動變成對齊的新音軌並設定角色，可選擇靜音原軌與自動混音 |
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
│       ├── dsp.js            # Web Audio 處理：通道、總輸出、排程、分析、緩衝區編輯、WAV 編碼
│       ├── synth.js          # 樂器音軌的合成器（各種樂器、鼓組、自訂取樣播放）
│       ├── sampler.js        # 取樣工具：檔名判斷根音、音高偵測、鼓件判斷、去除開頭靜音
│       ├── noteeditor.js     # 每小節的打譜編輯器（鋼琴捲簾／鼓格）
│       └── app.js            # 介面、播放、錄音、編輯、儲存／載入、匯出
├── worker/                   # Cloudflare Workers 版後端（R2 儲存、Replicate 音源分離）
│   ├── wrangler.toml
│   ├── src/                  # index.js（路由）、storage.js（R2）、separation.js（Replicate）、http.js
│   └── test/                 # Miniflare 整合測試
└── backend/                  # Node.js + Express REST API（本機／自架，可用自己的 GPU 跑 HTDemucs）
    ├── package.json
    ├── src/
    │   ├── server.js         # 進入點：API + （可選）提供前端靜態檔
    │   ├── config.js         # 環境變數設定
    │   ├── storage.js        # 檔案系統儲存（專案、音訊、個人預設）
    │   ├── separation.js     # 分離工作佇列：執行 Python worker、回報進度、儲存分軌
    │   └── routes/
    │       ├── projects.js   # /api/projects
    │       ├── audio.js      # /api/audio
    │       ├── presets.js    # /api/strip-presets
    │       └── separation.js # /api/separation
    ├── separator/            # HTDemucs Python worker
    │   ├── separate.py       # 分離程式（以 JSON lines 回報進度）
    │   ├── requirements.txt
    │   └── setup.sh          # 建立 .venv 並安裝 PyTorch + demucs
    └── test/                 # API 整合測試（含模擬的分離 worker）
```

- **前端**負責所有音訊處理（Web Audio API），不依賴後端也能完整使用（離線模式）。
- **後端**負責資料保存（專案設定、上傳的音訊檔、個人預設），以及執行 HTDemucs 音源分離（Python worker，一次執行一個工作）。

## 快速開始

需求：Node.js 18.17 以上、現代瀏覽器（Chrome、Edge、Firefox、Safari）。

```bash
cd backend
npm install
npm start
```

開啟 <http://localhost:3000>。後端會同時提供前端頁面，頁面右上角會顯示「已連線伺服器」。

### 啟用 AI 音源分離（HTDemucs）

需求：Python 3.10–3.12、`ffmpeg`。有 NVIDIA GPU 會快很多（RTX 3090 分離一首 4 分鐘的歌約 10–20 秒；只用 CPU 則需要數分鐘）。

```bash
cd backend/separator
./setup.sh        # NVIDIA GPU（CUDA 12.8 版 PyTorch，下載約數 GB）
./setup.sh cpu    # 沒有 GPU 時使用 CPU 版
```

腳本會在 `backend/separator/.venv` 建立 Python 環境並安裝 PyTorch 與 demucs，最後執行環境檢查。後端會自動使用這個環境，不需要額外設定，重新整理頁面即可使用「✦ AI 音源分離」。模型權重會在第一次使用時下載到 `backend/separator/models/`（htdemucs 約 80 MB，htdemucs_ft 約 320 MB）。

| 模型 | 分軌 | 說明 |
|---|---|---|
| `htdemucs` | 鼓、貝斯、其他、人聲 | 預設，速度快 |
| `htdemucs_ft` | 鼓、貝斯、其他、人聲 | 微調版，品質最好，約慢 4 倍 |
| `htdemucs_6s` | 再加上吉他、鋼琴 | 鋼琴分軌較不穩定 |

也可以直接在命令列使用 worker：

```bash
backend/separator/.venv/bin/python backend/separator/separate.py \
  --input song.mp3 --outdir out/ --model htdemucs --shifts 1
```

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

## 部署到 Cloudflare Workers（不需要自己的電腦開機）

`worker/` 是後端的 Cloudflare Workers 版本，提供與 Node.js 後端**相同的 REST API**，前端不需修改：

- **Worker**：提供前端靜態檔案（Workers Static Assets）與 `/api/*`。
- **R2**：存放專案、音訊、取樣、個人預設與分離工作（一個 bucket）。
- **AI 音源分離**：HTDemucs 需要 Python、PyTorch 與 GPU，無法在 Workers 上執行，所以改用 [Replicate](https://replicate.com/ryan5453/demucs) 的雲端 GPU（依使用量計費，需自行設定 token；不設定時分離功能會自動停用，其他功能照常）。

### 第一次部署

```bash
cd worker
npm install
npx wrangler login                                  # 登入 Cloudflare
npx wrangler r2 bucket create online-audio-mixer    # 建立 R2 bucket（名稱需與 wrangler.toml 相同）
npx wrangler secret put API_TOKEN                   # 設定存取金鑰（強烈建議，見下方說明）
npx wrangler secret put REPLICATE_API_TOKEN         # 選用：啟用 AI 音源分離
npx wrangler deploy
```

部署完成後會得到 `https://online-audio-mixer.<你的帳號>.workers.dev`，前端和 API 都在這個網址。第一次開啟時，點右上角的「🔒 需要存取金鑰」輸入 `API_TOKEN`，瀏覽器會記住它。沒有金鑰的人仍可使用所有不需要伺服器的功能（混音、打譜、匯出）。

### 自動部署（GitHub Actions）

`.github/workflows/deploy-worker.yml` 會在 `main` 分支的 `frontend/` 或 `worker/` 有變更時，自動執行測試並部署。需要在 GitHub repo 的 Settings → Secrets and variables → Actions 加入：

- `CLOUDFLARE_API_TOKEN`：在 Cloudflare 後台 My Profile → API Tokens 建立，使用「Edit Cloudflare Workers」範本即可（需包含 Workers Scripts 與 Workers R2 Storage 的編輯權限）。
- `CLOUDFLARE_ACCOUNT_ID`：Cloudflare 後台 Workers & Pages 頁面右側可以看到。

沒有設定這兩個 secret 時，workflow 會自動跳過部署。`API_TOKEN`、`REPLICATE_API_TOKEN` 只需要用 `wrangler secret put` 設定一次，之後的部署會保留。

### Worker 設定

| 名稱 | 類型 | 說明 |
|---|---|---|
| `API_TOKEN` | secret | 存取金鑰。設定後，除了 `/api/health`，所有 API 都需要 `Authorization: Bearer <金鑰>`。網址公開時**一定要設定**，否則任何人都能上傳檔案、使用你的 Replicate 額度 |
| `REPLICATE_API_TOKEN` | secret | Replicate 的 API token，用於 AI 音源分離 |
| `MAX_UPLOAD_MB` | var | 單一檔案上傳上限，預設 95（Workers 免費／Pro 方案的請求上限是 100 MB） |
| `MAX_JSON_MB` | var | JSON 請求上限，預設 5 |
| `CORS_ORIGIN` | var | 允許從其他網站呼叫 API 的來源，以逗號分隔（例如前端另外放在 GitHub Pages 時） |
| `REPLICATE_VERSION` | var | Replicate 上 `ryan5453/demucs` 的版本 ID |
| `REPLICATE_OUTPUT_FORMAT` | var | 分軌格式，預設 `flac` |

### 費用與限制

- **Cloudflare 免費方案**通常就夠用：Workers 每天 10 萬次請求，R2 免費 10 GB 儲存空間，且沒有流量（egress）費用。
- **請求與 CPU 限制**：Workers 單一請求上限 100 MB，所以檔案上傳上限是 95 MB。免費方案每個請求只有 10 ms CPU 時間。音訊上傳以串流直接寫入 R2，幾乎不耗 CPU；但專案很多時，刪除專案（需要檢查哪些音訊還在使用）可能接近上限。遇到問題時，可改用 Workers 付費方案（每月 5 美元，CPU 上限 30 秒）。
- **AI 音源分離**依 Replicate 的 GPU 使用時間計費。分離工作沒有背景程序，進度在前端每秒查詢時推進：完成後會把分軌從 Replicate 複製到 R2。
- **本機測試**：在 `worker/` 執行 `npx wrangler dev`（使用本機模擬的 R2），或執行 `npm test` 跑 Worker 的整合測試（用 Miniflare 模擬 R2 與 Replicate）。

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
| `API_TOKEN` | （空） | 選用的存取金鑰。設定後，除了 `/api/health`，所有 API 都需要 `Authorization: Bearer <金鑰>` |
| `SEPARATOR_PYTHON` | `backend/separator/.venv/bin/python` | 執行分離 worker 的 Python |
| `SEPARATOR_SCRIPT` | `backend/separator/separate.py` | 分離 worker 腳本 |
| `SEPARATOR_MODELS_DIR` | `backend/separator/models` | 模型權重快取（`TORCH_HOME`） |
| `DEMUCS_DEVICE` | `auto` | `auto`／`cuda`／`cpu`／`mps` |
| `SEPARATION_TIMEOUT_MIN` | `60` | 單一分離工作的時間上限（分鐘） |

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
| POST | `/api/audio` | 上傳音訊：建議用原始內容串流上傳（`Content-Type: audio/*`，標頭 `X-File-Name` 放 URI 編碼的檔名），也支援 `multipart/form-data`（欄位 `file`，選填 `name`）→ `201 { id, name, size, mimeType, url }` |
| GET | `/api/audio/:id` | 下載音訊（支援 Range 請求） |
| DELETE | `/api/audio/:id` | 刪除音訊 → `204` |
| GET | `/api/strip-presets` | 個人預設清單 `{ presets: [{ id, name, role, createdAt, strip }] }` |
| POST | `/api/strip-presets` | 建立個人預設，body：`{ name, role, strip }` → `201` |
| DELETE | `/api/strip-presets/:id` | 刪除個人預設 → `204` |
| GET | `/api/separation` | 分離功能狀態 `{ available, reason?, device, gpu, models }`（`?refresh=1` 重新檢查） |
| POST | `/api/separation/jobs` | 開始分離，body：`{ audioId, model?, shifts?, stems? }` → `202` 工作物件 |
| GET | `/api/separation/jobs/:id` | 查詢工作 `{ status, stage, progress, queuePosition, stems: [{ name, audioId, url }], error }` |
| DELETE | `/api/separation/jobs/:id` | 取消排隊中或執行中的工作 |

分離流程：前端先用 `POST /api/audio` 上傳音檔，再以 `audioId` 建立分離工作，接著每秒查詢進度。`status` 依序為 `queued` → `running` → `done`／`error`／`cancelled`。完成後每個分軌都是一般的音訊（`audioId`），可用 `GET /api/audio/:id` 下載（FLAC）。工作只保存在記憶體中，伺服器重新啟動後會消失，但分軌音訊會留在儲存空間。

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

測試會使用暫存目錄啟動 API，涵蓋健康檢查、專案與音訊的完整流程、輸入驗證（格式、大小、檔案類型、路徑）、個人預設，以及分離工作（使用 `test/fake-separator.js` 模擬 worker，不需要安裝 PyTorch）。

## 使用流程範例

1. 按「上傳音檔」匯入各分軌，系統會依檔名猜測角色（vocal、kick、bass、gtr、人聲、鼓…），必要時再手動修改。
2. 在「⚡ 自動混音」列選擇曲風，按「自動混音所有音軌」。
3. 選取音軌，在下方通道設定中微調；每個模組都有「預設」選單與「⚡ 自動」按鈕。
4. 「儲存到伺服器」保存整個專案（含音訊），或「儲存設定」下載參數檔。
5. 「匯出 WAV」輸出混音成品。

### 樂器音軌與編輯

- **新增樂器音軌**：工具列的「+ 樂器音軌」選單選擇樂器，或在空白音軌上按「♪ 改為樂器音軌」。
- **自訂音色（上傳取樣）**：樂器選「自訂音色（上傳取樣）」或「自訂鼓組（上傳取樣）」，在「取樣音色」卡片上傳音檔。
  - 一般樂器：每個音符使用音高最接近的取樣並以播放速率移調。根音從檔名判斷（`Piano C4.wav`、`A#3`、`60`），否則用自相關法自動偵測，也可手動輸入。上傳多個取樣（例如每 3～4 個半音一個）效果最好。
  - 鼓組：每個取樣對應一個鼓件，檔名含 kick／snare／hat／crash／ride／tom 等字樣時會自動對應。
  - 可調整起音、釋放、取樣音量，以及是否播放完整取樣。開頭靜音會自動去除。還沒上傳取樣時，會使用內建的鋼琴／鼓組聲音。
  - 「儲存到伺服器」時取樣會一起上傳，開啟專案時會自動下載。本機設定檔只記錄取樣名稱與對應，不包含音訊。
- **打譜**：雙擊任一小節（或選取小節後按 Enter）開啟該小節的打譜編輯器。點擊空格新增音符，拖曳移動，拖曳右邊緣改長度，空白處拖曳框選。格線支援 1/4～1/32 與三連音，也能調整力度、移調、量化、播放小節，以及切換上一個／下一個小節。
- **選取**：樂器音軌點擊／拖曳／Shift+點擊選取小節。音訊軌切到「範圍」工具（E）後拖曳選取時間範圍，切回「移動」工具（V）可移動與修剪片段。
- **剪貼**：Ctrl+X／C／V、Delete、裁切。只能在同類型的音軌之間貼上：音符 → 樂器音軌（不同樂器之間也可以），音訊 → 音訊軌（也可以貼到空白音軌）。貼上的位置是目標音軌的選取起點，沒有選取時則是播放頭。
- **保持對齊**：音訊的剪下與刪除會留下靜音，貼上會覆寫目標位置，不會讓其他音軌錯位。
- **復原／重做**：Ctrl+Z、Ctrl+Shift+Z（或 Ctrl+Y）。
- 音符以拍為單位儲存（4/4 拍），修改 BPM 後會跟著新速度播放。樂器音軌的音符會一起存進設定檔與伺服器專案。

快捷鍵：`空白鍵` 播放／暫停、`Home` 回到開頭、`R` 錄音、`M`／`S` 靜音／獨奏、`B` 分割、`↑`／`↓` 切換音軌、`Ctrl+S` 儲存設定、`?` 使用說明。

## 注意事項

- 後端沒有使用者帳號與驗證，適合個人或區域網路使用。若要對外開放，請在前面加上反向代理與驗證機制。
- 殘響使用程式產生的脈衝響應（指數衰減雜訊），不是真實空間的取樣。
- 每條音訊軌包含一個片段；「分割」會把後半段放到新的音軌。音訊經過剪下／貼上／裁切後會變成新的音訊（以 WAV 上傳到伺服器）。
- 樂器音軌目前固定為 4/4 拍，打譜編輯器是鋼琴捲簾與鼓格，不是五線譜。樂器音色由瀏覽器即時合成，不是取樣音源。
- 自動音量以平均響度為基礎，提供的是良好的起點，仍建議用耳朵確認。
- 音源分離的結果取決於原始混音，分軌之間可能會有少量殘留（bleed）。分離產生的分軌會一直留在伺服器的 `audio/` 裡，除非它所屬的專案被刪除；沒有存成專案的分軌需要手動清理。
- 分離工作一次只執行一個（共用一張 GPU），其他工作會排隊。
