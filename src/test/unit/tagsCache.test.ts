import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createTagsCache } from '../../tagsCache';

suite('Tags Cache', () => {
    let tempDir: string;

    setup(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tags-cache-'));
    });

    teardown(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('parses on first call and reuses cached value on subsequent calls', async () => {
        const file = path.join(tempDir, 'a.tags');
        fs.writeFileSync(file, 'foo\ta.c\t1\n', 'utf8');

        let parseCount = 0;
        const cache = createTagsCache<number[]>(async () => {
            parseCount += 1;
            return [parseCount];
        });

        const first = await cache.get(file);
        const second = await cache.get(file);

        assert.strictEqual(parseCount, 1, 'parser should run only once');
        assert.deepStrictEqual(first, [1]);
        assert.strictEqual(first, second, 'cached calls should return the same reference');
    });

    test('reparses after the file mtime advances', async () => {
        const file = path.join(tempDir, 'b.tags');
        fs.writeFileSync(file, 'foo\tb.c\t1\n', 'utf8');

        let parseCount = 0;
        const cache = createTagsCache<number>(async () => {
            parseCount += 1;
            return parseCount;
        });

        const first = await cache.get(file);

        // Advance mtime explicitly so we don't rely on filesystem clock granularity.
        const future = new Date(Date.now() + 5_000);
        fs.utimesSync(file, future, future);

        const second = await cache.get(file);

        assert.strictEqual(first, 1);
        assert.strictEqual(second, 2, 'mtime change should trigger a reparse');
        assert.strictEqual(parseCount, 2);
    });

    test('caches each path independently', async () => {
        const file1 = path.join(tempDir, 'c.tags');
        const file2 = path.join(tempDir, 'd.tags');
        fs.writeFileSync(file1, 'one\n', 'utf8');
        fs.writeFileSync(file2, 'two\n', 'utf8');

        const seen: string[] = [];
        const cache = createTagsCache<string>(async (p) => {
            seen.push(p);
            return p;
        });

        await cache.get(file1);
        await cache.get(file2);
        await cache.get(file1);

        assert.deepStrictEqual(seen, [file1, file2], 'each unique path is parsed exactly once');
        assert.strictEqual(cache.size(), 2);
    });

    test('invalidate forces a reparse for the next call', async () => {
        const file = path.join(tempDir, 'e.tags');
        fs.writeFileSync(file, 'foo\n', 'utf8');

        let parseCount = 0;
        const cache = createTagsCache<number>(async () => {
            parseCount += 1;
            return parseCount;
        });

        await cache.get(file);
        cache.invalidate(file);
        await cache.get(file);

        assert.strictEqual(parseCount, 2);
    });

    test('clear empties every entry', async () => {
        const file1 = path.join(tempDir, 'f.tags');
        const file2 = path.join(tempDir, 'g.tags');
        fs.writeFileSync(file1, 'foo\n', 'utf8');
        fs.writeFileSync(file2, 'bar\n', 'utf8');

        const cache = createTagsCache<string>(async (p) => p);
        await cache.get(file1);
        await cache.get(file2);
        assert.strictEqual(cache.size(), 2);

        cache.clear();
        assert.strictEqual(cache.size(), 0);
    });
});
