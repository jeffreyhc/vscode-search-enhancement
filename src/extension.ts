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
        const keywords = input.trim().split(/\s+/).map(k => k.toLowerCase());

        // 取得工作區路徑
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showErrorMessage('請打開一個工作區');
            return;
        }
        const rootPath = workspaceFolders[0].uri.fsPath;

        // == 改為使用 ctags 資料庫( .tags ) 取得符號清單 ==
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
                // 顯示結果並讓使用者選擇
                const items = matchedSymbols.map(sym => ({
                    label: sym.name,
                    description: `${path.relative(rootPath, sym.file)}:${sym.line}`,
                    symbol: sym
                }));
                const selectedItem = await vscode.window.showQuickPick(items, {
                    placeHolder: '選擇一個符號'
                });
                if (selectedItem) {
                    // 開啟檔案並跳至行號
                    const doc = await vscode.workspace.openTextDocument(selectedItem.symbol.file);
                    const editor = await vscode.window.showTextDocument(doc);

                    // ctags 的行號通常是 1-based，VS Code 的行號是 0-based
                    const line = Math.max(0, selectedItem.symbol.line - 1);
                    const position = new vscode.Position(line, 0);

                    editor.selection = new vscode.Selection(position, position);
                    editor.revealRange(new vscode.Range(position, position));
                }
            } else {
                // ctags 資料庫中找不到符合關鍵字的符號 -> 執行 fallback
                vscode.window.showInformationMessage('ctags 找不到符合的符號，啟用正則搜尋。');
                await runFallbackSearch(rootPath, keywords);
            }
        } else {
            // ctagsSymbols 是空 -> 執行 fallback
            vscode.window.showInformationMessage('ctags 索引無內容，啟用正則搜尋。');
            await runFallbackSearch(rootPath, keywords);
        }
    });

    context.subscriptions.push(disposable);
}

/** ctags 解析後的符號資料結構，可自行擴充 */
interface CtagsSymbol {
  name: string;
  file: string;
  line: number;
  /** 符號種類 (function, variable, class...) */
  kind?: string;
  /** 可能還有更多屬性，如 language, scope, 依需求自行加入 */
  [key: string]: any;
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


// == 新增：封裝 fallback 的流程，與 V1 相同 ==
async function runFallbackSearch(rootPath: string, keywords: string[]) {
    // 搜尋並提取函式名稱 (您也可擴充為提取變數、巨集等)
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

// == 以下保持與 V1 相同: 取得函式名稱、使用正則定位等 ==

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
