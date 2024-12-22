import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext) {
    let disposable = vscode.commands.registerCommand('extension.searchFunctions', async () => {
        // 讓使用者輸入關鍵字
        const input = await vscode.window.showInputBox({ placeHolder: '請輸入關鍵字，以空格分隔' });
        if (!input) {
            return;
        }
        const keywords = input.trim().split(/\s+/);

		// 獲取工作區路徑
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders) {
			vscode.window.showErrorMessage('請打開一個工作區');
			return;
		}

		// 每個 keyword 都向 symbol provider 查詢一次
        let allSymbolSets: vscode.SymbolInformation[][] = [];
        for (const kw of keywords) {
            // 拿不到任何結果時，回傳空陣列即可
            const result = await vscode.commands.executeCommand<vscode.SymbolInformation[]>('vscode.executeWorkspaceSymbolProvider', kw) || [];
            //console.log("kw: ", kw);
            //console.log(result);
            allSymbolSets.push(result);
        }

        // 取交集：只有同時出現在所有結果裡的符號才能保留
        // 這邊要注意如何判斷「同一個符號」，我們可比對 (symbol.name, symbol.location.uri, symbol.location.range)
        let intersectedSymbols = allSymbolSets[0];
        for (let i = 1; i < allSymbolSets.length; i++) {
            intersectedSymbols = intersectionOfSymbols(intersectedSymbols, allSymbolSets[i]);
        }

        // 顯示結果
        if (intersectedSymbols.length > 0) {
            const items = intersectedSymbols.map(symbol => ({
                label: symbol.name,
                description: `${vscode.workspace.asRelativePath(symbol.location.uri.fsPath)}:${symbol.location.range.start.line + 1}`,
                symbol: symbol
            }));
            const selectedItem = await vscode.window.showQuickPick(items, { placeHolder: '選擇一個符號' });
            if (selectedItem) {
                const { symbol } = selectedItem;
                const doc = await vscode.workspace.openTextDocument(symbol.location.uri);
                const editor = await vscode.window.showTextDocument(doc);
                editor.selection = new vscode.Selection(symbol.location.range.start, symbol.location.range.start);
                editor.revealRange(symbol.location.range);
            }
        }
		else
		{
			vscode.window.showInformationMessage('未找到同時包含所有關鍵字的符號，啟用替代方案。');
			const rootPath = workspaceFolders[0].uri.fsPath;

			// 搜尋並提取函式名稱
			const functionNames = await getAllFunctionNames(rootPath);

			// 篩選符合關鍵字的函式
			const matchedFunctions = functionNames.filter(name => {
				return keywords.every(keyword => name.includes(keyword));
			});

			// 顯示結果
			if (matchedFunctions.length > 0) {
				const selectedFunction = await vscode.window.showQuickPick(matchedFunctions, { placeHolder: '選擇一個函式' });
				if (selectedFunction) {
					// 定位到函式定義
					locateFunctionDefinition(rootPath, selectedFunction);
				}
			} else {
				vscode.window.showInformationMessage('未找到符合的函式');
			}
		}
    });

    context.subscriptions.push(disposable);
}
/**
 * 取兩組符號陣列的交集，只保留同一個符號。
 * 這裡用 name, uri, range 同時比對，才可視為同一個符號。
 */
function intersectionOfSymbols(a: vscode.SymbolInformation[], b: vscode.SymbolInformation[]): vscode.SymbolInformation[] {
    // 先把 b 存成 map 或 set 供快速比對
    // 注意 range 的比對可以用 isEqual()，但因為這裡沒得直接呼叫，只能比較行/列
    const bSet = new Set(b.map(sym => getSymbolKey(sym)));

    return a.filter(sym => bSet.has(getSymbolKey(sym)));
}

function getSymbolKey(sym: vscode.SymbolInformation): string {
    const uriStr = sym.location.uri.toString();
    const startLine = sym.location.range.start.line;
    const startChar = sym.location.range.start.character;
    const endLine = sym.location.range.end.line;
    const endChar = sym.location.range.end.character;
    return `${sym.name}@@${uriStr}@@[${startLine},${startChar}]-[${endLine},${endChar}]`;
}

async function getAllFunctionNames(dir: string): Promise<string[]> {
    let functionNames: string[] = [];
    const files = fs.readdirSync(dir);

    for (const file of files) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
            const names = await getAllFunctionNames(fullPath);
            functionNames = functionNames.concat(names);
        } else if (file.endsWith('.c') || file.endsWith('.h')) {
            const content = fs.readFileSync(fullPath, 'utf-8');
            const names = extractFunctionNames(content);
            functionNames = functionNames.concat(names);
        }
    }

    return functionNames;
}

function extractFunctionNames(content: string): string[] {
    const functionNames: string[] = [];
    const regex = /^[a-zA-Z_][a-zA-Z0-9_*\s]*\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\([^)]*\)\s*\{/gm;
    let match;
    while ((match = regex.exec(content)) !== null) {
        functionNames.push(match[1]);
    }
    return functionNames;
}

function locateFunctionDefinition(rootPath: string, functionName: string) {
    const files = vscode.workspace.findFiles('**/*.{c,h}');
    files.then(files => {
        files.forEach(file => {
            vscode.workspace.openTextDocument(file).then(doc => {
                const content = doc.getText();
                const regex = new RegExp(`[a-zA-Z_][a-zA-Z0-9_\\*\\s]*\\s+${functionName}\\s*\\([^)]*\\)\\s*\\{`, 'gm');
                if (regex.test(content)) {
                    vscode.window.showTextDocument(doc).then(editor => {
                        const position = doc.positionAt(content.indexOf(functionName));
                        editor.selection = new vscode.Selection(position, position);
                        editor.revealRange(new vscode.Range(position, position));
                    });
                }
            });
        });
    });
}

export function deactivate() {}
