#!/usr/bin/env node

/**
 * Update Master Metadata Script
 *
 * Combines analyzed release data from multiple repositories and updates
 * the master metadata file. Format corrections have already been applied
 * by analyze-release.js (v-prefix removal, commonalities as numbers, etc).
 *
 * Usage:
 *   node update-master.js --mode incremental --input analysis-results.json
 *   node update-master.js --mode full --input analysis-results.json
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

// Paths
// Paths (relative to repository root)
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const DATA_PATH = path.join(REPO_ROOT, 'data');
const CONFIG_PATH = path.join(__dirname, '..', '..', '..', 'config'); // /config at repository root
const MASTER_FILE = path.join(DATA_PATH, 'releases-master.yaml');

/**
 * Load meta-release mappings configuration
 */
function loadMappings() {
  const mappingsFile = path.join(CONFIG_PATH, 'meta-release-mappings.yaml');
  return yaml.load(fs.readFileSync(mappingsFile, 'utf8'));
}

/**
 * Load current master metadata
 */
function loadMaster() {
  if (!fs.existsSync(MASTER_FILE)) {
    // Initialize if doesn't exist
    return {
      metadata: {
        last_updated: null,
        workflow_version: "3.0.0",
        schema_version: "2.1.0"
      },
      releases: [],
      repositories: []
    };
  }
  const master = yaml.load(fs.readFileSync(MASTER_FILE, 'utf8'));
  // Ensure repositories array exists (migration from 1.0.0)
  if (!master.repositories) {
    master.repositories = [];
  }
  // Update schema version if needed
  master.metadata.schema_version = "2.0.0";
  return master;
}

/**
 * Determine meta-release for a repository and release tag
 * Now only processing rX.Y format releases
 */
function getMetaRelease(repository, releaseTag, mappings) {
  // Extract release cycle from tag (rX.Y -> rX)
  const cycle = releaseTag.match(/^(r\d+)\./)?.[1];
  if (!cycle) {
    console.error(`Warning: Unexpected release tag format: ${releaseTag}`);
    return 'Unknown';
  }

  // Check each meta-release
  for (const [metaRelease, repos] of Object.entries(mappings.mappings)) {
    if (repos[repository] === cycle) {
      return metaRelease;
    }
  }

  return 'None (Sandbox)';  // rX.Y format but not mapped to a meta-release
}

/**
 * Find existing release in master data
 */
function findExistingRelease(releases, repository, releaseTag) {
  return releases.findIndex(r =>
    r.repository === repository && r.release_tag === releaseTag
  );
}

/**
 * Determine if a pre-release should be included
 * A pre-release is excluded if there's a non-prerelease in the same cycle
 */
function shouldIncludePrerelease(prerelease, allReleases) {
  const cycle = prerelease.release_tag.match(/^(r\d+)\./)?.[1];
  if (!cycle) return true;

  const hasPublicRelease = allReleases.some(r =>
    r.repository === prerelease.repository &&
    r.release_tag.startsWith(cycle + '.') &&
    !r.is_prerelease
  );

  return !hasPublicRelease;
}

/**
 * Determine release_type for non-prereleases
 * - First non-prerelease in a cycle → public-release
 * - Subsequent non-prereleases → maintenance-release
 */
function determineNonPrereleaseType(release, allReleases) {
  const cycle = release.release_tag.match(/^(r\d+)\./)?.[1];
  if (!cycle) return 'public-release';

  // Get all non-prereleases in the same cycle for this repo, sorted by tag
  const cycleReleases = allReleases
    .filter(r =>
      r.repository === release.repository &&
      r.release_tag.startsWith(cycle + '.') &&
      !r.is_prerelease
    )
    .sort((a, b) => {
      const aMatch = a.release_tag.match(/r\d+\.(\d+)/);
      const bMatch = b.release_tag.match(/r\d+\.(\d+)/);
      return (aMatch ? parseInt(aMatch[1]) : 0) - (bMatch ? parseInt(bMatch[1]) : 0);
    });

  // First one in the cycle is public-release, rest are maintenance
  if (cycleReleases.length > 0 && cycleReleases[0].release_tag === release.release_tag) {
    return 'public-release';
  }
  return 'maintenance-release';
}

