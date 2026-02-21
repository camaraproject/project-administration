#!/usr/bin/env node

/**
 * Release Detection Script
 *
 * Compares current releases in CAMARA repositories with stored master metadata
 * to determine if updates are needed.
 *
 * Modes:
 * - incremental: Detect only new releases
 * - full: Force re-analysis of all releases
 * - dry-run: Test without making changes
 */

const fs = require('fs');
const yaml = require('js-yaml');
const { Octokit } = require('@octokit/rest');

// Configuration
const GITHUB_ORG = process.env.GITHUB_ORG || 'camaraproject';
const MASTER_METADATA_PATH = 'data/releases-master.yaml';
const CONFIG_PATH = 'config';

// Initialize GitHub API client
const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN
});

/**
 * Load master metadata from YAML file
 */
function loadMasterMetadata() {
  try {
    if (fs.existsSync(MASTER_METADATA_PATH)) {
      const content = fs.readFileSync(MASTER_METADATA_PATH, 'utf8');
      return yaml.load(content);
    }
  } catch (error) {
    console.error('Error loading master metadata:', error);
  }

  // Return empty structure if file doesn't exist
  return {
    metadata: {
      last_updated: null,
      last_checked: null,
      workflow_version: '3.0.0',
      schema_version: '1.0.0'
    },
    releases: []
  };
}

/**
 * Fetch all API repositories from GitHub
 */
async function fetchAPIRepositories() {
  console.error(`Fetching repositories from ${GITHUB_ORG}...`);

  const repos = [];
  let page = 1;

  while (true) {
    const { data } = await octokit.repos.listForOrg({
      org: GITHUB_ORG,
      type: 'public',
      per_page: 100,
      page: page
    });

    if (data.length === 0) break;

    // Filter for API repositories by topics (includes archived)
    // Topics: sandbox-api-repository, incubating-api-repository, graduated-api-repository, archived-api-repository
    const apiRepos = data.filter(repo =>
      repo.topics?.includes('sandbox-api-repository') ||
      repo.topics?.includes('incubating-api-repository') ||
      repo.topics?.includes('graduated-api-repository') ||
      repo.topics?.includes('archived-api-repository')
    );

    repos.push(...apiRepos);
    page++;
  }

  // Validate consistency between archived-api-repository topic and GitHub archived status
  const warnings = [];
  const validRepos = repos.filter(repo => {
    const hasArchivedTopic = repo.topics?.includes('archived-api-repository');
    const isGitHubArchived = repo.archived;
    if (hasArchivedTopic && !isGitHubArchived) {
      warnings.push(`${repo.name}: has archived-api-repository topic but is NOT archived on GitHub`);
      return false;
    }
    if (!hasArchivedTopic && isGitHubArchived) {
      warnings.push(`${repo.name}: archived on GitHub but does NOT have archived-api-repository topic`);
      return false;
    }
    return true;
  });

  if (warnings.length > 0) {
    console.error(`⚠️  ${warnings.length} archived status mismatch(es):`);
    warnings.forEach(w => console.error(`  - ${w}`));
  }

  const archivedCount = validRepos.filter(r => r.topics?.includes('archived-api-repository')).length;
  console.error(`Found ${validRepos.length} API repositories (${archivedCount} archived${warnings.length > 0 ? `, ${warnings.length} skipped due to mismatch` : ''})`);
  return { repos: validRepos, warnings };
}

/**
 * Fetch all releases for a repository (including pre-releases)
 */
async function fetchReleases(repoName) {
  const releases = [];
  let page = 1;

  while (true) {
    const { data } = await octokit.repos.listReleases({
      owner: GITHUB_ORG,
      repo: repoName,
      per_page: 100,
      page: page
    });

    if (data.length === 0) break;

    // Get all releases with rX.Y format (exclude drafts and pre-Fall24 formats)
    // Now includes pre-releases for visibility of release candidates
    const validReleases = data.filter(release =>
      !release.draft &&
      /^r[1-9]\d*\.[1-9]\d*$/.test(release.tag_name)  // Only rX.Y format where X,Y >= 1
    );

    releases.push(...validReleases);
    page++;
  }

  return releases;
}

/**
 * Check if a pre-release is superseded by an existing release in master
 * A pre-release rX.Y is superseded if master has any rX.Z (non-prerelease) where Z >= Y
 * for the same repository
 */
function isSupersededPrerelease(prerelease, storedReleases) {
  const match = prerelease.release_tag.match(/^r(\d+)\.(\d+)$/);
  if (!match) return false;

  const cycle = parseInt(match[1]);
  const minor = parseInt(match[2]);

  // Check if any non-prerelease in same repo/cycle exists with >= minor version
  return storedReleases.some(r => {
    if (r.repository !== prerelease.repository) return false;
    const storedMatch = r.release_tag.match(/^r(\d+)\.(\d+)$/);
    if (!storedMatch) return false;
    const storedCycle = parseInt(storedMatch[1]);
    const storedMinor = parseInt(storedMatch[2]);
    // Same cycle and stored version >= prerelease version means superseded
    return storedCycle === cycle && storedMinor >= minor;
  });
}

