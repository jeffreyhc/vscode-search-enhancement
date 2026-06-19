# Change Log

<!-- All notable changes to the "search-enhancement" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file. -->

### [0.0.1] - 2024-12-23

- Initial release

### [0.1.0] - 2025-02-16
#### Modify
- 搜尋欄的使用方式，目前可選擇在主要側邊欄或次要側邊欄使用
  - 目前搜尋方式是即打即搜，可在搜尋欄底下的文字得知目前狀態

### [0.1.1] - 2025-02-23
#### Add
- 如Issue #3的需求，搜尋欄增加Partial match mode
#### Improve
- 降低XSS發生的可能

### [0.2.0] - 2025-02-24
#### Add
- github action support: push跟pull request都會編譯並跑過eslint
- 將搜尋的debounce time與.tag路徑改為configurable
#### Update
- Readme.md:
  - 修改Features的文字說明，並更新相關截圖
  - 修改Usage的文字說明，把用法寫得更清楚一點

### [0.2.1] - 2025-03-24
#### Update
- Readme.md:
  - 修改Requirements的文字說明，把用法寫得更清楚一點

### [0.3.0] - 2026-04-30
#### Add
- 支援使用多個 .tags 檔案 (Issue #4)
  - 新增 `searchEnhancement.tagsFilePaths` 設定（string array）
  - 既有的 `searchEnhancement.tagsFilePath` 已標記為 deprecated；若使用者自訂過 legacy 值，第一次使用時會自動 migrate 到 `tagsFilePaths`
- 搜尋字串含底線時的 phrase 比對 (Issue #7)
  - 例如搜 `A_B_C` 會在 symbol 的 segments 中尋找連續的 `[A,B,C]`
  - Strict 模式要求 segment 完全相符；partial 模式允許 segment 內子字串比對，但仍要求連續
- 多關鍵字 AND 語意：phrase 與 token 混用時以 AND 結合

### [0.3.1] - 2026-04-30
#### Fix
- 修正 Windows ctags 預設輸出 CRLF 換行時，搜尋結果跳轉行號全部變 1 的 bug
- 修正 `searchEnhancement.debounceTime` 設定變更後不會即時生效的 bug，現在無需重新載入 webview
#### Improve
- 新增 P0 / P1 單元測試與 fresh-install migration 的 e2e regression test，覆蓋 searchMatcher / tagsConfig / getSymbolsFromTags（共 46 個 case）
- Refactor：把 tagsFilePath migration 決策邏輯抽出為純函式，方便維護與測試

### [0.3.2] - 2026-05-03
#### Fix
- 修正搜尋結果為空時 webview 卡在「正在搜尋...」訊息不更新的 bug
#### Improve
- `.tags` 解析改成以 mtime 為基準的 cache，大型 index 在連續輸入關鍵字時不再重複 parse；重跑 ctags 後下一次搜尋會自動偵測並重 parse
- 移除未實際接到任何 view 的 TreeView dead code（`SearchResultsProvider` / `SearchResultItem` 與對應的 commands、context menu）
- 把 unit tests 跟 integration tests 拆開，unit tests 用純 mocha 跑（30ms 內），CI 改成 9 個 matrix jobs 都跑 unit、僅 Linux + Node 20 跑需要 VS Code 的 e2e
- README.md 改為英文主版本、附加 banner 跟 Marketplace gallery 設定；繁體中文版另存於 [README.zh-TW.md](README.zh-TW.md)

### [0.3.3] - 2026-05-04
#### Fix
- `searchEnhancement.tagsFilePaths` 設定加上 `"scope": "resource"`，multi-root workspace 的每個 folder 可以獨立設定 tags 路徑
#### Improve
- 把 `getSymbolsFromTags` 從 `extension.ts` 抽到獨立的 `tagsParser.ts`，unit test 不再需要模擬 `vscode` module
- Webview HTML / CSS / JS 從 200 行 inline template literal 拆到 [resource/webview/](resource/webview/) 下的三個獨立檔案，方便編輯器 syntax highlighting 與後續 UI 改動
- LICENSE / CONTRIBUTING.md 改名為 GitHub 慣例的全大寫
- `package.json` 的 `license` 改為 SPDX `MIT`
- `.vscodeignore` 補上 `.claude/`、`.github/`、`out/test/`、`*.code-workspace`、`*.vsix`，避免內部 / CI / 測試檔被打包進 marketplace 上的 vsix

### [0.5.3] - 2026-06-20
#### Improve
- 搜尋面板開啟時在背景預先解析 `.tags`，避免預熱完成後的第一次搜尋等待大型索引 parse；1.65M symbols 的實測從約 9.9 秒降至 62ms
- 新增 `searchEnhancement.warmTagsCacheOnViewOpen` 設定，可關閉背景預熱以比較舊版 cold-first-search 行為
- 背景預熱與搜尋同時遇到首次 cache miss 時共用同一個 in-flight parse，避免重複解析大型 `.tags`
- `profileSearch` 新增 `Tags warm-up` 計時區塊，方便比較背景預熱成本與第一次搜尋延遲

### [0.5.2] - 2026-05-20
#### Fix
- 修 README badges 在 Marketplace 頁面顯示異常：
  - shields.io 把 `visual-studio-marketplace` endpoint 撤掉了，version / installs badges 變成 "retired badge" 字樣 — 改用 `vsmarketplacebadges.dev` 社群替代服務
  - shields.io 的 `github/license` endpoint 因 GitHub API token pool 耗盡回 "Unable to select next GitHub token from pool" 錯誤訊息塞進 badge 模板裡 — 改用 `img.shields.io/badge` 靜態 badge，不打 API、不會壞

### [0.5.1] - 2026-05-19
#### Improve
- Marketplace metadata 大改寫，提升搜尋曝光：
  - `displayName` 從 "Search Enhancement for code" 改為 "Search Enhancement — ctags Symbol Search"，把背後用的技術直接點出來
  - `description` 從模糊一行改成具體 hook（million-line C/C++ codebase、FreeRTOS / kernel / embedded / legacy 場景、IntelliSense 跑不起來時的替代品）
  - `keywords` 從 2 個（"search", "keyword"）擴到 17 個（ctags、c、cpp、c++、symbol、navigation、search、goto、definition、macro、embedded、kernel、freertos、zephyr、linux、large codebase、monorepo）
  - `categories` 增加 "Programming Languages"
- README 改寫：
  - 加上 Marketplace / installs / CI / license badges
  - 第一段換成具體的 value proposition、附上 v0.5.0 30× perf 數字
  - 新增 "Why this over Ctrl+T" section 說明跟內建 symbol search 的差異（LSP-free、多關鍵字 AND、macros、大 codebase）
- README.zh-TW 同步翻譯

### [0.5.0] - 2026-05-19
#### Improve
- 大型 codebase 的搜尋速度大幅提升 — 1.65M symbols 的 workload 從每個 keystroke ~3s 降到 ~100ms（**~30× faster**）
  - 新增設定 `searchEnhancement.precomputeSegments`（boolean，預設 `true`，scope `window`）：在 parse `.tags` 時就把每個 symbol 的 lowercase / underscore-split segments 算好存起來，搜尋時直接讀、不重算
  - 代價：每 100 萬 symbols 大約多 50-100 MB 常駐 memory；cold parse 多 ~15%
  - 記憶體吃緊的環境可關掉這個設定，搜尋會回到 v0.4 的行為
- 搜尋路徑針對「只有單一 `.tags` 檔案」做 fast path — 跳過 `dedupeSymbolsByIdentity` 整段 O(N) 字串配置 + Set 操作（dedupe 對單檔本來就是 no-op，但每次都要付 N 次字串 alloc 的 GC 壓力）
#### Refactor
- `getSymbolsFromTags` 加上 options 參數 `{ precomputeSegments?: boolean }`；`CtagsSymbol` 加 optional 欄位 `normalizedSegments?: string[]`
- `matchesAllClauses` 加 optional 4th 參數 `precomputedSegments?: string[]`，有傳就跳過內部 normalize；沒傳時行為與 v0.4 完全相同

### [0.4.0] - 2026-05-18
#### Add
- 每筆搜尋結果前顯示對應的 codicon symbol 圖示 (Issue #5)
  - 對 C/C++ ctags 預設 kind（`f`/`v`/`c`/`d`/...）做 mapping 到 VS Code outline view 慣用 icon，配色跟著主題自動切換
  - 也支援 `--fields=+K` 的 long-form kind（`function`、`variable` 等）
  - 滑鼠停在 icon 上會顯示 kind 的中英文人類可讀描述（`function`、`macro`、`enumerator` ...）
- 搜尋結果可分組顯示，支援兩種模式 (Issue #6)
  - **Group by Name**（預設）：每個 symbol name 一組，底下列出該 symbol 出現在哪些檔/路徑
  - **Group by File**：每個檔案一組，底下列出該檔內的 matching symbols
  - 點檔頭 / symbol name 可折疊或展開那組；每組顯示結果計數
  - 多個同名檔（如 FreeRTOS 多個 `port.c`）會在檔名後顯示 dim 的相對路徑做區隔，hover 可看完整絕對路徑
- 搜尋面板右上角 `...` 選單可即時切換模式
  - `Partial Match Mode`、`Group by Name`、`Group by File` 三個 toggle
  - 當前 active 的選項 title 會帶 `✓` 前綴做指示
  - 切換顯示模式即時 re-render（不需要重新搜尋）
- 新增設定 `searchEnhancement.defaultGroupBy`（`name` / `file`，預設 `name`，scope `resource`）控制初次開啟的預設分組
- 過長的 symbol name 會自動以 `...` 截斷顯示（例如搜到 struct 內部 nested member 那種長串），hover 可看完整名稱
#### Fix
- 修正 ctags parser 對真實 Universal Ctags row 格式的解析
  - 正確處理 `;"` sentinel 黏在 exCmd 後面的標準格式
  - 正確處理 regex exCmd 內含 tab 字元的情況（如 tab-aligned `#define` macro）
  - 正確用 extension 欄位裡的 `line:N` 覆蓋 regex exCmd 的 fallback 行號
  - `file:` 等空值 key 不再 clobber 已 resolve 的 file path
