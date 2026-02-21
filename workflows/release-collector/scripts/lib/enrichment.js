/**
 * API Enrichment Utility Library
 *
 * Functions for runtime enrichment of API data with landscape information.
 * Handles API name matching including previous names.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

/**
 * Load the API landscape configuration
 * @param {string} landscapePath - Path to api-landscape.yaml (optional)
 * @returns {object} Parsed landscape data
 */
function loadLandscape(landscapePath) {
  const defaultPath = path.join(__dirname, '..', '..', '..', '..', 'config', 'api-landscape.yaml'); // /config at repository root
  const filePath = landscapePath || process.env.API_LANDSCAPE_PATH || defaultPath;

  if (!fs.existsSync(filePath)) {
    console.warn(`API landscape file not found at ${filePath}`);
    return null;
  }

  try {
    return yaml.load(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    console.error(`Failed to load API landscape: ${error.message}`);
    return null;
  }
}

/**
 * Find enrichment data for an API
 * @param {string} apiName - The API name to look up
 * @param {object} landscape - The loaded landscape data
 * @returns {object|null} Enrichment data with canonical_name if matched via previous_names
 */
function findEnrichment(apiName, landscape) {
  if (!landscape || !landscape.apis || !apiName) {
    return null;
  }

  // Direct match - API name exists as-is in landscape
  if (landscape.apis[apiName]) {
    return {
      ...landscape.apis[apiName],
      canonical_name: apiName  // For direct match, canonical name is the same
    };
  }

  // Check previous names for renamed APIs
  for (const [canonicalName, apiData] of Object.entries(landscape.apis)) {
    if (apiData.previous_names && Array.isArray(apiData.previous_names)) {
      if (apiData.previous_names.includes(apiName)) {
        // Found via previous name - return with canonical name
        return {
          ...apiData,
          canonical_name: canonicalName  // This is the current/canonical name
        };
      }
    }
  }

  return null;
}

/**
 * Apply enrichment to a single API object
 * @param {object} api - The API object from master metadata
 * @param {object} landscape - The loaded landscape data
 * @param {string} currentMetaRelease - Current meta-release being processed (for isNew)
 * @returns {object} Enriched API object
 */
function enrichAPI(api, landscape, currentMetaRelease = null) {
  const enrichment = findEnrichment(api.api_name, landscape);

  // Determine API maturity based on api_version
  let maturity = 'initial';  // default
  if (api.api_version && typeof api.api_version === 'string') {
    if (api.api_version.match(/^0\./)) {
      maturity = 'initial';
    } else {
      maturity = 'stable';
    }
  }

  if (!enrichment) {
    // No enrichment found - return API as-is with defaults
    return {
      ...api,
      maturity: maturity,
      portfolio_category: null,
      website_url: null,
      tooltip: null,
      display_name: api.api_title || api.api_name,
      published: true,  // Default to published if not specified
      canonical_name: api.api_name,
      first_release: 'Sandbox',  // Default for unknown APIs
      // Add isNew for meta-release reports
      ...(currentMetaRelease && ['Fall24', 'Spring25', 'Fall25'].includes(currentMetaRelease) ? {
        isNew: false  // Default to false for unknown APIs
      } : {})
    };
  }

  // Determine isNew based on first_release and current meta-release
  let isNew = false;
  if (currentMetaRelease && enrichment.first_release &&
      ['Fall24', 'Spring25', 'Fall25'].includes(currentMetaRelease)) {
    isNew = enrichment.first_release === currentMetaRelease;
  }

  // Apply enrichment
  return {
    ...api,
    // Maturity based on version
    maturity: maturity,
    // Enrichment fields
    portfolio_category: enrichment.category || null,
    website_url: enrichment.website_url || null,
    tooltip: enrichment.tooltip || null,
    display_name: enrichment.display_name || api.api_title || api.api_name,
    published: enrichment.published !== false,  // Default to true
    canonical_name: enrichment.canonical_name || api.api_name,
    first_release: enrichment.first_release || 'Sandbox',
    // Include previous names if this was matched via previous name
    ...(enrichment.previous_names ? { previous_names: enrichment.previous_names } : {}),
    // Add isNew for meta-release reports
    ...(currentMetaRelease && ['Fall24', 'Spring25', 'Fall25'].includes(currentMetaRelease) ? {
      isNew: isNew
    } : {})
  };
}

/**
 * Apply enrichment to release data
 * @param {object} masterData - The master metadata with releases
 * @param {object} landscape - The loaded landscape data
 * @param {string} currentMetaRelease - Current meta-release being processed (optional)
 * @returns {object} Enriched release data
 */
function enrichReleaseData(masterData, landscape, currentMetaRelease = null) {
  if (!masterData || !masterData.releases) {
    return masterData;
  }

  return {
    ...masterData,
    releases: masterData.releases.map(release => ({
      ...release,
      apis: release.apis.map(api => enrichAPI(api, landscape, currentMetaRelease || release.meta_release))
    }))
  };
}

/**
 * Compare semantic versions for CAMARA API versioning
 * Handles formats: x.y.z, x.y.z-alpha, x.y.z-rc, x.y.z-alpha.n, x.y.z-rc.n
 * @param {string} v1 - First version
 * @param {string} v2 - Second version
 * @returns {number} 1 if v1 > v2, -1 if v1 < v2, 0 if equal
 */
function compareVersions(v1, v2) {
  // Parse version: x.y.z[-prerelease[.n]]
  const parseVersion = (v) => {
    const [base, ...prerelease] = v.split('-');
    const [major, minor, patch] = base.split('.').map(Number);
    const pre = prerelease.join('-');  // Rejoin in case there are multiple hyphens

    let preType = '';
    let preNum = 0;

    if (pre) {
      if (pre.startsWith('alpha')) {
        preType = 'alpha';
        const num = pre.split('.')[1];
        preNum = num ? parseInt(num) : 1;  // alpha = alpha.1
      } else if (pre.startsWith('rc')) {
        preType = 'rc';
        const num = pre.split('.')[1];
        preNum = num ? parseInt(num) : 1;  // rc = rc.1
      }
    }

    return { major, minor, patch, preType, preNum };
  };

  const v1p = parseVersion(v1);
  const v2p = parseVersion(v2);

  // Compare major.minor.patch
  if (v1p.major !== v2p.major) return v1p.major > v2p.major ? 1 : -1;
  if (v1p.minor !== v2p.minor) return v1p.minor > v2p.minor ? 1 : -1;
  if (v1p.patch !== v2p.patch) return v1p.patch > v2p.patch ? 1 : -1;

  // Both are release versions (no pre-release)
  if (!v1p.preType && !v2p.preType) return 0;

  // Pre-release has lower precedence than release
  if (v1p.preType && !v2p.preType) return -1;
  if (!v1p.preType && v2p.preType) return 1;

  // Both have pre-release, compare type (alpha < rc)
  if (v1p.preType !== v2p.preType) {
    if (v1p.preType === 'alpha') return -1;
    if (v2p.preType === 'alpha') return 1;
  }

  // Same pre-release type, compare numbers
  return v1p.preNum > v2p.preNum ? 1 : v1p.preNum < v2p.preNum ? -1 : 0;
}

/**
 * Generate statistics with canonical name grouping
 * @param {array} releases - Array of release objects with enriched APIs
 * @returns {object} Statistics object
 */
function generateEnrichedStatistics(releases) {
  const stats = {
    total_repositories: new Set(),
    total_apis: 0,
    unique_apis: new Set(),
    canonical_apis: new Set(),
    api_maturity: {
      stable: 0,
      initial: 0,
      rc: 0
    },
    unique_api_maturity: {
      stable: 0,
      initial: 0,
      rc: 0
    },
    latest_versions: new Map(),  // Track latest version per canonical API
    categories: {},
    commonalities_versions: new Set(),
    apis_with_renames: 0
  };

  for (const release of releases) {
    stats.total_repositories.add(release.repository);

    for (const api of release.apis) {
      stats.total_apis++;

      // Track both original and canonical names
      stats.unique_apis.add(api.api_name);
      stats.canonical_apis.add(api.canonical_name || api.api_name);

      // Count renamed APIs
      if (api.previous_names && api.previous_names.length > 0) {
        stats.apis_with_renames++;
      }

      // Determine API maturity
      if (api.api_version) {
        if (api.api_version.includes('-rc')) {
          stats.api_maturity.rc++;
        } else if (api.api_version.match(/^0\./)) {
          stats.api_maturity.initial++;
        } else {
          stats.api_maturity.stable++;
        }

        // Track latest version per canonical API
        const canonicalName = api.canonical_name || api.api_name;
        const currentLatest = stats.latest_versions.get(canonicalName);
        if (!currentLatest || compareVersions(api.api_version, currentLatest) > 0) {
          stats.latest_versions.set(canonicalName, api.api_version);
        }
      }

      // Track categories
      if (api.portfolio_category) {
        stats.categories[api.portfolio_category] =
          (stats.categories[api.portfolio_category] || 0) + 1;
      }

      // Track commonalities versions
      if (api.commonalities) {
        stats.commonalities_versions.add(api.commonalities);
      }
    }
  }

  // Calculate unique API maturity based on latest versions
  for (const [canonicalName, latestVersion] of stats.latest_versions) {
    if (latestVersion.includes('-rc')) {
      stats.unique_api_maturity.rc++;
    } else if (latestVersion.match(/^0\./)) {
      stats.unique_api_maturity.initial++;
    } else {
      stats.unique_api_maturity.stable++;
    }
  }

  return {
    repositories_count: stats.total_repositories.size,
    api_versions_count: stats.total_apis,  // Total API versions (apis × versions)
    unique_api_names_count: stats.unique_apis.size,  // Count of different API names found
    unique_apis_count: stats.canonical_apis.size,  // Count of unique APIs after canonical grouping
    api_version_maturity: stats.api_maturity,  // Maturity count by version (not unique APIs)
    unique_api_maturity: stats.unique_api_maturity,  // Maturity based on latest version per API
    categories: stats.categories,
    commonalities_versions: Array.from(stats.commonalities_versions).sort(),
    apis_with_previous_names: stats.apis_with_renames
  };
}

/**
 * Create a flattened view of APIs for viewer consumption
 * @param {array} releases - Array of release objects with enriched APIs
 * @returns {array} Flattened array of API objects with release context
 */
function createFlattenedAPIView(releases) {
  const flatApis = [];

  for (const release of releases) {
    for (const api of release.apis) {
      flatApis.push({
        ...api,
        // Add release context
        repository: release.repository,
        release_tag: release.release_tag,
        release_date: release.release_date,
        meta_release: release.meta_release,
        github_url: release.github_url,
        release_type: release.release_type,
        ...(release.repository_archived ? { repository_archived: true } : {})
      });
    }
  }

  // Sort by repository and API name for consistent ordering
  flatApis.sort((a, b) => {
    const repoCompare = a.repository.localeCompare(b.repository);
    if (repoCompare !== 0) return repoCompare;
    return (a.canonical_name || a.api_name).localeCompare(b.canonical_name || b.api_name);
  });

  return flatApis;
}

/**
 * Group releases by repository for summary view
 * @param {array} releases - Array of release objects
 * @returns {object} Repository summary object
 */
function createRepositorySummary(releases) {
  const summary = {};

  for (const release of releases) {
    if (!summary[release.repository]) {
      summary[release.repository] = {
        releases: [],
        total_apis: 0,
        unique_apis: new Set(),
        ...(release.repository_archived ? { repository_archived: true } : {})
      };
    }

    summary[release.repository].releases.push({
      tag: release.release_tag,
      date: release.release_date,
      apis_count: release.apis.length
    });

    summary[release.repository].total_apis += release.apis.length;

    // Track unique APIs by canonical name
    for (const api of release.apis) {
      summary[release.repository].unique_apis.add(api.canonical_name || api.api_name);
    }
  }

  // Convert Sets to counts
  for (const repo of Object.keys(summary)) {
    summary[repo].unique_apis_count = summary[repo].unique_apis.size;
    delete summary[repo].unique_apis;  // Remove the Set from output

    // Sort releases by date
    summary[repo].releases.sort((a, b) =>
      new Date(b.date) - new Date(a.date)
    );
  }

  return summary;
}

module.exports = {
  loadLandscape,
  findEnrichment,
  enrichAPI,
  enrichReleaseData,
  generateEnrichedStatistics,
  createFlattenedAPIView,
  createRepositorySummary
};