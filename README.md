# search-enhancement

search-enhancement 是用於加強vscode的搜尋方式的擴充套件

## Features

使用者可以用`Ctrl` + `Alt` + `F`叫出搜尋欄，並輸入要搜尋的關鍵字，關鍵字之間可以用空白隔開，搜尋結果會是包含全部關鍵字的symbol (不論關鍵字的先後順序)

![idle](/resource/screenshots/idle.png "idle")

![searching](/resource/screenshots/searching.png "searching")

![search result](/resource/screenshots/search_result.png "search result")

![search result compare with vscode](/resource/screenshots/search_result_compare_with_vscode.png "search result compare with vscode")

![no search result](/resource/screenshots/no_result.png "no search result")

## Installation

1. 下載並安裝 [Visual Studio Code](https://code.visualstudio.com/)
2. 在VS Code中的延伸模組Marketplace搜尋search-enhancement以安裝

## Requirements
這個擴充套件使用前需要先做前置設定:
1. 對資料夾建立workspace
2. 使用[Ctags](https://github.com/universal-ctags/ctags/releases)建立symbol list:安裝後在workspace根目錄執行`ctags -R --languages=C,C++ --fields=+n --extras=+q -f .tags`

## Usage

1. 按 `Ctrl` + `Alt` + `F` 叫出搜尋欄
2. 輸入要搜尋的關鍵字，關鍵字之間可以用空白隔開
3. 搜尋結果會顯示在側邊欄中，點擊結果可以打開對應的文件並跳到對應行數
4. 由於跳轉的位置取決於Ctags建立的symbol list，請記得定期更新symbol list以獲得最好的使用體驗

## Contributing

歡迎貢獻代碼、報告問題和提交功能請求。請參閱 [CONTRIBUTING.md](CONTRIBUTING.md) 了解更多資訊。

## Developing
- `npm install`
- `npm run compile`
- `F5` to start debugging

## License

此專案採用 [MIT](LICENSE) 授權條款。

## 致謝

圖標來源於 [SVG Repo](https://www.svgrepo.com/)