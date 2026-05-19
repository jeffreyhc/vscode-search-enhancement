#!/usr/bin/env node
/**
 * Headless bench for the extension's search hot path. Imports the pure-TS
 * modules from `out/` (run `npm run compile` first) and exercises them
 * against a real ctags index file, reporting per-stage p50/p95 timings.
 *
 * Usage:
 *   node scripts/bench-search.js <path-to-.tags>
 *
 * Generate a fixture .tags from a public C codebase, e.g.:
 *   git clone --depth=1 https://github.com/FreeRTOS/FreeRTOS-Kernel.git /tmp/freertos-kernel
 *   ctags -R --fields=+K -f /tmp/freertos-kernel/.tags /tmp/freertos-kernel
 *
 * The script measures the extension-side compute path (parse, dedupe,
 * filter, build-results) but not the webview DOM render, which needs a
 * real VS Code window. Mirrors the search-handler stages in
 * src/extension.ts as closely as possible while staying free of any
 * dependency on the `vscode` module so it can run in plain node.
 */

const path = require('path');
const { performance } = require('perf_hooks');

const OUT = path.join(__dirname, '..', 'out');
const { matchesAllClauses, parseQueryClauses } = require(path.join(OUT, 'searchMatcher.js'));
const { dedupeSymbolsByIdentity } = require(path.join(OUT, 'tagsConfig.js'));
const { getSymbolsFromTags } = require(path.join(OUT, 'tagsParser.js'));

const WARMUP_RUNS = 3;
const MEASURE_RUNS = 10;

const QUERIES = [
    { name: 'single-short',   q: 'x' },
    { name: 'single-long',    q: 'port' },
    { name: 'multi-token',    q: 'port nvic' },
    { name: 'phrase',         q: 'port_NVIC' },
    { name: 'phrase-strict',  q: 'port_NVIC_int' },
    { name: 'miss',           q: 'zzzzzz' }
];

function pct(sortedAsc, p) {
    if (sortedAsc.length === 0) return 0;
    const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.floor(p * sortedAsc.length)));
    return sortedAsc[idx];
}

function stats(samples) {
    const sorted = samples.slice().sort((a, b) => a - b);
    return { p50: pct(sorted, 0.5), p95: pct(sorted, 0.95) };
}

function fmtMs(ms) { return ms.toFixed(1).padStart(6); }

/**
 * Mirrors the per-search compute path in src/extension.ts.
 * Returns { dedupeMs, filterMs, buildMs, matchCount }.
 */
function runOnce(symbols, clauses, isPartial, rootPath) {
    const t0 = performance.now();
    const deduped = dedupeSymbolsByIdentity(symbols);
    const t1 = performance.now();

    const matched = deduped.filter(sym => matchesAllClauses(sym.name, clauses, isPartial));
    const t2 = performance.now();

    const results = matched.map(sym => {
        const relativeDir = path.dirname(path.relative(rootPath, sym.file));
        return {
            label: sym.name,
            filePath: sym.file,
            line: sym.line,
            fileName: path.basename(sym.file),
            relativeDir: relativeDir === '.' ? '' : relativeDir,
            kind: sym.kind
        };
    });
    const t3 = performance.now();

    return {
        dedupeMs: t1 - t0,
        filterMs: t2 - t1,
        buildMs: t3 - t2,
        matchCount: results.length
    };
}

function aggregate(runs, key) {
    return stats(runs.map(r => r[key]));
}

async function main() {
    const tagsPath = process.argv[2];
    if (!tagsPath) {
        console.error('Usage: node scripts/bench-search.js <path-to-.tags>');
        process.exit(2);
    }

    console.log(`fixture: ${tagsPath}`);
    const parseStart = performance.now();
    const symbols = await getSymbolsFromTags(tagsPath);
    const parseMs = performance.now() - parseStart;
    console.log(`parse:   ${symbols.length} symbols in ${fmtMs(parseMs)}ms`);
    console.log(`runs:    warmup=${WARMUP_RUNS} measure=${MEASURE_RUNS}`);
    console.log('');

    const rootPath = path.dirname(tagsPath);

    // Header
    const header = [
        'case'.padEnd(18),
        'mode'.padEnd(9),
        'matches'.padStart(8),
        'dedupe(p50/p95)'.padStart(18),
        'filter(p50/p95)'.padStart(18),
        'build(p50/p95)'.padStart(18),
        'total(p50)'.padStart(12)
    ].join('  ');
    console.log(header);
    console.log('-'.repeat(header.length));

    for (const { name, q } of QUERIES) {
        const clauses = parseQueryClauses(q);
        for (const isPartial of [false, true]) {
            // Warmup
            let matchCount = 0;
            for (let i = 0; i < WARMUP_RUNS; i++) {
                matchCount = runOnce(symbols, clauses, isPartial, rootPath).matchCount;
            }
            // Measure
            const runs = [];
            for (let i = 0; i < MEASURE_RUNS; i++) {
                runs.push(runOnce(symbols, clauses, isPartial, rootPath));
            }
            const dedupe = aggregate(runs, 'dedupeMs');
            const filter = aggregate(runs, 'filterMs');
            const build = aggregate(runs, 'buildMs');
            const totalP50 = dedupe.p50 + filter.p50 + build.p50;

            console.log([
                (name + ' "' + q + '"').padEnd(18),
                (isPartial ? 'partial' : 'strict').padEnd(9),
                String(matchCount).padStart(8),
                `${fmtMs(dedupe.p50)}/${fmtMs(dedupe.p95)}`.padStart(18),
                `${fmtMs(filter.p50)}/${fmtMs(filter.p95)}`.padStart(18),
                `${fmtMs(build.p50)}/${fmtMs(build.p95)}`.padStart(18),
                `${fmtMs(totalP50)}`.padStart(12)
            ].join('  '));
        }
    }
    console.log('');
    console.log('All times in milliseconds.');
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
