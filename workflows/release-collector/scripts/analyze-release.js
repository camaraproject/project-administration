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
const { extractLegacyMetadata } = require('./lib/legacy-metadata');
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
  const serverUrl = spec.servers[0] && spec.servers[0].url;
  if (typeof serverUrl !== 'string') {
    return null;
  }

  // Match pattern /{api-name}/{version}
  // API name is between first and second slash from the end
  const match = serverUrl.match(/\/([^\/]+)\/[^\/]+\/?$/);
  if (match) {
    return match[1];
  }

  return null;
}

/**
 * Determine pre-release type from API versions
 * Pre-releases contain API versions with -alpha.N or -rc.N extensions
 *
 * Logic: A release is only as mature as its least mature API
 * - If ANY API has -alpha.N extension → 'pre-release-alpha'
 * - If ALL APIs are -rc.N or public (no extension) → 'pre-release-rc'
 * - If pre-release but no valid alpha/rc extensions → warn and classify as 'pre-release-alpha'
 *
 * @param {Array} apis - Array of API objects with api_version field
 * @param {boolean} isPrerelease - GitHub prerelease flag
 * @param {string} repository - Repository name for logging
 * @param {string} releaseTag - Release tag for logging
 * @returns {string|null} 'pre-release-alpha' | 'pre-release-rc' | null (if not a pre-release)
 */
function determinePreReleaseType(apis, isPrerelease, repository, releaseTag) {
  if (!isPrerelease) {
    return null;  // Not a pre-release, type will be determined in update-master.js
  }

  // Check if any API has an alpha version extension
  const hasAlpha = apis.some(api =>
    api.api_version && api.api_version.includes('-alpha.')
  );

  // Check if any API has an rc version extension
  const hasRc = apis.some(api =>
    api.api_version && api.api_version.includes('-rc.')
  );

  // If any API is alpha, the release can't be better than alpha
  if (hasAlpha) {
    return 'pre-release-alpha';
  }

  // All APIs are rc → release is rc
  if (hasRc) {
    return 'pre-release-rc';
  }

  // No valid alpha or rc extension found (could be typo, missing number, or maintenance pre-release)
  console.error(`⚠️ WARNING: ${repository} ${releaseTag} is marked as pre-release but contains neither a valid -alpha.N nor -rc.N API version. Classifying as pre-release-alpha.`);
  return 'pre-release-alpha';
}

/**
 * Apply format corrections to API data
 * These corrections are hardcoded and always applied:
 * 1. Remove 'v' prefix from api_version (v0.11.0 → 0.11.0)
 * 2. Ensure commonalities is a string and correct format (0.4.0 → 0.4 for Fall24)
 * 3. Convert API names to lowercase for consistency
 */
