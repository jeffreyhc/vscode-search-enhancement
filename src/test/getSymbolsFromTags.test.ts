import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createRequire } from 'module';

interface ParsedSymbol {
    name: string;
    file: string;
    line: number;
    kind?: string;
    [key: string]: string | number | boolean | undefined;
}

function loadGetSymbolsFromTags(): (tagsFilePath: string) => Promise<ParsedSymbol[]> {
    const req = createRequire(__filename);
    const moduleLoader = req('module') as {
        _load: (request: string, parent: unknown, isMain: boolean) => unknown;
    };
    const originalLoad = moduleLoader._load;

    moduleLoader._load = function patchedLoad(
        request: string,
        parent: unknown,
        isMain: boolean
    ): unknown {
        if (request === 'vscode') {
            class EventEmitter {
                public event = () => {};
                public fire(): void {}
            }

            class TreeItem {
                constructor(public label?: string, public collapsibleState?: number) {}
            }

            return {
                window: {},
                workspace: {},
                commands: {},
                Uri: { joinPath: () => ({}) },
                Position: class {},
                Selection: class {},
                Range: class {},
                ViewColumn: { Beside: 2 },
                TreeItem,
                TreeItemCollapsibleState: { None: 0 },
                EventEmitter,
                ConfigurationTarget: {
                    WorkspaceFolder: 1,
                    Workspace: 2,
                    Global: 3
                }
            };
        }

        return originalLoad.call(this, request, parent, isMain);
    };

    try {
        delete req.cache[req.resolve('../extension')];
        const extension = req('../extension') as {
            getSymbolsFromTags: (tagsFilePath: string) => Promise<ParsedSymbol[]>;
        };
        return extension.getSymbolsFromTags;
    } finally {
        moduleLoader._load = originalLoad;
    }
}

suite('getSymbolsFromTags', () => {
    test('skips metadata and malformed rows, parses line numbers and resolves paths', async () => {
        const getSymbolsFromTags = loadGetSymbolsFromTags();
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tags-parser-'));
        const tagsFilePath = path.join(tempDir, '.tags');
        const absoluteFilePath = path.join(tempDir, 'absolute.ts');
        const tagsContent = [
            '!_TAG_FILE_FORMAT\t2\t/extended format/',
            '',
            'badrow\tonly-two-columns',
            'foo\tsrc/foo.ts\t10\t;"\tf\tlanguage:TypeScript\tscope:MyClass',
            `bar\t${absoluteFilePath}\t/^const bar =$/\t;"\tv`,
            'baz\tsrc/baz.ts\tnot_a_line\t;"\tv'
        ].join('\n');

        fs.writeFileSync(tagsFilePath, tagsContent, 'utf8');

        try {
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
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('parses key:value extra fields from ctags extension columns', async () => {
        const getSymbolsFromTags = loadGetSymbolsFromTags();
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tags-fields-'));
        const tagsFilePath = path.join(tempDir, '.tags');
        const tagsContent = [
            'with_meta\tsrc/meta.ts\t42\t;"\tf\tlanguage:TypeScript\taccess:public\tsignature:(x,y)'
        ].join('\n');

        fs.writeFileSync(tagsFilePath, tagsContent, 'utf8');

        try {
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
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('returns empty array for empty file and metadata-only file', async () => {
        const getSymbolsFromTags = loadGetSymbolsFromTags();
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tags-empty-'));
        const emptyPath = path.join(tempDir, 'empty.tags');
        const metaPath = path.join(tempDir, 'meta.tags');

        fs.writeFileSync(emptyPath, '', 'utf8');
        fs.writeFileSync(
            metaPath,
            '!_TAG_FILE_FORMAT\t2\t/extended/\n!_TAG_FILE_SORTED\t1\t/sorted/\n',
            'utf8'
        );

        try {
            assert.deepStrictEqual(await getSymbolsFromTags(emptyPath), []);
            assert.deepStrictEqual(await getSymbolsFromTags(metaPath), []);
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('parses CRLF-terminated tags files (Windows ctags output)', async () => {
        const getSymbolsFromTags = loadGetSymbolsFromTags();
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tags-crlf-'));
        const tagsFilePath = path.join(tempDir, '.tags');
        const tagsContent = [
            '!_TAG_FILE_FORMAT\t2\t/extended format/',
            'foo\tsrc/foo.c\t10',
            'bar\tsrc/bar.c\t20\t;"\tf'
        ].join('\r\n');

        fs.writeFileSync(tagsFilePath, tagsContent, 'utf8');

        try {
            const symbols = await getSymbolsFromTags(tagsFilePath);

            assert.strictEqual(symbols.length, 2);
            assert.strictEqual(symbols[0].name, 'foo');
            assert.strictEqual(symbols[0].line, 10);
            assert.strictEqual(symbols[1].name, 'bar');
            assert.strictEqual(symbols[1].line, 20);
            assert.strictEqual(symbols[1].kind, 'f');
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });
});
