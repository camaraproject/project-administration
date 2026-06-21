#!/usr/bin/env node

/**
 * Generate self-contained HTML viewers for CAMARA meta-releases
 *
 * This script embeds shared library, styles, and data into HTML templates
 * to create fully self-contained viewer files for GitHub Pages deployment.
 */

const fs = require('fs').promises;
const path = require('path');

// Paths relative to this script's location
const SCRIPT_DIR = __dirname;
const ROOT_DIR = path.join(SCRIPT_DIR, '../../..');
const TEMPLATES_DIR = path.join(SCRIPT_DIR, '../templates');
const REPORTS_DIR = path.join(ROOT_DIR, 'reports');
const VIEWERS_DIR = path.join(ROOT_DIR, 'viewers');

// Check for force regeneration flag from workflow
const FORCE_REGENERATE = process.env.FORCE_REGENERATE === 'true';
const META_RELEASE_VIEWERS = ['fall24', 'spring25', 'fall25', 'spring26'];

/**
 * Check if viewer needs regeneration based on source file timestamps
 * @param {string} release - Release name (e.g., 'fall25', 'portfolio', 'internal')
 * @returns {Promise<boolean>} True if regeneration needed
 */
async function shouldRegenerateViewer(release) {
  // Map viewer types to their data sources and templates
  const config = {
    'fall24': {
      reportPath: path.join(REPORTS_DIR, 'fall24.json'),
      viewerPath: path.join(VIEWERS_DIR, 'fall24.html'),
      template: 'meta-release-template.html'
    },
    'spring25': {
      reportPath: path.join(REPORTS_DIR, 'spring25.json'),
      viewerPath: path.join(VIEWERS_DIR, 'spring25.html'),
      template: 'meta-release-template.html'
    },
    'fall25': {
      reportPath: path.join(REPORTS_DIR, 'fall25.json'),
      viewerPath: path.join(VIEWERS_DIR, 'fall25.html'),
      template: 'meta-release-template.html'
    },
    'spring26': {
      reportPath: path.join(REPORTS_DIR, 'spring26.json'),
      viewerPath: path.join(VIEWERS_DIR, 'spring26.html'),
      template: 'meta-release-template.html'
    },
    'portfolio': {
      reportPath: path.join(REPORTS_DIR, 'all-releases.json'),
      viewerPath: path.join(VIEWERS_DIR, 'portfolio.html'),
      template: 'portfolio-template.html'
    },
    'internal': {
      reportPath: path.join(REPORTS_DIR, 'all-releases.json'),
      viewerPath: path.join(VIEWERS_DIR, 'internal.html'),
      template: 'internal-template.html'
    }
  };

  const cfg = config[release];
  if (!cfg) {
    console.log(`  ⚠ Unknown viewer type: ${release}`);
    return false;
  }

  // Template files that affect viewer output
  const templateFiles = [
    path.join(TEMPLATES_DIR, 'viewer-lib.js'),
    path.join(TEMPLATES_DIR, 'viewer-styles.css'),
    path.join(TEMPLATES_DIR, cfg.template)
  ];

  try {
    // Check if viewer exists
    const viewerStat = await fs.stat(cfg.viewerPath);
    const viewerTime = viewerStat.mtime.getTime();

    // Check if report is newer
    const reportStat = await fs.stat(cfg.reportPath);
    if (reportStat.mtime.getTime() > viewerTime) {
      console.log(`  ↻ Report data updated (${release})`);
      return true;
    }

    // Check if any template is newer
    for (const templateFile of templateFiles) {
      const templateStat = await fs.stat(templateFile);
      if (templateStat.mtime.getTime() > viewerTime) {
        const templateName = path.basename(templateFile);
        console.log(`  ↻ Template ${templateName} updated (${release})`);
        return true;
      }
    }

    console.log(`  ✓ Viewer up-to-date (${release})`);
    return false;

  } catch (err) {
    if (err.code === 'ENOENT') {
      console.log(`  + Viewer missing (${release})`);
      return true; // Viewer doesn't exist, needs generation
    }
    throw err;
  }
}

/**
 * Generate meta-release viewer for a specific release
 */
