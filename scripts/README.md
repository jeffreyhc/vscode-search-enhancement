# scripts/

Developer utilities. Not shipped in the published `.vsix` (excluded via
[`.vscodeignore`](../.vscodeignore)).

## bench-search.js

Headless bench for the extension's search hot path. Imports the compiled
modules from `out/` and exercises them against a real ctags index file,
reporting per-stage p50/p95 timings.

Measures the **extension-side compute path** (parse, dedupe, filter,
build-results) only. Webview DOM render is not included because it needs
a real VS Code window. For end-to-end profiling, enable the
`searchEnhancement.profileSearch` setting and watch the "Search
Enhancement" output channel in a debug-extension host.

### Generate a fixture

The bench needs a real `.tags` file. Two convenient options:

```sh
# Option A: FreeRTOS-Kernel — well-aligned with typical workloads
git clone --depth=1 https://github.com/FreeRTOS/FreeRTOS-Kernel.git /tmp/freertos-kernel
ctags -R --fields=+K -f /tmp/freertos-kernel/.tags /tmp/freertos-kernel

# Option B: any local repo you already have
ctags -R --fields=+K -f /path/to/repo/.tags /path/to/repo
```

### Run

```sh
npm run compile
node scripts/bench-search.js /tmp/freertos-kernel/.tags
```

Output is a table of per-stage p50/p95 in milliseconds across the
following query mix (each run in both strict and partial modes):

| name           | query             | exercises                       |
|----------------|-------------------|---------------------------------|
| single-short   | `x`               | very large M, token-only        |
| single-long    | `port`            | medium M, token-only            |
| multi-token    | `port nvic`       | multi-clause AND                |
| phrase         | `port_NVIC`       | phrase branch                   |
| phrase-strict  | `port_NVIC_int`   | multi-segment phrase            |
| miss           | `zzzzzz`          | full scan miss, sanity floor    |

Knobs at the top of the script: `WARMUP_RUNS` (3) and `MEASURE_RUNS` (10).
