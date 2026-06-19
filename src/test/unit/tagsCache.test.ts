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
        assert.deepStrictEqual(first.value, [1]);
        assert.strictEqual(first.wasCached, false, 'first call is a miss');
        assert.strictEqual(second.wasCached, true, 'second call is a hit');
        assert.strictEqual(first.value, second.value, 'cached calls should return the same reference');
    });

    test('coalesces concurrent first calls for the same path into one parse', async () => {
        const file = path.join(tempDir, 'concurrent.tags');
        fs.writeFileSync(file, 'foo\tconcurrent.c\t1\n', 'utf8');

        let parseCount = 0;
        let releaseParse: (() => void) | undefined;
        let firstParseStarted: (() => void) | undefined;
        const parseGate = new Promise<void>(resolve => {
            releaseParse = resolve;
        });
        const firstParseStartedGate = new Promise<void>(resolve => {
            firstParseStarted = resolve;
        });
        const parsedValue = ['parsed'];

        const cache = createTagsCache<string[]>(async () => {
            parseCount += 1;
            if (parseCount === 1) {
                firstParseStarted?.();
            }
            await parseGate;
            return parsedValue;
        });

        const firstPromise = cache.get(file);
        await firstParseStartedGate;
        const secondPromise = cache.get(file);

        await new Promise(resolve => setTimeout(resolve, 50));
        releaseParse?.();
        const [first, second] = await Promise.all([firstPromise, secondPromise]);

        assert.strictEqual(parseCount, 1, 'concurrent misses should share one parser invocation');
        assert.strictEqual(first.wasCached, false, 'the parser result is a miss');
        assert.strictEqual(second.wasCached, false, 'the shared in-flight result is still a miss');
        assert.strictEqual(first.value, parsedValue);
        assert.strictEqual(second.value, parsedValue);
        assert.strictEqual(first.value, second.value, 'both callers should receive the same parsed reference');
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

        assert.strictEqual(first.value, 1);
        assert.strictEqual(first.wasCached, false);
        assert.strictEqual(second.value, 2, 'mtime change should trigger a reparse');
        assert.strictEqual(second.wasCached, false, 'mtime change is a miss, not a hit');
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

        const r1a = await cache.get(file1);
        const r2 = await cache.get(file2);
        const r1b = await cache.get(file1);

        assert.deepStrictEqual(seen, [file1, file2], 'each unique path is parsed exactly once');
        assert.strictEqual(cache.size(), 2);
        assert.strictEqual(r1a.wasCached, false);
        assert.strictEqual(r2.wasCached, false);
        assert.strictEqual(r1b.wasCached, true, 'second call on file1 is a hit');
    });

    test('invalidate forces a reparse for the next call', async () => {
        const file = path.join(tempDir, 'e.tags');
        fs.writeFileSync(file, 'foo\n', 'utf8');

        let parseCount = 0;
        const cache = createTagsCache<number>(async () => {
            parseCount += 1;
            return parseCount;
        });

        const before = await cache.get(file);
        cache.invalidate(file);
        const after = await cache.get(file);

        assert.strictEqual(parseCount, 2);
        assert.strictEqual(before.wasCached, false);
        assert.strictEqual(after.wasCached, false, 'invalidated entry is a miss next time');
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
