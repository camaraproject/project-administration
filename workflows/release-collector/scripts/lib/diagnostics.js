/**
 * Release Collector diagnostics.
 *
 * One small machine-readable artifact built from the analysis results and the
 * previous master data, plus a compact markdown rendering for the workflow
 * summary and the generated PR body. Review signals only: nothing here gates
 * the workflow or changes generated data.
 */

const DEFAULT_MAX_ITEMS = 25;

const apiNames = release => (release.apis || []).map(api => api.api_name);

/**
 * @param {object} args
 * @param {Array} args.analysisResults - Results from analyze-release.js
 * @param {Array} args.previousReleases - master.releases before this update
 * @param {object} args.run - Run context (see provenance.collectRunProvenance)
 */
function buildDiagnostics({ analysisResults, previousReleases, run }) {
  const previousByKey = new Map(
    previousReleases.map(r => [`${r.repository}\u0000${r.release_tag}`, r])
  );

  const fileIssues = [];
  const nativeMetadataErrors = [];
  const removedApis = [];

  for (const result of analysisResults) {
    const { repository, release_tag } = result;
    const d = result.diagnostics || {};

    for (const issue of d.file_issues || []) {
      fileIssues.push({ repository, release_tag, ...issue });
    }
    if (d.native_metadata_error) {
      nativeMetadataErrors.push({ repository, release_tag, error: d.native_metadata_error });
    }

    const previous = previousByKey.get(`${repository}\u0000${release_tag}`);
    if (previous) {
      const previousNames = apiNames(previous);
      const analyzedNames = apiNames(result);
      const removed = previousNames.filter(name => !analyzedNames.includes(name));
      if (removed.length > 0) {
        removedApis.push({ repository, release_tag, previous: previousNames, analyzed: analyzedNames, removed });
      }
    }
  }

  return {
    run,
    releases_analyzed: analysisResults.length,
    file_issues: fileIssues,
    native_metadata_errors: nativeMetadataErrors,
    removed_apis: removedApis
  };
}

function section(title, entries, format, maxItems) {
  if (entries.length === 0) {
    return [];
  }
  const lines = [`**${title} (${entries.length})**`, ''];
  for (const entry of entries.slice(0, maxItems)) {
    lines.push(`- ${format(entry)}`);
  }
  if (entries.length > maxItems) {
    lines.push(`- … and ${entries.length - maxItems} more (see the diagnostics artifact)`);
  }
  lines.push('');
  return lines;
}

/**
 * Compact markdown for the workflow summary and PR body.
 */
function renderDiagnosticsMarkdown(diagnostics, { maxItems = DEFAULT_MAX_ITEMS } = {}) {
  const lines = [
    ...section(
      'Potential API removals',
      diagnostics.removed_apis,
      e => `\`${e.repository}\` \`${e.release_tag}\`: ${e.removed.join(', ')}`,
      maxItems
    ),
    ...section(
      'OpenAPI files without extracted metadata',
      diagnostics.file_issues,
      e => `\`${e.repository}\` \`${e.release_tag}\` \`${e.file}\`: ${e.error}`,
      maxItems
    ),
    ...section(
      'Native metadata check failed (fell back to OpenAPI)',
      diagnostics.native_metadata_errors,
      e => `\`${e.repository}\` \`${e.release_tag}\`: ${e.error}`,
      maxItems
    )
  ];

  if (lines.length === 0) {
    return `No review signals (${diagnostics.releases_analyzed} release(s) analyzed).`;
  }
  return lines.join('\n').trimEnd();
}

module.exports = { buildDiagnostics, renderDiagnosticsMarkdown };
