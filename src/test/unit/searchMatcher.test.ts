import * as assert from 'assert';
import {
    matchesAllClauses,
    matchesPhrase,
    normalizeSymbolSegments,
    parseQueryClauses
} from '../../searchMatcher';

suite('Search Matcher', () => {
    test('strict token search matches A_B_D_C_F and A_B_C_F_Q for A B C', () => {
        const clauses = parseQueryClauses('A B C');

        assert.strictEqual(matchesAllClauses('A_B_D_C_F', clauses, false), true);
        assert.strictEqual(matchesAllClauses('A_B_C_F_Q', clauses, false), true);
    });

    test('strict phrase search only matches contiguous full segments', () => {
        const clauses = parseQueryClauses('A_B_C');

        assert.strictEqual(matchesAllClauses('A_B_D_C_F', clauses, false), false);
        assert.strictEqual(matchesAllClauses('A_B_C_F_Q', clauses, false), true);
    });

    test('strict phrase search can match phrase in the middle', () => {
        const clauses = parseQueryClauses('A_B_C');

        assert.strictEqual(matchesAllClauses('X_A_B_C_Y', clauses, false), true);
    });

    test('partial phrase search allows segment-level partial match but keeps contiguity', () => {
        const clauses = parseQueryClauses('A_B_C');

        assert.strictEqual(matchesAllClauses('A_B_CD_F', clauses, false), false);
        assert.strictEqual(matchesAllClauses('A_B_CX_F', clauses, false), false);
        assert.strictEqual(matchesAllClauses('A_B_CD_F', clauses, true), true);
        assert.strictEqual(matchesAllClauses('A_B_CX_F', clauses, true), true);
    });

    test('partial phrase search still rejects non-contiguous segments', () => {
        const clauses = parseQueryClauses('A_B_C');

        assert.strictEqual(matchesAllClauses('A_B_D_C_F', clauses, true), false);
    });

    test('mixed phrase and token clauses use AND semantics', () => {
        const clauses = parseQueryClauses('A_B_C D');

        assert.strictEqual(matchesAllClauses('A_B_C_D_F', clauses, false), true);
        assert.strictEqual(matchesAllClauses('X_A_B_C_Y_D', clauses, false), true);
        assert.strictEqual(matchesAllClauses('A_B_C_F_Q', clauses, false), false);
        assert.strictEqual(matchesAllClauses('A_B_D_C_F', clauses, false), false);
    });

    test('query parsing normalizes repeated underscores and spaces', () => {
        const clauses = parseQueryClauses('  A__B___C   D  ');

        assert.deepStrictEqual(clauses, [
            { kind: 'phrase', parts: ['a', 'b', 'c'] },
            { kind: 'token', parts: ['d'] }
        ]);
    });

    test('empty or whitespace query returns no clauses', () => {
        assert.deepStrictEqual(parseQueryClauses(''), []);
        assert.deepStrictEqual(parseQueryClauses('    '), []);
    });

    test('symbol normalization removes empty underscore segments', () => {
        assert.deepStrictEqual(normalizeSymbolSegments('A__B___C'), ['a', 'b', 'c']);
    });

    test('phrase does not match when symbol segments are shorter than phrase', () => {
        assert.strictEqual(matchesPhrase(['a', 'b'], ['a', 'b', 'c'], false), false);
        assert.strictEqual(matchesPhrase(['a', 'b'], ['a', 'b', 'c'], true), false);
    });

    test('empty clauses are treated as match-all', () => {
        assert.strictEqual(matchesAllClauses('A_B_C', [], false), true);
    });

    test('partial token clause matches segment substring', () => {
        const clauses = parseQueryClauses('foo');

        assert.strictEqual(matchesAllClauses('A_FOOBAR_B', clauses, true), true);
        assert.strictEqual(matchesAllClauses('A_FOOBAR_B', clauses, false), false);
        assert.strictEqual(matchesAllClauses('A_BAR_C', clauses, true), false);
    });

    test('leading/trailing underscores in query degrade to a token clause', () => {
        assert.deepStrictEqual(parseQueryClauses('_foo'), [{ kind: 'token', parts: ['foo'] }]);
        assert.deepStrictEqual(parseQueryClauses('foo_'), [{ kind: 'token', parts: ['foo'] }]);
        assert.deepStrictEqual(parseQueryClauses('__'), []);
    });

    test('precomputed segments are used in place of re-normalizing the symbol name', () => {
        const clauses = parseQueryClauses('A B C');
        const precomputed = normalizeSymbolSegments('A_B_D_C_F');

        // 4th arg is the cached segments; the symbolName arg is intentionally
        // a sentinel that would NOT match if it were re-normalized — proving
        // the function uses the cached segments instead of recomputing.
        assert.strictEqual(matchesAllClauses('IRRELEVANT', clauses, false, precomputed), true);
        assert.strictEqual(matchesAllClauses('IRRELEVANT', parseQueryClauses('Z'), false, precomputed), false);
    });

    test('falls back to normalizeSymbolSegments when precomputed segments not supplied', () => {
        const clauses = parseQueryClauses('A B C');

        // Behaviour with 3 args (legacy callers, tests above) is unchanged
        // when 4th arg is omitted.
        assert.strictEqual(matchesAllClauses('A_B_D_C_F', clauses, false), true);
        assert.strictEqual(matchesAllClauses('A_B_D_C_F', clauses, false, undefined), true);
    });
});