/**
 * Compute repository release references
 * - latest_public_release: Most recent public/maintenance release
 * - newest_pre_release: Most recent pre-release if newer than latest public
 */
function computeRepoReleaseRefs(repoName, releases) {
  const repoReleases = releases.filter(r => r.repository === repoName);

  // Find latest public/maintenance release (by date)
  const publicReleases = repoReleases
    .filter(r => r.release_type === 'public-release' || r.release_type === 'maintenance-release')
    .sort((a, b) => new Date(b.release_date) - new Date(a.release_date));
  const latestPublic = publicReleases[0]?.release_tag || null;
  const latestPublicDate = publicReleases[0]?.release_date || null;

  // Find newest non-superseded pre-release (only if newer than latest public)
  const preReleases = repoReleases
    .filter(r => (r.release_type === 'pre-release-alpha' || r.release_type === 'pre-release-rc')
                 && !r.superseded)
    .sort((a, b) => new Date(b.release_date) - new Date(a.release_date));

  let newestPreRelease = null;
  if (preReleases.length > 0) {
    const newestPre = preReleases[0];
    if (!latestPublicDate || new Date(newestPre.release_date) > new Date(latestPublicDate)) {
      newestPreRelease = newestPre.release_tag;
    }
  }

  return {
    latest_public_release: latestPublic,
    newest_pre_release: newestPreRelease
  };
}

/**
 * Update master metadata with new analysis results
 * Format corrections have already been applied by analyze-release.js
 * Returns { master, hasContentChanges } to track if actual updates occurred
 */
function updateMaster(master, analysisResults, mode, mappings, archivedRepoNames = new Set()) {
  let releasesAdded = 0;
  let releasesUpdated = 0;
  let releasesSuperseded = 0;

  // First pass: add all releases to get complete picture for superseded detection
  const tempReleases = [...master.releases];

  for (const result of analysisResults) {
    const existingIndex = tempReleases.findIndex(r =>
      r.repository === result.repository && r.release_tag === result.release_tag
    );

    const tempEntry = {
      repository: result.repository,
      release_tag: result.release_tag,
      release_date: result.release_date,
      is_prerelease: result.is_prerelease,
      release_type: result.release_type  // Pre-populated for pre-releases, null for non-prereleases
    };

    if (existingIndex >= 0) {
      tempReleases[existingIndex] = { ...tempReleases[existingIndex], ...tempEntry };
    } else {
      tempReleases.push(tempEntry);
    }
  }

  // Second pass: process results with full context
  for (const result of analysisResults) {
    // Detect superseded pre-releases (mark instead of removing)
    let superseded = false;
    if (result.is_prerelease && !shouldIncludePrerelease(result, tempReleases)) {
      superseded = true;
      releasesSuperseded++;
    }

    const metaRelease = getMetaRelease(result.repository, result.release_tag, mappings);

    // Determine release_type
    let releaseType = result.release_type;  // Use pre-populated type for pre-releases
    if (!releaseType && !result.is_prerelease) {
      // Determine public-release vs maintenance-release for non-prereleases
      releaseType = determineNonPrereleaseType(result, tempReleases);
    }

    // Build release entry (with format corrections already applied)
    const releaseEntry = {
      repository: result.repository,
      release_tag: result.release_tag,
      release_date: result.release_date,
      meta_release: metaRelease,
      github_url: result.github_url,
      release_type: releaseType,
      superseded: superseded || undefined,  // only present when true
      repository_archived: archivedRepoNames.has(result.repository) || undefined,  // only present when true
      apis: result.apis.map(api => ({
        api_name: api.api_name,        // Raw API name from server URL
        file_name: api.file_name,      // Raw filename for reference
        api_version: api.api_version,
        api_title: api.api_title,
        commonalities: api.commonalities
      }))
    };

    // Find if release already exists
    const existingIndex = findExistingRelease(master.releases, result.repository, result.release_tag);

    if (existingIndex >= 0) {
      // Update existing release
      master.releases[existingIndex] = releaseEntry;
      releasesUpdated++;
      console.log(`Updated: ${result.repository} ${result.release_tag} (${releaseType}${superseded ? ', superseded' : ''})`);
    } else {
      // Add new release
      master.releases.push(releaseEntry);
      releasesAdded++;
      console.log(`Added: ${result.repository} ${result.release_tag} (${releaseType}${superseded ? ', superseded' : ''})`);
    }
  }

  // Retroactive superseded marking: when a new public release is added,
  // existing pre-releases in the same cycle become superseded.
  // Note: is_prerelease is not persisted in master, so use release_type.
  let retroactiveCount = 0;
  for (const release of master.releases) {
    const isPreRelease = release.release_type?.startsWith('pre-release-');
    if (isPreRelease && !release.superseded) {
      const cycle = release.release_tag.match(/^(r\d+)\./)?.[1];
      if (cycle) {
        const hasPublicRelease = master.releases.some(r =>
          r.repository === release.repository &&
          r.release_tag.startsWith(cycle + '.') &&
          r.release_type && !r.release_type.startsWith('pre-release-')
        );
        if (hasPublicRelease) {
          release.superseded = true;
          retroactiveCount++;
          console.log(`Retroactively superseded: ${release.repository} ${release.release_tag}`);
        }
      }
    }
  }

  // Sort releases by repository name, then by release tag
  master.releases.sort((a, b) => {
    if (a.repository !== b.repository) {
      return a.repository.localeCompare(b.repository);
    }
    // Extract version numbers for proper sorting
    const aVersion = a.release_tag.match(/r(\d+)\.(\d+)/);
    const bVersion = b.release_tag.match(/r(\d+)\.(\d+)/);
    if (aVersion && bVersion) {
      const aMajor = parseInt(aVersion[1]);
      const bMajor = parseInt(bVersion[1]);
      if (aMajor !== bMajor) return aMajor - bMajor;
      return parseInt(aVersion[2]) - parseInt(bVersion[2]);
    }
    return a.release_tag.localeCompare(b.release_tag);
  });

  // Track whether content changed
  const hasReleaseChanges = releasesAdded > 0 || releasesUpdated > 0 || retroactiveCount > 0;
  console.log(`\nRelease changes: ${releasesAdded} added, ${releasesUpdated} updated, ${releasesSuperseded} superseded (new), ${retroactiveCount} superseded (retroactive)`);

  return { master, hasReleaseChanges };
}

