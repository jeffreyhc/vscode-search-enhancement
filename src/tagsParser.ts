import * as fs from 'fs';
import * as path from 'path';

/** ctags 解析後的符號資料結構，可自行擴充 */
export interface CtagsSymbol {
    name: string;
    file: string;
    line: number;
    /** 符號種類 (function `f`, variable `v`, class `c`, ...) */
    kind?: string;
    /** Other extension fields such as language, scope, typeref, access. */
    [key: string]: string | number | boolean | undefined;
}

/**
 * Parse a ctags-format index file into a list of symbols.
 *
 * Real Universal Ctags row format:
 *
 *   name<TAB>file<TAB>exCmd;"<TAB>kind[<TAB>key:value]*
 *
 * The `;"` sentinel is glued to the end of exCmd (regex pattern or line
 * number); the next tab-separated field is the single-letter kind (or
 * `kind:long-name` when --fields=+K was used), followed by zero or more
 * `key:value` extension fields such as `line:193`, `typeref:typename:void`,
 * `scope:MyClass`, `file:` (the last one has an empty value to indicate a
 * file-scope / static symbol — we skip empty values so they don't clobber
 * the resolved file path).
 *
 * Lines beginning with `!` are metadata headers and are skipped, as are
 * rows with fewer than three columns. CRLF line endings (default for
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

        // Universal Ctags allows raw TAB characters inside a regex exCmd
        // (e.g. when source uses tab-aligned `#define` macros), so parts[2]
        // alone may only be the start of exCmd. Find the part that ends with
        // the `;"` sentinel — everything from parts[2] up to it is exCmd.
        let exCmdEndIdx = -1;
        for (let i = 2; i < parts.length; i++) {
            if (parts[i].endsWith(';"')) {
                exCmdEndIdx = i;
                break;
            }
        }

        let exCmd: string;
        let extensionStartIdx: number;
        if (exCmdEndIdx >= 2) {
            exCmd = parts.slice(2, exCmdEndIdx + 1).join('\t').slice(0, -2);
            extensionStartIdx = exCmdEndIdx + 1;
        } else {
            // No `;"` sentinel anywhere — assume no extension fields.
            exCmd = parts.slice(2).join('\t');
            extensionStartIdx = parts.length;
        }

        let lineNumber = 1;
        const lineMatch = exCmd.match(/^\d+$/);
        if (lineMatch) {
            lineNumber = parseInt(lineMatch[0], 10);
        }
        // Non-numeric exCmd (regex pattern) → fall back to 1; will be
        // overridden below by a `line:N` extension field if present.

        const absoluteFilePath = path.isAbsolute(filePath)
            ? filePath
            : path.join(path.dirname(tagsFilePath), filePath);

        const symbol: CtagsSymbol = {
            name,
            file: absoluteFilePath,
            line: lineNumber
        };

        // First extension field is the kind (single-letter, or "kind:long-name"
        // with --fields=+K). The rest are key:value pairs.
        if (extensionStartIdx < parts.length && parts[extensionStartIdx]) {
            const firstExt = parts[extensionStartIdx];
            const colonIdx = firstExt.indexOf(':');
            if (colonIdx > 0) {
                applyExtension(symbol, firstExt.slice(0, colonIdx), firstExt.slice(colonIdx + 1));
            } else {
                symbol.kind = firstExt;
            }

            for (const field of parts.slice(extensionStartIdx + 1)) {
                if (!field) {
                    continue;
                }
                const idx = field.indexOf(':');
                if (idx > 0) {
                    applyExtension(symbol, field.slice(0, idx), field.slice(idx + 1));
                }
            }
        }

        symbols.push(symbol);
    }

    return symbols;
}

/** Set a parsed extension field on the symbol, respecting reserved keys. */
function applyExtension(symbol: CtagsSymbol, key: string, value: string): void {
    if (!value) {
        // Empty value (e.g. `file:` meaning "file-scope") → ignore so the
        // resolved file path / line number / kind aren't clobbered.
        return;
    }
    if (key === 'kind') {
        symbol.kind = value;
        return;
    }
    if (key === 'line') {
        const parsed = parseInt(value, 10);
        if (!isNaN(parsed)) {
            symbol.line = parsed;
        }
        return;
    }
    symbol[key] = value;
}
