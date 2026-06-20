import * as fs from 'fs';
import * as path from 'path';
import { performance } from 'perf_hooks';
import { normalizeSymbolSegments } from './searchMatcher';

/** ctags 解析後的符號資料結構，可自行擴充 */
export interface CtagsSymbol {
    name: string;
    file: string;
    line: number;
    /** 符號種類 (function `f`, variable `v`, class `c`, ...) */
    kind?: string;
    /**
     * Lower-case underscore-split segments of `name`, precomputed at parse
     * time when the `precomputeSegments` option is enabled. Filtering reads
     * this directly instead of recomputing per keystroke, which on large
     * indexes is the dominant per-search cost. Stays `undefined` when the
     * option is off — callers fall back to computing on the fly.
     */
    normalizedSegments?: string[];
    /** Other extension fields such as language, scope, typeref, access. */
    [key: string]: string | number | boolean | string[] | undefined;
}

export interface GetSymbolsFromTagsOptions {
    /**
     * When true, populate `normalizedSegments` on each returned symbol so
     * `matchesAllClauses` can skip the per-call split/lowercase work. The
     * memory cost is roughly 50-100 MB per 1 million symbols; the speed
     * win is ~3-4× on the filter stage. Defaults to false to keep behaviour
     * backwards-compatible for callers that don't pass options (notably
     * unit tests).
     */
    precomputeSegments?: boolean;
    /** Receive phase timings for a real parse. Omit to keep profiling overhead at zero. */
    onProfile?: (profile: TagsParseProfile) => void;
}

export interface TagsParseProfile {
    tagsFilePath: string;
    fileBytes: number;
    lineCount: number;
    symbolCount: number;
    readMs: number;
    splitLinesMs: number;
    parseRowsMs: number;
    precomputeSegmentsMs: number;
    totalMs: number;
    heapUsedBeforeBytes: number;
    heapUsedAfterBytes: number;
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
export async function getSymbolsFromTags(
    tagsFilePath: string,
    options: GetSymbolsFromTagsOptions = {}
): Promise<CtagsSymbol[]> {
    const precomputeSegments = options.precomputeSegments === true;
    const profile = options.onProfile;
    const fileBytes = profile ? fs.statSync(tagsFilePath).size : 0;
    const heapUsedBeforeBytes = profile ? process.memoryUsage().heapUsed : 0;
    const startedAt = profile ? performance.now() : 0;
    const content = fs.readFileSync(tagsFilePath, 'utf-8');
    const readFinishedAt = profile ? performance.now() : 0;
    const lines = content.split(/\r?\n/);
    const splitFinishedAt = profile ? performance.now() : 0;
    const symbols: CtagsSymbol[] = [];
    const tagsDirectory = path.dirname(tagsFilePath);
    const resolvedFilePaths = new Map<string, string>();

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

        let absoluteFilePath = resolvedFilePaths.get(filePath);
        if (absoluteFilePath === undefined) {
            absoluteFilePath = path.isAbsolute(filePath)
                ? filePath
                : path.join(tagsDirectory, filePath);
            resolvedFilePaths.set(filePath, absoluteFilePath);
        }

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

        if (precomputeSegments && !profile) {
            symbol.normalizedSegments = normalizeSymbolSegments(name);
        }

        symbols.push(symbol);
    }

    const parseFinishedAt = profile ? performance.now() : 0;
    if (precomputeSegments && profile) {
        for (const symbol of symbols) {
            symbol.normalizedSegments = normalizeSymbolSegments(symbol.name);
        }
    }
    const finishedAt = profile ? performance.now() : 0;

    if (profile) {
        profile({
            tagsFilePath,
            fileBytes,
            lineCount: lines.length,
            symbolCount: symbols.length,
            readMs: readFinishedAt - startedAt,
            splitLinesMs: splitFinishedAt - readFinishedAt,
            parseRowsMs: parseFinishedAt - splitFinishedAt,
            precomputeSegmentsMs: finishedAt - parseFinishedAt,
            totalMs: finishedAt - startedAt,
            heapUsedBeforeBytes,
            heapUsedAfterBytes: process.memoryUsage().heapUsed
        });
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
