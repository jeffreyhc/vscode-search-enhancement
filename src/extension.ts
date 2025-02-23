import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext) {
    const searchResultsProvider = new SearchResultsProvider();

    // 使用 WebviewViewProvider 來註冊側邊欄中的搜尋視圖
    const viewProvider = new SearchFunctionsViewProvider(context.extensionUri, searchResultsProvider);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(SearchFunctionsViewProvider.viewId, viewProvider)
    );
    vscode.commands.registerCommand('extension.searchFunctions', () => {
        // 可在此做點擊後的操作，例如切換到 Explorer 或設定焦點到搜尋視圖
        vscode.commands.executeCommand('workbench.view.extension.searchResultsContainer').then(() => {
            viewProvider.focusSearchInput();
        });
    });

    vscode.commands.registerCommand('extension.openFile', async (item: SearchResultItem) => {
        const doc = await vscode.workspace.openTextDocument(item.filePath);
        const editor = await vscode.window.showTextDocument(doc);
        const line = Math.max(0, item.line - 1);
        const position = new vscode.Position(line, 0);
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(new vscode.Range(position, position));
    });

    vscode.commands.registerCommand('extension.openFileInNewTab', async (item: SearchResultItem) => {
        const doc = await vscode.workspace.openTextDocument(item.filePath);
        const editor = await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside });
        const line = Math.max(0, item.line - 1);
        const position = new vscode.Position(line, 0);
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(new vscode.Range(position, position));
    });
}

class SearchFunctionsViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewId = 'searchResultsView';
    private view: vscode.WebviewView | undefined;
    private isPartialMatchMode = false;

    // 讀取設定
    private config = vscode.workspace.getConfiguration("searchEnhancement");
    private debounceTime = this.config.get<number>("debounceTime", 600);
    private tagsFilePathConfig = this.config.get<string>("tagsFilePath", "${workspaceFolder}/.tags");

    constructor(private readonly _extensionUri: vscode.Uri,
                private readonly searchResultsProvider: SearchResultsProvider) { }

    public resolveWebviewView(
		webviewView: vscode.WebviewView,
	) {
        this.view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

        // 監聽設定變更，讓 debounceTime 和 tagsFilePath 即時更新
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration("searchEnhancement.debounceTime")) {
                this.debounceTime = vscode.workspace.getConfiguration("searchEnhancement").get<number>("debounceTime", 600);
            }
            if (event.affectsConfiguration("searchEnhancement.tagsFilePath")) {
                this.tagsFilePathConfig = vscode.workspace.getConfiguration("searchEnhancement").get<string>("tagsFilePath", "${workspaceFolder}/.tags");
            }
        });

        webviewView.webview.onDidReceiveMessage(
            async message => {
                switch (message.command) {
                    case 'search':
                        {
                            const query = message.text.trim();
                            const keywords: string[] = query.split(/\s+/).map((k: string) => k.toLowerCase());

                            // 取得工作區路徑
                            const workspaceFolders = vscode.workspace.workspaceFolders;
                            if (!workspaceFolders) {
                                vscode.window.showErrorMessage('請打開一個工作區');
                                return;
                            }
                            const rootPath = workspaceFolders[0].uri.fsPath;
                            // == 使用 ctags 資料庫( .tags ) 取得符號清單 ==
                            const tagsFilePath = this.tagsFilePathConfig.replace("${workspaceFolder}", rootPath);

                            if (!fs.existsSync(tagsFilePath)) {
                                vscode.window.showErrorMessage('未找到 .tags 檔案，請先使用 ctags 產生索引。');
                                return;
                            }

                            // 解析 .tags 檔案，取得所有符號資訊
                            const ctagsSymbols = await getSymbolsFromTags(tagsFilePath);

                            if (ctagsSymbols.length > 0) {
                                // 取得 ctagsSymbols，然後做篩選
                                const matchedSymbols = ctagsSymbols.filter(sym => {
                                    // 紀錄原始名稱
                                    const originalName = sym.name;
                    
                                    // 拆解 symbol.name 為多個 sub-symbol (小寫化)
                                    const subSymbolsLowerCase = originalName.split('_').map(s => s.toLowerCase());

                                    let result = false;
                                    if (!this.isPartialMatchMode) {
                                        // 完全符合：keywords 必須完全符合 subSymbolsLowerCase 中的任意一個
                                        result = keywords.every(keyword => subSymbolsLowerCase.includes(keyword));
                                    }
                                    else {
                                        // 部分符合：檢查keywords 中的每個 keyword，是否都出現在 subSymbolsLowerCase 裡的任意部分
                                        result = keywords.every(keyword =>
                                            subSymbolsLowerCase.some(subSymbol => subSymbol.includes(keyword))
                                        );
                                    }
                                    return result;
                                });

                                if (matchedSymbols.length > 0) {
                                    const results = matchedSymbols.map(sym => new SearchResultItem(sym.name, sym.file, sym.line, vscode.TreeItemCollapsibleState.None));
                                    // 同步更新 TreeView 使用的結果（如果有）
                                    this.searchResultsProvider.refresh(results);
                                    // 同時更新 Webview 內的結果顯示
                                    webviewView.webview.postMessage({ command: 'updateResults', results: results, query: query });
                                }
                                else {
                                    webviewView.webview.postMessage({ command: 'updateResults', results: [], query: query });
                                }
                            }
                        }
                        break;
                    case 'openFile':
                        {
                            const symbol = message.symbol;
                            const doc = await vscode.workspace.openTextDocument(symbol.filePath);
                            const editor = await vscode.window.showTextDocument(doc);
                            const line = Math.max(0, symbol.line - 1);
                            const position = new vscode.Position(line, 0);
                            editor.selection = new vscode.Selection(position, position);
                            editor.revealRange(new vscode.Range(position, position));
                        }
                        break;
                    case 'changeSearchMode':
                        this.isPartialMatchMode = message.mode;
                        break;
                }
            }
        );
    }

    public focusSearchInput() {
        if (this.view) {
            this.view.webview.postMessage({ command: 'focusSearchInput' });
        }
    }

    private getHtmlForWebview(webview: vscode.Webview): string {
        const nonce = this.getNonce();
        const codiconsUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'node_modules', '@vscode/codicons', 'dist', 'codicon.css'));
        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource};">
                <title>Search Functions</title>
                <link rel="stylesheet" href="${codiconsUri}" />
                <style>
                    body {
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
                        margin: 0;
                        padding: 16px;
                    }
                    #search-container {
                        display: flex;
                        align-items: center;
                        width: 100%;
                    }
                    #search {
                        flex: 1;
                        padding: 8px;
                        box-sizing: border-box;
                        border: 1px solid #444;
                        background-color: #222;
                        color: white;
                    }
                    #toggleSearchMode {
                        width: 32px;
                        height: 32px;
                        margin-left: 5px;
                        background-color: #333;
                        border: 1px solid #444;
                        color: white;
                        cursor: pointer;
                        transition: background-color 0.2s;
                    }
                    #toggleSearchMode:hover {
                        background-color: #555;
                    }
                    codicon {
                        display: flex;
	                    align-items: center;
                        justify-content: center;
                        font-size: 20px;
                    }
                    #toggleSearchMode .codicon {
                        color: white; /* 預設 icon 顏色 */
                    }
                    /* 當模式啟用時，讓按鈕有 "按下" 的狀態 */
                    #toggleSearchMode.active {
                        background-color: #007acc; /* VS Code 預設藍色 */
                        border-color: #005f99;
                    }
                    #toggleSearchMode.active .codicon {
                        color: yellow; /* 啟用 Partial Match Mode 時 icon 變黃 */
                    }
                    #toggleSearchMode:hover .codicon {
                        color: lightgray; /* 滑鼠懸停時 icon 變淺灰 */
                    }
                    #status {
                        margin-top: 8px;
                        color: #888;
                    }
                    ul {
                        list-style-type: none;
                        padding: 0;
                    }
                    li {
                        padding: 8px;
                        border-bottom: 1px;
                        cursor: pointer;
                    }
                    li:hover {
                        background-color:rgb(70, 70, 70);
                    }
                </style>
            </head>
            <body>
                <div id="search-container">
                    <input type="text" id="search" placeholder="請輸入關鍵字，以空格分隔" />
                    <button id="toggleSearchMode" title="Partial match mode">
                        <span class="codicon codicon-sparkle"></span>
                    </button>
                </div>
                <div id="status"></div>
                <ul id="results"></ul>
                <script nonce="${nonce}">
                    const vscode = acquireVsCodeApi();
                    const searchInput = document.getElementById('search');
                    const statusDiv = document.getElementById('status');
                    const resultsList = document.getElementById('results');
                    const toggleButton = document.getElementById("toggleSearchMode");

                    let isPartialMatchEnabled = false;

                    function debounce(func, wait) {
                        let timeout;
                        return function(...args) {
                            const later = () => {
                                clearTimeout(timeout);
                                func(...args);
                            };
                            clearTimeout(timeout);
                            timeout = setTimeout(later, wait);
                        };
                    }

                    const debouncedSearch = debounce(() => {
                        const query = searchInput.value.trim();
                        if (query) {
                            statusDiv.textContent = \`正在搜尋 "\${query}"...\`;
                            vscode.postMessage({ command: 'search', text: query });
                        } else {
                            statusDiv.textContent = '';
                            resultsList.innerHTML = '';
                        }
                    }, ${this.debounceTime});

                    searchInput.addEventListener('input', debouncedSearch);

                    toggleButton.addEventListener("click", () => {
                        isPartialMatchEnabled = !isPartialMatchEnabled;
                        vscode.postMessage({ command: "changeSearchMode", mode: isPartialMatchEnabled });

                        toggleButton.classList.toggle("active", isPartialMatchEnabled);
                        toggleButton.title = isPartialMatchEnabled
                            ? "Partial match mode (activated)"
                            : "Partial match mode";

                        // 如果搜尋框中有內容，立即觸發搜尋
                        if (searchInput.value.trim()) {
                            debouncedSearch();
                        }
                    });

                    window.addEventListener('message', event => {
                        const message = event.data;
                        switch (message.command) {
                            case 'updateResults':
                                const results = message.results;
                                const query = message.query;
                                resultsList.innerHTML = '';

                                if (results.length > 0) {
                                    statusDiv.textContent = \`搜尋 "\${query}"，找到 \${results.length} 個結果：\`;
                                    results.forEach(result => {
                                        const li = document.createElement('li');

                                        // 建立標籤文字
                                        const labelText = document.createTextNode(result.label);
                                        li.appendChild(labelText);

                                        // 添加冒號
                                        li.appendChild(document.createTextNode(': '));

                                        // 建立檔案名稱 span
                                        const fileNameSpan = document.createElement('span');
                                        fileNameSpan.className = 'file-name';
                                        fileNameSpan.textContent = result.fileName;
                                        li.appendChild(fileNameSpan);

                                        li.addEventListener('click', () => {
                                            vscode.postMessage({ command: 'openFile', symbol: result });
                                        });
                                        resultsList.appendChild(li);
                                    });
                                } else {
                                    statusDiv.textContent = \`搜尋 "\${query}"，未找到結果。\`;
                                }
                                break;
                            case 'focusSearchInput':
                                searchInput.focus();
                                break;
                        }
                    });
                </script>
            </body>
            </html>
        `;
    }

    private getNonce() {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }
}

class SearchResultsProvider implements vscode.TreeDataProvider<SearchResultItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<SearchResultItem | undefined | void> = new vscode.EventEmitter<SearchResultItem | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<SearchResultItem | undefined | void> = this._onDidChangeTreeData.event;

    private results: SearchResultItem[] = [];

    refresh(results: SearchResultItem[]): void {
        this.results = results;
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: SearchResultItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: SearchResultItem): Thenable<SearchResultItem[]> {
        if (element) {
            return Promise.resolve([]);
        } else {
            return Promise.resolve(this.results);
        }
    }
}

