#!/usr/bin/env node

/**
 * Generate Release Metadata Script
 *
 * Generates release-metadata.yaml files for ALL releases.
 * Conforms to the schema at:
 * upstream/traversals/ReleaseManagement/artifacts/metadata-schemas/schemas/release-metadata-schema.yaml
 *
 * Always regenerates ALL metadata files - git diff shows what changed.
 * No modes needed - idempotent regeneration.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

// Paths
const DATA_DIR = path.join(__dirname, '..', '..', '..', 'data');
const MASTER_FILE = path.join(DATA_DIR, 'releases-master.yaml');
const ARTIFACTS_DIR = path.join(DATA_DIR, 'release-artifacts');

/**
 * Load the master metadata file
 * @returns {object} Master metadata with releases
 */
function loadMaster() {
  if (!fs.existsSync(MASTER_FILE)) {
    console.error(`Master file not found: ${MASTER_FILE}`);
    process.exit(1);
  }
  return yaml.load(fs.readFileSync(MASTER_FILE, 'utf8'));
}

/**
 * Convert master release entry to release-metadata schema format
 * @param {object} release - Release from releases-master.yaml
 * @returns {object} Release metadata conforming to upstream schema
 */
function toReleaseMetadata(release) {
  // Use schema 2.0.0 property names only (clean break)
  const apis = (release.apis || []).map(api => ({
    api_name: api.api_name,
    api_version: api.api_version,
    api_title: api.api_title || api.api_name
  }));

  return {
    repository: {
      repository_name: release.repository,
      release_tag: release.release_tag,
      release_type: release.release_type,  // Use directly from master file
      release_date: formatReleaseDate(release.release_date),
      src_commit_sha: null  // Not available for backfill
    },
    apis: apis
  };
}

/**
 * Format release date to ISO 8601 UTC format
 * @param {string} dateString - Date string from release
 * @returns {string|null} Formatted date or null
 */
function formatReleaseDate(dateString) {
  if (!dateString) return null;

  try {
    const date = new Date(dateString);
    // Format: YYYY-MM-DDTHH:MM:SSZ
    return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
  } catch (e) {
    return dateString;
  }
}

/**
 * Write release metadata files
 * @param {object} metadata - Release metadata object
 * @param {string} repo - Repository name
 * @param {string} tag - Release tag
 */
function writeMetadataFiles(metadata, repo, tag) {
  const dir = path.join(ARTIFACTS_DIR, repo, tag);

  // Create directory structure
  fs.mkdirSync(dir, { recursive: true });

  // Write YAML file
  const yamlContent = yaml.dump(metadata, {
    indent: 2,
    lineWidth: -1,
    noRefs: true,
    quotingType: '"',
    forceQuotes: false
  });
  fs.writeFileSync(path.join(dir, 'release-metadata.yaml'), yamlContent);

}

/**
 * Process all releases
 * @returns {object} Processing results
 */
function processReleases() {
  const master = loadMaster();
  const releases = master.releases || [];

  const results = {
    processed: 0,
    errors: [],
    files: []
  };

  console.error(`Processing ${releases.length} releases...`);

  for (const release of releases) {
    const repo = release.repository;
    const tag = release.release_tag;

    try {
      const metadata = toReleaseMetadata(release);
      writeMetadataFiles(metadata, repo, tag);

      console.error(`Generated ${repo}/${tag}`);
      results.processed++;
      results.files.push(`${repo}/${tag}/release-metadata.yaml`);
    } catch (error) {
      console.error(`Error processing ${repo}/${tag}: ${error.message}`);
      results.errors.push({ repo, tag, error: error.message });
    }
  }

  return results;
}

/**
 * Main execution
 */
function main() {
  const args = process.argv.slice(2);

  // Check for help
  if (args.includes('--help') || args.includes('-h')) {
    console.error(`
Usage: node generate-release-metadata.js

Generates release-metadata.yaml files for ALL releases
in releases-master.yaml. Always regenerates all files - git diff shows changes.

Output directory: data/release-artifacts/{repo}/{tag}/
`);
    process.exit(0);
  }

  console.error('Release Metadata Generator');
  console.error('');

  const results = processReleases();

  // Output summary
  console.error('');
  console.error('=== Summary ===');
  console.error(`Processed: ${results.processed}`);
  console.error(`Errors: ${results.errors.length}`);

  if (results.errors.length > 0) {
    console.error('\nErrors:');
    results.errors.forEach(e => {
      console.error(`  ${e.repo}/${e.tag}: ${e.error}`);
    });
  }

  // Output JSON summary to stdout for workflow consumption
  console.log(JSON.stringify({
    processed: results.processed,
    errors: results.errors.length,
    files: results.files
  }, null, 2));

  // Exit with error if all releases failed
  if (results.processed === 0 && results.errors.length > 0) {
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

module.exports = {
  toReleaseMetadata,
  processReleases,
  loadMaster,
  formatReleaseDate
};