async function generateMetaReleaseViewer(release, options = {}) {
  try {
    console.log(`\nGenerating ${release} viewer...`);

    // Load shared library and styles
    const libraryPath = path.join(TEMPLATES_DIR, 'viewer-lib.js');
    const stylesPath = path.join(TEMPLATES_DIR, 'viewer-styles.css');
    const templatePath = path.join(TEMPLATES_DIR, 'meta-release-template.html');

    console.log(`  Loading shared library from: ${libraryPath}`);
    const library = await fs.readFile(libraryPath, 'utf8');

    console.log(`  Loading shared styles from: ${stylesPath}`);
    const styles = await fs.readFile(stylesPath, 'utf8');

    console.log(`  Loading template from: ${templatePath}`);
    const template = await fs.readFile(templatePath, 'utf8');

    // Load enriched report data
    const reportPath = path.join(REPORTS_DIR, `${release}.json`);
    console.log(`  Loading report data from: ${reportPath}`);
    const reportData = JSON.parse(await fs.readFile(reportPath, 'utf8'));

    // Apply data filters based on options
    let filteredData = { ...reportData };
    if (options.publishedOnly) {
      console.log(`  Filtering for published APIs only...`);
      // Filter at the release level - keep releases but filter their APIs
      if (filteredData.releases) {
        filteredData.releases = filteredData.releases.map(release => ({
          ...release,
          apis: release.apis.filter(api => api.published)
        })).filter(release => release.apis.length > 0); // Remove releases with no published APIs
      }
    }

    // Count APIs for logging
    let apiCount = 0;
    if (filteredData.releases) {
      filteredData.releases.forEach(release => {
        apiCount += release.apis.length;
      });
    }
    console.log(`  Data contains ${apiCount} APIs in ${filteredData.releases?.length || 0} releases`);

    // Embed everything into template
    console.log(`  Embedding library, styles, and data...`);
    let html = template;

    // Replace placeholders
    html = html.replace('{{VIEWER_LIBRARY}}', library);
    html = html.replace('{{VIEWER_STYLES}}', styles);
    html = html.replace('{{RELEASE_DATA}}', JSON.stringify(filteredData, null, 2));
    html = html.replace(/{{META_RELEASE}}/g, filteredData.metadata.meta_release);

    // Write self-contained HTML file
    const outputFilename = options.outputFilename || `${release}.html`;
    const outputPath = path.join(VIEWERS_DIR, outputFilename);

    console.log(`  Writing viewer to: ${outputPath}`);
    await fs.writeFile(outputPath, html, 'utf8');

    console.log(`✓ Generated ${outputFilename} (${apiCount} APIs)`);

    return {
      filename: outputFilename,
      path: outputPath,
      apiCount: apiCount,
      releaseCount: filteredData.releases?.length || 0
    };
  } catch (error) {
    console.error(`✗ Error generating ${release} viewer:`, error.message);
    throw error;
  }
}

/**
 * Generate portfolio viewer (multi-release comparison)
 * @param {Object} options - Generation options
 * @returns {Promise<Object>} Generation result
 */
async function generatePortfolioViewer(options = {}) {
  try {
    console.log(`\nGenerating portfolio viewer...`);

    // Load shared library and styles
    const libraryPath = path.join(TEMPLATES_DIR, 'viewer-lib.js');
    const stylesPath = path.join(TEMPLATES_DIR, 'viewer-styles.css');
    const templatePath = path.join(TEMPLATES_DIR, 'portfolio-template.html');

    console.log(`  Loading shared library from: ${libraryPath}`);
    const library = await fs.readFile(libraryPath, 'utf8');

    console.log(`  Loading shared styles from: ${stylesPath}`);
    const styles = await fs.readFile(stylesPath, 'utf8');

    console.log(`  Loading template from: ${templatePath}`);
    const template = await fs.readFile(templatePath, 'utf8');

    // Load all-releases data
    const reportPath = path.join(REPORTS_DIR, 'all-releases.json');
    console.log(`  Loading report data from: ${reportPath}`);
    const reportData = JSON.parse(await fs.readFile(reportPath, 'utf8'));

    // Filter for published only (external/product audience)
    let filteredData = { ...reportData };
    if (options.publishedOnly !== false) {
      console.log(`  Filtering for published APIs only...`);
      if (filteredData.releases) {
        filteredData.releases = filteredData.releases.map(release => ({
          ...release,
          apis: release.apis.filter(api => api.published)
        })).filter(release => release.apis.length > 0); // Remove releases with no published APIs
      }
    }

    // Count APIs for logging
    let apiCount = 0;
    if (filteredData.releases) {
      filteredData.releases.forEach(release => {
        apiCount += release.apis.length;
      });
    }
    console.log(`  Data contains ${apiCount} APIs in ${filteredData.releases?.length || 0} releases`);

    // Embed everything into template
    console.log(`  Embedding library, styles, and data...`);
    let html = template;

    // Replace placeholders
    html = html.replace('{{VIEWER_LIBRARY}}', library);
    html = html.replace('{{VIEWER_STYLES}}', styles);
    html = html.replace('{{RELEASE_DATA}}', JSON.stringify(filteredData, null, 2));

    // Write self-contained HTML file
    const outputFilename = options.outputFilename || 'portfolio.html';
    const outputPath = path.join(VIEWERS_DIR, outputFilename);

    console.log(`  Writing viewer to: ${outputPath}`);
    await fs.writeFile(outputPath, html, 'utf8');

    console.log(`✓ Generated ${outputFilename} (${apiCount} API versions, published only)`);

    return {
      filename: outputFilename,
      path: outputPath,
      apiCount: apiCount,
      releaseCount: filteredData.releases?.length || 0
    };
  } catch (error) {
    console.error(`✗ Error generating portfolio viewer:`, error.message);
    throw error;
  }
}

