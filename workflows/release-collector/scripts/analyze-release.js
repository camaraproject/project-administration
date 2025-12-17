#!/usr/bin/env node

/**
 * Release Analysis Script
 *
 * Analyzes releases to extract API specifications and metadata.
 * Can work in two modes:
 * - Remote: Fetch from GitHub API
 * - Local: Analyze from local git repository (for testing)
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { Octokit } = require('@octokit/rest');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

// Configuration
const GITHUB_ORG = process.env.GITHUB_ORG || 'camaraproject';
const CONFIG_PATH = path.join(__dirname, '..', '..', '..', 'config'); // /config at repository root

// Initialize GitHub API client
const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN
});

/**
 * Load configuration files
 */
function loadConfig() {
  // Load meta-release mappings
  const mappings = yaml.load(
    fs.readFileSync(path.join(CONFIG_PATH, 'meta-release-mappings.yaml'), 'utf8')
  );

  return { mappings };
}

/**
 * Extract filename from file path (without extension)
 * code/API_definitions/quality-on-demand.yaml -> quality-on-demand
 */
function extractFileName(filePath) {
  const match = filePath.match(/API_definitions\/([^\/]+)\.yaml$/);
  if (match) {
    return match[1];
  }
  return null;
}

/**
 * Extract API name from server URL in OpenAPI spec
 * Server URL format: https://example.com/{api-name}/{version}
 */
function extractAPINameFromSpec(spec) {
  if (!spec.servers || !Array.isArray(spec.servers) || spec.servers.length === 0) {
    return null;
  }

  // Take first server URL
  const serverUrl = spec.servers[0].url;

  // Match pattern /{api-name}/{version}
  // API name is between first and second slash from the end
  const match = serverUrl.match(/\/([^\/]+)\/[^\/]+\/?$/);
  if (match) {
    return match[1];
  }

  return null;
}

/**
 * Apply format corrections to API data
 * These corrections are hardcoded and always applied:
 * 1. Remove 'v' prefix from version (v0.11.0 → 0.11.0)
 * 2. Ensure commonalities is a string and correct format (0.4.0 → 0.4 for Fall24)
 * 3. Convert API names to lowercase for consistency
 */
function applyFormatCorrections(api) {
  const corrected = { ...api };

  // 1. Strip 'v' prefix from version if present
  if (corrected.version && typeof corrected.version === 'string') {
    corrected.version = corrected.version.replace(/^v/, '');
  }

  // 2. Ensure commonalities is a string (convert numbers, preserve existing strings)
  if (corrected.commonalities !== null && corrected.commonalities !== undefined) {
    if (typeof corrected.commonalities === 'number') {
      // Convert number to string
      corrected.commonalities = String(corrected.commonalities);
    }
    // Specific correction: 0.4.0 → 0.4 (Fall24 rule change to use only major.minor)
    if (corrected.commonalities === '0.4.0') {
      corrected.commonalities = '0.4';
    }
  }

  // 3. Convert API name to lowercase for consistency
  if (corrected.api_name && typeof corrected.api_name === 'string') {
    corrected.api_name = corrected.api_name.toLowerCase();
  }

  return corrected;
}

/**
 * Determine meta-release for a repository and release tag
 */
function getMetaRelease(repository, releaseTag, mappings) {
  // Extract release cycle from tag (rX.Y -> rX)
  const cycle = releaseTag.match(/^(r\d+)\./)?.[1];
  if (!cycle) {
    return 'PreFall24';  // Not in rX.Y format
  }

  // Check each meta-release
  for (const [metaRelease, repos] of Object.entries(mappings.mappings)) {
    if (repos[repository] === cycle) {
      return metaRelease;
    }
  }

  return 'None (Sandbox)';  // rX.Y format but not mapped
}

/**
 * Analyze release from local repository (for testing)
 */
