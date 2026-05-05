import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { matchesAllClauses, parseQueryClauses } from './searchMatcher';
import {
    DEFAULT_DEBOUNCE_TIME_MS,
    LegacyPathConfigScope,
    decideTagsFilePathMigration,
    dedupeSymbolsByIdentity,
    deriveConfigChangeEffect,
    resolveTagsFilePaths
} from './tagsConfig';
import { createTagsCache } from './tagsCache';
import { CtagsSymbol, getSymbolsFromTags } from './tagsParser';

export function activate(context: vscode.ExtensionContext) {
    // 使用 WebviewViewProvider 來註冊側邊欄中的搜尋視圖
    const viewProvider = new SearchFunctionsViewProvider(context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(SearchFunctionsViewProvider.viewId, viewProvider)
    );
    vscode.commands.registerCommand('extension.searchFunctions', () => {
        // 可在此做點擊後的操作，例如切換到 Explorer 或設定焦點到搜尋視圖
        vscode.commands.executeCommand('workbench.view.extension.searchResultsContainer').then(() => {
            viewProvider.focusSearchInput();
        });
    });
}

class SearchFunctionsViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewId = 'searchResultsView';
    private view: vscode.WebviewView | undefined;
    private isPartialMatchMode = false;

    // 讀取設定
    private config = vscode.workspace.getConfiguration("searchEnhancement");
    private debounceTime = this.config.get<number>("debounceTime", DEFAULT_DEBOUNCE_TIME_MS);
    private tagsFilePathsConfig = this.config.get<string[]>("tagsFilePaths", []);

    // mtime-based cache for parsed .tags files; saves re-reading large indexes
    // on every keystroke and stays correct across user-driven ctags re-runs.
    private symbolsCache = createTagsCache<CtagsSymbol[]>(getSymbolsFromTags);

    constructor(private readonly _extensionUri: vscode.Uri) { }

    public resolveWebviewView(
		webviewView: vscode.WebviewView,
	) {
        this.view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

        // 監聽設定變更，讓 debounceTime 和 tagsFilePaths 即時生效
        vscode.workspace.onDidChangeConfiguration(event => {
            const effect = deriveConfigChangeEffect(
                event,
                vscode.workspace.getConfiguration("searchEnhancement")
            );
            if (effect.debounceTime !== undefined) {
                this.debounceTime = effect.debounceTime;
                webviewView.webview.postMessage({ command: 'updateDebounceTime', value: effect.debounceTime });
            }
            if (effect.tagsFilePaths !== undefined) {
                this.tagsFilePathsConfig = effect.tagsFilePaths;
            }
        });

        webviewView.webview.onDidReceiveMessage(
            async message => {
                switch (message.command) {
                    case 'search':
                        {
                            const query = message.text.trim();
                            const clauses = parseQueryClauses(query);

                            // 取得工作區路徑
                            const workspaceFolders = vscode.workspace.workspaceFolders;
                            if (!workspaceFolders) {
                                vscode.window.showErrorMessage('請打開一個工作區');
                                return;
                            }
                            const rootPath = workspaceFolders[0].uri.fsPath;
                            const tagsFilePathTemplates = await this.ensureTagsFilePathsInitialized(workspaceFolders[0].uri);
                            const tagsFilePaths = resolveTagsFilePaths(tagsFilePathTemplates, rootPath);

                            const existingTagsFiles: string[] = [];
                            const missingTagsFiles: string[] = [];
                            tagsFilePaths.forEach(tagsFilePath => {
                                if (fs.existsSync(tagsFilePath)) {
                                    existingTagsFiles.push(tagsFilePath);
                                } else {
                                    missingTagsFiles.push(tagsFilePath);
                                }
                            });

                            if (missingTagsFiles.length > 0) {
                                vscode.window.showWarningMessage(`Skipped missing tags files: ${missingTagsFiles.join(', ')}`);
                            }
                            if (existingTagsFiles.length === 0) {
                                vscode.window.showErrorMessage('No tags files found. Please generate ctags indexes first.');
                                return;
                            }

                            const symbolGroups = await Promise.all(existingTagsFiles.map(p => this.symbolsCache.get(p)));
                            const ctagsSymbols = dedupeSymbolsByIdentity(symbolGroups.flat());

                            const matchedSymbols = ctagsSymbols.filter(sym =>
                                matchesAllClauses(sym.name, clauses, this.isPartialMatchMode)
                            );

                            const results = matchedSymbols.map(sym => ({
                                label: sym.name,
                                filePath: sym.file,
                                line: sym.line,
                                fileName: path.basename(sym.file)
                            }));
                            webviewView.webview.postMessage({ command: 'updateResults', results, query });
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

    private toConfigurationTarget(scope: LegacyPathConfigScope): vscode.ConfigurationTarget {
        switch (scope) {
            case 'workspaceFolder': return vscode.ConfigurationTarget.WorkspaceFolder;
            case 'workspace': return vscode.ConfigurationTarget.Workspace;
            case 'global': return vscode.ConfigurationTarget.Global;
        }
    }

    private async ensureTagsFilePathsInitialized(workspaceFolderUri: vscode.Uri): Promise<string[]> {
        const scopedConfig = vscode.workspace.getConfiguration("searchEnhancement", workspaceFolderUri);
        const decision = decideTagsFilePathMigration(
            scopedConfig.get<string[]>("tagsFilePaths", []),
            scopedConfig.inspect<string>("tagsFilePath")
        );

        if (decision.kind === 'initialize') {
            await scopedConfig.update("tagsFilePaths", decision.paths, this.toConfigurationTarget(decision.scope));
        }

        this.tagsFilePathsConfig = decision.paths;
        return decision.paths;
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

                    function performSearch() {
                        const query = searchInput.value.trim();
                        if (query) {
                            statusDiv.textContent = \`正在搜尋 "\${query}"...\`;
                            vscode.postMessage({ command: 'search', text: query });
                        } else {
                            statusDiv.textContent = '';
                            resultsList.innerHTML = '';
                        }
                    }

                    let debouncedSearch = debounce(performSearch, ${this.debounceTime});

                    searchInput.addEventListener('input', () => debouncedSearch());

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
                            case 'updateDebounceTime':
                                debouncedSearch = debounce(performSearch, message.value);
                                break;
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

export function deactivate() {}