/**
 * Generate internal administration viewer (all data)
 * @param {Object} options - Generation options
 * @returns {Promise<Object>} Generation result
 */
async function generateInternalViewer(options = {}) {
  try {
    console.log(`\nGenerating internal viewer...`);

    // Load shared library and styles
    const libraryPath = path.join(TEMPLATES_DIR, 'viewer-lib.js');
    const stylesPath = path.join(TEMPLATES_DIR, 'viewer-styles.css');
    const templatePath = path.join(TEMPLATES_DIR, 'internal-template.html');

    console.log(`  Loading shared library from: ${libraryPath}`);
    const library = await fs.readFile(libraryPath, 'utf8');

    console.log(`  Loading shared styles from: ${stylesPath}`);
    const styles = await fs.readFile(stylesPath, 'utf8');

    console.log(`  Loading template from: ${templatePath}`);
    const template = await fs.readFile(templatePath, 'utf8');

    // Load all-releases data (no filtering - show everything)
    const reportPath = path.join(REPORTS_DIR, 'all-releases.json');
    console.log(`  Loading report data from: ${reportPath}`);
    const reportData = JSON.parse(await fs.readFile(reportPath, 'utf8'));

    // Count APIs for logging
    let apiCount = 0;
    if (reportData.releases) {
      reportData.releases.forEach(release => {
        apiCount += release.apis.length;
      });
    }
    const publishedCount = apiCount; // Will count properly in client side
    console.log(`  Data contains ${apiCount} API versions (all data including unpublished)`);

    // Embed everything into template
    console.log(`  Embedding library, styles, and data...`);
    let html = template;

    // Replace placeholders
    html = html.replace('{{VIEWER_LIBRARY}}', library);
    html = html.replace('{{VIEWER_STYLES}}', styles);
    html = html.replace('{{RELEASE_DATA}}', JSON.stringify(reportData, null, 2));

    // Write self-contained HTML file
    const outputFilename = options.outputFilename || 'internal.html';
    const outputPath = path.join(VIEWERS_DIR, outputFilename);

    console.log(`  Writing viewer to: ${outputPath}`);
    await fs.writeFile(outputPath, html, 'utf8');

    console.log(`✓ Generated ${outputFilename} (${apiCount} API versions, all data)`);

    return {
      filename: outputFilename,
      path: outputPath,
      apiCount: apiCount,
      releaseCount: reportData.releases?.length || 0
    };
  } catch (error) {
    console.error(`✗ Error generating internal viewer:`, error.message);
    throw error;
  }
}

/**
 * Generate all meta-release viewers
 */
