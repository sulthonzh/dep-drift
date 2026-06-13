#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

/**
 * dep-drift — Detect dependency drift between package.json ranges and installed versions.
 * Zero dependencies.
 */

// ── Semver helpers (minimal, no deps) ──────────────────────────────

function parseVersion(v) {
  const m = v.replace(/^v/, '').match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!m) return null;
  return { major: +m[1], minor: m[2] != null ? +m[2] : 0, patch: m[3] != null ? +m[3] : 0 };
}

function cmpVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return 0;
  if (pa.major !== pb.major) return pa.major - pb.major;
  if (pa.minor !== pb.minor) return pa.minor - pb.minor;
  return pa.patch - pb.patch;
}

function satisfiesRange(version, range) {
  const v = parseVersion(version);
  if (!v) return false;
  const r = range.trim();

  // Handle multiple ranges separated by ||
  const parts = r.split(/\s*\|\|\s*/);
  return parts.some(part => satisfiesSingleRange(version, part.trim()));
}

function satisfiesSingleRange(version, range) {
  const v = parseVersion(version);
  if (!v) return false;

  // Hyphen range: a.b.c - d.e.f (check before space split)
  const hyphen = range.match(/^(\d+\.\d+\.\d+)\s+-\s+(\d+\.\d+\.\d+)$/);
  if (hyphen) {
    return cmpVersions(version, hyphen[1]) >= 0 && cmpVersions(version, hyphen[2]) <= 0;
  }

  // Handle space-separated AND conditions (e.g., ">=1.0.0 <2.0.0")
  const conditions = range.split(/\s+/);
  if (conditions.length > 1 && !conditions[0].startsWith('^') && !conditions[0].startsWith('~')) {
    return conditions.every(c => satisfiesSingleRange(version, c));
  }

  // Exact version
  if (/^\d+\.\d+\.\d+$/.test(range)) {
    return version === range;
  }

  // Caret range ^a.b.c
  const caret = range.match(/^(\^)(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (caret) {
    const major = +caret[2];
    const minor = caret[3] != null ? +caret[3] : null;
    const patch = caret[4] != null ? +caret[4] : null;

    if (v.major !== major) return false;
    if (minor !== null && v.minor < minor) return false;
    if (minor !== null && patch !== null && v.minor === minor && v.patch < patch) return false;
    return true;
  }

  // Tilde range ~a.b.c
  const tilde = range.match(/^(~)(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (tilde) {
    const major = +tilde[2];
    const minor = tilde[3] != null ? +tilde[3] : 0;
    const patch = tilde[4] != null ? +tilde[4] : 0;

    if (v.major !== major) return false;
    if (v.minor !== minor) return false;
    if (patch !== null && v.patch < patch) return false;
    return true;
  }

  // Comparison operators
  const comp = range.match(/^(>=|<=|>|<|=)(\d+\.\d+\.\d+)/);
  if (comp) {
    const op = comp[1];
    const target = comp[2];
    const cmp = cmpVersions(version, target);
    switch (op) {
      case '>=': return cmp >= 0;
      case '<=': return cmp <= 0;
      case '>': return cmp > 0;
      case '<': return cmp < 0;
      case '=': return cmp === 0;
    }
  }

  // X-ranges: 1.x, 1.2.x, *, latest
  if (range === '*' || range === 'latest' || range === '') return true;

  const xrange = range.match(/^(\d+)(?:\.([xX*]))?(?:\.([xX*]))?$/);
  if (xrange) {
    const major = +xrange[1];
    const hasMinor = xrange[2] != null;
    const hasPatch = xrange[3] != null;

    if (!hasMinor || xrange[2] === 'x' || xrange[2] === 'X' || xrange[2] === '*') {
      return v.major === major;
    }
    return v.major === major && v.minor === +xrange[2];
  }

  // If we can't parse, assume it satisfies
  return true;
}

// ── Drift severity ─────────────────────────────────────────────────

function driftSeverity(range, installed) {
  const v = parseVersion(installed);
  if (!v) return 'unknown';

  // Extract the minimum version from range
  const caret = range.match(/^\^(\d+)\.(\d+)\.(\d+)/);
  if (caret) {
    const rMinor = +caret[2];
    const rMajor = +caret[1];
    if (v.major !== rMajor) return 'major';
    if (v.minor - rMinor > 5) return 'high';
    if (v.minor - rMinor > 2) return 'medium';
    return 'low';
  }

  const tilde = range.match(/^~(\d+)\.(\d+)\.(\d+)/);
  if (tilde) {
    const rPatch = +tilde[3];
    const rMinor = +tilde[2];
    if (v.minor !== rMinor) return 'major';
    if (v.patch - rPatch > 5) return 'high';
    if (v.patch - rPatch > 2) return 'medium';
    return 'low';
  }

  return 'low';
}

// ── Core logic ─────────────────────────────────────────────────────

function readJSON(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function getInstalledVersion(depName, nodeModulesDir) {
  const pkgPath = path.join(nodeModulesDir, depName, 'package.json');
  const pkg = readJSON(pkgPath);
  return pkg ? pkg.version : null;
}

function analyzeDeps(pkgJson, nodeModulesDir, opts = {}) {
  const depTypes = opts.depTypes || ['dependencies', 'devDependencies'];
  const results = [];

  for (const depType of depTypes) {
    const deps = pkgJson[depType];
    if (!deps) continue;

    for (const [name, range] of Object.entries(deps)) {
      // Skip non-version ranges (git urls, file:, npm:, etc.)
      if (/^(git|file|npm|link|http|https):/.test(range) || range.includes(':')) continue;

      const installed = getInstalledVersion(name, nodeModulesDir);
      const satisfies = installed ? satisfiesRange(installed, range) : null;
      const drift = installed ? driftSeverity(range, installed) : 'missing';

      results.push({
        name,
        range,
        installed,
        depType,
        satisfies,
        drift,
        outOfRange: installed ? !satisfies : false,
      });
    }
  }

  return results;
}

// ── Reporters ──────────────────────────────────────────────────────

function textReport(results, opts = {}) {
  const driftOnly = opts.driftOnly || false;
  const quiet = opts.quiet || false;

  const issues = results.filter(r => !r.satisfies || r.outOfRange);
  const ok = results.filter(r => r.satisfies && !r.outOfRange);
  const missing = results.filter(r => r.installed === null);

  if (driftOnly) {
    const display = results.filter(r => r.outOfRange || r.installed === null);
    if (display.length === 0) {
      console.log('✅ No drift detected — all deps within range');
      return;
    }
    for (const r of display) {
      if (r.installed === null) {
        console.log(`  ❌ ${r.name} — not installed (wanted ${r.range})`);
      } else {
        const icon = r.drift === 'major' ? '🔴' : r.drift === 'high' ? '🟠' : r.drift === 'medium' ? '🟡' : '🟢';
        console.log(`  ${icon} ${r.name} ${r.installed} (range: ${r.range}) — ${r.drift} drift [${r.depType}]`);
      }
    }
    return;
  }

  console.log(`\n  dep-drift report\n`);
  console.log(`  Total deps:    ${results.length}`);
  console.log(`  In range:      ${ok.length}`);
  console.log(`  Out of range:  ${issues.length}`);
  console.log(`  Not installed: ${missing.length}\n`);

  if (issues.length > 0) {
    console.log('  Drifted / Out of range:');
    for (const r of issues) {
      const icon = r.drift === 'major' ? '🔴' : r.drift === 'high' ? '🟠' : r.drift === 'medium' ? '🟡' : '🟢';
      console.log(`    ${icon} ${r.name} ${r.installed} (wanted ${r.range}) — ${r.drift} [${r.depType}]`);
    }
    console.log();
  }

  if (missing.length > 0) {
    console.log('  Missing:');
    for (const r of missing) {
      console.log(`    ❌ ${r.name} (wanted ${r.range}) [${r.depType}]`);
    }
    console.log();
  }

  if (!quiet && ok.length > 0) {
    console.log('  In range:');
    for (const r of ok) {
      console.log(`    ✅ ${r.name} ${r.installed} (${r.range}) [${r.depType}]`);
    }
    console.log();
  }
}

function jsonReport(results) {
  const issues = results.filter(r => r.outOfRange);
  const missing = results.filter(r => r.installed === null);
  const ok = results.filter(r => r.satisfies && !r.outOfRange);

  return {
    total: results.length,
    inRange: ok.length,
    outOfRange: issues.length,
    missing: missing.length,
    results: results.map(r => ({
      name: r.name,
      range: r.range,
      installed: r.installed,
      satisfies: r.satisfies,
      drift: r.drift,
      outOfRange: r.outOfRange,
      depType: r.depType,
    })),
  };
}

// ── Exports ────────────────────────────────────────────────────────

module.exports = {
  parseVersion,
  cmpVersions,
  satisfiesRange,
  driftSeverity,
  analyzeDeps,
  textReport,
  jsonReport,
};