/**
 * Compare releases to find new ones
 * In incremental mode, filters out superseded pre-releases
 */
function findNewReleases(repoReleases, storedReleases, mode) {
  const storedTags = new Set(
    storedReleases.map(r => `${r.repository}:${r.release_tag}`)
  );

  const newReleases = [];

  for (const releaseInfo of repoReleases) {
    const key = `${releaseInfo.repository}:${releaseInfo.release_tag}`;

    // Skip if already in master
    if (storedTags.has(key)) continue;

    // Log superseded pre-releases (but still include them for metadata generation)
    if (mode === 'incremental' && releaseInfo.is_prerelease) {
      if (isSupersededPrerelease(releaseInfo, storedReleases)) {
        console.error(`  New (superseded): ${releaseInfo.repository} ${releaseInfo.release_tag}`);
      }
    }

    newReleases.push(releaseInfo);
  }

  return newReleases;
}

/**
 * Main execution
 */
async function main() {
  const args = process.argv.slice(2);
  let mode = 'incremental';

  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--mode' && i + 1 < args.length) {
      mode = args[i + 1];
      i++;
    }
  }

  console.error(`🔍 Release Detection - Mode: ${mode}`);
  console.error('================================');

  // Load existing metadata
  const masterData = loadMasterMetadata();
  console.error(`Loaded ${masterData.releases.length} existing releases`);

  // Fetch all API repositories with the specified topics (includes archived)
  const { repos: repositories, warnings } = await fetchAPIRepositories();
  const repositoriesToCheck = repositories.map(r => r.name).sort();

  console.error(`Will check ${repositoriesToCheck.length} repositories`);

  // Fetch all releases from all repositories
  const allReleases = [];

  for (const repo of repositoriesToCheck) {
    try {
      console.error(`Checking ${repo}...`);
      const releases = await fetchReleases(repo);

      // Add repository info to each release
      for (const release of releases) {
        allReleases.push({
          repository: repo,
          release_tag: release.tag_name,
          release_date: release.published_at,
          github_url: release.html_url,
          is_prerelease: release.prerelease  // Flag from GitHub API for release_type determination
        });
      }
    } catch (error) {
      console.error(`Error checking ${repo}: ${error.message}`);
    }
  }

  console.error(`Found ${allReleases.length} total rX.Y releases (including pre-releases)`);

  let releasesToAnalyze = [];

  if (mode === 'full') {
    // Full mode: analyze all rX.Y releases
    releasesToAnalyze = allReleases;
    console.error(`Full mode: Will analyze all ${releasesToAnalyze.length} releases`);
  } else {
    // Incremental mode: only new releases (filters out superseded pre-releases)
    releasesToAnalyze = findNewReleases(allReleases, masterData.releases, mode);
    console.error(`Incremental mode: Found ${releasesToAnalyze.length} new releases to analyze`);
  }

  // Group releases by repository for summary
  const repoSummary = {};
  for (const release of releasesToAnalyze) {
    if (!repoSummary[release.repository]) {
      repoSummary[release.repository] = 0;
    }
    repoSummary[release.repository]++;
  }

  // Build repositories list with minimal data for update-master.js
  const repositoriesList = repositories.map(repo => ({
    repository: repo.name,
    github_url: repo.html_url,
    ...(repo.topics?.includes('archived-api-repository') ? { archived: true } : {})
  })).sort((a, b) => a.repository.localeCompare(b.repository));

  // Check for new repositories (not in existing master data)
  const existingRepoNames = new Set(
    (masterData.repositories || []).map(r => r.repository)
  );
  const newRepositories = repositoriesList.filter(r => !existingRepoNames.has(r.repository));
  const hasNewRepositories = newRepositories.length > 0;

  if (hasNewRepositories) {
    console.error(`Found ${newRepositories.length} new repositories:`);
    newRepositories.forEach(r => console.error(`  - ${r.repository}`));
  }

  // Separate flags for releases vs repositories
  const hasNewReleases = releasesToAnalyze.length > 0;
  // has_updates is true if there are new releases OR new repositories
  const hasUpdates = hasNewReleases || hasNewRepositories;

  const output = {
    has_updates: hasUpdates,
    has_new_releases: hasNewReleases,
    has_new_repos: hasNewRepositories,
    releases_to_analyze: releasesToAnalyze,
    releases_count: releasesToAnalyze.length,
    repositories_affected: Object.keys(repoSummary).length,
    repository_summary: repoSummary,
    mode: mode,
    // Include repositories for use by update-master.js
    repositories: repositoriesList,
    repositories_count: repositoriesList.length,
    new_repositories: newRepositories,
    new_repositories_count: newRepositories.length,
    warnings: warnings
  };

  console.log(JSON.stringify(output, null, 2));
}

// Run if executed directly
if (require.main === module) {
  main().catch(error => {
    console.error('Error:', error);
    process.exit(1);
  });
}

module.exports = { loadMasterMetadata, fetchAPIRepositories, fetchReleases };