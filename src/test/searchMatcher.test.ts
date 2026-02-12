import * as assert from 'assert';
import { matchesAllClauses, parseQueryClauses } from '../searchMatcher';

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
});
