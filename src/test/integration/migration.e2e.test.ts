import * as assert from 'assert';
import * as vscode from 'vscode';
import { decideTagsFilePathMigration } from '../../tagsConfig';

/**
 * E2E reproduction for the fresh-install migration bug introduced in 3fe0be0.
 *
 * On a brand new workspace (no `tagsFilePath`, no `tagsFilePaths` set anywhere),
 * the first call to ensureTagsFilePathsInitialized() reaches:
 *
 *     await scopedConfig.update("tagsFilePaths", [...], WorkspaceFolder);
 *
 * Two things go wrong:
 *
 * 1A — VS Code throws because `tagsFilePaths` is declared without
 *      `"scope": "resource"` in package.json, so it does not support being
 *      written to a folder scope. The async message handler rejects without a
 *      catch, so the user sees the search command silently do nothing.
 *
 * 1B — Even if the scope were allowed, the migration writes the default value
 *      into the workspace `.vscode/settings.json` for users who never opted in,
 *      which dirties their repo state.
 *
 * Both assertions below describe the *desired* behavior (no throw, no write),
 * so the test is currently RED and demonstrates the bug end-to-end inside a
 * real VS Code instance with a real workspace folder.
 */
suite('Migration E2E (fresh install)', () => {
    let folderUri: vscode.Uri;
    let originalGlobalPaths: string[] | undefined;
    let originalWorkspacePaths: string[] | undefined;
    let originalGlobalLegacy: string | undefined;
    let originalWorkspaceLegacy: string | undefined;

    suiteSetup(async function () {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders || folders.length === 0) {
            this.skip();
            return;
        }
        folderUri = folders[0].uri;

        const config = vscode.workspace.getConfiguration('searchEnhancement', folderUri);
        const inspectedPaths = config.inspect<string[]>('tagsFilePaths');
        originalGlobalPaths = inspectedPaths?.globalValue;
        originalWorkspacePaths = inspectedPaths?.workspaceValue;
        const inspectedLegacy = config.inspect<string>('tagsFilePath');
        originalGlobalLegacy = inspectedLegacy?.globalValue;
        originalWorkspaceLegacy = inspectedLegacy?.workspaceValue;

        // Reset to a fresh-install state for the scopes we are allowed to write to.
        // (WorkspaceFolder is intentionally skipped: the bug is precisely that
        // VS Code refuses writes to that scope for this setting.)
        await config.update('tagsFilePaths', undefined, vscode.ConfigurationTarget.Global);
        await config.update('tagsFilePaths', undefined, vscode.ConfigurationTarget.Workspace);
        await config.update('tagsFilePath', undefined, vscode.ConfigurationTarget.Global);
        await config.update('tagsFilePath', undefined, vscode.ConfigurationTarget.Workspace);
    });

    suiteTeardown(async () => {
        if (!folderUri) {
            return;
        }
        const config = vscode.workspace.getConfiguration('searchEnhancement', folderUri);
        await config.update('tagsFilePaths', originalGlobalPaths, vscode.ConfigurationTarget.Global);
        await config.update('tagsFilePaths', originalWorkspacePaths, vscode.ConfigurationTarget.Workspace);
        await config.update('tagsFilePath', originalGlobalLegacy, vscode.ConfigurationTarget.Global);
        await config.update('tagsFilePath', originalWorkspaceLegacy, vscode.ConfigurationTarget.Workspace);
    });

    test('fresh install must not throw and must not write tagsFilePaths anywhere', async () => {
        const config = vscode.workspace.getConfiguration('searchEnhancement', folderUri);

        const before = config.inspect<string[]>('tagsFilePaths');
        assert.strictEqual(before?.globalValue, undefined, 'precondition: globalValue empty');
        assert.strictEqual(before?.workspaceValue, undefined, 'precondition: workspaceValue empty');
        assert.strictEqual(before?.workspaceFolderValue, undefined, 'precondition: workspaceFolderValue empty');

        // Replicate the production migration call site exactly.
        const decision = decideTagsFilePathMigration(
            config.get<string[]>('tagsFilePaths', []),
            config.inspect<string>('tagsFilePath')
        );

        let migrationError: Error | undefined;
        if (decision.kind === 'initialize') {
            try {
                await config.update(
                    'tagsFilePaths',
                    decision.paths,
                    vscode.ConfigurationTarget.WorkspaceFolder
                );
            } catch (e) {
                migrationError = e as Error;
            }
        }

        // BUG #1A: throws on first run because tagsFilePaths is not "resource"-scoped.
        assert.strictEqual(
            migrationError,
            undefined,
            `BUG #1A: production migration throws on first search — ` +
                `the async message handler rejects silently and the user sees ` +
                `"search button does nothing". Error: ${migrationError?.message}`
        );

        // BUG #1B: even if the write were allowed, fresh install should not persist
        // the default into .vscode/settings.json.
        const after = vscode.workspace
            .getConfiguration('searchEnhancement', folderUri)
            .inspect<string[]>('tagsFilePaths');
        assert.strictEqual(
            after?.workspaceFolderValue,
            undefined,
            `BUG #1B: migration persisted defaults to workspace settings. ` +
                `workspaceFolderValue = ${JSON.stringify(after?.workspaceFolderValue)}`
        );
    });
});
