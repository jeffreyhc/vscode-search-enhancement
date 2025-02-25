# search-enhancement

search-enhancement 是用於加強vscode的搜尋方式的擴充套件

## Features

使用者可以在搜尋欄輸入要搜尋的關鍵字，關鍵字之間可以用空白隔開，搜尋結果會是包含全部關鍵字的symbol (不論關鍵字的先後順序)。並且提供partial match mode，只要提供的關鍵字部分符合就能找到相關symbol。

![start to use](/resource/screenshots/start_to_use.png "start to use")

![idle](/resource/screenshots/idle.png "idle")

![searching](/resource/screenshots/searching.png "searching")

![search result](/resource/screenshots/search_result.png "search result")

![search result compare with vscode](/resource/screenshots/search_result_compare_with_vscode.png "search result compare with vscode")

![no search result](/resource/screenshots/no_result.png "no search result")

![partial match mode](/resource/screenshots/partial_match_mode.png "partial match mode")

## Installation

1. 下載並安裝 [Visual Studio Code](https://code.visualstudio.com/) (需要v1.96(含)之後的版本)
2. 在VS Code中的延伸模組Marketplace搜尋search-enhancement以安裝

## Requirements
這個擴充套件使用前需要先做前置設定:
1. 對資料夾建立workspace
2. 使用[Ctags](https://github.com/universal-ctags/ctags) (請根據使用平台選擇對應的release版本下載)
   1. 建立symbol list:安裝後在workspace根目錄執行`ctags -R --languages=C,C++ --fields=+n --extras=+q -f .tags`

## Usage

1. 按 `Ctrl` + `Shift` + `P` 叫出命令欄並輸入 `Search Symbols by Keywords` 或滑鼠先在主要編輯區點一下後按下`Ctrl` + `Alt` + `F`，兩個方法都可以叫出Search Enhancement功能，預設會先出現在主要側邊欄，建議可以把圖標拉往次要側邊欄喔
2. 在搜尋框輸入要搜尋的關鍵字，關鍵字之間可以用空白隔開
3. 搜尋結果會顯示在側邊欄中，點擊結果可以打開對應的文件並跳到對應行數
4. 由於跳轉的位置取決於Ctags建立的symbol list，請記得定期更新symbol list以獲得最好的使用體驗

## Contributing

歡迎貢獻代碼、報告問題和提交功能請求。請參閱 [Contributing.md](Contributing.md) 了解更多資訊。

## Developing
- `npm install`
- `npm run compile`
- `F5` to start debugging

## License

此專案採用 [MIT](LICENSE) 授權條款。

## 致謝

圖標來源於 [SVG Repo](https://www.svgrepo.com/)