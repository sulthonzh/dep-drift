# dep-drift

Detect dependency drift between `package.json` ranges and actually installed versions.

Ever run `npm install` and wonder if your `node_modules` is still in sync with what `package.json` says? This tool tells you.

## Why?

- `npm ls` shows you the tree, but doesn't clearly flag **drift** — packages that are installed at versions outside your declared range
- CI pipelines break silently when local `node_modules` drifts from `package.json`
- Lockfile conflicts can leave you with unexpected versions
- You want a quick health check, not a full audit

## Install

```bash
npm install -g dep-drift
# or use without installing
npx dep-drift
```

## Usage

```bash
# Full report in current directory
dep-drift

# Only show problems (great for CI)
dep-drift --drift-only

# JSON output for scripts
dep-drift --json

# Check a different project
dep-drift --dir ../other-project

# Only check production deps
dep-drift --deps-only

# Quiet mode — hide in-range deps
dep-drift --quiet
```

## Output

```
  dep-drift report

  Total deps:    24
  In range:      20
  Out of range:  2
  Not installed: 2

  Drifted / Out of range:
    🟠 lodash 4.18.0 (wanted ^4.17.0) — high [dependencies]
    🟡 jest 29.7.0 (wanted ^29.0.0) — medium [devDependencies]

  Missing:
    ❌ axios (wanted ^1.6.0) [dependencies]
    ❌ typescript (wanted ^5.3.0) [devDependencies]
```

### Drift Levels

| Icon | Level | Meaning |
|------|-------|---------|
| 🟢 | low | Minor patch drift, probably fine |
| 🟡 | medium | 3-5 versions ahead, worth checking |
| 🟠 | high | 6+ versions ahead, investigate |
| 🔴 | major | Different major version, likely breaking |
| ❌ | missing | Not installed at all |

## Programmatic API

```js
const { analyzeDeps, jsonReport } = require('dep-drift');

const results = analyzeDeps(pkgJson, './node_modules', {
  depTypes: ['dependencies', 'devDependencies']
});

const report = jsonReport(results);
console.log(`${report.outOfRange} packages out of range`);
```

### API

- `analyzeDeps(pkgJson, nodeModulesDir, opts)` — returns array of dep results
- `jsonReport(results)` — structured report object
- `textReport(results, opts)` — prints text report to stdout
- `satisfiesRange(version, range)` — check if version satisfies a semver range
- `cmpVersions(a, b)` — compare two versions
- `parseVersion(v)` — parse version string to `{major, minor, patch}`

## CI Integration

```yaml
# GitHub Actions
- name: Check dependency drift
  run: npx dep-drift --drift-only
```

Exit code is `1` if any packages are out of range or missing, `0` if everything is clean.

## Features

- **Zero dependencies** — no supply chain risk
- **All major range types** — caret, tilde, exact, comparators, x-ranges, hyphens, or-ranges
- **Drift severity** — not just "in/out" but how far
- **JSON output** — pipe into jq, scripts, dashboards
- **CI ready** — non-zero exit on drift, `--drift-only` for clean reports

## License

MIT
