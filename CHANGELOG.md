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