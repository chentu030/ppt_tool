# Designt.io — AI 簡報設計工具

> 上傳草稿或輸入文字，選擇風格參考，讓 Gemini AI 幫你生成專業水準的投影片圖片。

## 功能總覽

### 1. 專案管理（首頁）

- **建立專案** — 自訂名稱、顏色、圖示，所有專案存於 Firebase Firestore。
- **專案卡片** — 顯示縮圖預覽，支援重新命名、刪除。
- **快速進入** — 點擊卡片即可進入專案編輯器。

### 2. 專案編輯器（ProjectEditor）

這是核心功能頁面，提供完整的投影片設計流程：

| 功能 | 說明 |
|------|------|
| **上傳原稿** | 支援上傳 PPT 截圖、圖片作為投影片原稿 |
| **上傳 Word / TXT** | 匯入文字檔，自動解析為多頁投影片（以「第一頁」等標記分頁） |
| **風格參考圖** | 從模板庫選取或自行上傳風格參考圖片 |
| **模板庫** | 內建風格模板，支援收藏、歷史紀錄、社群分享模板 |
| **AI 生成** | 使用 Gemini API（3.1 Flash / 3 Pro）將原稿 + 風格參考一鍵重繪 |
| **局部修改** | 在生成圖片上塗抹遮罩，針對特定區域重新生成 |
| **進階設定** | 自訂字體、主色、強調色、背景色、特殊標記、比例（16:9 / 1:1 / 9:16 / 4:3）、解析度（1K / 2K / 4K） |
| **文字投影片** | 不需原稿，直接輸入文字內容由 AI 生成對應的投影片圖片 |
| **AI 潤色** | 對文字投影片內容進行 AI 潤色（自訂潤色方向） |
| **撤銷 / 重做** | 圖片生成歷史紀錄，可回退至前次生成或原稿 |
| **批次生成** | 選取多張投影片一次生成，支援 429 錯誤自動重試 |
| **拖曳排序** | 拖曳投影片縮圖調整順序 |
| **自動備份** | 生成的圖片自動壓縮備份至 Firestore，高畫質版上傳至 Firebase Storage |
| **Google Drive 備份** | 可選，透過 Apps Script 自動備份至 Google Drive |
| **下載圖片** | 全部或選取的投影片下載為 ZIP 或直接存入資料夾（File System Access API） |
| **匯出 PPTX** | 一鍵匯出為 PowerPoint 檔案 |
| **預覽模式** | 全螢幕瀏覽所有已生成的投影片 |

### 3. AI 對話（AIChatPage）

對話式的投影片規劃與生成工具：

- **多輪對話** — 與 Gemini AI 自由對話，可上傳圖片、Word、PDF 等附件。
- **自動規劃投影片** — AI 根據對話內容自動產生投影片規劃（標題 + 內容大綱）。
- **投影片規劃面板** — 編輯每頁標題與內容，新增 / 刪除頁面。
- **文字操作工具列** — 擴寫、精簡、換語氣（正式 / 輕鬆 / 學術 / 幽默）、搜尋擴充。
- **模板庫 + 風格設定** — 選取參考圖、設定字體 / 顏色 / 比例等。
- **批次圖片生成** — 根據規劃一鍵生成所有投影片圖片。
- **圖片預覽欄** — 右側面板即時預覽已生成的圖片，支援放大查看。
- **匯出 PPTX** — 將規劃文字稿 + 生成圖片匯出為 PowerPoint。
- **存為專案** — 將投影片規劃（文字稿 + 生成圖片）一鍵轉存為專案，在專案編輯器中繼續編輯。
- **對話紀錄** — 自動儲存至 localStorage，支援多個對話、搜尋、重新命名、刪除。

### 4. 設定頁

