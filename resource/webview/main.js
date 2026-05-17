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
const toggleButton = document.getElementById('toggleSearchMode');

let isPartialMatchEnabled = false;

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
    }
}

let debouncedSearch = debounce(performSearch, {{DEBOUNCE_TIME}});

searchInput.addEventListener('input', () => debouncedSearch());

toggleButton.addEventListener('click', () => {
    isPartialMatchEnabled = !isPartialMatchEnabled;
    vscode.postMessage({ command: 'changeSearchMode', mode: isPartialMatchEnabled });

    toggleButton.classList.toggle('active', isPartialMatchEnabled);
    toggleButton.title = isPartialMatchEnabled
        ? 'Partial match mode (activated)'
        : 'Partial match mode';

    // Trigger an immediate search if there is text in the box.
    if (searchInput.value.trim()) {
        debouncedSearch();
    }
});

window.addEventListener('message', (event) => {
    const message = event.data;
    switch (message.command) {
        case 'updateDebounceTime':
            debouncedSearch = debounce(performSearch, message.value);
            break;
        case 'updateResults': {
            const results = message.results;
            const query = message.query;
            resultsList.innerHTML = '';

            if (results.length > 0) {
                statusDiv.textContent = `搜尋 "${query}"，找到 ${results.length} 個結果：`;
                results.forEach((result) => {
                    const li = document.createElement('li');

                    const iconSpan = document.createElement('span');
                    iconSpan.className = `codicon codicon-${codiconClassForKind(result.kind)} symbol-icon`;
                    iconSpan.title = describeKind(result.kind);
                    iconSpan.setAttribute('aria-label', describeKind(result.kind));
                    li.appendChild(iconSpan);

                    li.appendChild(document.createTextNode(result.label));
                    li.appendChild(document.createTextNode(': '));

                    const fileNameSpan = document.createElement('span');
                    fileNameSpan.className = 'file-name';
                    fileNameSpan.textContent = result.fileName;
                    li.appendChild(fileNameSpan);

                    li.addEventListener('click', () => {
                        vscode.postMessage({ command: 'openFile', symbol: result });
                    });
                    resultsList.appendChild(li);
                });
            } else {
                statusDiv.textContent = `搜尋 "${query}"，未找到結果。`;
            }
            break;
        }
        case 'focusSearchInput':
            searchInput.focus();
            break;
    }
});
