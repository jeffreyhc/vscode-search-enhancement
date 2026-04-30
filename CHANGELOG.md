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