import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext) {
    const searchResultsProvider = new SearchResultsProvider();
    //vscode.window.registerTreeDataProvider('searchResults', searchResultsProvider);

    // 使用 WebviewViewProvider 來註冊側邊欄中的搜尋視圖
    const viewProvider = new SearchFunctionsViewProvider(context.extensionUri, searchResultsProvider);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(SearchFunctionsViewProvider.viewId, viewProvider)
    );
    vscode.commands.registerCommand('extension.searchFunctions', () => {
        // 可在此做點擊後的操作，例如切換到 Explorer 或設定焦點到搜尋視圖
        //vscode.window.showInformationMessage('Test');
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

        webviewView.webview.html = this.getHtmlForWebview();

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
                            const tagsFilePath = path.join(rootPath, '.tags');

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
                    
                                    // 檢查：keywords 中的每個 keyword，是否都出現在 subSymbolsLowerCase 裡
                                    return keywords.every(keyword => subSymbolsLowerCase.includes(keyword));
                                });

                                if (matchedSymbols.length > 0) {
                                    const results = matchedSymbols.map(sym => new SearchResultItem(sym.name, sym.file, sym.line, vscode.TreeItemCollapsibleState.None));
                                    //console.log('Results:', results);
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
                }
            }
        );
    }

    public focusSearchInput() {
        if (this.view) {
            this.view.webview.postMessage({ command: 'focusSearchInput' });
        }
    }

    private getHtmlForWebview(): string {
        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Search Functions</title>
                <style>
                    body {
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
                        margin: 0;
                        padding: 16px;
                    }
                    input[type="text"] {
                        background: transparent;
                        color: var(--vscode-input-foreground);
                        padding: 3px 0 3px 6px;
                        font-size: inherit;
                        width: 100%;
                        resize: none;
                        line-break: anywhere;
                    }
                    #status {
                        margin-bottom: 8px;
                        color: #888;
                    }
                    ul {
                        padding: 1px;
                    }
                    li {
                        font-size: inherit;
                    }
                    .file-name {
                        color: gray;
                    }
                </style>
            </head>
            <body>
                <input type="text" id="search" placeholder="請輸入關鍵字，以空格分隔" />
                <div id="status"></div>
                <ul id="results"></ul>
                <script>
                    const vscode = acquireVsCodeApi();
                    const searchInput = document.getElementById('search');
                    const statusDiv = document.getElementById('status');
                    const resultsList = document.getElementById('results');

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
                    }, 600);

                    searchInput.addEventListener('input', debouncedSearch);

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
                                        li.innerHTML = \`\${result.label}: <span class="file-name">\${result.fileName}</span>\`;
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
