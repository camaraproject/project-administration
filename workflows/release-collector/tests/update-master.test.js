const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const yaml = require('js-yaml');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'update-master.js');

const priorMaster = {
  metadata: { last_updated: '2026-01-01T00:00:00.000Z', workflow_version: '3.0.0', schema_version: '3.1.0' },
  releases: [{
    repository: 'DeviceStatus',
    release_tag: 'r2.1',
    release_date: '2025-01-01T00:00:00Z',
    meta_release: 'Fall25',
    github_url: 'https://github.com/camaraproject/DeviceStatus/releases/tag/r2.1',
    release_type: 'public-release',
    apis: [
      { api_name: 'device-status', api_version: '2.1.0', api_title: 'Device Status', commonalities: '0.5' },
      { api_name: 'device-status-subscriptions', api_version: '2.1.0', api_title: 'Subs', commonalities: '0.5' }
    ]
  }],
  repositories: []
};

const analyzed = [{
  repository: 'DeviceStatus',
  release_tag: 'r2.1',
  release_date: '2025-01-01T00:00:00Z',
  github_url: 'https://github.com/camaraproject/DeviceStatus/releases/tag/r2.1',
  is_prerelease: false,
  release_type: null,
  native_metadata: false,
  diagnostics: { files_analyzed: 2, file_issues: [{ file: 'code/API_definitions/s.yaml', recovered: false, error: 'boom' }] },
  apis: [{ api_name: 'device-status', api_version: '2.1.0', api_title: 'Device Status', commonalities: '0.5' }]
}];

function run(mode, results) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'collector-'));
  fs.mkdirSync(path.join(dir, 'data'));
  fs.writeFileSync(path.join(dir, 'data', 'releases-master.yaml'), yaml.dump(priorMaster));
  fs.writeFileSync(path.join(dir, 'in.json'), JSON.stringify(results));
  const proc = spawnSync('node', [
    SCRIPT, '--mode', mode, '--input', path.join(dir, 'in.json'),
    '--diagnostics', path.join(dir, 'diag.json')
  ], {
    encoding: 'utf8',
    env: { ...process.env, COLLECTOR_DATA_DIR: path.join(dir, 'data'), GITHUB_RUN_ID: '42', GITHUB_RUN_NUMBER: '7',
           GITHUB_SERVER_URL: 'https://github.com', GITHUB_REPOSITORY: 'o/r', GITHUB_SHA: 'abc' }
  });
  assert.strictEqual(proc.status, 0, proc.stderr);
  return {
    master: yaml.load(fs.readFileSync(path.join(dir, 'data', 'releases-master.yaml'), 'utf8')),
    diag: JSON.parse(fs.readFileSync(path.join(dir, 'diag.json'), 'utf8'))
  };
}

test('full run: reports the removal, keeps the analyzed data, stamps provenance and schema 3.2.0', () => {
  const { master, diag } = run('full', analyzed);

  assert.strictEqual(master.metadata.schema_version, '3.2.0');
  assert.strictEqual(master.metadata.collector_run.analysis_scope, 'full');
  assert.strictEqual(master.metadata.collector_run.workflow_run_id, '42');
  assert.match(master.metadata.collector_run.dependencies['js-yaml'], /^4\./);
  // data reflects what was analyzed, not the previous entry
  assert.deepStrictEqual(master.releases[0].apis.map(a => a.api_name), ['device-status']);
  // no provenance or diagnostics leak onto releases
  assert.strictEqual(master.releases[0].collector_run, undefined);
  assert.strictEqual(master.releases[0].diagnostics, undefined);

  assert.strictEqual(diag.removed_apis[0].removed[0], 'device-status-subscriptions');
  assert.strictEqual(diag.file_issues[0].error, 'boom');
  assert.strictEqual(diag.run.workflow_run_id, '42');
});

test('incremental run without changes leaves provenance untouched', () => {
  const { master } = run('incremental', []);
  assert.strictEqual(master.metadata.collector_run, undefined);
  assert.strictEqual(master.metadata.last_updated, '2026-01-01T00:00:00.000Z');
});
