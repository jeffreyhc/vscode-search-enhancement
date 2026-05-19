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
 * Runs every query twice: once in **baseline** mode (no precompute, dedupe
 * runs) — matches the extension's pre-v0.5.0 behaviour — and once in
 * **optimized** mode (precompute on, dedupe skipped) — matches the v0.5.0
 * default when only one .tags file is in play. The per-stage delta between
 * the two rows is the win from `searchEnhancement.precomputeSegments` plus
 * the 1-file dedupe fast path.
 *
 * Webview DOM render is not exercised here — it needs a real VS Code window.
 * For end-to-end profiling, enable `searchEnhancement.profileSearch` and
 * watch the "Search Enhancement" output channel.
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
 * Mirrors a single search through the extension's compute path.
 *
 * @param symbols      parsed symbol array (may or may not carry
 *                     normalizedSegments depending on the parse options)
 * @param clauses      parsed query clauses
 * @param isPartial    partial-match flag
 * @param rootPath     for building relative paths in the results step
 * @param skipDedupe   when true, mimic the 1-file fast path in
 *                     extension.ts that bypasses dedupeSymbolsByIdentity
 * @param usePrecomputed when true, pass sym.normalizedSegments as the 4th
 *                     arg to matchesAllClauses
 */
function runOnce(symbols, clauses, isPartial, rootPath, skipDedupe, usePrecomputed) {
    const t0 = performance.now();
    const deduped = skipDedupe ? symbols : dedupeSymbolsByIdentity(symbols);
    const t1 = performance.now();

    const matched = usePrecomputed
        ? deduped.filter(sym => matchesAllClauses(sym.name, clauses, isPartial, sym.normalizedSegments))
        : deduped.filter(sym => matchesAllClauses(sym.name, clauses, isPartial));
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

function runQueryMatrix(label, symbols, rootPath, skipDedupe, usePrecomputed) {
    console.log(`\n=== ${label} ===`);
    const header = [
        'case'.padEnd(22),
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
            let matchCount = 0;
            for (let i = 0; i < WARMUP_RUNS; i++) {
                matchCount = runOnce(symbols, clauses, isPartial, rootPath, skipDedupe, usePrecomputed).matchCount;
            }
            const runs = [];
            for (let i = 0; i < MEASURE_RUNS; i++) {
                runs.push(runOnce(symbols, clauses, isPartial, rootPath, skipDedupe, usePrecomputed));
            }
            const dedupe = aggregate(runs, 'dedupeMs');
            const filter = aggregate(runs, 'filterMs');
            const build = aggregate(runs, 'buildMs');
            const totalP50 = dedupe.p50 + filter.p50 + build.p50;

            console.log([
                (name + ' "' + q + '"').padEnd(22),
                (isPartial ? 'partial' : 'strict').padEnd(9),
                String(matchCount).padStart(8),
                `${fmtMs(dedupe.p50)}/${fmtMs(dedupe.p95)}`.padStart(18),
                `${fmtMs(filter.p50)}/${fmtMs(filter.p95)}`.padStart(18),
                `${fmtMs(build.p50)}/${fmtMs(build.p95)}`.padStart(18),
                `${fmtMs(totalP50)}`.padStart(12)
            ].join('  '));
        }
    }
}

async function main() {
    const tagsPath = process.argv[2];
    if (!tagsPath) {
        console.error('Usage: node scripts/bench-search.js <path-to-.tags>');
        process.exit(2);
    }

    console.log(`fixture: ${tagsPath}`);

    // Two separate parses so each mode gets symbols matching its expected
    // shape. The precomputed parse is slightly slower (extra work per symbol)
    // and we report both numbers.
    const parseBaselineStart = performance.now();
    const baselineSymbols = await getSymbolsFromTags(tagsPath);
    const parseBaselineMs = performance.now() - parseBaselineStart;

    const parsePrecompStart = performance.now();
    const precomputedSymbols = await getSymbolsFromTags(tagsPath, { precomputeSegments: true });
    const parsePrecompMs = performance.now() - parsePrecompStart;

    console.log(`parse (no precompute):  ${precomputedSymbols.length} symbols in ${fmtMs(parseBaselineMs)}ms`);
    console.log(`parse (+ precompute):   ${precomputedSymbols.length} symbols in ${fmtMs(parsePrecompMs)}ms  (delta ${fmtMs(parsePrecompMs - parseBaselineMs)}ms)`);
    console.log(`runs: warmup=${WARMUP_RUNS} measure=${MEASURE_RUNS}`);

    const rootPath = path.dirname(tagsPath);

    runQueryMatrix('BASELINE  (no precompute, dedupe runs — pre-v0.5.0 behaviour)',
        baselineSymbols, rootPath, /* skipDedupe */ false, /* usePrecomputed */ false);

    runQueryMatrix('OPTIMIZED (precompute ON, dedupe skipped — v0.5.0 default for 1-file)',
        precomputedSymbols, rootPath, /* skipDedupe */ true, /* usePrecomputed */ true);

    console.log('\nAll times in milliseconds.');
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
