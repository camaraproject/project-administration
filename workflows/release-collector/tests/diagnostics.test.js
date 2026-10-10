const test = require('node:test');
const assert = require('node:assert');

const { buildDiagnostics, renderDiagnosticsMarkdown } = require('../scripts/lib/diagnostics');

const run = { analysis_scope: 'full', workflow_run_id: '1', workflow_run_url: 'https://example.test/run/1' };

const release = (repository, release_tag, names, extra = {}) => ({
  repository,
  release_tag,
  apis: names.map(api_name => ({ api_name })),
  ...extra
});

test('reports names missing from a re-analyzed release', () => {
  const previous = [release('DeviceStatus', 'r2.1', ['device-status', 'device-roaming-status-subscriptions'])];
  const analyzed = [release('DeviceStatus', 'r2.1', ['device-status'])];

  const d = buildDiagnostics({ analysisResults: analyzed, previousReleases: previous, run });

  assert.deepStrictEqual(d.removed_apis, [{
    repository: 'DeviceStatus',
    release_tag: 'r2.1',
    previous: ['device-status', 'device-roaming-status-subscriptions'],
    analyzed: ['device-status'],
    removed: ['device-roaming-status-subscriptions']
  }]);
});

test('reports nothing for unchanged, added or brand-new releases', () => {
  const previous = [release('A', 'r1.1', ['a']), release('B', 'r1.1', ['b'])];
  const analyzed = [
    release('A', 'r1.1', ['a', 'a-extra']),
    release('C', 'r1.1', ['c'])
  ];

  const d = buildDiagnostics({ analysisResults: analyzed, previousReleases: previous, run });

  assert.deepStrictEqual(d.removed_apis, []);
});

test('collects file issues and native metadata errors by repository and tag', () => {
  const analyzed = [release('A', 'r1.1', ['a'], {
    diagnostics: {
      files_analyzed: 2,
      file_issues: [{ file: 'code/API_definitions/x.yaml', recovered: false, error: 'boom' }],
      native_metadata_error: 'GitHub API 502'
    }
  })];

  const d = buildDiagnostics({ analysisResults: analyzed, previousReleases: [], run });

  assert.deepStrictEqual(d.file_issues, [
    { repository: 'A', release_tag: 'r1.1', file: 'code/API_definitions/x.yaml', recovered: false, error: 'boom' }
  ]);
  assert.deepStrictEqual(d.native_metadata_errors, [
    { repository: 'A', release_tag: 'r1.1', error: 'GitHub API 502' }
  ]);
});

test('carries the run context and totals', () => {
  const d = buildDiagnostics({
    analysisResults: [release('A', 'r1.1', ['a']), release('B', 'r1.1', ['b'])],
    previousReleases: [],
    run
  });
  assert.deepStrictEqual(d.run, run);
  assert.strictEqual(d.releases_analyzed, 2);
});

test('markdown says so when there is nothing to review', () => {
  const d = buildDiagnostics({ analysisResults: [release('A', 'r1.1', ['a'])], previousReleases: [], run });
  assert.match(renderDiagnosticsMarkdown(d), /No review signals/);
});

test('markdown lists removals and file issues and caps long lists', () => {
  const previous = Array.from({ length: 5 }, (_, i) => release(`R${i}`, 'r1.1', ['x', 'y']));
  const analyzed = Array.from({ length: 5 }, (_, i) => release(`R${i}`, 'r1.1', ['x']));
  const d = buildDiagnostics({ analysisResults: analyzed, previousReleases: previous, run });

  const md = renderDiagnosticsMarkdown(d, { maxItems: 3 });

  assert.match(md, /Potential API removals \(5\)/);
  assert.match(md, /`R0` `r1.1`: y/);
  assert.match(md, /and 2 more/);
  assert.doesNotMatch(md, /R4/);
});
