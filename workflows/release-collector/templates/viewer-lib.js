/**
 * CAMARA Viewer Library v3
 * Shared utilities for meta-release viewers
 *
 * This library is embedded in all generated viewer HTML files
 */

const ViewerLib = {
  /**
   * Compare two semantic version strings
   * @param {string} a - First version
   * @param {string} b - Second version
   * @returns {number} -1 if a < b, 0 if equal, 1 if a > b
   */
  compareVersions: function (a, b) {
    if (!a && !b) return 0;
    if (!a) return -1;
    if (!b) return 1;

    const partsA = a.split(/[.-]/);
    const partsB = b.split(/[.-]/);
    const maxLen = Math.max(partsA.length, partsB.length);

    for (let i = 0; i < maxLen; i++) {
      const partA = parseInt(partsA[i]) || 0;
      const partB = parseInt(partsB[i]) || 0;

      if (partA < partB) return -1;
      if (partA > partB) return 1;
    }

    return 0;
  },

  /**
   * Parse semantic version into components
   * @param {string} version - Version string (e.g., "1.2.3")
   * @returns {Object} {major, minor, patch} or null if invalid
   */
  parseVersion: function (version) {
    if (!version) return null;

    const parts = version.split(/[.-]/);
    if (parts.length < 2) return null;

    return {
      major: parseInt(parts[0]) || 0,
      minor: parseInt(parts[1]) || 0,
      patch: parseInt(parts[2]) || 0,
      full: version
    };
  },

  /**
   * Filter to latest patch release per MAJOR.MINOR cycle
   * Keeps all different MAJOR.MINOR versions, filters older patches
   * @param {Array} apis - Flat array of API objects
   * @returns {Array} Filtered array with latest patch per release cycle
   */
  filterLatestPatches: function (apis) {
    // Group by canonical_name + MAJOR.MINOR
    const grouped = {};

    apis.forEach(api => {
      const apiKey = api.canonical_name || api.api_name;
      const parsedVersion = this.parseVersion(api.api_version);

      if (!parsedVersion) {
        // Keep APIs without valid versions
        const key = `${apiKey}|unknown`;
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(api);
        return;
      }

      // Group by API name + MAJOR.MINOR
      const releaseKey = `${apiKey}|${parsedVersion.major}.${parsedVersion.minor}`;

      if (!grouped[releaseKey]) {
        grouped[releaseKey] = [];
      }
      grouped[releaseKey].push(api);
    });

    // For each group, find the latest patch
    const latest = [];
    Object.keys(grouped).forEach(key => {
      const versions = grouped[key];

      if (versions.length === 1) {
        // Only one version in this release cycle
        latest.push(versions[0]);
        return;
      }

      // Sort by patch version (descending), then by date (descending)
      versions.sort((a, b) => {
        const versionCompare = this.compareVersions(b.api_version, a.api_version);
        if (versionCompare !== 0) {
          return versionCompare;
        }
        // Same version, compare dates
        const dateA = new Date(a.release_date);
        const dateB = new Date(b.release_date);
        return dateB - dateA;
      });

      // Take the first (latest)
      latest.push(versions[0]);
    });

    return latest;
  },

  /**
   * Filter APIs based on criteria
   * @param {Array} apis - Array of API objects
   * @param {Object} criteria - Filter criteria
   * @returns {Array} Filtered APIs
   */
  filterAPIs: function (apis, criteria) {
    return apis.filter(api => {
      // Published filter
      if (criteria.publishedOnly && !api.published) {
        return false;
      }

      // Category filter - supports both single and multi-select
      if (criteria.category) {
        if (api.portfolio_category !== criteria.category) {
          return false;
        }
      } else if (criteria.categories && criteria.categories.length > 0) {
        if (!criteria.categories.includes(api.portfolio_category)) {
          return false;
        }
      }

      // Maturity filter
      if (criteria.maturity && api.maturity !== criteria.maturity) {
        return false;
      }

      // New filter
      if (criteria.isNew !== undefined && api.isNew !== criteria.isNew) {
        return false;
      }

      // Repository filter
      if (criteria.repository && !api.repository.toLowerCase().includes(criteria.repository.toLowerCase())) {
        return false;
      }

      // API name filter
      if (criteria.apiName && !api.api_name.toLowerCase().includes(criteria.apiName.toLowerCase())) {
        return false;
      }

      // Version range filters
      if (criteria.versionMin && this.compareVersions(api.api_version, criteria.versionMin) < 0) {
        return false;
      }
      if (criteria.versionMax && this.compareVersions(api.api_version, criteria.versionMax) > 0) {
        return false;
      }

      return true;
    });
  },

  /**
   * Search APIs by text query
   * @param {Array} apis - Array of API objects
   * @param {string} query - Search query
   * @returns {Array} Matching APIs
   */
  searchAPIs: function (apis, query) {
    if (!query) return apis;

    const lowerQuery = query.toLowerCase();
    return apis.filter(api =>
      api.api_name.toLowerCase().includes(lowerQuery) ||
      (api.api_title && api.api_title.toLowerCase().includes(lowerQuery)) ||
      (api.portfolio_category && api.portfolio_category.toLowerCase().includes(lowerQuery)) ||
      (api.repository && api.repository.toLowerCase().includes(lowerQuery))
    );
  },

  /**
   * Sort APIs by field
   * @param {Array} apis - Array of API objects
   * @param {string} field - Field to sort by
   * @param {boolean} ascending - Sort direction
   * @returns {Array} Sorted APIs
   */
  sortAPIs: function (apis, field, ascending = true) {
    const sorted = [...apis].sort((a, b) => {
      let aVal = a[field];
      let bVal = b[field];

      // Handle version fields specially
      if (field === 'api_version') {
        return this.compareVersions(aVal, bVal);
      }

      // Handle boolean fields
      if (typeof aVal === 'boolean') {
        return (aVal ? 1 : 0) - (bVal ? 1 : 0);
      }

      // Handle string fields
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return aVal.localeCompare(bVal);
      }

      // Handle null/undefined
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;

      return aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
    });

    return ascending ? sorted : sorted.reverse();
  },

  /**
   * Render category pill HTML
   * @param {string} category - Category name
   * @returns {string} HTML string
   */
  renderCategoryPill: function (category) {
    if (!category) {
      return '<span class="category-pill category-other">Other</span>';
    }

    const className = category.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    return `<span class="category-pill category-${className}">${category}</span>`;
  },

  /**
   * Compute API status from version string
   * Status progression: alpha -> rc -> public (initial or stable)
   * @param {string} version - API version string (e.g., "0.5.0-alpha.1", "1.0.0-rc.2", "1.0.0")
   * @returns {string} API status: 'alpha', 'rc', 'initial', 'stable'
   */
  getApiStatus: function (version) {
    if (!version) return 'unknown';
    if (version.includes('-alpha.')) return 'alpha';
    if (version.includes('-rc.')) return 'rc';
    // Public: check initial (0.x) vs stable (1.x+)
    if (version.match(/^0\./)) return 'initial';
    return 'stable';
  },

  /**
   * Render API status badge HTML
   * @param {string} status - API status from getApiStatus()
   * @returns {string} HTML string
   */
  renderApiStatusBadge: function (status) {
    const badges = {
      'stable': '<span class="badge badge-stable">Stable</span>',
      'initial': '<span class="badge badge-initial">Initial</span>',
      'rc': '<span class="badge badge-rc">RC</span>',
      'alpha': '<span class="badge badge-alpha">Alpha</span>'
    };
    return badges[status] || `<span class="badge badge-unknown">${status}</span>`;
  },

  /**
   * Render maturity badge HTML (deprecated - use renderApiStatusBadge)
   * @param {string} maturity - Maturity level
   * @returns {string} HTML string
   */
  renderMaturityBadge: function (maturity) {
    const badges = {
      'stable': '<span class="badge badge-stable">Stable</span>',
      'initial': '<span class="badge badge-initial">Initial</span>',
      'rc': '<span class="badge badge-rc">RC</span>',
      'alpha': '<span class="badge badge-alpha">Alpha</span>'
    };
    return badges[maturity] || `<span class="badge badge-unknown">${maturity}</span>`;
  },

  /**
   * Render "New" indicator HTML
   * @param {boolean} isNew - Whether API is new
   * @returns {string} HTML string
   */
  renderNewIndicator: function (isNew) {
    return isNew ? '<span class="badge badge-new">New</span>' : '-';
  },

  /**
   * Export APIs to CSV format
   * @param {Array} apis - APIs to export
   * @param {string} filename - Output filename
   */
  exportToCSV: function (apis, filename = 'camara-apis.csv') {
    const headers = ['API Name', 'API Title', 'API Version', 'Category', 'Maturity', 'Repository', 'New', 'Release Tag'];
    const rows = apis.map(api => [
      api.api_name || '',
      api.api_title || '',
      api.api_version || '',
      api.portfolio_category || '',
      api.maturity || '',
      api.repository || '',
      api.isNew ? 'Yes' : 'No',
      api.release_tag || ''
    ]);

    const csv = [headers, ...rows]
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    this.downloadFile(csv, filename, 'text/csv');
  },

  // Theme Toggling Logic
  // Theme Toggling Logic (3-State: Auto -> Light -> Dark)
  initThemeToggle: function (scope = 'default') {
    let themeToggleBtn = document.getElementById('theme-toggle');

    // In iframe: inject toggle into footer (header is hidden in iframe)
    if (this.isInIframe()) {
      const footerMetadata = document.getElementById('footer-metadata');
      if (footerMetadata) {
        const footerToggle = document.createElement('button');
        footerToggle.id = 'theme-toggle-footer';
        footerToggle.className = 'theme-toggle-btn theme-toggle-footer';
        footerToggle.setAttribute('aria-label', 'Toggle Dark Mode');
        footerToggle.innerHTML = '<span class="theme-icon">🌗</span>';
        footerMetadata.appendChild(footerToggle);
        themeToggleBtn = footerToggle;
      }
    }

    if (!themeToggleBtn) return;

    const storageKey = `camara-theme-${scope}`;
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    // State management: 'auto' | 'light' | 'dark'
    let currentState = localStorage.getItem(storageKey) || 'auto';

    function applyTheme(state) {
      // Determine effective theme
      let effectiveTheme = state;
      if (state === 'auto') {
        effectiveTheme = mediaQuery.matches ? 'dark' : 'light';
      }

      document.documentElement.setAttribute('data-theme', effectiveTheme);
      updateToggleIcon(state);
    }

    function updateToggleIcon(state) {
      let icon, label;
      switch (state) {
        case 'auto':
          icon = '🌗'; // Half moon/sun for Auto
          label = 'System Theme (Auto)';
          break;
        case 'light':
          icon = '☀️';
          label = 'Light Mode';
          break;
        case 'dark':
          icon = '🌙';
          label = 'Dark Mode';
          break;
      }

      const iconSpan = themeToggleBtn.querySelector('.theme-icon');
      if (iconSpan) {
        iconSpan.textContent = icon;
      } else {
        themeToggleBtn.textContent = icon;
      }
      themeToggleBtn.setAttribute('title', `${label} (Click to cycle)`);
      themeToggleBtn.setAttribute('aria-label', label);
    }

    // Initial Apply
    applyTheme(currentState);

    // Toggle event listener (Cycle: Auto -> Light -> Dark -> Auto)
    themeToggleBtn.addEventListener('click', () => {
      if (currentState === 'auto') currentState = 'light';
      else if (currentState === 'light') currentState = 'dark';
      else currentState = 'auto';

      localStorage.setItem(storageKey, currentState);
      applyTheme(currentState);
    });

    // System Theme Listener (only affects if in 'auto' mode)
    mediaQuery.addEventListener('change', () => {
      if (currentState === 'auto') {
        applyTheme('auto');
      }
    });
  },

  // Helper to create the button HTML
  createThemeToggle: function () {
    return `
      <button id="theme-toggle" class="theme-toggle-btn" aria-label="Toggle Dark Mode">
        <span class="theme-icon">🌙</span>
      </button>
    `;
  },

  /**
   * Export APIs to JSON format
   * @param {Array} apis - APIs to export
   * @param {string} filename - Output filename
   */
  exportToJSON: function (apis, filename = 'camara-apis.json') {
    const json = JSON.stringify(apis, null, 2);
    this.downloadFile(json, filename, 'application/json');
  },

  /**
   * Trigger file download in browser
   * @param {string} content - File content
   * @param {string} filename - Filename
   * @param {string} mimeType - MIME type
   */
  downloadFile: function (content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  /**
   * Detect if page is running in iframe
   * @returns {boolean} True if in iframe
   */
  isInIframe: function () {
    try {
      return window.self !== window.top;
    } catch (e) {
      return true;
    }
  },

  /**
   * Count APIs by category
   * @param {Array} apis - Array of APIs
   * @returns {Object} Category counts
   */
  getCategoryCounts: function (apis) {
    const counts = {};
    apis.forEach(api => {
      const category = api.portfolio_category || 'Other';
      counts[category] = (counts[category] || 0) + 1;
    });
    return counts;
  },

  /**
   * Count unique APIs in a dataset (by canonical_name or api_name)
   * @param {Array} apis - Array of API objects
   * @returns {number} Count of unique APIs
   */
  countUniqueAPIs: function (apis) {
    const uniqueNames = new Set();
    apis.forEach(api => {
      const key = api.canonical_name || api.api_name;
      uniqueNames.add(key);
    });
    return uniqueNames.size;
  },

  /**
   * Get unique API counts per category
   * @param {Array} apis - Array of API objects
   * @returns {Object} Category counts based on unique APIs
   */
  getUniqueCategoryCounts: function (apis) {
    const categoryApis = {}; // Track unique APIs per category

    apis.forEach(api => {
      const category = api.portfolio_category || 'Other';
      const apiKey = api.canonical_name || api.api_name;

      if (!categoryApis[category]) {
        categoryApis[category] = new Set();
      }
      categoryApis[category].add(apiKey);
    });

    // Convert Sets to counts
    const counts = {};
    Object.keys(categoryApis).forEach(category => {
      counts[category] = categoryApis[category].size;
    });

    return counts;
  },

  /**
   * Get unique values for a field
   * @param {Array} apis - Array of APIs
   * @param {string} field - Field name
   * @returns {Array} Sorted unique values
   */
  getUniqueValues: function (apis, field) {
    const values = new Set();
    apis.forEach(api => {
      const value = api[field];
      if (value != null && value !== '') {
        values.add(value);
      }
    });
    return Array.from(values).sort();
  },

  /**
   * Format date string for display
   * @param {string} dateString - ISO date string
   * @returns {string} Formatted date
   */
  formatDate: function (dateString) {
    if (!dateString) return '';
    try {
      return new Date(dateString).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    } catch (e) {
      return dateString;
    }
  },

  /**
   * Escape HTML special characters while preserving newlines
   * Manual escaping prevents browser from normalizing whitespace
   * @param {string} text - Text to escape
   * @returns {string} Escaped text with preserved newlines
   */
  escapeHtml: function (text) {
    if (!text) return '';
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  },

  /**
   * Decide what the meta-release viewer shows for a URL query string.
   * Parameters: `meta-release=<name>` (case-insensitive) and `selector=true|false`.
   * - no meta-release value: newest (last in list); selector shown unless selector=false
   * - known value: that meta-release; selector hidden unless selector=true
   * - unknown value: no data; selector shown unless selector=false
   * - empty list: status 'empty'
   * @param {string} search - location.search (leading '?' optional)
   * @param {string[]} metaReleases - Meta-release names, oldest first
   * @returns {{status: 'ok'|'unknown'|'empty', metaRelease: string|null,
   *            requested: string, showSelector: boolean}}
   */
  resolveMetaReleaseView: function (search, metaReleases) {
    const params = new URLSearchParams(search || '');
    const requested = (params.get('meta-release') || '').trim();
    const selectorParam = params.get('selector');
    const selector = selectorParam === 'true' ? true : selectorParam === 'false' ? false : null;
    const list = metaReleases || [];

    if (list.length === 0) {
      return { status: 'empty', metaRelease: null, requested, showSelector: false };
    }
    if (!requested) {
      return {
        status: 'ok',
        metaRelease: list[list.length - 1],
        requested,
        showSelector: selector !== false
      };
    }
    const match = list.find(name => name.toLowerCase() === requested.toLowerCase());
    if (!match) {
      return { status: 'unknown', metaRelease: null, requested, showSelector: selector !== false };
    }
    return { status: 'ok', metaRelease: match, requested, showSelector: selector === true };
  }
};

if (typeof module !== 'undefined') module.exports = ViewerLib;