async function analyzeLocalRelease(repoPath, releaseTag) {
  console.error(`Analyzing local release: ${repoPath} @ ${releaseTag}`);

  const repoName = path.basename(repoPath);

  // Checkout the release tag
  await execAsync(`git checkout ${releaseTag} --quiet`, { cwd: repoPath });

  // Find API specification files
  const apiSpecPath = path.join(repoPath, 'code', 'API_definitions');
  let apiFiles = [];

  if (fs.existsSync(apiSpecPath)) {
    apiFiles = fs.readdirSync(apiSpecPath)
      .filter(file => file.endsWith('.yaml'))
      .map(file => path.join(apiSpecPath, file));
  }

  // Extract API information
  const apis = [];

  for (const apiFile of apiFiles) {
    try {
      const content = fs.readFileSync(apiFile, 'utf8');
      const spec = yaml.load(content);

      const fileName = extractFileName(apiFile);
      const apiName = extractAPINameFromSpec(spec);

      if (spec && spec.info) {
        const apiData = {
          api_name: apiName || fileName,        // Use filename as fallback for legacy releases
          file_name: fileName,                  // Filename for consistency check
          version: spec.info.version || 'unknown',
          title: spec.info.title || 'Untitled',
          commonalities: spec.info['x-camara-commonalities'] || null
        };

        // Apply format corrections only (not content changes)
        const correctedApi = applyFormatCorrections(apiData);

        // Repository/release-specific corrections
        if (repoName === 'ConnectivityInsights' && releaseTag === 'r1.2' &&
            correctedApi.api_name === 'v0.4' && correctedApi.file_name === 'connectivity-insights-subscriptions') {
          console.error(`Applying correction: ConnectivityInsights r1.2 - mapping 'v0.4' to 'connectivity-insights-subscriptions'`);
          correctedApi.api_name = 'connectivity-insights-subscriptions';
        }

        // Fix incorrect title for connectivity-insights-subscriptions in r1.2 and r2.2
        if (repoName === 'ConnectivityInsights' && (releaseTag === 'r1.2' || releaseTag === 'r2.2') &&
            correctedApi.file_name === 'connectivity-insights-subscriptions' && correctedApi.title === 'Connectivity Insights') {
          console.error(`Applying correction: ConnectivityInsights ${releaseTag} - fixing title to 'Connectivity Insights Subscriptions'`);
          correctedApi.title = 'Connectivity Insights Subscriptions';
        }

        // Exclude known invalid RC release
        if (correctedApi.api_name === 'region-device-count' && correctedApi.version === '0.1.0-rc.1') {
          console.error(`Excluding invalid RC release: ${correctedApi.api_name} ${correctedApi.version}`);
          continue;
        }

        apis.push(correctedApi);
      }
    } catch (error) {
      console.error(`Error parsing ${apiFile}:`, error.message);
    }
  }

  // Get release date
  const { stdout: releaseDate } = await execAsync(
    `git log -1 --format=%aI ${releaseTag}`,
    { cwd: repoPath }
  );

  // Return back to main branch
  await execAsync('git checkout main --quiet', { cwd: repoPath });

  return {
    repository: repoName,
    release_tag: releaseTag,
    release_date: releaseDate.trim(),
    github_url: `https://github.com/${GITHUB_ORG}/${repoName}/releases/tag/${releaseTag}`,
    apis: apis
  };
}

/**
 * Analyze release from GitHub API
 */
