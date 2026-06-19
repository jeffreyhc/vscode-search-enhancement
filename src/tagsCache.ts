import * as fs from 'fs';

/**
 * Per-file parse cache keyed by absolute path. Cached entries are invalidated
 * automatically when the file's mtime changes, so callers do not need to
 * subscribe to a file watcher to stay correct — they just call get() and the
 * cache decides whether to reparse.
 *
 * `get()` returns the parsed value together with a `wasCached` flag so
 * profiling callers can distinguish cache hits from re-parses without
 * threading separate state through the cache. Non-profiling callers can
 * simply destructure `value`.
 */
export interface TagsCacheResult<T> {
    value: T;
    wasCached: boolean;
}

export interface TagsCache<T> {
    get(filePath: string): Promise<TagsCacheResult<T>>;
    invalidate(filePath: string): void;
    clear(): void;
    size(): number;
}

interface CacheEntry<T> {
    mtimeMs: number;
    value: T;
}

interface PendingEntry<T> {
    mtimeMs: number;
    promise: Promise<CacheEntry<T>>;
}

export function createTagsCache<T>(parse: (filePath: string) => Promise<T>): TagsCache<T> {
    const cache = new Map<string, CacheEntry<T>>();
    const pending = new Map<string, PendingEntry<T>>();
    let version = 0;

    return {
        async get(filePath: string): Promise<TagsCacheResult<T>> {
            const stat = await fs.promises.stat(filePath);
            const cached = cache.get(filePath);
            if (cached && cached.mtimeMs === stat.mtimeMs) {
                return { value: cached.value, wasCached: true };
            }

            const pendingEntry = pending.get(filePath);
            if (pendingEntry && pendingEntry.mtimeMs === stat.mtimeMs) {
                const entry = await pendingEntry.promise;
                return { value: entry.value, wasCached: false };
            }

            const parseVersion = version;
            const parsePromise = (async (): Promise<CacheEntry<T>> => {
                const value = await parse(filePath);
                const entry = { mtimeMs: stat.mtimeMs, value };
                if (version === parseVersion) {
                    cache.set(filePath, entry);
                }
                return entry;
            })();
            pending.set(filePath, { mtimeMs: stat.mtimeMs, promise: parsePromise });

            try {
                const entry = await parsePromise;
                return { value: entry.value, wasCached: false };
            } finally {
                const currentPending = pending.get(filePath);
                if (currentPending?.promise === parsePromise) {
                    pending.delete(filePath);
                }
            }
        },
        invalidate(filePath: string): void {
            version += 1;
            cache.delete(filePath);
            pending.delete(filePath);
        },
        clear(): void {
            version += 1;
            cache.clear();
            pending.clear();
        },
        size(): number {
            return cache.size;
        }
    };
}