function applyFormatCorrections(api) {
  const corrected = { ...api };

  // 1. Strip 'v' prefix from api_version if present
  if (corrected.api_version && typeof corrected.api_version === 'string') {
    corrected.api_version = corrected.api_version.replace(/^v/, '');
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
 * Extract Commonalities semantic version from a dependency string.
 * Input format: "r4.2 (1.2.0-rc.1)" or null
 * Returns: "1.2.0-rc.1" or null
 */
function extractCommonalitiesVersion(depString) {
  if (!depString) return null;
  const match = depString.match(/\(([^)]+)\)/);
  return match ? match[1] : null;
}

/**
 * Fetch native release-metadata.yaml from a release tag tree via GitHub API.
 * Returns parsed metadata object if found, null if not present (404).
 *
 * @param {string} repo - Repository name
 * @param {string} tag - Release tag
 * @returns {Promise<object|null>} Parsed metadata or null
 */
async function fetchNativeReleaseMetadata(repo, tag) {
  const url = `https://api.github.com/repos/${GITHUB_ORG}/${repo}/contents/release-metadata.yaml?ref=${encodeURIComponent(tag)}`;
  const headers = {
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'camara-release-collector'
  };

  if (process.env.GITHUB_TOKEN) {
    headers['Authorization'] = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  const response = await fetch(url, { headers });

  if (response.status === 404) {
    return null;
  }

  if (response.status !== 200) {
    const body = await response.text();
    throw new Error(`GitHub API ${response.status} while fetching native metadata for ${repo}/${tag}: ${body}`);
  }

  const data = await response.json();
  const content = Buffer.from(data.content, 'base64').toString('utf8');
  return yaml.load(content);
}

/**
 * Build analysis result from native release-metadata.yaml.
 * Maps native metadata fields to the collector's analysis result format.
 *
 * @param {object} metadata - Parsed native release-metadata.yaml
 * @param {object} release - GitHub release object (for date, URL, prerelease flag)
 * @param {string} repository - Repository name
 * @returns {object} Analysis result in collector format
 */
function buildResultFromNativeMetadata(metadata, release, repository) {
  const repo = metadata.repository || {};
  const releaseType = repo.release_type || null;
  const isPrerelease = releaseType ? releaseType.startsWith('pre-release-') : release.prerelease;

  // Derive per-API commonalities from release-level dependency (ADR-0004 Decision 7)
  const commonalitiesVersion = extractCommonalitiesVersion(
    metadata.dependencies?.commonalities_release
  );

  const apis = (metadata.apis || []).map(api => {
    const apiData = {
      api_name: api.api_name,
      api_version: api.api_version || 'unknown',
      api_title: api.api_title || 'Untitled',
      commonalities: commonalitiesVersion
    };
    return applyFormatCorrections(apiData);
  });

  return {
    repository: repository,
    release_tag: repo.release_tag || release.tag_name,
    release_date: release.published_at,
    github_url: release.html_url,
    is_prerelease: isPrerelease,
    release_type: releaseType,
    src_commit_sha: repo.src_commit_sha || null,
    dependencies: metadata.dependencies || null,
    native_metadata: true,
    apis: apis
  };
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

  return 'Independent';  // rX.Y format but not mapped
}

/**
 * Analyze legacy OpenAPI files (releases without native release-metadata.yaml).
 *
 * Only the top-level info and servers sections are read (metadata-only
 * extraction); the rest of each document is never parsed. A file that yields
 * no usable info is recorded in diagnostics.file_issues and skipped.
 *
 * @param {Array<{path: string, content: string}>} files - API definition files
 * @param {string} repository - Repository name
 * @param {string} releaseTag - Release tag
 * @returns {{apis: Array, diagnostics: {files_analyzed: number, file_issues: Array}}}
 */
function analyzeLegacyFiles(files, repository, releaseTag) {
  const apis = [];
  const diagnostics = { files_analyzed: files.length, file_issues: [] };

  for (const file of files) {
    try {
      const spec = extractLegacyMetadata(file.content);

      const fileName = extractFileName(file.path);
      const apiName = extractAPINameFromSpec(spec);

      const apiData = {
        api_name: apiName || fileName,        // Use filename as fallback for legacy releases
        api_version: spec.info.version || 'unknown',
        api_title: spec.info.title || 'Untitled',
        commonalities: spec.info['x-camara-commonalities'] || null
      };

      // Apply format corrections only (not content changes)
      const correctedApi = applyFormatCorrections(apiData);

      // Repository/release-specific corrections
      if (repository === 'ConnectivityInsights' && releaseTag === 'r1.2' &&
          correctedApi.api_name === 'v0.4') {
        console.error(`Applying correction: ConnectivityInsights r1.2 - mapping 'v0.4' to 'connectivity-insights-subscriptions'`);
        correctedApi.api_name = 'connectivity-insights-subscriptions';
      }

      // Fix incorrect api_title for connectivity-insights-subscriptions in r1.2 and r2.2
      if (repository === 'ConnectivityInsights' && (releaseTag === 'r1.2' || releaseTag === 'r2.2') &&
          correctedApi.api_name === 'connectivity-insights-subscriptions' && correctedApi.api_title === 'Connectivity Insights') {
        console.error(`Applying correction: ConnectivityInsights ${releaseTag} - fixing api_title to 'Connectivity Insights Subscriptions'`);
        correctedApi.api_title = 'Connectivity Insights Subscriptions';
      }

      // Exclude known invalid RC release
      if (correctedApi.api_name === 'region-device-count' && correctedApi.api_version === '0.1.0-rc.1') {
        console.error(`Excluding invalid RC release: ${correctedApi.api_name} ${correctedApi.api_version}`);
        continue;
      }

      apis.push(correctedApi);
    } catch (error) {
      console.error(`Error extracting metadata from ${file.path}:`, error.message);
      diagnostics.file_issues.push({ file: file.path, recovered: false, error: error.message });
    }
  }

  return { apis, diagnostics };
}

/**
 * Analyze release from local repository (for testing)
 * @param {string} repoPath - Path to local repository
 * @param {string} releaseTag - Release tag to analyze
 * @param {boolean} isPrerelease - Whether this is a pre-release (default: false)
 */
async function analyzeLocalRelease(repoPath, releaseTag, isPrerelease = false) {
  console.error(`Analyzing local release: ${repoPath} @ ${releaseTag} (prerelease: ${isPrerelease})`);

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

  // Extract API information (metadata-only)
  const files = apiFiles.map(apiFile => ({
    path: path.relative(repoPath, apiFile),
    content: fs.readFileSync(apiFile, 'utf8')
  }));
  const { apis, diagnostics } = analyzeLegacyFiles(files, repoName, releaseTag);

  // Get release date
  const { stdout: releaseDate } = await execAsync(
    `git log -1 --format=%aI ${releaseTag}`,
    { cwd: repoPath }
  );

  // Return back to main branch
  await execAsync('git checkout main --quiet', { cwd: repoPath });

  // Determine release_type for pre-releases (public/maintenance determined in update-master.js)
  const releaseType = determinePreReleaseType(apis, isPrerelease, repoName, releaseTag);

  return {
    repository: repoName,
    release_tag: releaseTag,
    release_date: releaseDate.trim(),
    github_url: `https://github.com/${GITHUB_ORG}/${repoName}/releases/tag/${releaseTag}`,
    is_prerelease: isPrerelease,
    release_type: releaseType,  // null for non-prereleases, determined in update-master.js
    src_commit_sha: null,
    dependencies: null,
    native_metadata: false,
    diagnostics: diagnostics,
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

  // Check for native release-metadata.yaml (ADR-0004: native metadata is authoritative)
  let nativeMetadataError = null;
  try {
    const nativeMetadata = await fetchNativeReleaseMetadata(repository, releaseTag);
    if (nativeMetadata) {
      console.error(`  → Native release-metadata.yaml found, using as authoritative source`);
      return buildResultFromNativeMetadata(nativeMetadata, release, repository);
    }
    console.error(`  → No native metadata, falling back to OpenAPI analysis`);
  } catch (error) {
    console.error(`  → Error checking native metadata, falling back to OpenAPI analysis: ${error.message}`);
    nativeMetadataError = error.message;
  }

  // Legacy path: analyze OpenAPI specs from tag tree
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

  // Fetch file contents; a failed fetch is recorded like an extraction issue
  const files = [];
  const fetchIssues = [];
  for (const file of apiFiles) {
    try {
      const { data: blob } = await octokit.git.getBlob({
        owner: GITHUB_ORG,
        repo: repository,
        file_sha: file.sha
      });
      files.push({
        path: file.path,
        content: Buffer.from(blob.content, 'base64').toString('utf8')
      });
    } catch (error) {
      console.error(`Error fetching ${file.path}:`, error.message);
      fetchIssues.push({ file: file.path, recovered: false, error: `fetch failed: ${error.message}` });
    }
  }

  // Extract API information (metadata-only)
  const { apis, diagnostics } = analyzeLegacyFiles(files, repository, releaseTag);
  diagnostics.files_analyzed += fetchIssues.length;
  diagnostics.file_issues.push(...fetchIssues);
  if (nativeMetadataError) {
    diagnostics.native_metadata_error = nativeMetadataError;
  }

  // Determine release_type for pre-releases (public/maintenance determined in update-master.js)
  const releaseType = determinePreReleaseType(apis, release.prerelease, repository, releaseTag);

  return {
    repository: repository,
    release_tag: releaseTag,
    release_date: release.published_at,
    github_url: release.html_url,
    is_prerelease: release.prerelease,
    release_type: releaseType,  // null for non-prereleases, determined in update-master.js
    src_commit_sha: null,
    dependencies: null,
    native_metadata: false,
    diagnostics: diagnostics,
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
    console.error('  Local:  node analyze-release.js --local <repo-path> <release-tag> [--prerelease]');
    console.error('  GitHub: node analyze-release.js --github <repo-name> <release-tag>');
    console.error('');
    console.error('Examples:');
    console.error('  node analyze-release.js --local /path/to/DeviceRoamingStatus r1.1');
    console.error('  node analyze-release.js --local /path/to/DeviceRoamingStatus r1.1 --prerelease');
    console.error('  node analyze-release.js --github DeviceRoamingStatus r1.1');
    process.exit(1);
  }

  const mode = args[0];
  let result;

  try {
    if (mode === '--local') {
      const [, repoPath, releaseTag, ...rest] = args;
      const isPrerelease = rest.includes('--prerelease');
      result = await analyzeLocalRelease(repoPath, releaseTag, isPrerelease);
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
  analyzeLegacyFiles,
  analyzeLocalRelease,
  analyzeGitHubRelease,
  getMetaRelease,
  extractAPINameFromSpec,
  extractFileName,
  applyFormatCorrections,
  determinePreReleaseType,
  loadConfig
};