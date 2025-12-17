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
        last_checked: null,
        workflow_version: "3.0.0",
        schema_version: "1.0.0"
      },
      releases: []
    };
  }
  return yaml.load(fs.readFileSync(MASTER_FILE, 'utf8'));
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
 * Update master metadata with new analysis results
 * Format corrections have already been applied by analyze-release.js
 */
function updateMaster(master, analysisResults, mode, mappings) {
  const timestamp = new Date().toISOString();

  // Update metadata
  master.metadata.last_updated = timestamp;
  master.metadata.last_checked = timestamp;

  // Process each analysis result
  for (const result of analysisResults) {
    const metaRelease = getMetaRelease(result.repository, result.release_tag, mappings);

    // Build release entry (with format corrections already applied)
    const releaseEntry = {
      repository: result.repository,
      release_tag: result.release_tag,
      release_date: result.release_date,
      meta_release: metaRelease,
      github_url: result.github_url,
      apis: result.apis.map(api => ({
        api_name: api.api_name,        // Raw API name from server URL
        file_name: api.file_name,      // Raw filename for reference
        version: api.version,
        title: api.title,
        commonalities: api.commonalities
      }))
    };

    // Find if release already exists
    const existingIndex = findExistingRelease(master.releases, result.repository, result.release_tag);

    if (existingIndex >= 0) {
      // Update existing release
      master.releases[existingIndex] = releaseEntry;
      console.log(`Updated: ${result.repository} ${result.release_tag}`);
    } else {
      // Add new release
      master.releases.push(releaseEntry);
      console.log(`Added: ${result.repository} ${result.release_tag}`);
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

  return master;
}

/**
 * Main execution
 */
async function main() {
  const args = process.argv.slice(2);

  // Parse arguments
  let mode = 'incremental';
  let inputFile = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--mode' && i + 1 < args.length) {
      mode = args[i + 1];
      i++;
    } else if (args[i] === '--input' && i + 1 < args.length) {
      inputFile = args[i + 1];
      i++;
    }
  }

  if (!inputFile) {
    console.error('Usage: node update-master.js --mode [incremental|full] --input <analysis-results.json>');
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

    // Update master with new data
    const updatedMaster = updateMaster(master, analysisResults, mode, mappings);

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
  getMetaRelease
};