import * as assert from 'assert';
import * as path from 'path';
import {
    DEFAULT_TAGS_FILE_PATH_TEMPLATE,
    dedupeSymbolsByIdentity,
    normalizeTagsFilePathTemplates,
    pickInitialTagsFilePathTemplates,
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
});
