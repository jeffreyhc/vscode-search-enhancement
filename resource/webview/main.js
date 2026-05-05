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
