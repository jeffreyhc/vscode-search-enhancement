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

        const webviewDir = path.join(this._extensionUri.fsPath, 'resource', 'webview');
        const htmlTemplate = fs.readFileSync(path.join(webviewDir, 'index.html'), 'utf8');
        const styleContent = fs.readFileSync(path.join(webviewDir, 'style.css'), 'utf8');
        const scriptContent = applyPlaceholders(
            fs.readFileSync(path.join(webviewDir, 'main.js'), 'utf8'),
            { DEBOUNCE_TIME: String(this.debounceTime) }
        );

        return applyPlaceholders(htmlTemplate, {
            NONCE: nonce,
            CSP_SOURCE: webview.cspSource,
            CODICONS_URI: codiconsUri.toString(),
            STYLE: styleContent,
            SCRIPT: scriptContent
        });
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

/**
 * Substitute `{{KEY}}` placeholders in `template` using `vars`. Unknown keys
 * are left as-is so that any `{{...}}` written intentionally in the source
 * (none today) is not silently dropped.
 */
function applyPlaceholders(template: string, vars: Record<string, string>): string {
    return template.replace(/\{\{([A-Z_]+)\}\}/g, (match, key: string) =>
        Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : match
    );
}
