import * as assert from 'assert';
import * as path from 'path';
import {
    DEFAULT_TAGS_FILE_PATH_TEMPLATE,
    decideTagsFilePathMigration,
    dedupeSymbolsByIdentity,
    normalizeTagsFilePathTemplates,
    pickInitialTagsFilePathTemplates,
    pickLegacyPathConfigScope,
    resolveTagsFilePaths
} from '../tagsConfig';

suite('Tags Config', () => {
    test('uses legacy custom value when tagsFilePaths is empty', () => {
        const result = pickInitialTagsFilePathTemplates([], '${workspaceFolder}/custom.tags', DEFAULT_TAGS_FILE_PATH_TEMPLATE);
        assert.deepStrictEqual(result, ['${workspaceFolder}/custom.tags']);
    });

    test('uses default value when legacy value equals default', () => {
        const result = pickInitialTagsFilePathTemplates([], '${workspaceFolder}/.tags', DEFAULT_TAGS_FILE_PATH_TEMPLATE);
        assert.deepStrictEqual(result, ['${workspaceFolder}/.tags']);
    });

    test('uses default value when both settings are empty', () => {
        const result = pickInitialTagsFilePathTemplates([], undefined, DEFAULT_TAGS_FILE_PATH_TEMPLATE);
        assert.deepStrictEqual(result, ['${workspaceFolder}/.tags']);
    });

    test('does not override existing tagsFilePaths', () => {
        const result = pickInitialTagsFilePathTemplates(
            [' ${workspaceFolder}/a.tags ', '${workspaceFolder}/a.tags', '${workspaceFolder}/b.tags'],
            '${workspaceFolder}/legacy.tags',
            DEFAULT_TAGS_FILE_PATH_TEMPLATE
        );
        assert.deepStrictEqual(result, ['${workspaceFolder}/a.tags', '${workspaceFolder}/b.tags']);
    });

    test('resolves workspace variables and deduplicates absolute paths', () => {
        const rootPath = path.resolve('workspace-root');
        const result = resolveTagsFilePaths(
            ['${workspaceFolder}/.tags', './backend/.tags', '${workspaceFolder}/.tags'],
            rootPath
        );

        assert.deepStrictEqual(result, [
            path.join(rootPath, '.tags'),
            path.join(rootPath, 'backend', '.tags')
        ]);
    });

    test('dedupes symbols by name, file and line', () => {
        const symbols = [
            { name: 'foo', file: '/a.ts', line: 10 },
            { name: 'foo', file: '/a.ts', line: 10 },
            { name: 'foo', file: '/a.ts', line: 11 },
            { name: 'bar', file: '/a.ts', line: 10 }
        ];

        const result = dedupeSymbolsByIdentity(symbols);

        assert.deepStrictEqual(result, [
            { name: 'foo', file: '/a.ts', line: 10 },
            { name: 'foo', file: '/a.ts', line: 11 },
            { name: 'bar', file: '/a.ts', line: 10 }
        ]);
    });

    test('normalizes and deduplicates path templates', () => {
        const result = normalizeTagsFilePathTemplates([
            '',
            ' ',
            ' ${workspaceFolder}/.tags ',
            '${workspaceFolder}/.tags',
            '${workspaceFolder}/backend.tags'
        ]);

        assert.deepStrictEqual(result, [
            '${workspaceFolder}/.tags',
            '${workspaceFolder}/backend.tags'
        ]);
    });

    test('returns empty array when all path templates are empty', () => {
        const result = normalizeTagsFilePathTemplates(['', ' ', '\t']);
        assert.deepStrictEqual(result, []);
    });

    test('normalization preserves first-seen order', () => {
        const result = normalizeTagsFilePathTemplates([
            ' ${workspaceFolder}/b.tags ',
            '${workspaceFolder}/a.tags',
            '${workspaceFolder}/b.tags'
        ]);
        assert.deepStrictEqual(result, [
            '${workspaceFolder}/b.tags',
            '${workspaceFolder}/a.tags'
        ]);
    });

    test('legacy path value is trimmed when initializing paths', () => {
        const result = pickInitialTagsFilePathTemplates(
            [],
            '   ${workspaceFolder}/legacy.tags   ',
            DEFAULT_TAGS_FILE_PATH_TEMPLATE
        );
        assert.deepStrictEqual(result, ['${workspaceFolder}/legacy.tags']);
    });

    test('resolving paths deduplicates equivalent absolute paths', () => {
        const rootPath = path.resolve('workspace-root');
        const absoluteDefaultPath = path.join(rootPath, '.tags');
        const result = resolveTagsFilePaths(
            ['${workspaceFolder}/.tags', absoluteDefaultPath],
            rootPath
        );
        assert.deepStrictEqual(result, [absoluteDefaultPath]);
    });

    test('dedupeSymbolsByIdentity keeps first symbol when identity collides', () => {
        const symbols = [
            { name: 'foo', file: '/a.ts', line: 10, kind: 'f' },
            { name: 'foo', file: '/a.ts', line: 10, kind: 'v' }
        ];

        const result = dedupeSymbolsByIdentity(symbols);

        assert.deepStrictEqual(result, [{ name: 'foo', file: '/a.ts', line: 10, kind: 'f' }]);
    });

    test('resolveTagsFilePaths returns empty array when no templates provided', () => {
        assert.deepStrictEqual(resolveTagsFilePaths([], path.resolve('workspace-root')), []);
    });
});

