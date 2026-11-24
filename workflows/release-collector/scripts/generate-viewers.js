#!/usr/bin/env node

/**
 * Generate self-contained HTML viewers for CAMARA meta-releases
 *
 * Reads only report files. The meta-release list comes from
 * reports/all-releases.json `metadata.meta_releases` (written by generate-reports.js).
 *
 * Output (viewers/):
 *   meta-release.html       one viewer, all meta-release reports embedded
 *   portfolio.html          multi-release comparison, published APIs only
 *   internal.html           administration view, all data
 *   production-index.html   index page with one link per meta-release
 *   staging-index.html      same for staging
 *
 * Exits non-zero when the list is missing or empty, or a listed report file is missing.
 */

const fs = require('fs').promises;
const path = require('path');

// Paths (COLLECTOR_ROOT overrides the repository root for tests)
const SCRIPT_DIR = __dirname;
const ROOT_DIR = process.env.COLLECTOR_ROOT || path.join(SCRIPT_DIR, '../../..');
const TEMPLATES_DIR = path.join(SCRIPT_DIR, '../templates');
const REPORTS_DIR = path.join(ROOT_DIR, 'reports');
const VIEWERS_DIR = path.join(ROOT_DIR, 'viewers');
const ALL_RELEASES = path.join(REPORTS_DIR, 'all-releases.json');

// Check for force regeneration flag from workflow
const FORCE_REGENERATE = process.env.FORCE_REGENERATE === 'true';

const SHARED_TEMPLATE_FILES = ['viewer-lib.js', 'viewer-styles.css'];

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

/**
 * JSON for embedding in HTML: "<" escaped so "</script>" in data cannot end the tag
 */
function embeddableJson(value) {
  return JSON.stringify(value, null, 2).replace(/</g, '\\u003c');
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Replace a placeholder with a value; a function replacement keeps "$&" etc. in data literal
 */
function fill(html, placeholder, value) {
  return html.split(placeholder).join(value);
}

function reportFile(metaRelease) {
  return path.join(REPORTS_DIR, `${metaRelease.toLowerCase()}.json`);
}

/**
 * Meta-release list from all-releases.json; throws unless the list is non-empty
 * and every listed report file exists
 * @returns {Promise<string[]>}
 */
async function loadMetaReleases() {
  const all = await readJson(ALL_RELEASES);
  const list = all.metadata && all.metadata.meta_releases;
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error(
      `${path.basename(ALL_RELEASES)} has no metadata.meta_releases list. ` +
      'Run generate-reports.js (the reports were probably made by an older generator).'
    );
  }
  for (const name of list) {
    try {
      await fs.access(reportFile(name));
    } catch (err) {
      throw new Error(`Report file missing for meta-release ${name}: ${path.basename(reportFile(name))}`);
    }
  }
  return list;
}

/**
 * Check if a viewer needs regeneration based on source file timestamps
 * @param {string} viewerFile - Output file name in viewers/
 * @param {string[]} sourceFiles - Report files the viewer is built from
 * @param {string} template - Template file name
 */
async function shouldRegenerateViewer(viewerFile, sourceFiles, template) {
  const templateFiles = [...SHARED_TEMPLATE_FILES, template].map(f => path.join(TEMPLATES_DIR, f));
  try {
    const viewerTime = (await fs.stat(path.join(VIEWERS_DIR, viewerFile))).mtime.getTime();
    for (const file of sourceFiles) {
      if ((await fs.stat(file)).mtime.getTime() > viewerTime) {
        console.log(`  ↻ Report data updated (${viewerFile})`);
        return true;
      }
    }
    for (const file of templateFiles) {
      if ((await fs.stat(file)).mtime.getTime() > viewerTime) {
        console.log(`  ↻ Template ${path.basename(file)} updated (${viewerFile})`);
        return true;
      }
    }
    console.log(`  ✓ Viewer up-to-date (${viewerFile})`);
    return false;
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.log(`  + Viewer missing (${viewerFile})`);
      return true;
    }
    throw err;
  }
}

async function loadShared(template) {
  const library = await fs.readFile(path.join(TEMPLATES_DIR, 'viewer-lib.js'), 'utf8');
  const styles = await fs.readFile(path.join(TEMPLATES_DIR, 'viewer-styles.css'), 'utf8');
  const html = await fs.readFile(path.join(TEMPLATES_DIR, template), 'utf8');
  return { library, styles, html };
}

function keepPublished(report) {
  const filtered = { ...report };
  if (filtered.releases) {
    filtered.releases = filtered.releases
      .map(release => ({ ...release, apis: release.apis.filter(api => api.published) }))
      .filter(release => release.apis.length > 0);
  }
  return filtered;
}

function countApis(report) {
  return (report.releases || []).reduce((sum, release) => sum + release.apis.length, 0);
}

/**
 * Generate the meta-release viewer: all listed reports embedded, selected by URL parameter
 */
async function generateMetaReleaseViewer(metaReleases) {
  console.log('\nGenerating meta-release viewer...');
  const { library, styles, html: template } = await loadShared('meta-release-template.html');

  const reports = {};
  let apiCount = 0;
  for (const name of metaReleases) {
    reports[name] = keepPublished(await readJson(reportFile(name)));
    apiCount += countApis(reports[name]);
    console.log(`  ${name}: ${countApis(reports[name])} published API versions`);
  }

  // Data last: placeholders inside it are never expanded
  let html = fill(template, '{{VIEWER_STYLES}}', styles);
  html = fill(html, '{{VIEWER_LIBRARY}}', library);
  html = fill(html, '{{VIEWER_DATA}}', embeddableJson({ metaReleases, reports }));

  await fs.writeFile(path.join(VIEWERS_DIR, 'meta-release.html'), html, 'utf8');
  console.log(`✓ Generated meta-release.html (${metaReleases.length} meta-releases)`);
  return { filename: 'meta-release.html', apiCount, releaseCount: metaReleases.length };
}

