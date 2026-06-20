import * as assert from 'assert';
import * as fs from 'fs';
import { createRequire } from 'module';
import * as os from 'os';
import * as path from 'path';
import { TagsParseProfile, getSymbolsFromTags } from '../../tagsParser';

suite('tagsParser', () => {
    let tempDir: string;

    setup(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tags-parser-'));
    });

    teardown(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('skips metadata and malformed rows, parses line numbers and resolves paths', async () => {
        const tagsFilePath = path.join(tempDir, '.tags');
        const absoluteFilePath = path.join(tempDir, 'absolute.ts');
        const tagsContent = [
            '!_TAG_FILE_FORMAT\t2\t/extended format/',
            '',
            'badrow\tonly-two-columns',
            'foo\tsrc/foo.ts\t10;"\tf\tlanguage:TypeScript\tscope:MyClass',
            `bar\t${absoluteFilePath}\t/^const bar =$/;"\tv`,
            'baz\tsrc/baz.ts\tnot_a_line;"\tv'
        ].join('\n');

        fs.writeFileSync(tagsFilePath, tagsContent, 'utf8');

        const symbols = await getSymbolsFromTags(tagsFilePath);

        assert.strictEqual(symbols.length, 3);

        assert.deepStrictEqual(symbols[0], {
            name: 'foo',
            file: path.join(tempDir, 'src', 'foo.ts'),
            line: 10,
            kind: 'f',
            language: 'TypeScript',
            scope: 'MyClass'
        });

        assert.strictEqual(symbols[1].name, 'bar');
        assert.strictEqual(symbols[1].file, absoluteFilePath);
        assert.strictEqual(symbols[1].line, 1);
        assert.strictEqual(symbols[1].kind, 'v');

        assert.strictEqual(symbols[2].name, 'baz');
        assert.strictEqual(symbols[2].file, path.join(tempDir, 'src', 'baz.ts'));
        assert.strictEqual(symbols[2].line, 1);
        assert.strictEqual(symbols[2].kind, 'v');
    });

    test('resolves each distinct relative source path once per parse', async () => {
        const tagsFilePath = path.join(tempDir, '.tags');
        const tagsContent = [
            'first\tsrc/shared.c\t10;"\tf',
            'second\tsrc/shared.c\t20;"\tv',
            'third\tsrc/other.c\t30;"\td'
        ].join('\n');
        fs.writeFileSync(tagsFilePath, tagsContent, 'utf8');

        const pathModule = createRequire(__filename)('path') as { join: typeof path.join };
        const originalJoin = pathModule.join;
        let parserJoinCalls = 0;
        pathModule.join = ((...parts: string[]) => {
            if (parts[0] === tempDir && parts[1]?.startsWith('src/')) {
                parserJoinCalls += 1;
            }
            return originalJoin(...parts);
        }) as typeof path.join;

        try {
            const symbols = await getSymbolsFromTags(tagsFilePath);

            assert.strictEqual(parserJoinCalls, 2);
            assert.deepStrictEqual(symbols, [
                { name: 'first', file: originalJoin(tempDir, 'src/shared.c'), line: 10, kind: 'f' },
                { name: 'second', file: originalJoin(tempDir, 'src/shared.c'), line: 20, kind: 'v' },
                { name: 'third', file: originalJoin(tempDir, 'src/other.c'), line: 30, kind: 'd' }
            ]);
        } finally {
            pathModule.join = originalJoin;
        }
    });

    test('parses key:value extra fields from ctags extension columns', async () => {
        const tagsFilePath = path.join(tempDir, '.tags');
        const tagsContent = [
            'with_meta\tsrc/meta.ts\t42;"\tf\tlanguage:TypeScript\taccess:public\tsignature:(x,y)'
        ].join('\n');

        fs.writeFileSync(tagsFilePath, tagsContent, 'utf8');

        const symbols = await getSymbolsFromTags(tagsFilePath);

        assert.strictEqual(symbols.length, 1);
        assert.deepStrictEqual(symbols[0], {
            name: 'with_meta',
            file: path.join(tempDir, 'src', 'meta.ts'),
            line: 42,
            kind: 'f',
            language: 'TypeScript',
            access: 'public',
            signature: '(x,y)'
        });
    });

    test('returns empty array for empty file and metadata-only file', async () => {
        const emptyPath = path.join(tempDir, 'empty.tags');
        const metaPath = path.join(tempDir, 'meta.tags');

        fs.writeFileSync(emptyPath, '', 'utf8');
        fs.writeFileSync(
            metaPath,
            '!_TAG_FILE_FORMAT\t2\t/extended/\n!_TAG_FILE_SORTED\t1\t/sorted/\n',
            'utf8'
        );

        assert.deepStrictEqual(await getSymbolsFromTags(emptyPath), []);
        assert.deepStrictEqual(await getSymbolsFromTags(metaPath), []);
    });

    test('parses CRLF-terminated tags files (Windows ctags output)', async () => {
        const tagsFilePath = path.join(tempDir, '.tags');
        const tagsContent = [
            '!_TAG_FILE_FORMAT\t2\t/extended format/',
            'foo\tsrc/foo.c\t10',
            'bar\tsrc/bar.c\t20;"\tf'
        ].join('\r\n');

        fs.writeFileSync(tagsFilePath, tagsContent, 'utf8');

        const symbols = await getSymbolsFromTags(tagsFilePath);

        assert.strictEqual(symbols.length, 2);
        assert.strictEqual(symbols[0].name, 'foo');
        assert.strictEqual(symbols[0].line, 10);
        assert.strictEqual(symbols[1].name, 'bar');
        assert.strictEqual(symbols[1].line, 20);
        assert.strictEqual(symbols[1].kind, 'f');
    });

    test('real-world Universal Ctags row: regex exCmd, line:N field, trailing empty file: scope', async () => {
        // This mirrors a row from a real `ctags -R --languages=C,C++ --fields=+n --extras=+q`
        // run against FreeRTOS sources. Regression test for the kind icon bug
        // (issue #5 follow-up): the kind sentinel `;"` is glued to the exCmd,
        // and `line:N` lives in the extension fields rather than in exCmd.
        const tagsFilePath = path.join(tempDir, '.tags');
        const row =
            'vErrorChecks\tsrc/main.c\t/^static void vErrorChecks( void *pvParameters )$/;"\tf\tline:193\ttyperef:typename:void\tfile:';
        fs.writeFileSync(tagsFilePath, row + '\n', 'utf8');

        const symbols = await getSymbolsFromTags(tagsFilePath);

        assert.strictEqual(symbols.length, 1);
        const sym = symbols[0];
        assert.strictEqual(sym.name, 'vErrorChecks');
        // `file:` extension field has an empty value (= file-scope marker) and
        // must NOT overwrite the resolved file path from parts[1].
        assert.strictEqual(sym.file, path.join(tempDir, 'src', 'main.c'));
        // `line:193` overrides the line=1 fallback that the regex exCmd produced.
        assert.strictEqual(sym.line, 193);
        assert.strictEqual(typeof sym.line, 'number');
        assert.strictEqual(sym.kind, 'f');
        assert.strictEqual(sym.typeref, 'typename:void');
    });

    test('handles raw TAB inside the regex exCmd (tab-aligned #define macros)', async () => {
        // Regression for a real FreeRTOS .tags row: ctags preserves the tab
        // character that separates `#define NAME` from the macro body, so the
        // regex exCmd ends up containing literal `\t`. A naive split('\t')
        // would treat the regex tail (and the kind that follows) as separate
        // fields and the parser would pick up `/;"` as the kind. Find the
        // part that ends with `;"` and re-join everything up to it as exCmd.
        const tagsFilePath = path.join(tempDir, '.tags');
        const row =
            'portNVIC_SYSTICK_LOAD_REG\tport.c\t/^#define portNVIC_SYSTICK_LOAD_REG\t/;"\td\tline:53\tfile:';
        fs.writeFileSync(tagsFilePath, row + '\n', 'utf8');

        const symbols = await getSymbolsFromTags(tagsFilePath);

        assert.strictEqual(symbols.length, 1);
        assert.strictEqual(symbols[0].name, 'portNVIC_SYSTICK_LOAD_REG');
        assert.strictEqual(symbols[0].file, path.join(tempDir, 'port.c'));
        assert.strictEqual(symbols[0].line, 53);
        assert.strictEqual(symbols[0].kind, 'd');
    });

    test('accepts long-form kind via --fields=+K (kind:function)', async () => {
        const tagsFilePath = path.join(tempDir, '.tags');
        const row = 'doStuff\tsrc/a.c\t12;"\tkind:function\tline:12';
        fs.writeFileSync(tagsFilePath, row + '\n', 'utf8');

        const symbols = await getSymbolsFromTags(tagsFilePath);

        assert.strictEqual(symbols.length, 1);
        assert.strictEqual(symbols[0].kind, 'function');
        assert.strictEqual(symbols[0].line, 12);
    });

    test('precomputeSegments: true populates normalizedSegments per symbol', async () => {
        const tagsFilePath = path.join(tempDir, '.tags');
        const tagsContent = [
            'vTaskCreate\tsrc/tasks.c\t10;"\tf',
            'port_NVIC_INT\tsrc/port.c\t20;"\td',
            '__attribute__\tsrc/header.h\t30;"\td'
        ].join('\n');
        fs.writeFileSync(tagsFilePath, tagsContent, 'utf8');

        const symbols = await getSymbolsFromTags(tagsFilePath, { precomputeSegments: true });

        assert.strictEqual(symbols.length, 3);
        assert.deepStrictEqual(symbols[0].normalizedSegments, ['vtaskcreate']);
        assert.deepStrictEqual(symbols[1].normalizedSegments, ['port', 'nvic', 'int']);
        // Leading/trailing/repeated underscores collapse via the existing
        // `filter(Boolean)` step inside normalizeSymbolSegments.
        assert.deepStrictEqual(symbols[2].normalizedSegments, ['attribute']);
    });

    test('precomputeSegments default (off) leaves normalizedSegments undefined', async () => {
        const tagsFilePath = path.join(tempDir, '.tags');
        fs.writeFileSync(tagsFilePath, 'vTaskCreate\tsrc/tasks.c\t10;"\tf\n', 'utf8');

        // Default options
        const symbolsDefault = await getSymbolsFromTags(tagsFilePath);
        assert.strictEqual(symbolsDefault[0].normalizedSegments, undefined);

        // Explicit false
        const symbolsExplicit = await getSymbolsFromTags(tagsFilePath, { precomputeSegments: false });
        assert.strictEqual(symbolsExplicit[0].normalizedSegments, undefined);
    });

    test('reports parse phase timings and size metrics through onProfile', async () => {
        const tagsFilePath = path.join(tempDir, '.tags');
        const tagsContent = [
            'vTaskCreate\tsrc/tasks.c\t10;"\tf',
            'port_NVIC_INT\tsrc/port.c\t20;"\td'
        ].join('\n');
        fs.writeFileSync(tagsFilePath, tagsContent, 'utf8');

        let callbackCount = 0;
        let profile: TagsParseProfile | undefined;
        const options = {
            precomputeSegments: true,
            onProfile: (value: TagsParseProfile) => {
                callbackCount += 1;
                profile = value;
            }
        };

        const symbols = await getSymbolsFromTags(tagsFilePath, options);

        assert.strictEqual(callbackCount, 1);
        assert.ok(profile);
        assert.strictEqual(profile.tagsFilePath, tagsFilePath);
        assert.strictEqual(profile.fileBytes, Buffer.byteLength(tagsContent, 'utf8'));
        assert.strictEqual(profile.lineCount, 2);
        assert.strictEqual(profile.symbolCount, 2);
        for (const duration of [
            profile.readMs,
            profile.splitLinesMs,
            profile.parseRowsMs,
            profile.precomputeSegmentsMs,
            profile.totalMs
        ]) {
            assert.ok(duration >= 0, `expected non-negative duration, got ${duration}`);
        }
        assert.ok(profile.heapUsedBeforeBytes > 0);
        assert.ok(profile.heapUsedAfterBytes > 0);
        assert.deepStrictEqual(symbols[1].normalizedSegments, ['port', 'nvic', 'int']);
    });
});