async function analyzeGitHubRelease(repository, releaseTag) {
  console.error(`Analyzing GitHub release: ${repository} @ ${releaseTag}`);

  // Get release information
  const { data: release } = await octokit.repos.getReleaseByTag({
    owner: GITHUB_ORG,
    repo: repository,
    tag: releaseTag
  });

  // Get tree for the release tag
  const { data: ref } = await octokit.git.getRef({
    owner: GITHUB_ORG,
    repo: repository,
    ref: `tags/${releaseTag}`
  });

  const { data: tree } = await octokit.git.getTree({
    owner: GITHUB_ORG,
    repo: repository,
    tree_sha: ref.object.sha,
    recursive: true
  });

  // Find API specification files
  const apiFiles = tree.tree.filter(item =>
    item.path.startsWith('code/API_definitions/') &&
    item.path.endsWith('.yaml') &&
    item.type === 'blob'
  );

  // Extract API information
  const apis = [];

  for (const file of apiFiles) {
    try {
      // Get file content
      const { data: blob } = await octokit.git.getBlob({
        owner: GITHUB_ORG,
        repo: repository,
        file_sha: file.sha
      });

      // Decode base64 content
      const content = Buffer.from(blob.content, 'base64').toString('utf8');
      const spec = yaml.load(content);

      const fileName = extractFileName(file.path);
      const apiName = extractAPINameFromSpec(spec);

      if (spec && spec.info) {
        const apiData = {
          api_name: apiName || fileName,        // Use filename as fallback for legacy releases
          file_name: fileName,                  // Filename for consistency check
          version: spec.info.version || 'unknown',
          title: spec.info.title || 'Untitled',
          commonalities: spec.info['x-camara-commonalities'] || null
        };

        // Apply format corrections only (not content changes)
        const correctedApi = applyFormatCorrections(apiData);

        // Repository/release-specific corrections
        if (repository === 'ConnectivityInsights' && releaseTag === 'r1.2' &&
            correctedApi.api_name === 'v0.4' && correctedApi.file_name === 'connectivity-insights-subscriptions') {
          console.error(`Applying correction: ConnectivityInsights r1.2 - mapping 'v0.4' to 'connectivity-insights-subscriptions'`);
          correctedApi.api_name = 'connectivity-insights-subscriptions';
        }

        // Fix incorrect title for connectivity-insights-subscriptions in r1.2 and r2.2
        if (repository === 'ConnectivityInsights' && (releaseTag === 'r1.2' || releaseTag === 'r2.2') &&
            correctedApi.file_name === 'connectivity-insights-subscriptions' && correctedApi.title === 'Connectivity Insights') {
          console.error(`Applying correction: ConnectivityInsights ${releaseTag} - fixing title to 'Connectivity Insights Subscriptions'`);
          correctedApi.title = 'Connectivity Insights Subscriptions';
        }

        // Exclude known invalid RC release
        if (correctedApi.api_name === 'region-device-count' && correctedApi.version === '0.1.0-rc.1') {
          console.error(`Excluding invalid RC release: ${correctedApi.api_name} ${correctedApi.version}`);
          continue;
        }

        apis.push(correctedApi);
      }
    } catch (error) {
      console.error(`Error parsing ${file.path}:`, error.message);
    }
  }

  return {
    repository: repository,
    release_tag: releaseTag,
    release_date: release.published_at,
    github_url: release.html_url,
    apis: apis
  };
}

/**
 * Main execution
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error('Usage:');
    console.error('  Local:  node analyze-release.js --local <repo-path> <release-tag>');
    console.error('  GitHub: node analyze-release.js --github <repo-name> <release-tag>');
    console.error('');
    console.error('Examples:');
    console.error('  node analyze-release.js --local /path/to/DeviceRoamingStatus r1.1');
    console.error('  node analyze-release.js --github DeviceRoamingStatus r1.1');
    process.exit(1);
  }

  const mode = args[0];
  let result;

  try {
    if (mode === '--local') {
      const [, repoPath, releaseTag] = args;
      result = await analyzeLocalRelease(repoPath, releaseTag);
    } else if (mode === '--github') {
      const [, repoName, releaseTag] = args;
      result = await analyzeGitHubRelease(repoName, releaseTag);
    } else {
      console.error('Invalid mode. Use --local or --github');
      process.exit(1);
    }

    // Output result as JSON
    console.log(JSON.stringify(result, null, 2));

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

module.exports = {
  analyzeLocalRelease,
  analyzeGitHubRelease,
  getMetaRelease,
  extractAPINameFromSpec,
  extractFileName,
  applyFormatCorrections,
  loadConfig
};