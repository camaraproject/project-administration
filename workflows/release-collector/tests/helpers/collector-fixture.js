// Builds a throw-away collector root (config/, data/, reports/) for script tests.
const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');

function release(repository, tag, metaRelease, apiName) {
  return {
    repository,
    release_tag: tag,
    release_date: '2026-01-01T00:00:00Z',
    meta_release: metaRelease,
    github_url: `https://github.com/camaraproject/${repository}/releases/tag/${tag}`,
    release_type: 'public-release',
    apis: [{ api_name: apiName, api_version: '1.0.0', api_title: apiName, commonalities: '0.8.0' }]
  };
}

/**
 * @param {string[]} metaReleases mappings keys, in file order
 * @param {string[]} withReleases meta-releases that get a release in the master data
 */
function makeCollectorRoot(metaReleases, withReleases = metaReleases) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'collector-'));
  fs.mkdirSync(path.join(root, 'config'));
  fs.mkdirSync(path.join(root, 'data'));
  const mappings = {};
  for (const name of metaReleases) mappings[name] = { Repo: 'r1' };
  fs.writeFileSync(path.join(root, 'config', 'meta-release-mappings.yaml'), yaml.dump({ mappings }));
  const releases = withReleases.map((name, i) => release(`Repo${i}`, 'r1.1', name, `api-${i}`));
  releases.push(release('IndependentRepo', 'r1.1', 'Independent', 'independent-api'));
  fs.writeFileSync(path.join(root, 'data', 'releases-master.yaml'), yaml.dump({ metadata: {}, releases }));
  return root;
}

module.exports = { makeCollectorRoot };

const { spawnSync } = require('child_process');
const SCRIPTS = path.join(__dirname, '..', '..', 'scripts');

function runScript(script, root, extraEnv = {}) {
  return spawnSync(process.execPath, [path.join(SCRIPTS, script)], {
    encoding: 'utf8',
    env: { ...process.env, COLLECTOR_ROOT: root, API_LANDSCAPE_PATH: path.join(root, 'no-landscape.yaml'), ...extraEnv }
  });
}

module.exports.runScript = runScript;
