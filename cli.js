#!/usr/bin/env node
'use strict';

const { analyzeDeps, textReport, jsonReport } = require('./index');
const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2);
const opts = { depTypes: ['dependencies', 'devDependencies'] };
let dir = process.cwd();
let outputJson = false;
let driftOnly = false;
let quiet = false;

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '--json':
      outputJson = true;
      break;
    case '--drift-only':
    case '-d':
      driftOnly = true;
      break;
    case '--quiet':
    case '-q':
      quiet = true;
      break;
    case '--dir':
      dir = args[++i];
      break;
    case '--deps-only':
      opts.depTypes = ['dependencies'];
      break;
    case '--dev-only':
      opts.depTypes = ['devDependencies'];
      break;
    case '--help':
    case '-h':
      console.log(`
  dep-drift — detect dependency drift between package.json and node_modules

  Usage:
    dep-drift [options]

  Options:
    --dir <path>        Project directory (default: cwd)
    --json              Output as JSON
    --drift-only, -d    Only show drifted/missing deps
    --quiet, -q         Hide in-range deps from text output
    --deps-only         Check only dependencies
    --dev-only          Check only devDependencies
    --help, -h          Show this help

  Examples:
    dep-drift                  # full report
    dep-drift --drift-only     # only problems
    dep-drift --json           # machine-readable output
    dep-drift --dir ../my-app  # check another project
`);
      process.exit(0);
    default:
      if (!args[i].startsWith('-')) dir = args[i];
      break;
  }
}

const pkgPath = path.resolve(dir, 'package.json');
const nodeModulesDir = path.resolve(dir, 'node_modules');

if (!fs.existsSync(pkgPath)) {
  console.error('Error: No package.json found in', dir);
  process.exit(1);
}

const pkgJson = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const results = analyzeDeps(pkgJson, nodeModulesDir, opts);

if (outputJson) {
  console.log(JSON.stringify(jsonReport(results), null, 2));
} else {
  textReport(results, { driftOnly, quiet });
}

// Exit code: non-zero if any drift detected
const hasIssues = results.some(r => r.outOfRange || r.installed === null);
process.exit(hasIssues ? 1 : 0);
