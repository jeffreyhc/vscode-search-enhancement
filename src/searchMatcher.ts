export interface QueryClause {
    kind: 'token' | 'phrase';
    parts: string[];
}

export function parseQueryClauses(query: string): QueryClause[] {
    const words = query
        .trim()
        .split(/\s+/)
        .filter(Boolean);

    const clauses: QueryClause[] = [];

    for (const rawWord of words) {
        const hasUnderscore = rawWord.includes('_');
        const normalizedParts = rawWord
            .split('_')
            .map(part => part.trim().toLowerCase())
            .filter(Boolean);

        if (normalizedParts.length === 0) {
            continue;
        }

        if (hasUnderscore && normalizedParts.length >= 2) {
            clauses.push({ kind: 'phrase', parts: normalizedParts });
            continue;
        }

        clauses.push({ kind: 'token', parts: [normalizedParts[0]] });
    }

    return clauses;
}

export function normalizeSymbolSegments(symbolName: string): string[] {
    return symbolName
        .toLowerCase()
        .split('_')
        .filter(Boolean);
}

export function matchesToken(symbolSegments: string[], token: string, isPartial: boolean): boolean {
    if (!token) {
        return false;
    }

    if (!isPartial) {
        return symbolSegments.some(segment => segment === token);
    }

    return symbolSegments.some(segment => segment.includes(token));
}

export function matchesPhrase(symbolSegments: string[], parts: string[], isPartial: boolean): boolean {
    if (parts.length === 0 || symbolSegments.length < parts.length) {
        return false;
    }

    const windowSize = parts.length;

    for (let start = 0; start <= symbolSegments.length - windowSize; start++) {
        const matched = parts.every((part, index) => {
            const segment = symbolSegments[start + index];
            return isPartial ? segment.includes(part) : segment === part;
        });

        if (matched) {
            return true;
        }
    }

    return false;
}

export function matchesClause(symbolSegments: string[], clause: QueryClause, isPartial: boolean): boolean {
    if (clause.kind === 'phrase') {
        return matchesPhrase(symbolSegments, clause.parts, isPartial);
    }

    return matchesToken(symbolSegments, clause.parts[0], isPartial);
}

/**
 * @param symbolName            Original symbol name. Used to derive segments
 *                              on the fly when `precomputedSegments` is not
 *                              supplied.
 * @param clauses               Parsed query clauses to match (AND semantics).
 * @param isPartial             When true, individual segments only need to
 *                              substring-match each part.
 * @param precomputedSegments   Optional, already-normalized segments produced
 *                              by `normalizeSymbolSegments(symbolName)`. When
 *                              callers cache this on the symbol (via
 *                              `getSymbolsFromTags`'s `precomputeSegments`
 *                              option) they can pass it here to skip the
 *                              per-search split/lowercase work — the dominant
 *                              cost on large indexes.
 */
export function matchesAllClauses(
    symbolName: string,
    clauses: QueryClause[],
    isPartial: boolean,
    precomputedSegments?: string[]
): boolean {
    const symbolSegments = precomputedSegments ?? normalizeSymbolSegments(symbolName);
    return clauses.every(clause => matchesClause(symbolSegments, clause, isPartial));
}
