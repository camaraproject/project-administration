#!/usr/bin/env node

/**
 * API Landscape Validation Script
 *
 * Validates the api-landscape.yaml file against the schema and checks data consistency.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

// Configuration
// Paths (relative to workflow directory)
const CONFIG_PATH = path.join(__dirname, '..', '..', '..', 'config'); // /config at repository root
const LANDSCAPE_FILE = path.join(CONFIG_PATH, 'api-landscape.yaml');

// Allowed categories as defined in the schema
const ALLOWED_CATEGORIES = [
  "Authentication and Fraud Prevention",
  "Communication Quality",
  "Communication Services",
  "Computing Services",
  "Device Information",
  "Location Services",
  "Payments and Charging",
  "Service Management"
];

/**
 * Load and parse the landscape file
 */
function loadLandscape() {
  if (!fs.existsSync(LANDSCAPE_FILE)) {
    throw new Error(`Landscape file not found: ${LANDSCAPE_FILE}`);
  }

  try {
    return yaml.load(fs.readFileSync(LANDSCAPE_FILE, 'utf8'));
  } catch (error) {
    throw new Error(`Failed to parse YAML: ${error.message}`);
  }
}

/**
 * Validate metadata section
 */
function validateMetadata(landscape) {
  const errors = [];

  if (!landscape.metadata) {
    errors.push('Missing metadata section');
    return errors;
  }

  const required = ['version', 'last_updated', 'description'];
  for (const field of required) {
    if (!landscape.metadata[field]) {
      errors.push(`Missing metadata.${field}`);
    }
  }

  // Validate version format
  if (landscape.metadata.version && !landscape.metadata.version.match(/^\d+\.\d+\.\d+$/)) {
    errors.push(`Invalid version format: ${landscape.metadata.version} (expected X.Y.Z)`);
  }

  // Validate date format
  if (landscape.metadata.last_updated && !landscape.metadata.last_updated.match(/^\d{4}-\d{2}-\d{2}$/)) {
    errors.push(`Invalid date format: ${landscape.metadata.last_updated} (expected YYYY-MM-DD)`);
  }

  // Validate allowed categories
  if (landscape.metadata.allowed_categories) {
    const diff = landscape.metadata.allowed_categories.filter(cat => !ALLOWED_CATEGORIES.includes(cat));
    if (diff.length > 0) {
      errors.push(`Unknown categories in metadata: ${diff.join(', ')}`);
    }
  }

  return errors;
}

/**
 * Validate API entries
 */
function validateAPIs(landscape) {
  const errors = [];
  const warnings = [];

  if (!landscape.apis || typeof landscape.apis !== 'object') {
    errors.push('Missing or invalid apis section');
    return { errors, warnings };
  }

  const apiNames = Object.keys(landscape.apis);
  const previousNamesUsage = new Map();

  for (const apiName of apiNames) {
    const api = landscape.apis[apiName];
    const prefix = `apis.${apiName}`;

    // Validate required fields
    if (!api.category) {
      errors.push(`${prefix}: missing category`);
    } else if (!ALLOWED_CATEGORIES.includes(api.category)) {
      errors.push(`${prefix}: invalid category '${api.category}'`);
    }

    if (!api.tooltip) {
      errors.push(`${prefix}: missing tooltip`);
    }

    if (api.published === undefined) {
      warnings.push(`${prefix}: missing published field (defaulting to true)`);
    }

    // Validate website_url format if present
    if (api.website_url && api.website_url !== null) {
      if (!api.website_url.startsWith('https://')) {
        errors.push(`${prefix}: website_url must use HTTPS: ${api.website_url}`);
      }
    }

    // Validate previous_names if present
    if (api.previous_names) {
      if (!Array.isArray(api.previous_names)) {
        errors.push(`${prefix}: previous_names must be an array`);
      } else {
        // Check for duplicates
        for (const prevName of api.previous_names) {
          if (previousNamesUsage.has(prevName)) {
            errors.push(`${prefix}: previous name '${prevName}' is already used by ${previousNamesUsage.get(prevName)}`);
          } else {
            previousNamesUsage.set(prevName, apiName);
          }

          // Check if previous name exists as current API
          if (apiNames.includes(prevName)) {
            errors.push(`${prefix}: previous name '${prevName}' exists as current API name`);
          }
        }
      }
    }

    // Validate display_name if present
    if (api.display_name && typeof api.display_name !== 'string') {
      errors.push(`${prefix}: display_name must be a string`);
    }
  }

  return { errors, warnings };
}

/**
 * Validate categories section
 */