/**
 * Generate portfolio (published only) or internal (all data) viewer from all-releases.json
 */
async function generateAllReleasesViewer({ template, outputFilename, publishedOnly }) {
  console.log(`\nGenerating ${outputFilename}...`);
  const { library, styles, html: templateHtml } = await loadShared(template);
  const all = await readJson(ALL_RELEASES);
  const data = publishedOnly ? keepPublished(all) : all;

  let html = fill(templateHtml, '{{VIEWER_STYLES}}', styles);
  html = fill(html, '{{VIEWER_LIBRARY}}', library);
  html = fill(html, '{{RELEASE_DATA}}', embeddableJson(data));

  await fs.writeFile(path.join(VIEWERS_DIR, outputFilename), html, 'utf8');
  const apiCount = countApis(data);
  console.log(`✓ Generated ${outputFilename} (${apiCount} API versions${publishedOnly ? ', published only' : ', all data'})`);
  return { filename: outputFilename, apiCount, releaseCount: (data.releases || []).length };
}

/**
 * Generate index pages: one link per meta-release, newest first
 */
async function generateIndexPages(metaReleases) {
  console.log('\nGenerating index pages...');
  const newestFirst = metaReleases.slice().reverse();
  const results = [];
  for (const [template, output, suffix] of [
    ['production-index-template.html', 'production-index.html', ''],
    ['staging-index-template.html', 'staging-index.html', ' (Staging)']
  ]) {
    const templateHtml = await fs.readFile(path.join(TEMPLATES_DIR, template), 'utf8');
    const links = newestFirst
      .map(name => {
        const href = `meta-release.html?meta-release=${encodeURIComponent(name)}`;
        return `  <a href="${href}" class="viewer-link">${escapeHtml(name)} meta-release${suffix}</a>`;
      })
      .join('\n');
    await fs.writeFile(path.join(VIEWERS_DIR, output), fill(templateHtml, '{{META_RELEASE_LINKS}}', links), 'utf8');
    console.log(`✓ Generated ${output}`);
    results.push({ filename: output });
  }
  return results;
}

/**
 * Generate all viewers
 */
async function generateAllViewers() {
  console.log('=== CAMARA Viewer Generation v4 ===\n');

  const metaReleases = await loadMetaReleases();
  console.log(`Meta-releases (${metaReleases.length}): ${metaReleases.join(', ')}`);
  await fs.mkdir(VIEWERS_DIR, { recursive: true });

  if (FORCE_REGENERATE) {
    console.log('⚡ Force regeneration enabled - bypassing timestamp checks\n');
  }

  const reportFiles = metaReleases.map(reportFile);
  const viewers = [
    {
      file: 'meta-release.html',
      sources: [ALL_RELEASES, ...reportFiles],
      template: 'meta-release-template.html',
      generate: () => generateMetaReleaseViewer(metaReleases)
    },
    {
      file: 'portfolio.html',
      sources: [ALL_RELEASES],
      template: 'portfolio-template.html',
      generate: () => generateAllReleasesViewer({
        template: 'portfolio-template.html', outputFilename: 'portfolio.html', publishedOnly: true
      })
    },
    {
      file: 'internal.html',
      sources: [ALL_RELEASES],
      template: 'internal-template.html',
      generate: () => generateAllReleasesViewer({
        template: 'internal-template.html', outputFilename: 'internal.html', publishedOnly: false
      })
    }
  ];

  const results = [];
  let skipped = 0;
  for (const viewer of viewers) {
    if (FORCE_REGENERATE || await shouldRegenerateViewer(viewer.file, viewer.sources, viewer.template)) {
      results.push(await viewer.generate());
    } else {
      console.log(`  ⊘ Skipping ${viewer.file} (unchanged)`);
      skipped++;
    }
  }

  // Index pages list the meta-releases, so they are always rewritten (cheap)
  results.push(...await generateIndexPages(metaReleases));

  console.log('\n=== Generation Summary ===');
  console.log(`Regenerated: ${results.length} files`);
  console.log(`Skipped: ${skipped} viewers`);
  results.forEach(result => {
    if (result.apiCount && result.releaseCount) {
      console.log(`  - ${result.filename}: ${result.apiCount} APIs, ${result.releaseCount} releases`);
    } else {
      console.log(`  - ${result.filename}`);
    }
  });
  console.log(`\nViewers directory: ${VIEWERS_DIR}`);
}

async function main() {
  if (process.argv.slice(2).some(arg => arg === '-h' || arg === '--help')) {
    console.log(`
CAMARA Viewer Generator v4

Usage:
  node generate-viewers.js

Reads reports/all-releases.json (metadata.meta_releases) and the listed reports,
writes meta-release.html, portfolio.html, internal.html and the index pages to viewers/.
Set FORCE_REGENERATE=true to bypass the timestamp checks.
`);
    return;
  }
  await generateAllViewers();
}

if (require.main === module) {
  main().catch(error => {
    console.error(`\n✗ Viewer generation failed: ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  loadMetaReleases,
  generateMetaReleaseViewer,
  generateAllReleasesViewer,
  generateIndexPages,
  generateAllViewers
};
