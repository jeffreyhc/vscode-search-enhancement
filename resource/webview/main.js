// Maps a ctags `kind` to a codicon class. Covers both Universal Ctags' default
// single-letter form for C/C++ AND the long-form names emitted with
// --fields=+K. The mapping follows VS Code outline view conventions. Unknown
// or undefined kinds fall back to symbol-misc.
const KIND_TO_CODICON = {
    // Single-letter (default)
    c: 'symbol-class',
    d: 'symbol-constant',
    e: 'symbol-enum-member',
    f: 'symbol-function',
    g: 'symbol-enum',
    h: 'symbol-file',
    m: 'symbol-field',
    n: 'symbol-namespace',
    p: 'symbol-method',
    s: 'symbol-struct',
    t: 'symbol-type-parameter',
    u: 'symbol-struct',
    v: 'symbol-variable',
    x: 'symbol-variable',
    l: 'symbol-variable',
    z: 'symbol-parameter',
    // Long-form (--fields=+K)
    class: 'symbol-class',
    macro: 'symbol-constant',
    enumerator: 'symbol-enum-member',
    function: 'symbol-function',
    enum: 'symbol-enum',
    header: 'symbol-file',
    member: 'symbol-field',
    namespace: 'symbol-namespace',
    prototype: 'symbol-method',
    struct: 'symbol-struct',
    typedef: 'symbol-type-parameter',
    union: 'symbol-struct',
    variable: 'symbol-variable',
    externvar: 'symbol-variable',
    local: 'symbol-variable',
    parameter: 'symbol-parameter'
};

function codiconClassForKind(kind) {
    return KIND_TO_CODICON[kind] || 'symbol-misc';
}

// Human-readable name shown in the icon's hover tooltip. Single-letter ctags
// kinds get expanded; long-form kinds (`function`, `variable`, ...) are
// already self-descriptive and pass through unchanged.
const KIND_TO_DESCRIPTION = {
    c: 'class',
    d: 'macro',
    e: 'enumerator',
    f: 'function',
    g: 'enum',
    h: 'header',
    m: 'member',
    n: 'namespace',
    p: 'function prototype',
    s: 'struct',
    t: 'typedef',
    u: 'union',
    v: 'variable',
    x: 'extern variable',
    l: 'local variable',
    z: 'function parameter'
};

function describeKind(kind) {
    if (!kind) {
        return 'unknown kind';
    }
    return KIND_TO_DESCRIPTION[kind] || kind;
}

const vscode = acquireVsCodeApi();
const searchInput = document.getElementById('search');
const statusDiv = document.getElementById('status');
const resultsList = document.getElementById('results');

// Initialised from the package.json `searchEnhancement.defaultGroupBy` setting
// via template substitution. Switched live by `setGroupBy` messages from the
// extension (driven by the panel's More Actions menu commands).
let groupByMode = '{{DEFAULT_GROUP_BY}}';

// Cached last result set so we can re-render when groupByMode changes without
// asking the extension to re-search.
let lastResults = [];
let lastQuery = '';

// Toggled by the extension via `setProfileEnabled`. When true, renderResults
// times itself and posts a `profileTiming` message so the extension can
// append the webview render time to its profile output. Off by default so
// normal usage pays no measurement overhead.
let profileEnabled = false;

