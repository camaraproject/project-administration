#!/usr/bin/env node

/**
 * Print the markdown rendering of a collector diagnostics file.
 *
 * Usage: node summarize-diagnostics.js <diagnostics.json>
 */

const fs = require('fs');
const { renderDiagnosticsMarkdown } = require('./lib/diagnostics');

const file = process.argv[2];
if (!file || !fs.existsSync(file)) {
  console.error('Usage: node summarize-diagnostics.js <diagnostics.json>');
  process.exit(1);
}

console.log(renderDiagnosticsMarkdown(JSON.parse(fs.readFileSync(file, 'utf8'))));