suite('Tags Migration Decision', () => {
    test('pickLegacyPathConfigScope returns workspaceFolder when workspaceFolderValue present', () => {
        assert.strictEqual(
            pickLegacyPathConfigScope({ workspaceFolderValue: '${workspaceFolder}/x.tags' }),
            'workspaceFolder'
        );
    });

    test('pickLegacyPathConfigScope returns workspace when only workspaceValue present', () => {
        assert.strictEqual(
            pickLegacyPathConfigScope({ workspaceValue: '${workspaceFolder}/x.tags' }),
            'workspace'
        );
    });

    test('pickLegacyPathConfigScope returns global when only globalValue present', () => {
        assert.strictEqual(
            pickLegacyPathConfigScope({ globalValue: '${workspaceFolder}/x.tags' }),
            'global'
        );
    });

    test('pickLegacyPathConfigScope falls back to workspaceFolder when nothing set', () => {
        assert.strictEqual(pickLegacyPathConfigScope(undefined), 'workspaceFolder');
        assert.strictEqual(pickLegacyPathConfigScope({}), 'workspaceFolder');
    });

    test('decideTagsFilePathMigration is no-op when current paths already set', () => {
        const decision = decideTagsFilePathMigration(
            [' ${workspaceFolder}/a.tags ', '${workspaceFolder}/a.tags', '${workspaceFolder}/b.tags'],
            { defaultValue: DEFAULT_TAGS_FILE_PATH_TEMPLATE }
        );
        assert.deepStrictEqual(decision, {
            kind: 'no-op',
            paths: ['${workspaceFolder}/a.tags', '${workspaceFolder}/b.tags']
        });
    });

    test('decideTagsFilePathMigration initializes from custom legacy value', () => {
        const decision = decideTagsFilePathMigration(
            [],
            {
                workspaceFolderValue: '${workspaceFolder}/custom.tags',
                defaultValue: DEFAULT_TAGS_FILE_PATH_TEMPLATE
            }
        );
        assert.deepStrictEqual(decision, {
            kind: 'initialize',
            paths: ['${workspaceFolder}/custom.tags'],
            scope: 'workspaceFolder'
        });
    });

    test('decideTagsFilePathMigration uses default when legacy value equals default', () => {
        const decision = decideTagsFilePathMigration(
            [],
            { globalValue: DEFAULT_TAGS_FILE_PATH_TEMPLATE, defaultValue: DEFAULT_TAGS_FILE_PATH_TEMPLATE }
        );
        assert.deepStrictEqual(decision, {
            kind: 'initialize',
            paths: [DEFAULT_TAGS_FILE_PATH_TEMPLATE],
            scope: 'global'
        });
    });

    test('decideTagsFilePathMigration is no-op on fresh install with no legacy value', () => {
        const decision = decideTagsFilePathMigration([], undefined);
        assert.deepStrictEqual(decision, {
            kind: 'no-op',
            paths: [DEFAULT_TAGS_FILE_PATH_TEMPLATE]
        });
    });

    test('decideTagsFilePathMigration assigns workspace scope from legacy workspaceValue', () => {
        const decision = decideTagsFilePathMigration(
            [],
            { workspaceValue: '${workspaceFolder}/ws.tags', defaultValue: DEFAULT_TAGS_FILE_PATH_TEMPLATE }
        );
        assert.deepStrictEqual(decision, {
            kind: 'initialize',
            paths: ['${workspaceFolder}/ws.tags'],
            scope: 'workspace'
        });
    });
});
