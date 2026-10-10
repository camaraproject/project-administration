const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { analyzeLegacyFiles } = require('../scripts/analyze-release');

const fixture = name => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

test('recovers an API from a file whose body does not parse', () => {
  const { apis, diagnostics } = analyzeLegacyFiles(
    [{ path: 'code/API_definitions/device-status.yaml', content: fixture('legacy-broken-paths.yaml') }],
    'DeviceStatus', 'r2.1'
  );
  assert.deepStrictEqual(apis, [{
    api_name: 'device-status',
    api_version: '2.1.0',
    api_title: 'Device Status',
    commonalities: '0.4'
  }]);
  assert.deepStrictEqual(diagnostics.file_issues, []);
  assert.strictEqual(diagnostics.files_analyzed, 1);
});

test('falls back to the file name when servers is missing', () => {
  const { apis } = analyzeLegacyFiles(
    [{ path: 'code/API_definitions/my-api.yaml', content: 'info:\n  title: T\n  version: v1.0.0\n' }],
    'Repo', 'r1.1'
  );
  assert.strictEqual(apis[0].api_name, 'my-api');
  assert.strictEqual(apis[0].commonalities, null);
});

test('records an issue and keeps going when a file has no usable info', () => {
  const { apis, diagnostics } = analyzeLegacyFiles(
    [
      { path: 'code/API_definitions/bad.yaml', content: 'openapi: 3.0.3\npaths: {}\n' },
      { path: 'code/API_definitions/good.yaml', content: 'info:\n  title: G\n  version: 1.0.0\n' }
    ],
    'Repo', 'r1.1'
  );
  assert.deepStrictEqual(apis.map(a => a.api_name), ['good']);
  assert.strictEqual(diagnostics.file_issues.length, 1);
  assert.strictEqual(diagnostics.file_issues[0].file, 'code/API_definitions/bad.yaml');
  assert.strictEqual(diagnostics.file_issues[0].recovered, false);
  assert.match(diagnostics.file_issues[0].error, /no top-level info section/);
});

test('applies the ConnectivityInsights r1.2 corrections', () => {
  const { apis } = analyzeLegacyFiles(
    [{
      path: 'code/API_definitions/connectivity-insights-subscriptions.yaml',
      content: 'info:\n  title: Connectivity Insights\n  version: 0.4.0\nservers:\n  - url: https://x.example/v0.4/v1\n'
    }],
    'ConnectivityInsights', 'r1.2'
  );
  assert.strictEqual(apis[0].api_name, 'connectivity-insights-subscriptions');
  assert.strictEqual(apis[0].api_title, 'Connectivity Insights Subscriptions');
});

test('excludes the known invalid region-device-count RC without reporting an issue', () => {
  const { apis, diagnostics } = analyzeLegacyFiles(
    [{ path: 'code/API_definitions/region-device-count.yaml', content: 'info:\n  title: R\n  version: 0.1.0-rc.1\n' }],
    'RegionDeviceCount', 'r0.1'
  );
  assert.deepStrictEqual(apis, []);
  assert.deepStrictEqual(diagnostics.file_issues, []);
});