function debounce(func, wait) {
    let timeout;
    return function (...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

function performSearch() {
    const query = searchInput.value.trim();
    if (query) {
        statusDiv.textContent = `正在搜尋 "${query}"...`;
        vscode.postMessage({ command: 'search', text: query });
    } else {
        statusDiv.textContent = '';
        resultsList.innerHTML = '';
        lastResults = [];
        lastQuery = '';
    }
}

let debouncedSearch = debounce(performSearch, {{DEBOUNCE_TIME}});

searchInput.addEventListener('input', () => debouncedSearch());

// --- Grouping helpers ---------------------------------------------------

function groupByFile(results) {
    const groups = new Map();
    for (const r of results) {
        let group = groups.get(r.filePath);
        if (!group) {
            group = {
                filePath: r.filePath,
                fileName: r.fileName,
                relativeDir: r.relativeDir || '',
                items: []
            };
            groups.set(r.filePath, group);
        }
        group.items.push(r);
    }
    return Array.from(groups.values());
}

function groupByName(results) {
    const groups = new Map();
    for (const r of results) {
        let group = groups.get(r.label);
        if (!group) {
            group = { name: r.label, items: [] };
            groups.set(r.label, group);
        }
        group.items.push(r);
    }
    return Array.from(groups.values());
}

// --- DOM helpers --------------------------------------------------------

function createIconSpan(kind) {
    const iconSpan = document.createElement('span');
    iconSpan.className = `codicon codicon-${codiconClassForKind(kind)} symbol-icon`;
    iconSpan.title = describeKind(kind);
    iconSpan.setAttribute('aria-label', describeKind(kind));
    return iconSpan;
}

function createDirSpan(filePath, relativeDir) {
    if (!relativeDir) {
        return null;
    }
    const dirSpan = document.createElement('span');
    dirSpan.className = 'file-dir';
    dirSpan.textContent = relativeDir;
    dirSpan.title = filePath;
    return dirSpan;
}

function createCountSpan(n) {
    const countSpan = document.createElement('span');
    countSpan.className = 'file-count';
    countSpan.textContent = ` (${n})`;
    return countSpan;
}

function createCollapsibleGroup(buildHeader, items, buildItem) {
    const groupLi = document.createElement('li');
    groupLi.className = 'file-group';

    const headerDiv = document.createElement('div');
    headerDiv.className = 'file-header';
    headerDiv.setAttribute('role', 'button');
    headerDiv.setAttribute('aria-expanded', 'true');

    const chevron = document.createElement('span');
    chevron.className = 'codicon codicon-chevron-down file-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    headerDiv.appendChild(chevron);

    buildHeader(headerDiv);

    const itemsUl = document.createElement('ul');
    itemsUl.className = 'file-items';
    for (const item of items) {
        itemsUl.appendChild(buildItem(item));
    }

    headerDiv.addEventListener('click', () => {
        const expanded = !groupLi.classList.toggle('collapsed');
        headerDiv.setAttribute('aria-expanded', String(expanded));
    });

    groupLi.appendChild(headerDiv);
    groupLi.appendChild(itemsUl);
    return groupLi;
}

// --- Renderers ----------------------------------------------------------

function renderGroupedByFile(results) {
    for (const group of groupByFile(results)) {
        const li = createCollapsibleGroup(
            (header) => {
                const nameSpan = document.createElement('span');
                nameSpan.className = 'file-name';
                nameSpan.textContent = group.fileName;
                header.appendChild(nameSpan);

                const dirSpan = createDirSpan(group.filePath, group.relativeDir);
                if (dirSpan) {
                    header.appendChild(dirSpan);
                }

                header.appendChild(createCountSpan(group.items.length));
            },
            group.items,
            (item) => {
                const row = document.createElement('li');
                row.className = 'symbol-row';
                // Set the tooltip on the row itself so it fires anywhere on
                // the row, not only over the text span (which is offset by
                // padding). The icon's own title still takes precedence when
                // hovering directly over the kind icon.
                row.title = item.label;
                row.appendChild(createIconSpan(item.kind));

                const labelSpan = document.createElement('span');
                labelSpan.className = 'symbol-label';
                labelSpan.textContent = item.label;
                row.appendChild(labelSpan);

                row.addEventListener('click', () => {
                    vscode.postMessage({ command: 'openFile', symbol: item });
                });
                return row;
            }
        );
        resultsList.appendChild(li);
    }
}

function renderGroupedByName(results) {
    for (const group of groupByName(results)) {
        const li = createCollapsibleGroup(
            (header) => {
                // Tooltip on the header itself so it fires anywhere along
                // the row, not only over the symbol-name span.
                header.title = group.name;

                // Use the first occurrence's kind for the header icon; in
                // practice all items in a name group share the same kind.
                header.appendChild(createIconSpan(group.items[0].kind));

                const nameSpan = document.createElement('span');
                nameSpan.className = 'symbol-group-name';
                nameSpan.textContent = group.name;
                header.appendChild(nameSpan);

                header.appendChild(createCountSpan(group.items.length));
            },
            group.items,
            (item) => {
                const row = document.createElement('li');
                row.className = 'symbol-row location-row';

                const fileNameSpan = document.createElement('span');
                fileNameSpan.className = 'file-name';
                fileNameSpan.textContent = item.fileName;
                row.appendChild(fileNameSpan);

                const dirSpan = createDirSpan(item.filePath, item.relativeDir);
                if (dirSpan) {
                    row.appendChild(dirSpan);
                }

                row.addEventListener('click', () => {
                    vscode.postMessage({ command: 'openFile', symbol: item });
                });
                return row;
            }
        );
        resultsList.appendChild(li);
    }
}

function renderResults(results, query) {
    resultsList.innerHTML = '';
    if (!results || results.length === 0) {
        statusDiv.textContent = query ? `搜尋 "${query}"，未找到結果。` : '';
        return;
    }
    statusDiv.textContent = `搜尋 "${query}"，找到 ${results.length} 個結果：`;
    if (groupByMode === 'file') {
        renderGroupedByFile(results);
    } else {
        renderGroupedByName(results);
    }
}

// --- Message router -----------------------------------------------------

window.addEventListener('message', (event) => {
    const message = event.data;
    switch (message.command) {
        case 'updateDebounceTime':
            debouncedSearch = debounce(performSearch, message.value);
            break;
        case 'updateResults': {
            lastResults = message.results;
            lastQuery = message.query;
            // Time the render *only* on the search→render path; setGroupBy /
            // setPartialMatch re-renders are independent of the extension's
            // pending profile record and would emit stray timings.
            const t0 = profileEnabled ? performance.now() : 0;
            renderResults(lastResults, lastQuery);
            if (profileEnabled) {
                vscode.postMessage({
                    command: 'profileTiming',
                    renderMs: performance.now() - t0,
                    resultCount: lastResults ? lastResults.length : 0
                });
            }
            break;
        }
        case 'setGroupBy': {
            groupByMode = message.mode;
            renderResults(lastResults, lastQuery);
            break;
        }
        case 'setPartialMatch': {
            // Mode is already updated on the extension side; re-run the
            // current query so the result list reflects the new filter.
            if (searchInput.value.trim()) {
                debouncedSearch();
            }
            break;
        }
        case 'setProfileEnabled': {
            profileEnabled = !!message.enabled;
            break;
        }
        case 'focusSearchInput':
            searchInput.focus();
            break;
    }
});
