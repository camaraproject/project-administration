const test = require('node:test');
const assert = require('node:assert');

const { collectRunProvenance, loadedPackageVersion, applyRunProvenance } = require('../scripts/lib/provenance');

const env = {
  GITHUB_RUN_ID: '27907738771',
  GITHUB_RUN_NUMBER: '233',
  GITHUB_SERVER_URL: 'https://github.com',
  GITHUB_REPOSITORY: 'camaraproject/project-administration',
  GITHUB_SHA: '654af56'
};

test('builds collector_run from the workflow environment', () => {
  const run = collectRunProvenance('full', env);
  assert.strictEqual(run.analysis_scope, 'full');
  assert.strictEqual(run.workflow_run_id, '27907738771');
  assert.strictEqual(run.workflow_run_number, 233);
  assert.strictEqual(run.workflow_run_url, 'https://github.com/camaraproject/project-administration/actions/runs/27907738771');
  assert.strictEqual(run.source_sha, '654af56');
  assert.strictEqual(run.node_version, process.version);
});

test('records the versions actually resolved for the declared dependencies', () => {
  const run = collectRunProvenance('incremental', env);
  assert.deepStrictEqual(Object.keys(run.dependencies).sort(), ['@octokit/rest', 'js-yaml']);
  assert.match(run.dependencies['js-yaml'], /^4\.\d+\.\d+$/);
  assert.strictEqual(run.dependencies['js-yaml'], loadedPackageVersion('js-yaml'));
});

test('omits workflow fields outside a workflow run', () => {
  const run = collectRunProvenance('full', {});
  assert.strictEqual(run.workflow_run_id, undefined);
  assert.strictEqual(run.workflow_run_url, undefined);
});

test('loadedPackageVersion reads packages that hide package.json behind exports', () => {
  assert.match(loadedPackageVersion('@octokit/rest'), /^\d+\.\d+\.\d+/);
});

test('applyRunProvenance sets only metadata.collector_run', () => {
  const master = { metadata: { last_updated: 'x' }, releases: [], repositories: [] };
  applyRunProvenance(master, { analysis_scope: 'full' });
  assert.deepStrictEqual(master.metadata.collector_run, { analysis_scope: 'full' });
  assert.deepStrictEqual(master.releases, []);
});
