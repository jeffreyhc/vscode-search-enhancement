**English** | [繁體中文](README.zh-TW.md)

![search-enhancement banner](resource/banner/search-enhancement-banner.png)

# search-enhancement

[![Marketplace](https://img.shields.io/visual-studio-marketplace/v/jeffreyhc.vscode-search-enhancement?label=marketplace)](https://marketplace.visualstudio.com/items?itemName=jeffreyhc.vscode-search-enhancement)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/jeffreyhc.vscode-search-enhancement)](https://marketplace.visualstudio.com/items?itemName=jeffreyhc.vscode-search-enhancement)
[![CI](https://github.com/jeffreyhc/vscode-search-enhancement/actions/workflows/node.js.yml/badge.svg)](https://github.com/jeffreyhc/vscode-search-enhancement/actions/workflows/node.js.yml)
[![License](https://img.shields.io/github/license/jeffreyhc/vscode-search-enhancement)](LICENSE)

Find any function, variable, or macro in million-line C/C++ codebases as fast as you can type. Multi-keyword search backed by [Universal Ctags](https://github.com/universal-ctags/ctags). Built for FreeRTOS, kernel, embedded, and legacy projects where IntelliSense is slow or unavailable.

> ⚡ **v0.5.0**: 30× faster on million-symbol indexes — 3 s → 100 ms warm cache. See [CHANGELOG](CHANGELOG.md).

## Features

Type space-separated keywords in the search box. Results are symbols whose name contains **all** keywords, regardless of the order you typed them. A *partial match* mode is also available — turn it on and any symbol whose name *partially* contains each keyword will surface.

![start to use](/resource/screenshots/start_to_use.png "start to use")

![idle](/resource/screenshots/idle.png "idle")

![searching](/resource/screenshots/searching.png "searching")

![search result](/resource/screenshots/search_result.png "search result")

![search result compare with vscode](/resource/screenshots/search_result_compare_with_vscode.png "search result compare with vscode")

![no search result](/resource/screenshots/no_result.png "no search result")

![partial match mode](/resource/screenshots/partial_match_mode.png "partial match mode")

## Why this over `Ctrl+T` (Go to Symbol in Workspace)?

VS Code's built-in symbol search uses the active Language Server. For C/C++ that means clangd or cpptools needs a complete project setup (`compile_commands.json`, IntelliSense database). For many real-world projects — FreeRTOS / Zephyr / Linux / vendor SDKs / legacy build systems — that setup is fragile, slow, or doesn't exist.

This extension reads from a [Universal Ctags](https://github.com/universal-ctags/ctags) index instead:

- **No build-system dependency.** If ctags can parse it, you can search it. No `compile_commands.json`, no LSP daemon, no IntelliSense database.
- **Multi-keyword AND search.** Type `task create` to find `vTaskCreateStatic`, `xTaskCreatePinnedToCore`, etc. — regardless of word order. Add underscores like `port_NVIC` for phrase matching.
- **Built for scale.** Million-symbol indexes search in ~100 ms warm cache; per-keystroke filtering does not block the UI.
- **Macros, typedefs, anything ctags knows.** Includes the symbols your LSP often misses.

## Installation

1. Install [Visual Studio Code](https://code.visualstudio.com/) v1.96 or newer
2. Search for `search-enhancement` in the Marketplace and install

## Requirements

The extension reads from a Ctags-generated symbol index. Set it up before first use:

1. Open a folder as a workspace
2. Install [Universal Ctags](https://github.com/universal-ctags/ctags). Pre-built binaries:
   - [Windows](https://github.com/universal-ctags/ctags-win32/tags)
   - [Linux](https://github.com/universal-ctags/ctags-nightly-build/tags)
   - [macOS](https://formulae.brew.sh/formula/universal-ctags)
3. From the workspace root, generate the index:
   ```sh
   ctags -R --languages=C,C++ --fields=+n --extras=+q -f .tags
   ```
   Adding the ctags directory to `PATH` makes this easier to re-run.

## Usage

1. Press `Ctrl` + `Shift` + `P` and run **Search Symbols by Keywords**, or focus the editor and press `Ctrl` + `Alt` + `F`. The search panel opens in the primary side bar (you can drag its icon to the secondary side bar).
2. Type space-separated keywords in the search box.
3. Click any result to open the file at the matching line.
4. Re-run ctags whenever your code changes — line numbers depend on the index being current.

## Settings

All settings live under the `searchEnhancement.*` namespace. Open the Settings UI (`Ctrl` + `,`) and search for *Search Enhancement*, or edit `settings.json` directly.

| Setting | Type | Default | Description |
|---|---|---|---|
| `tagsFilePaths` | `string[]` | `[]` (falls back to `${workspaceFolder}/.tags`) | One or more ctags index files. Absolute paths or `${workspaceFolder}/...` templates are both accepted. `resource`-scoped so each folder of a multi-root workspace can configure its own. |
| `debounceTime` | `number` | `600` | Milliseconds to wait after the last keystroke before firing a search. Lower = more responsive but more CPU; higher = laggier but cheaper. |
| `defaultGroupBy` | `"name"` \| `"file"` | `"name"` | Initial grouping of results when the panel opens. Can be switched live from the panel's More Actions (`...`) menu without reloading. |
| `precomputeSegments` | `boolean` | `true` | Precompute lowercased / underscore-split segments at parse time so per-keystroke filtering can skip the work. ~3–30× faster on large indexes; costs roughly 50–100 MB of resident memory per 1 million symbols. |
| `profileSearch` | `boolean` | `false` | Log per-stage timings to the **Search Enhancement** Output channel for each search. Use for diagnosing slow searches; leave off in normal use. |

### Tags file paths

- When `tagsFilePaths` is empty:
  - If the legacy `searchEnhancement.tagsFilePath` (deprecated) has a custom value, it is migrated into `tagsFilePaths[0]` and persisted to your settings.
  - Otherwise the default `${workspaceFolder}/.tags` is used at runtime **without modifying any settings file**.
- `searchEnhancement.tagsFilePath` (singular) is retained only for migration compatibility; new setups should use `tagsFilePaths`.

### Memory / speed trade-off (`precomputeSegments`)

The default (`true`) is tuned for typical dev machines and large codebases — on a 1.65 M-symbol index it cuts each warm-cache search from ~3 s to ~100 ms. If you index a smaller project or are on a memory-constrained machine, set it to `false` to save the per-symbol cache (~50–100 MB per 1 M symbols). Toggling takes effect on the next search; the parsed-tags cache is cleared automatically.

### Diagnosing slow searches (`profileSearch`)

Enable the setting, then open `View` → `Output` and pick **Search Enhancement** from the channel picker on the right. Each search appends a block like:

```
[14:32:05] Search "port" partial=false groupBy=name
  resolve paths            0.2ms
  tags cache              45.3ms  (1 files, 1 miss)
  dedupe                   0.0ms  (47288 symbols)
  filter                  18.7ms  (47288 → 137 matches)
  build results            0.4ms
  post message             0.1ms
  ---
  extension total         64.7ms
  webview render          12.5ms  (137 results)
  ---
  end-to-end total        77.2ms
```

The first search after VS Code starts (or after ctags re-runs) pays a one-time `tags cache` parse cost proportional to the index size; later searches reuse the parsed result.

## Contributing

Contributions, bug reports and feature requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## Developing

```sh
npm install
npm run compile
```

Press `F5` in VS Code to launch a development host with the extension loaded.

Tests:

```sh
npm test                  # unit + integration
npm run test:unit         # unit only — runs in plain Node, no VS Code needed
npm run test:integration  # e2e against a real VS Code instance
```

## License

This project is licensed under the [MIT](LICENSE) license.

## Acknowledgements

Icon adapted from [SVG Repo](https://www.svgrepo.com/).
