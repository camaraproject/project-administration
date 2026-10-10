/**
 * Run provenance for data/releases-master.yaml.
 *
 * Recorded once, at top level (metadata.collector_run), and only when the
 * master file is actually updated.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const PACKAGE_JSON = path.join(__dirname, '..', '..', 'package.json');

/**
 * Version of the package Node actually resolves for `name`.
 * Some packages hide package.json behind "exports", so walk up from the
 * resolved entry point to the package's own package.json.
 */
function loadedPackageVersion(name) {
  let dir = path.dirname(require.resolve(name));
  for (;;) {
    const candidate = path.join(dir, 'package.json');
    if (fs.existsSync(candidate)) {
      const pkg = JSON.parse(fs.readFileSync(candidate, 'utf8'));
      if (pkg.name === name) {
        return pkg.version;
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(`package.json for ${name} not found`);
    }
    dir = parent;
  }
}

function npmVersion() {
  try {
    return execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim();
  } catch (error) {
    return undefined;
  }
}

/**
 * Build the collector_run object.
 *
 * @param {string} analysisScope - 'full' or 'incremental'
 * @param {object} env - process.env-like object
 */
function collectRunProvenance(analysisScope, env = process.env) {
  const declared = Object.keys(JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8')).dependencies || {});
  const dependencies = {};
  for (const name of declared) {
    dependencies[name] = loadedPackageVersion(name);
  }

  const runId = env.GITHUB_RUN_ID;
  const runNumber = env.GITHUB_RUN_NUMBER ? parseInt(env.GITHUB_RUN_NUMBER, 10) : undefined;
  const runUrl = runId && env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY
    ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${runId}`
    : undefined;

  return {
    analysis_scope: analysisScope,
    workflow_run_id: runId,
    workflow_run_number: runNumber,
    workflow_run_url: runUrl,
    source_sha: env.GITHUB_SHA,
    node_version: process.version,
    npm_version: npmVersion(),
    dependencies
  };
}

/**
 * Set metadata.collector_run, dropping fields that are not available.
 */
function applyRunProvenance(master, run) {
  const clean = {};
  for (const [key, value] of Object.entries(run)) {
    if (value !== undefined) {
      clean[key] = value;
    }
  }
  master.metadata.collector_run = clean;
  return master;
}

module.exports = { collectRunProvenance, loadedPackageVersion, applyRunProvenance };
