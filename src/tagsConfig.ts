import * as path from 'path';

export const DEFAULT_TAGS_FILE_PATH_TEMPLATE = '${workspaceFolder}/.tags';

interface SymbolIdentity {
    name: string;
    file: string;
    line: number;
}

export function normalizeTagsFilePathTemplates(pathTemplates: string[]): string[] {
    const seen = new Set<string>();
    const normalized: string[] = [];

    for (const template of pathTemplates) {
        const trimmed = template.trim();
        if (!trimmed || seen.has(trimmed)) {
            continue;
        }
        seen.add(trimmed);
        normalized.push(trimmed);
    }

    return normalized;
}

export function pickInitialTagsFilePathTemplates(
    pathTemplates: string[],
    legacyValue: string | undefined,
    legacyDefaultValue: string | undefined
): string[] {
    const normalizedCurrentPaths = normalizeTagsFilePathTemplates(pathTemplates);
    if (normalizedCurrentPaths.length > 0) {
        return normalizedCurrentPaths;
    }

    const defaultTemplate = (legacyDefaultValue ?? DEFAULT_TAGS_FILE_PATH_TEMPLATE).trim();
    const trimmedLegacyValue = legacyValue?.trim();
    const chosenTemplate = trimmedLegacyValue && trimmedLegacyValue !== defaultTemplate
        ? trimmedLegacyValue
        : defaultTemplate;

    return [chosenTemplate];
}

export function resolveTagsFilePaths(pathTemplates: string[], rootPath: string): string[] {
    const seen = new Set<string>();
    const resolvedPaths: string[] = [];

    for (const template of normalizeTagsFilePathTemplates(pathTemplates)) {
        const withWorkspaceFolder = template.replace(/\$\{workspaceFolder\}/g, rootPath);
        const absolutePath = path.isAbsolute(withWorkspaceFolder)
            ? path.normalize(withWorkspaceFolder)
            : path.resolve(rootPath, withWorkspaceFolder);

        if (seen.has(absolutePath)) {
            continue;
        }
        seen.add(absolutePath);
        resolvedPaths.push(absolutePath);
    }

    return resolvedPaths;
}

export function dedupeSymbolsByIdentity<T extends SymbolIdentity>(symbols: T[]): T[] {
    const seen = new Set<string>();
    const deduped: T[] = [];

    for (const symbol of symbols) {
        const key = `${symbol.name}|${symbol.file}|${symbol.line}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        deduped.push(symbol);
    }

    return deduped;
}