/**
 * Update repositories array with release references
 * Returns hasRepoChanges flag indicating if repository list changed
 */
function updateRepositories(master, repositoriesInput) {
  // Track existing repos for change detection
  const existingRepoNames = new Set(master.repositories.map(r => r.repository));
  const inputRepoNames = new Set(repositoriesInput.map(r => r.repository));

  // Detect new repositories
  const newRepos = repositoriesInput.filter(r => !existingRepoNames.has(r.repository));
  const hasRepoChanges = newRepos.length > 0;

  if (newRepos.length > 0) {
    console.log(`\nNew repositories detected: ${newRepos.length}`);
    newRepos.forEach(r => console.log(`  + ${r.repository}`));
  }

  // Build map of repos
  const repoMap = new Map();

  // Add all repos from input
  for (const repo of repositoriesInput) {
    repoMap.set(repo.repository, {
      repository: repo.repository,
      github_url: repo.github_url,
      ...(repo.archived ? { repository_archived: true } : {})
    });
  }

  // Compute release references for each repo
  for (const [repoName, repoData] of repoMap) {
    const refs = computeRepoReleaseRefs(repoName, master.releases);
    repoData.latest_public_release = refs.latest_public_release;
    repoData.newest_pre_release = refs.newest_pre_release;
  }

  // Convert to sorted array
  master.repositories = Array.from(repoMap.values())
    .sort((a, b) => a.repository.localeCompare(b.repository));

  console.log(`\nRepositories updated: ${master.repositories.length}`);
  const withPublic = master.repositories.filter(r => r.latest_public_release).length;
  const withPreOnly = master.repositories.filter(r => !r.latest_public_release && r.newest_pre_release).length;
  const noReleases = master.repositories.filter(r => !r.latest_public_release && !r.newest_pre_release).length;
  const archivedCount = master.repositories.filter(r => r.repository_archived).length;
  console.log(`  With public release: ${withPublic}`);
  console.log(`  Pre-release only: ${withPreOnly}`);
  console.log(`  No releases: ${noReleases}`);
  if (archivedCount > 0) {
    console.log(`  Archived: ${archivedCount}`);
  }

  return hasRepoChanges;
}

/**
 * Main execution
 */
