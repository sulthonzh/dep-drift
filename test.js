#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { parseVersion, cmpVersions, satisfiesRange, driftSeverity, analyzeDeps, jsonReport } = require('./index');

let pass = 0;
let fail = 0;

function test(name, fn) {
  try {
    fn();
    pass++;
  } catch (e) {
    fail++;
    console.log(`  FAIL: ${name} — ${e.message}`);
  }
}

// ── parseVersion ───────────────────────────────────────────────────

test('parseVersion handles standard semver', () => {
  const v = parseVersion('1.2.3');
  assert.deepStrictEqual(v, { major: 1, minor: 2, patch: 3 });
});

test('parseVersion handles v prefix', () => {
  const v = parseVersion('v2.0.1');
  assert.deepStrictEqual(v, { major: 2, minor: 0, patch: 1 });
});

test('parseVersion handles missing patch', () => {
  const v = parseVersion('1.2');
  assert.deepStrictEqual(v, { major: 1, minor: 2, patch: 0 });
});

test('parseVersion returns null for garbage', () => {
  assert.strictEqual(parseVersion('not-a-version'), null);
});

// ── cmpVersions ────────────────────────────────────────────────────

test('cmpVersions equal', () => {
  assert.strictEqual(cmpVersions('1.2.3', '1.2.3'), 0);
});

test('cmpVersions greater major', () => {
  assert.strictEqual(cmpVersions('2.0.0', '1.9.9'), 1);
});

test('cmpVersions lesser minor', () => {
  assert.strictEqual(cmpVersions('1.1.0', '1.2.0'), -1);
});

test('cmpVersions greater patch', () => {
  assert.strictEqual(cmpVersions('1.0.2', '1.0.1'), 1);
});

// ── satisfiesRange ─────────────────────────────────────────────────

test('caret range — matching', () => {
  assert.strictEqual(satisfiesRange('1.2.3', '^1.2.0'), true);
});

test('caret range — same major different minor', () => {
  assert.strictEqual(satisfiesRange('1.5.0', '^1.2.0'), true);
});

test('caret range — different major', () => {
  assert.strictEqual(satisfiesRange('2.0.0', '^1.2.0'), false);
});

test('caret range — lower minor', () => {
  assert.strictEqual(satisfiesRange('1.1.0', '^1.2.0'), false);
});

test('tilde range — matching', () => {
  assert.strictEqual(satisfiesRange('1.2.5', '~1.2.0'), true);
});

test('tilde range — different minor', () => {
  assert.strictEqual(satisfiesRange('1.3.0', '~1.2.0'), false);
});

test('exact version — matching', () => {
  assert.strictEqual(satisfiesRange('1.2.3', '1.2.3'), true);
});

test('exact version — not matching', () => {
  assert.strictEqual(satisfiesRange('1.2.4', '1.2.3'), false);
});

test('gte range', () => {
  assert.strictEqual(satisfiesRange('2.0.0', '>=1.0.0'), true);
  assert.strictEqual(satisfiesRange('0.9.0', '>=1.0.0'), false);
});

test('lt range', () => {
  assert.strictEqual(satisfiesRange('1.9.9', '<2.0.0'), true);
  assert.strictEqual(satisfiesRange('2.0.0', '<2.0.0'), false);
});

test('compound range (>= and <)', () => {
  assert.strictEqual(satisfiesRange('1.5.0', '>=1.0.0 <2.0.0'), true);
  assert.strictEqual(satisfiesRange('2.0.0', '>=1.0.0 <2.0.0'), false);
});

test('star range', () => {
  assert.strictEqual(satisfiesRange('99.99.99', '*'), true);
});

test('latest', () => {
  assert.strictEqual(satisfiesRange('1.0.0', 'latest'), true);
});

test('x-range major', () => {
  assert.strictEqual(satisfiesRange('1.5.0', '1.x'), true);
  assert.strictEqual(satisfiesRange('2.0.0', '1.x'), false);
});

test('hyphen range', () => {
  assert.strictEqual(satisfiesRange('1.5.0', '1.0.0 - 2.0.0'), true);
  assert.strictEqual(satisfiesRange('2.1.0', '1.0.0 - 2.0.0'), false);
});

test('or range (||)', () => {
  assert.strictEqual(satisfiesRange('1.0.0', '^1.0.0 || ^2.0.0'), true);
  assert.strictEqual(satisfiesRange('2.5.0', '^1.0.0 || ^2.0.0'), true);
  assert.strictEqual(satisfiesRange('3.0.0', '^1.0.0 || ^2.0.0'), false);
});

// ── driftSeverity ──────────────────────────────────────────────────

test('drift severity — low within minor', () => {
  assert.strictEqual(driftSeverity('^1.2.0', '1.2.5'), 'low');
});

test('drift severity — medium drift', () => {
  assert.strictEqual(driftSeverity('^1.2.0', '1.5.0'), 'medium');
});

test('drift severity — high drift', () => {
  assert.strictEqual(driftSeverity('^1.2.0', '1.8.0'), 'high');
});

test('drift severity — major drift', () => {
  assert.strictEqual(driftSeverity('^1.2.0', '2.0.0'), 'major');
});

test('drift severity — tilde patch low', () => {
  assert.strictEqual(driftSeverity('~1.2.0', '1.2.2'), 'low');
});

// ── analyzeDeps (mocked) ───────────────────────────────────────────

test('analyzeDeps with no deps', () => {
  const results = analyzeDeps({ name: 'test' }, '/tmp/nonexistent');
  assert.deepStrictEqual(results, []);
});

test('analyzeDeps detects missing packages', () => {
  const results = analyzeDeps(
    { dependencies: { 'nonexistent-pkg': '^1.0.0' } },
    '/tmp/nonexistent-node-modules'
  );
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].name, 'nonexistent-pkg');
  assert.strictEqual(results[0].installed, null);
  assert.strictEqual(results[0].drift, 'missing');
});

test('analyzeDeps skips git/file/url ranges', () => {
  const results = analyzeDeps(
    { dependencies: { 'my-pkg': 'github:user/repo', 'other': 'file:../local' } },
    '/tmp/nonexistent'
  );
  assert.strictEqual(results.length, 0);
});

test('analyzeDeps respects depTypes filter', () => {
  const pkg = {
    dependencies: { lodash: '^4.0.0' },
    devDependencies: { jest: '^29.0.0' },
  };
  const results = analyzeDeps(pkg, '/tmp/nonexistent', { depTypes: ['devDependencies'] });
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].name, 'jest');
});

// ── jsonReport ─────────────────────────────────────────────────────

test('jsonReport has correct structure', () => {
  const results = [
    { name: 'foo', range: '^1.0.0', installed: '1.2.0', depType: 'dependencies', satisfies: true, drift: 'low', outOfRange: false },
    { name: 'bar', range: '^1.0.0', installed: null, depType: 'dependencies', satisfies: null, drift: 'missing', outOfRange: false },
  ];
  const report = jsonReport(results);
  assert.strictEqual(report.total, 2);
  assert.strictEqual(report.inRange, 1);
  assert.strictEqual(report.missing, 1);
  assert.strictEqual(report.results.length, 2);
});

// ── Summary ────────────────────────────────────────────────────────

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
