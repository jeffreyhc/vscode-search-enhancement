import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { performance } from 'perf_hooks';
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
    // Dedicated channel for profile output; created once per activation. We do
    // not create-on-demand because the user may flip the `profileSearch`
    // setting on and off without restarting and we want the channel to remain
    // available without re-registering.
    const profileChannel = vscode.window.createOutputChannel('Search Enhancement');
    context.subscriptions.push(profileChannel);

    // 使用 WebviewViewProvider 來註冊側邊欄中的搜尋視圖
    const viewProvider = new SearchFunctionsViewProvider(context.extensionUri, profileChannel);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(SearchFunctionsViewProvider.viewId, viewProvider),
        vscode.commands.registerCommand('extension.searchFunctions', () => {
            // 可在此做點擊後的操作，例如切換到 Explorer 或設定焦點到搜尋視圖
            vscode.commands.executeCommand('workbench.view.extension.searchResultsContainer').then(() => {
                viewProvider.focusSearchInput();
            });
        }),
        ...registerTwinCommand('searchEnhancement.togglePartialMatch', () => viewProvider.togglePartialMatch()),
        ...registerTwinCommand('searchEnhancement.groupByName', () => viewProvider.setGroupBy('name')),
        ...registerTwinCommand('searchEnhancement.groupByFile', () => viewProvider.setGroupBy('file'))
    );
}

/**
 * The view/title menu doesn't reliably honour `toggled` on webview-backed
 * views, so we contribute *two* commands per toggle: a plain one and a
 * `.checked` variant whose title is prefixed with `✓`. The active one is
 * picked at render time by `when` clauses in package.json. Both ids share
 * the same handler so clicking either has the same effect.
 */
function registerTwinCommand(id: string, handler: () => void): vscode.Disposable[] {
    return [
        vscode.commands.registerCommand(id, handler),
        vscode.commands.registerCommand(`${id}.checked`, handler)
    ];
}

export type GroupByMode = 'name' | 'file';

/**
 * In-flight profile record waiting for the webview's render-time reply. We
 * collect the extension-side timings synchronously, post `updateResults`,
 * then flush the full block when the webview answers back with its render
 * time. If a new search starts before the webview has replied, the
 * leftover record is flushed without a render line so no data is lost.
 */
interface ProfileRecord {
    header: string;
    lines: string[];
    extensionTotalMs: number;
}

class SearchFunctionsViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewId = 'searchResultsView';
    private view: vscode.WebviewView | undefined;
    private isPartialMatchMode = false;

    // 讀取設定
    private config = vscode.workspace.getConfiguration("searchEnhancement");
    private debounceTime = this.config.get<number>("debounceTime", DEFAULT_DEBOUNCE_TIME_MS);
    private tagsFilePathsConfig = this.config.get<string[]>("tagsFilePaths", []);
    private groupByMode: GroupByMode =
        this.config.get<GroupByMode>("defaultGroupBy", 'name') === 'file' ? 'file' : 'name';
    private profileSearch = this.config.get<boolean>("profileSearch", false);

    // mtime-based cache for parsed .tags files; saves re-reading large indexes
    // on every keystroke and stays correct across user-driven ctags re-runs.
    private symbolsCache = createTagsCache<CtagsSymbol[]>(getSymbolsFromTags);

    private pendingProfile: ProfileRecord | null = null;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly profileChannel: vscode.OutputChannel
    ) {
        // Publish initial context keys so the view/title menu items render
        // with the correct toggled state on first show.
        this.publishStateContextKeys();
    }

    public togglePartialMatch(): void {
        this.isPartialMatchMode = !this.isPartialMatchMode;
        this.publishStateContextKeys();
        // Webview re-runs its current query when it receives this so results
        // immediately reflect the new mode.
        this.view?.webview.postMessage({ command: 'setPartialMatch', enabled: this.isPartialMatchMode });
    }

    public setGroupBy(mode: GroupByMode): void {
        this.groupByMode = mode;
        this.publishStateContextKeys();
        // Re-renders the cached result list with the new grouping; no re-search.
        this.view?.webview.postMessage({ command: 'setGroupBy', mode });
    }

    /**
     * Push current toggle / mode state into context keys so the view/title
     * menu's `toggled` conditions evaluate correctly. We use boolean keys
     * per group-by mode (rather than a single string key compared with
     * `==`) because the simpler `condition: <boolean-key>` form is the
     * most reliable to render across VS Code menu surfaces.
     */
    private publishStateContextKeys(): void {
        vscode.commands.executeCommand('setContext', 'searchEnhancement.partialMatchEnabled', this.isPartialMatchMode);
        vscode.commands.executeCommand('setContext', 'searchEnhancement.isGroupByName', this.groupByMode === 'name');
        vscode.commands.executeCommand('setContext', 'searchEnhancement.isGroupByFile', this.groupByMode === 'file');
    }

    public resolveWebviewView(
		webviewView: vscode.WebviewView,
	) {
        this.view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);
        // Sync webview with current profile flag so it knows whether to time
        // renderResults and post a profileTiming reply.
        webviewView.webview.postMessage({ command: 'setProfileEnabled', enabled: this.profileSearch });

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
            if (effect.profileSearch !== undefined) {
                this.profileSearch = effect.profileSearch;
                webviewView.webview.postMessage({ command: 'setProfileEnabled', enabled: effect.profileSearch });
            }
        });

        webviewView.webview.onDidReceiveMessage(
            async message => {
                switch (message.command) {
                    case 'search':
                        await this.handleSearch(message.text, webviewView);
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
                    case 'profileTiming':
                        this.handleProfileTiming(message);
                        break;
                }
            }
        );
    }

    private async handleSearch(rawText: string, webviewView: vscode.WebviewView): Promise<void> {
        const profile = this.profileSearch;

        // If a previous search's render reply never arrived (e.g. the user
        // disabled profileSearch in between), flush its data now without the
        // render line rather than silently dropping it.
        if (profile && this.pendingProfile) {
            this.flushPendingProfile(undefined);
        }

        const query = rawText.trim();
        const clauses = parseQueryClauses(query);

        // 取得工作區路徑
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showErrorMessage('請打開一個工作區');
            return;
        }
        const rootPath = workspaceFolders[0].uri.fsPath;

        const t0 = profile ? performance.now() : 0;
        const tagsFilePathTemplates = await this.ensureTagsFilePathsInitialized(workspaceFolders[0].uri);
        const tagsFilePaths = resolveTagsFilePaths(tagsFilePathTemplates, rootPath);
        const t1 = profile ? performance.now() : 0;

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

        // Track per-file cache hits so the timing line can report "F files,
        // M miss". We still parallelize the fetches so wall-clock isn't
        // perturbed by the instrumentation.
        let missCount = 0;
        const symbolResults = await Promise.all(existingTagsFiles.map(async (p) => {
            const result = await this.symbolsCache.get(p);
            if (profile && !result.wasCached) {
                missCount += 1;
            }
            return result.value;
        }));
        const t2 = profile ? performance.now() : 0;

        const ctagsSymbols = dedupeSymbolsByIdentity(symbolResults.flat());
        const t3 = profile ? performance.now() : 0;

        const matchedSymbols = ctagsSymbols.filter(sym =>
            matchesAllClauses(sym.name, clauses, this.isPartialMatchMode)
        );
        const t4 = profile ? performance.now() : 0;

        const results = matchedSymbols.map(sym => {
            const relativeDir = path.dirname(path.relative(rootPath, sym.file));
            return {
                label: sym.name,
                filePath: sym.file,
                line: sym.line,
                fileName: path.basename(sym.file),
                // Empty for files directly under the workspace root; otherwise
                // a path like `FreeRTOS/Source/portable/CCS/ARM_CM3` used to
                // disambiguate same-named files in the grouped result view.
                relativeDir: relativeDir === '.' ? '' : relativeDir,
                kind: sym.kind
            };
        });
        const t5 = profile ? performance.now() : 0;

        webviewView.webview.postMessage({ command: 'updateResults', results, query });
        const t6 = profile ? performance.now() : 0;

        if (profile) {
            this.pendingProfile = this.buildProfileRecord({
                query,
                isPartial: this.isPartialMatchMode,
                groupBy: this.groupByMode,
                resolveMs: t1 - t0,
                cacheMs: t2 - t1,
                fileCount: existingTagsFiles.length,
                missCount,
                dedupeMs: t3 - t2,
                symbolCount: ctagsSymbols.length,
                filterMs: t4 - t3,
                matchCount: matchedSymbols.length,
                buildMs: t5 - t4,
                postMs: t6 - t5,
                extensionTotalMs: t6 - t0
            });
        }
    }

    private buildProfileRecord(d: {
        query: string;
        isPartial: boolean;
        groupBy: GroupByMode;
        resolveMs: number;
        cacheMs: number;
        fileCount: number;
        missCount: number;
        dedupeMs: number;
        symbolCount: number;
        filterMs: number;
        matchCount: number;
        buildMs: number;
        postMs: number;
        extensionTotalMs: number;
    }): ProfileRecord {
        const now = new Date();
        const hh = String(now.getHours()).padStart(2, '0');
        const mm = String(now.getMinutes()).padStart(2, '0');
        const ss = String(now.getSeconds()).padStart(2, '0');
        const header = `[${hh}:${mm}:${ss}] Search "${d.query}" partial=${d.isPartial} groupBy=${d.groupBy}`;

        const lines = [
            fmtLine('resolve paths', d.resolveMs),
            fmtLine('tags cache', d.cacheMs, `(${d.fileCount} files, ${d.missCount} miss)`),
            fmtLine('dedupe', d.dedupeMs, `(${d.symbolCount} symbols)`),
            fmtLine('filter', d.filterMs, `(${d.symbolCount} → ${d.matchCount} matches)`),
            fmtLine('build results', d.buildMs),
            fmtLine('post message', d.postMs),
            '  ---',
            fmtLine('extension total', d.extensionTotalMs)
        ];

        return { header, lines, extensionTotalMs: d.extensionTotalMs };
    }

    private handleProfileTiming(message: { renderMs?: number; resultCount?: number }): void {
        if (!this.pendingProfile) {
            return;
        }
        this.flushPendingProfile({
            renderMs: typeof message.renderMs === 'number' ? message.renderMs : 0,
            resultCount: typeof message.resultCount === 'number' ? message.resultCount : 0
        });
    }

    private flushPendingProfile(render: { renderMs: number; resultCount: number } | undefined): void {
        const record = this.pendingProfile;
        if (!record) {
            return;
        }
        this.pendingProfile = null;

        this.profileChannel.appendLine(record.header);
        for (const line of record.lines) {
            this.profileChannel.appendLine(line);
        }

        if (render) {
            this.profileChannel.appendLine(fmtLine('webview render', render.renderMs, `(${render.resultCount} results)`));
            this.profileChannel.appendLine('  ---');
            this.profileChannel.appendLine(fmtLine('end-to-end total', record.extensionTotalMs + render.renderMs));
        } else {
            this.profileChannel.appendLine('  (no webview render time — flushed without round-trip)');
        }
        this.profileChannel.appendLine('');
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
            {
                DEBOUNCE_TIME: String(this.debounceTime),
                DEFAULT_GROUP_BY: this.groupByMode
            }
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

/**
 * Format a single profile line: stage name left-padded to 20 chars, time
 * right-justified to 8 chars with one decimal, then an optional context
 * suffix like "(45123 symbols)".
 */
function fmtLine(label: string, ms: number, suffix?: string): string {
    const labelCol = label.padEnd(20);
    const msCol = `${ms.toFixed(1)}ms`.padStart(9);
    return `  ${labelCol}${msCol}${suffix ? '  ' + suffix : ''}`;
}