async function main() {
  const args = process.argv.slice(2);

  // Parse arguments
  let mode = 'incremental';
  let inputFile = null;
  let reposFile = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--mode' && i + 1 < args.length) {
      mode = args[i + 1];
      i++;
    } else if (args[i] === '--input' && i + 1 < args.length) {
      inputFile = args[i + 1];
      i++;
    } else if (args[i] === '--repos' && i + 1 < args.length) {
      reposFile = args[i + 1];
      i++;
    }
  }

  if (!inputFile) {
    console.error('Usage: node update-master.js --mode [incremental|full] --input <analysis-results.json> [--repos <repositories.json>]');
    process.exit(1);
  }

  try {
    // Load configurations
    const mappings = loadMappings();
    const master = loadMaster();

    // Load analysis results
    if (!fs.existsSync(inputFile)) {
      console.error(`Input file not found: ${inputFile}`);
      process.exit(1);
    }
    const analysisResults = JSON.parse(fs.readFileSync(inputFile, 'utf8'));

    // If full mode, completely rebuild from scratch
    if (mode === 'full') {
      console.log(`Full mode: Rebuilding master metadata from scratch`);
      master.releases = [];  // Clear ALL existing releases
    }

    // Build set of archived repository names from repos data (if available)
    let archivedRepoNames = new Set();
    let reposData = null;
    if (reposFile) {
      if (!fs.existsSync(reposFile)) {
        console.error(`Repos file not found: ${reposFile}`);
        process.exit(1);
      }
      reposData = JSON.parse(fs.readFileSync(reposFile, 'utf8'));
      archivedRepoNames = new Set(
        (reposData.repositories || [])
          .filter(r => r.archived)
          .map(r => r.repository)
      );
      if (archivedRepoNames.size > 0) {
        console.log(`Archived repositories: ${Array.from(archivedRepoNames).join(', ')}`);
      }
    }

    // Update master with new data
    const { master: updatedMaster, hasReleaseChanges } = updateMaster(master, analysisResults, mode, mappings, archivedRepoNames);

    // Update repositories if repos file provided
    let hasRepoChanges = false;
    if (reposData) {
      hasRepoChanges = updateRepositories(updatedMaster, reposData.repositories || []);
    }

    // Only update last_updated if actual content changed
    const hasContentChanges = hasReleaseChanges || hasRepoChanges || mode === 'full';
    if (hasContentChanges) {
      const timestamp = new Date().toISOString();
      updatedMaster.metadata.last_updated = timestamp;
      console.log(`\nContent changes detected - updated last_updated to ${timestamp}`);
    } else {
      console.log(`\nNo content changes - last_updated unchanged`);
    }

    // Remove last_checked if it exists (migration)
    delete updatedMaster.metadata.last_checked;

    // Write updated master file
    const yamlContent = yaml.dump(updatedMaster, {
      lineWidth: -1,
      noRefs: true,
      sortKeys: false
    });

    fs.writeFileSync(MASTER_FILE, yamlContent);
    console.log(`\nMaster metadata updated successfully`);
    console.log(`Total releases: ${updatedMaster.releases.length}`);

    // Summary by meta-release
    const summary = {};
    for (const release of updatedMaster.releases) {
      const mr = release.meta_release;
      if (!summary[mr]) {
        summary[mr] = { repositories: new Set(), apis: 0 };
      }
      summary[mr].repositories.add(release.repository);
      summary[mr].apis += release.apis.length;
    }

    console.log('\nSummary by meta-release:');
    for (const [mr, stats] of Object.entries(summary)) {
      console.log(`  ${mr}: ${stats.repositories.size} repositories, ${stats.apis} APIs`);
    }

    // Summary by release_type
    const typeSummary = {};
    for (const release of updatedMaster.releases) {
      const rt = release.release_type || 'unknown';
      typeSummary[rt] = (typeSummary[rt] || 0) + 1;
    }
    console.log('\nSummary by release_type:');
    for (const [rt, count] of Object.entries(typeSummary)) {
      console.log(`  ${rt}: ${count}`);
    }

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
  loadMaster,
  loadMappings,
  updateMaster,
  updateRepositories,
  getMetaRelease,
  shouldIncludePrerelease,
  determineNonPrereleaseType,
  computeRepoReleaseRefs
};