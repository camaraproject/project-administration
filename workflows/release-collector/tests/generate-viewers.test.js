const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { makeCollectorRoot, runScript } = require('./helpers/collector-fixture');

function collectorRootWithReports(metaReleases) {
  const root = makeCollectorRoot(metaReleases);
  const result = runScript('generate-reports.js', root);
  assert.strictEqual(result.status, 0, result.stderr);
  return root;
}

function allReleasesPath(root) {
  return path.join(root, 'reports', 'all-releases.json');
}

function editAllReleases(root, edit) {
  const data = JSON.parse(fs.readFileSync(allReleasesPath(root), 'utf8'));
  edit(data);
  fs.writeFileSync(allReleasesPath(root), JSON.stringify(data));
}

function viewerData(root) {
  const html = fs.readFileSync(path.join(root, 'viewers', 'meta-release.html'), 'utf8');
  const match = html.match(/<script type="application\/json" id="viewer-data">([\s\S]*?)<\/script>/);
  assert.ok(match, 'viewer-data script missing');
  return JSON.parse(match[1]);
}

test('generate-viewers: one meta-release.html embeds every listed report in list order', () => {
  const root = collectorRootWithReports(['Old1', 'Mid2', 'New3']);
  const result = runScript('generate-viewers.js', root);
  assert.strictEqual(result.status, 0, result.stderr);
  const data = viewerData(root);
  assert.deepStrictEqual(data.metaReleases, ['Old1', 'Mid2', 'New3']);
  assert.deepStrictEqual(Object.keys(data.reports), ['Old1', 'Mid2', 'New3']);
  assert.strictEqual(data.reports.Mid2.metadata.meta_release, 'Mid2');
  for (const file of ['portfolio.html', 'internal.html']) {
    assert.ok(fs.existsSync(path.join(root, 'viewers', file)), `${file} missing`);
  }
  assert.ok(!fs.existsSync(path.join(root, 'viewers', 'old1.html')), 'no per-meta-release file');
});

test('generate-viewers: index pages link every meta-release', () => {
  const root = collectorRootWithReports(['Old1', 'New3']);
  assert.strictEqual(runScript('generate-viewers.js', root).status, 0);
  for (const file of ['production-index.html', 'staging-index.html']) {
    const html = fs.readFileSync(path.join(root, 'viewers', file), 'utf8');
    assert.ok(html.includes('href="meta-release.html"'), `${file}: main link`);
    assert.ok(html.includes('href="meta-release.html?meta-release=Old1"'), `${file}: Old1 link`);
    assert.ok(html.includes('href="meta-release.html?meta-release=New3"'), `${file}: New3 link`);
    assert.ok(!html.includes('{{'), `${file}: placeholder left`);
  }
});

test('generate-viewers: a viewer embeds data containing "$&" and "</script>" unchanged', () => {
  const root = collectorRootWithReports(['One']);
  editAllReleases(root, d => { d.metadata.note = '$& </script> $1'; });
  const reportPath = path.join(root, 'reports', 'one.json');
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  report.metadata.note = '$& </script> $1';
  fs.writeFileSync(reportPath, JSON.stringify(report));
  assert.strictEqual(runScript('generate-viewers.js', root).status, 0);
  assert.strictEqual(viewerData(root).reports.One.metadata.note, '$& </script> $1');
});

test('generate-viewers: exits non-zero when metadata.meta_releases is missing', () => {
  const root = collectorRootWithReports(['One']);
  editAllReleases(root, d => { delete d.metadata.meta_releases; });
  const result = runScript('generate-viewers.js', root);
  assert.notStrictEqual(result.status, 0);
  assert.match(result.stderr, /meta_releases/);
  assert.ok(!fs.existsSync(path.join(root, 'viewers', 'meta-release.html')));
});

test('generate-viewers: exits non-zero when metadata.meta_releases is empty', () => {
  const root = collectorRootWithReports(['One']);
  editAllReleases(root, d => { d.metadata.meta_releases = []; });
  const result = runScript('generate-viewers.js', root);
  assert.notStrictEqual(result.status, 0);
  assert.match(result.stderr, /meta_releases/);
});

test('generate-viewers: exits non-zero when a listed report file is missing', () => {
  const root = collectorRootWithReports(['One', 'Two']);
  fs.unlinkSync(path.join(root, 'reports', 'two.json'));
  const result = runScript('generate-viewers.js', root);
  assert.notStrictEqual(result.status, 0);
  assert.match(result.stderr, /two\.json/);
});