function validateCategories(landscape) {
  const errors = [];
  const warnings = [];

  if (!landscape.categories) {
    warnings.push('Missing categories section');
    return { errors, warnings };
  }

  if (!Array.isArray(landscape.categories)) {
    errors.push('Categories must be an array');
    return { errors, warnings };
  }

  const categoryCounts = {};

  // Count APIs per category
  if (landscape.apis) {
    for (const api of Object.values(landscape.apis)) {
      if (api.category) {
        categoryCounts[api.category] = (categoryCounts[api.category] || 0) + 1;
      }
    }
  }

  // Validate each category entry
  for (const category of landscape.categories) {
    if (!category.name) {
      errors.push('Category entry missing name');
      continue;
    }

    if (!ALLOWED_CATEGORIES.includes(category.name)) {
      errors.push(`Invalid category name: ${category.name}`);
    }

    // Check API count accuracy
    const actualCount = categoryCounts[category.name] || 0;
    if (category.api_count !== undefined && category.api_count !== actualCount) {
      warnings.push(`Category '${category.name}': declared count ${category.api_count} doesn't match actual count ${actualCount}`);
    }
  }

  // Check for missing categories
  for (const catName of Object.keys(categoryCounts)) {
    const found = landscape.categories.find(c => c.name === catName);
    if (!found) {
      warnings.push(`Category '${catName}' used in APIs but not declared in categories section`);
    }
  }

  return { errors, warnings };
}

/**
 * Generate statistics
 */
function generateStatistics(landscape) {
  const stats = {
    total_apis: 0,
    apis_with_urls: 0,
    apis_published: 0,
    apis_unpublished: 0,
    apis_with_previous_names: 0,
    categories: {}
  };

  if (!landscape.apis) return stats;

  const apis = Object.entries(landscape.apis);
  stats.total_apis = apis.length;

  for (const [name, api] of apis) {
    if (api.website_url) stats.apis_with_urls++;
    if (api.published !== false) stats.apis_published++;
    if (api.published === false) stats.apis_unpublished++;
    if (api.previous_names && api.previous_names.length > 0) stats.apis_with_previous_names++;

    if (api.category) {
      stats.categories[api.category] = (stats.categories[api.category] || 0) + 1;
    }
  }

  return stats;
}

/**
 * Main validation function
 */
async function main() {
  console.log('API Landscape Validation');
  console.log('========================\n');

  try {
    // Load landscape
    console.log(`Loading: ${LANDSCAPE_FILE}`);
    const landscape = loadLandscape();
    console.log('✅ YAML parsed successfully\n');

    let hasErrors = false;
    let hasWarnings = false;

    // Validate metadata
    console.log('Validating metadata...');
    const metadataErrors = validateMetadata(landscape);
    if (metadataErrors.length > 0) {
      hasErrors = true;
      console.log('❌ Metadata validation errors:');
      metadataErrors.forEach(e => console.log(`  - ${e}`));
    } else {
      console.log('✅ Metadata valid');
    }
    console.log();

    // Validate APIs
    console.log('Validating API entries...');
    const apiValidation = validateAPIs(landscape);
    if (apiValidation.errors.length > 0) {
      hasErrors = true;
      console.log('❌ API validation errors:');
      apiValidation.errors.forEach(e => console.log(`  - ${e}`));
    } else {
      console.log('✅ All API entries valid');
    }
    if (apiValidation.warnings.length > 0) {
      hasWarnings = true;
      console.log('⚠️  API validation warnings:');
      apiValidation.warnings.forEach(w => console.log(`  - ${w}`));
    }
    console.log();

    // Validate categories
    console.log('Validating categories...');
    const categoryValidation = validateCategories(landscape);
    if (categoryValidation.errors.length > 0) {
      hasErrors = true;
      console.log('❌ Category validation errors:');
      categoryValidation.errors.forEach(e => console.log(`  - ${e}`));
    } else {
      console.log('✅ Categories valid');
    }
    if (categoryValidation.warnings.length > 0) {
      hasWarnings = true;
      console.log('⚠️  Category warnings:');
      categoryValidation.warnings.forEach(w => console.log(`  - ${w}`));
    }
    console.log();

    // Generate statistics
    console.log('Statistics:');
    console.log('----------');
    const stats = generateStatistics(landscape);
    console.log(`Total APIs: ${stats.total_apis}`);
    console.log(`APIs with URLs: ${stats.apis_with_urls}`);
    console.log(`Published APIs: ${stats.apis_published}`);
    console.log(`Unpublished APIs: ${stats.apis_unpublished}`);
    console.log(`APIs with previous names: ${stats.apis_with_previous_names}`);
    console.log('\nAPIs per category:');
    for (const [category, count] of Object.entries(stats.categories).sort()) {
      console.log(`  ${category}: ${count}`);
    }
    console.log();

    // Final result
    if (hasErrors) {
      console.log('❌ Validation FAILED - errors must be fixed');
      process.exit(1);
    } else if (hasWarnings) {
      console.log('⚠️  Validation passed with warnings');
      process.exit(0);
    } else {
      console.log('✅ Validation PASSED - landscape file is valid');
      process.exit(0);
    }

  } catch (error) {
    console.error(`\n❌ Fatal error: ${error.message}`);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}