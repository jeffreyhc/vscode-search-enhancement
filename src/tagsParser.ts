import * as fs from 'fs';
import * as path from 'path';

/** ctags 解析後的符號資料結構，可自行擴充 */
export interface CtagsSymbol {
    name: string;
    file: string;
    line: number;
    /** 符號種類 (function, variable, class...) */
    kind?: string;
    /** 可能還有更多屬性，如 language, scope, 依需求自行加入 */
    [key: string]: string | number | boolean | undefined;
}

/**
 * Parse a ctags-format index file into a list of symbols.
 *
 * Expected line format:
 *   name<TAB>file<TAB>exCmd[<TAB>extra fields ...]
 *
 *   - name      : symbol identifier
 *   - file      : path (relative to the tags file's directory) or absolute
 *   - exCmd     : line number, or a `/^pattern$/` regex; non-numeric falls
 *                 back to line 1
 *   - extras    : optional `;" kind` plus `key:value` pairs (Universal Ctags)
 *
 * Lines beginning with `!` are ctags metadata headers and are skipped, as
 * are rows with fewer than three columns. CRLF line endings (default for
 * Universal Ctags on Windows) are supported.
 */
export async function getSymbolsFromTags(tagsFilePath: string): Promise<CtagsSymbol[]> {
    const content = fs.readFileSync(tagsFilePath, 'utf-8');
    const lines = content.split(/\r?\n/);
    const symbols: CtagsSymbol[] = [];

    for (const line of lines) {
        if (!line || line.startsWith('!')) {
            continue;
        }

        const parts = line.split('\t');
        if (parts.length < 3) {
            continue;
        }

        const name = parts[0];
        const filePath = parts[1];
        const exCmd = parts[2];

        let lineNumber = 1;
        const lineMatch = exCmd.match(/^\d+$/);
        if (lineMatch) {
            lineNumber = parseInt(lineMatch[0], 10);
        }

        const absoluteFilePath = path.isAbsolute(filePath)
            ? filePath
            : path.join(path.dirname(tagsFilePath), filePath);

        const symbol: CtagsSymbol = {
            name,
            file: absoluteFilePath,
            line: lineNumber
        };

        if (parts.length > 3) {
            const extraFields = parts.slice(3).join('\t').trim();

            // ;" <kind> — single-letter kind from classic ctags format
            const kindMatch = extraFields.match(/;"\s+(\S+)/);
            if (kindMatch) {
                symbol.kind = kindMatch[1];
            }

            // Universal Ctags key:value pairs e.g. language:TypeScript scope:MyClass
            const keyValuePairs = extraFields.match(/\b(\w+):([^\s]+)/g);
            if (keyValuePairs) {
                keyValuePairs.forEach((pair: string) => {
                    const [k, v] = pair.split(':');
                    symbol[k] = v;
                });
            }
        }

        symbols.push(symbol);
    }

    return symbols;
}
