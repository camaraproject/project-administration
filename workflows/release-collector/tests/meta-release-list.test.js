const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { makeCollectorRoot } = require('./helpers/collector-fixture');

const GENERATE_REPORTS = path.join(__dirname, '..', 'scripts', 'generate-reports.js');

function runGenerateReports(root, landscapeFile = 'no-landscape.yaml') {
  return spawnSync(process.execPath, [GENERATE_REPORTS], {
    encoding: 'utf8',
    env: { ...process.env, COLLECTOR_ROOT: root, API_LANDSCAPE_PATH: path.join(root, landscapeFile) }
  });
}

function readReport(root, name) {
  return JSON.parse(fs.readFileSync(path.join(root, 'reports', name), 'utf8'));
}

test('generate-reports: one report per mappings key, list in file order in all-releases.json', () => {
  const root = makeCollectorRoot(['Zeta1', 'Alpha2', 'Mid3']);
  const result = runGenerateReports(root);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.deepStrictEqual(readReport(root, 'all-releases.json').metadata.meta_releases, ['Zeta1', 'Alpha2', 'Mid3']);
  for (const name of ['zeta1', 'alpha2', 'mid3']) {
    assert.ok(fs.existsSync(path.join(root, 'reports', `${name}.json`)), `${name}.json missing`);
  }
});

test('generate-reports: a mappings key without releases gets no report and no list entry', () => {
  const root = makeCollectorRoot(['One', 'Two'], ['One']);
  const result = runGenerateReports(root);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.deepStrictEqual(readReport(root, 'all-releases.json').metadata.meta_releases, ['One']);
  assert.ok(!fs.existsSync(path.join(root, 'reports', 'two.json')));
});

test('generate-reports: isNew is set for every listed meta-release, not a fixed set', () => {
  const root = makeCollectorRoot(['Future27']);
  fs.writeFileSync(path.join(root, 'landscape.yaml'), [
    'metadata: { version: 1.0.0 }',
    'apis:',
    '  api-0: { category: Test, published: true, first_release: Future27 }',
    ''
  ].join('\n'));
  const result = runGenerateReports(root, 'landscape.yaml');
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(readReport(root, 'future27.json').releases[0].apis[0].isNew, true);
  const all = readReport(root, 'all-releases.json');
  const independent = all.releases.find(r => r.meta_release === 'Independent');
  assert.ok(!('isNew' in independent.apis[0]), 'Independent releases carry no isNew');
});
