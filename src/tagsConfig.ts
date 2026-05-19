import * as path from 'path';

export const DEFAULT_TAGS_FILE_PATH_TEMPLATE = '${workspaceFolder}/.tags';

export type LegacyPathConfigScope = 'workspaceFolder' | 'workspace' | 'global';

export interface LegacyPathInspect {
    workspaceFolderValue?: string;
    workspaceValue?: string;
    globalValue?: string;
    defaultValue?: string;
}

export type MigrationDecision =
    | { kind: 'no-op'; paths: string[] }
    | { kind: 'initialize'; paths: string[]; scope: LegacyPathConfigScope };

export interface ConfigChangeEffect {
    debounceTime?: number;
    tagsFilePaths?: string[];
    profileSearch?: boolean;
    precomputeSegments?: boolean;
}

export const DEFAULT_DEBOUNCE_TIME_MS = 600;

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

export function pickLegacyPathConfigScope(inspected: LegacyPathInspect | undefined): LegacyPathConfigScope {
    if (inspected?.workspaceFolderValue !== undefined) {
        return 'workspaceFolder';
    }
    if (inspected?.workspaceValue !== undefined) {
        return 'workspace';
    }
    if (inspected?.globalValue !== undefined) {
        return 'global';
    }
    return 'workspaceFolder';
}

export function decideTagsFilePathMigration(
    currentPaths: string[],
    legacyInspect: LegacyPathInspect | undefined
): MigrationDecision {
    const normalizedCurrent = normalizeTagsFilePathTemplates(currentPaths);
    if (normalizedCurrent.length > 0) {
        return { kind: 'no-op', paths: normalizedCurrent };
    }

    const legacyValue =
        legacyInspect?.workspaceFolderValue ??
        legacyInspect?.workspaceValue ??
        legacyInspect?.globalValue;

    const resolvedPaths = pickInitialTagsFilePathTemplates(
        normalizedCurrent,
        legacyValue,
        legacyInspect?.defaultValue
    );

    // Fresh install with no legacy value → run with the in-memory default
    // without persisting anything. Avoids auto-writing user settings and
    // sidesteps VS Code rejecting WorkspaceFolder-scope writes for this key.
    if (legacyValue === undefined) {
        return { kind: 'no-op', paths: resolvedPaths };
    }

    return {
        kind: 'initialize',
        paths: resolvedPaths,
        scope: pickLegacyPathConfigScope(legacyInspect)
    };
}

export function deriveConfigChangeEffect(
    event: { affectsConfiguration: (key: string) => boolean },
    config: { get: <T>(key: string, defaultValue: T) => T }
): ConfigChangeEffect {
    const effect: ConfigChangeEffect = {};

    if (event.affectsConfiguration('searchEnhancement.debounceTime')) {
        effect.debounceTime = config.get<number>('debounceTime', DEFAULT_DEBOUNCE_TIME_MS);
    }
    if (event.affectsConfiguration('searchEnhancement.tagsFilePaths')) {
        effect.tagsFilePaths = config.get<string[]>('tagsFilePaths', []);
    }
    if (event.affectsConfiguration('searchEnhancement.profileSearch')) {
        effect.profileSearch = config.get<boolean>('profileSearch', false);
    }
    if (event.affectsConfiguration('searchEnhancement.precomputeSegments')) {
        effect.precomputeSegments = config.get<boolean>('precomputeSegments', true);
    }

    return effect;
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
