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

export function createTagsCache<T>(parse: (filePath: string) => Promise<T>): TagsCache<T> {
    const cache = new Map<string, CacheEntry<T>>();

    return {
        async get(filePath: string): Promise<TagsCacheResult<T>> {
            const stat = await fs.promises.stat(filePath);
            const cached = cache.get(filePath);
            if (cached && cached.mtimeMs === stat.mtimeMs) {
                return { value: cached.value, wasCached: true };
            }
            const value = await parse(filePath);
            cache.set(filePath, { mtimeMs: stat.mtimeMs, value });
            return { value, wasCached: false };
        },
        invalidate(filePath: string): void {
            cache.delete(filePath);
        },
        clear(): void {
            cache.clear();
        },
        size(): number {
            return cache.size;
        }
    };
}