async function generateAllViewers() {
  console.log('=== CAMARA Viewer Generation v3 ===\n');

  try {
    // Ensure output directory exists
    console.log(`Creating output directory: ${VIEWERS_DIR}`);
    await fs.mkdir(VIEWERS_DIR, { recursive: true });

    const results = [];

    // Determine which releases to generate
    const releases = META_RELEASE_VIEWERS;

    // Check which reports exist
    const existingReleases = [];
    for (const release of releases) {
      const reportPath = path.join(REPORTS_DIR, `${release}.json`);
      try {
        await fs.access(reportPath);
        existingReleases.push(release);
      } catch (err) {
        console.log(`⚠ Report not found: ${release}.json - skipping`);
      }
    }

    if (existingReleases.length === 0) {
      console.error('\n✗ No report files found. Run the meta-release collector first.');
      process.exit(1);
    }

    // Generate meta-release viewers with timestamp checking
    let regenerated = 0;
    let skipped = 0;

    if (FORCE_REGENERATE) {
      console.log('⚡ Force regeneration enabled - bypassing timestamp checks\n');
    }

    for (const release of existingReleases) {
      if (FORCE_REGENERATE || await shouldRegenerateViewer(release)) {
        if (FORCE_REGENERATE) {
          console.log(`  ⚡ Force regeneration (${release})`);
        }
        const result = await generateMetaReleaseViewer(release, {
          publishedOnly: true
        });
        results.push(result);
        regenerated++;
      } else {
        console.log(`  ⊘ Skipping ${release} (unchanged)`);
        skipped++;
      }
    }

    // Generate portfolio viewer
    console.log('\n--- Portfolio Viewer ---');
    if (FORCE_REGENERATE || await shouldRegenerateViewer('portfolio')) {
      if (FORCE_REGENERATE) {
        console.log(`  ⚡ Force regeneration (portfolio)`);
      }
      try {
        const result = await generatePortfolioViewer({ publishedOnly: true });
        results.push(result);
        regenerated++;
      } catch (error) {
        console.error(`✗ Portfolio viewer generation failed: ${error.message}`);
      }
    } else {
      console.log(`  ⊘ Skipping portfolio (unchanged)`);
      skipped++;
    }

    // Generate internal viewer
    console.log('\n--- Internal Viewer ---');
    if (FORCE_REGENERATE || await shouldRegenerateViewer('internal')) {
      if (FORCE_REGENERATE) {
        console.log(`  ⚡ Force regeneration (internal)`);
      }
      try {
        const result = await generateInternalViewer();
        results.push(result);
        regenerated++;
      } catch (error) {
        console.error(`✗ Internal viewer generation failed: ${error.message}`);
      }
    } else {
      console.log(`  ⊘ Skipping internal (unchanged)`);
      skipped++;
    }

    // Summary
    const totalViewers = existingReleases.length + 2; // meta-releases + portfolio + internal
    console.log('\n=== Generation Summary ===');
    console.log(`Regenerated: ${regenerated} viewers`);
    console.log(`Skipped: ${skipped} viewers`);
    console.log(`Total available: ${totalViewers} viewers (${existingReleases.length} meta-releases + portfolio + internal)`);
    if (results.length > 0) {
      console.log('\nRegenerated viewers:');
      results.forEach(result => {
        if (result.apiCount && result.releaseCount) {
          console.log(`  - ${result.filename}: ${result.apiCount} APIs, ${result.releaseCount} releases`);
        } else {
          console.log(`  - ${result.filename}`);
        }
      });
    }
    console.log(`\nViewers directory: ${VIEWERS_DIR}`);

  } catch (error) {
    console.error('\n✗ Error during viewer generation:', error.message);
    if (error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    process.exit(1);
  }
}

/**
 * Main entry point
 */
async function main() {
  const args = process.argv.slice(2);

  // Check for help flag
  if (args.includes('-h') || args.includes('--help')) {
    console.log(`
CAMARA Viewer Generator v3

Usage:
  node generate-viewers.js [release]

Options:
  release    Optional release name (fall24, spring25, fall25, spring26)
             If omitted, generates all available releases

Examples:
  node generate-viewers.js              # Generate all releases
  node generate-viewers.js fall25       # Generate only Fall25 viewer
  node generate-viewers.js spring26     # Generate only Spring26 viewer
`);
    process.exit(0);
  }

  // Check if specific release requested
  if (args.length > 0) {
    const release = args[0];
    console.log(`Generating single release: ${release}`);
    await generateMetaReleaseViewer(release, { publishedOnly: true });
  } else {
    await generateAllViewers();
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

// Export for potential use as module
module.exports = {
  META_RELEASE_VIEWERS,
  generateMetaReleaseViewer,
  generatePortfolioViewer,
  generateInternalViewer,
  generateAllViewers
};