class SearchResultItem extends vscode.TreeItem {
    fileName: string;
    constructor(
        public readonly label: string,
        public readonly filePath: string,
        public readonly line: number,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(label, collapsibleState);
        this.tooltip = `${this.filePath}:${this.line}`;
        this.description = `${this.filePath}:${this.line}`;
        this.fileName = `${path.basename(this.filePath)}`;
    }

    contextValue = 'searchResultItem';
}

/** ctags 解析後的符號資料結構，可自行擴充 */
interface CtagsSymbol {
  name: string;
  file: string;
  line: number;
  /** 符號種類 (function, variable, class...) */
  kind?: string;
  /** 可能還有更多屬性，如 language, scope, 依需求自行加入 */
  [key: string]: string | number | boolean | undefined;
}

/**
 * 讀取 .tags 檔案，回傳所有符號清單
 * 假設 ctags 產生的格式類似:
 *   main    main.c  10  ;"     f
 *  其中:
 *   - 欄位[0]: name (main)
 *   - 欄位[1]: file (main.c)
 *   - 欄位[2]: exCmd/lineNumber (10 或 /^...$/)
 *   - 欄位[3] 之後: 其他資訊 (;" f 等)
 */
export async function getSymbolsFromTags(tagsFilePath: string): Promise<CtagsSymbol[]> {
  const content = fs.readFileSync(tagsFilePath, 'utf-8');
  const lines = content.split('\n');
  const symbols: CtagsSymbol[] = [];

  for (const line of lines) {
    // 跳過空行或 ctags 檔頭 (通常以 '!' 開頭)
    if (!line || line.startsWith('!')) {
      continue;
    }

    const parts = line.split('\t');
    // 基本 ctags 至少有三欄 (name, file, exCmd)
    if (parts.length < 3) {
      continue;
    }

    // ctags 基本欄位
    const name = parts[0];
    const filePath = parts[1];
    const exCmd = parts[2]; // exCmd 通常是行號或 /^pattern$/

    // 解析行號
    let lineNumber = 1;
    const lineMatch = exCmd.match(/^\d+$/);
    if (lineMatch) {
      lineNumber = parseInt(lineMatch[0], 10);
    }
    // 若不是純數字，表示 exCmd 是 /pattern/，可再進一步解析

    // 取得絕對路徑
    const absoluteFilePath = path.isAbsolute(filePath)
      ? filePath
      : path.join(path.dirname(tagsFilePath), filePath);

    // 建立 symbol 物件
    const symbol: CtagsSymbol = {
      name: name,
      file: absoluteFilePath,
      line: lineNumber
    };

    // 若有多的欄位 (parts[3] 之後)，可能包含 ;" f 之類
    // 可以再進一步拆解、解析更多資訊，以下提供範例：
    if (parts.length > 3) {
      // 把多餘欄位合成一個字串，通常會長得像: ;" f  language:JavaScript 之類
      const extraFields = parts.slice(3).join('\t').trim();

      // 1. 嘗試抓取 kind (最常見的是 ;" f 這種形式)
      //    假設 ctags 只給你一個字母 f, v, c...，可視需求調整
      //    這裡示範一種簡單的匹配方式
      const kindMatch = extraFields.match(/;"\s+(\S+)/);
      if (kindMatch) {
        symbol.kind = kindMatch[1];
      }

      // 2. 若是使用 Universal Ctags，部分欄位會以 key:value 形式出現，
      //    可用更進階的方式去 parse。例如：
      //    language:JavaScript  scope:MyClass  access:public ...
      const keyValuePairs = extraFields.match(/\b(\w+):([^\s]+)/g);
      // keyValuePairs 可能類似 [ 'language:JavaScript', 'scope:MyClass' ]...
      if (keyValuePairs) {
        keyValuePairs.forEach(pair => {
          const [k, v] = pair.split(':');
          symbol[k] = v; // 把它存到 symbol 內
        });
      }
    }
    symbols.push(symbol);
  }

  return symbols;
}

export function deactivate() {}
