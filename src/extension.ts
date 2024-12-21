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
    });

    context.subscriptions.push(disposable);
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