- **主題切換** — 亮色 / 暗色模式。
- **API Key** — 可輸入自己的 Gemini API Key，或使用預設的 Vertex AI。
- **模型選擇** — Gemini 3.1 Flash Image（快速）或 Gemini 3 Pro Image（高品質）。
- **費用估算** — 顯示各模型的每張圖片費用參考。
- **Google Drive Script URL** — 設定 Apps Script 網址以啟用 Drive 備份。

### 5. 其他功能

- **Firebase 身份驗證** — Google 登入 / Email 登入。
- **可收合側邊欄** — 支援釘選，自動展開 / 收合。
- **響應式設計** — 適配不同螢幕尺寸。

---

## 技術架構

| 層級 | 技術 |
|------|------|
| 前端框架 | React 19 + TypeScript |
| 建構工具 | Vite 7 |
| 路由 | React Router v7 |
| 樣式 | CSS Variables + inline styles |
| 動畫 | Framer Motion |
| 圖示 | Lucide React |
| AI 模型 | Google Gemini API (Vertex AI) |
| 資料庫 | Firebase Firestore |
| 身份驗證 | Firebase Auth |
| 檔案儲存 | Firebase Storage |
| 備份 | Google Drive (Apps Script) |
| PPTX 匯出 | pptxgenjs |
| ZIP 打包 | JSZip |
| Markdown | react-markdown + remark-gfm + remark-math + rehype-katex |
| 部署 | Vercel |

---

## 快速開始

### 1. 安裝依賴

```bash
npm install
```

### 2. 設定環境變數

複製 `.env.example` 為 `.env.local`，填入你的 Firebase 與 API 金鑰：

```bash
cp .env.example .env.local
```

必要的環境變數：

| 變數 | 說明 |
|------|------|
| `VITE_FIREBASE_API_KEY` | Firebase 專案的 API Key |
| `VITE_FIREBASE_AUTH_DOMAIN` | Firebase Auth 網域 |
| `VITE_FIREBASE_PROJECT_ID` | Firebase 專案 ID |
| `VITE_FIREBASE_STORAGE_BUCKET` | Firebase Storage Bucket |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Firebase Messaging Sender ID |
| `VITE_FIREBASE_APP_ID` | Firebase App ID |
| `VITE_VERTEX_API_KEY` | Gemini / Vertex AI API Key（預設 key，使用者也可在設定頁自行輸入） |

可選的環境變數：

| 變數 | 說明 |
|------|------|
| `VITE_DRIVE_SCRIPT_URL` | Google Drive Apps Script 網址（用於圖片備份） |
| `VITE_GCP_PROJECT_ID` | GCP 專案 ID（Bearer Token 模式使用） |
| `VITE_GOOGLE_CLIENT_ID` | Google OAuth Client ID |
| `VITE_OCR_SERVICE_URL` | OCR 轉換服務網址 |

### 3. 啟動開發伺服器

```bash
npm run dev
```

開啟 `http://localhost:5173` 即可使用。

### 4. 建構部署

```bash
npm run build
```

產出檔案在 `dist/` 目錄，可直接部署至 Vercel、Netlify 等平台。

---

## Google Drive 備份設定（可選）

1. 開啟 [Google Apps Script](https://script.google.com/)，建立新專案。
2. 將 `driveBackup.gs` 的內容貼入。
3. 部署 → 新增部署 → Web App：
   - 執行身分：**我**
   - 存取權限：**所有人**
4. 複製部署後的 Web App URL。
5. 在設定頁的「Google Drive Script URL」欄位貼入。

---

## 使用流程

### 方式一：專案模式（適合已有素材）

```
建立專案 → 上傳 PPT 截圖 / 圖片 → 選取風格參考 → 設定進階選項 → 批次生成 → 下載 / 匯出 PPTX
```

### 方式二：AI 對話模式（從零開始）

```
開啟 AI 對話 → 描述簡報需求 → AI 自動規劃投影片 → 編輯調整內容 → 選取模板風格 → 批次生成圖片 → 匯出 PPTX 或存為專案
```

---

## 授權

Private project.
