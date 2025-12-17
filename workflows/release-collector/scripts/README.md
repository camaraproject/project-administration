# CAMARA Meta-Release Collector Scripts

This directory contains the scripts that power the CAMARA Meta-Release Collector Workflow v3.

## Architecture Overview

The workflow implements a clean separation of concerns:
1. **Master Metadata**: Contains only GitHub facts with format corrections
2. **API Landscape**: Contains all enrichments (categories, URLs, tooltips)
3. **Runtime Enrichment**: Applied during report generation

## Active Scripts (Used in Workflow)

### Core Workflow Scripts

#### 1. `detect-releases.js`
- **Purpose**: Detects new releases across all CAMARA repositories
- **Used by**: GitHub workflow (Phase 1)
- **Modes**:
  - `incremental`: Detect only new releases
  - `full`: Re-analyze all releases
- **Output**: List of releases to analyze

#### 2. `analyze-release.js`
- **Purpose**: Analyzes individual releases to extract API specifications
- **Used by**: GitHub workflow (Phase 2)
- **Key Features**:
  - Extracts API metadata from OpenAPI specs
  - **Applies format corrections** (v-prefix removal, commonalities as numbers)
  - Preserves historical facts (API names unchanged)
- **Modes**:
  - `--github <repo> <tag>`: Fetch from GitHub API
  - `--local <path> <tag>`: Analyze from local repository

#### 3. `update-master.js`
- **Purpose**: Updates master metadata with analyzed release data
- **Used by**: GitHub workflow (Phase 3)
- **Note**: Receives data with format corrections already applied
- **Output**: Updated `data/releases-master.yaml`

#### 4. `generate-reports.js`
- **Purpose**: Generates JSON reports for each meta-release
- **Used by**: GitHub workflow (Phase 4)
- **Key Features**:
  - **Runtime enrichment** from `/config/api-landscape.yaml`
  - Adds portfolio categories, URLs, tooltips
  - Groups APIs by canonical names (handles renames)
- **Output**: JSON reports in `reports/` directory

#### 5. `generate-viewers.js`
- **Purpose**: Generates HTML viewers with embedded report data
- **Used by**: GitHub workflow (Phase 5)
- **Output**: HTML viewers in `viewers/` directory

### Utility Scripts

#### 6. `validate-landscape.js`
- **Purpose**: Validates the API landscape configuration
- **Usage**: `node scripts/validate-landscape.js`
- **Validates**:
  - YAML syntax and schema compliance
  - Category consistency
  - Previous names handling
- **Output**: Validation report with statistics

### Library

#### `lib/enrichment.js`
- **Purpose**: Utility functions for runtime enrichment
- **Functions**:
  - `loadLandscape()`: Loads API landscape data
  - `findEnrichment()`: Matches APIs by name or previous_names
  - `enrichAPI()`: Applies enrichment to single API
  - `enrichReleaseData()`: Enriches complete release data
  - `generateEnrichedStatistics()`: Creates statistics with canonical grouping

## Data Flow

```
GitHub Repositories
        ↓
detect-releases.js (identify releases to analyze)
        ↓
analyze-release.js (extract APIs, apply format corrections)
        ↓
update-master.js (update master metadata)
        ↓
generate-reports.js (apply runtime enrichment)
        ↓
generate-viewers.js (create HTML viewers)
```

## Configuration Files

### Required Configuration

- `/config/meta-release-mappings.yaml`: Maps repositories to meta-releases
- `/config/api-landscape.yaml`: Enrichment data for APIs
  - Categories, URLs, tooltips
  - Previous names for renamed APIs

## Format Corrections Applied

The following format corrections are hardcoded and unconditionally applied by `analyze-release.js`:

1. **Version format**: Remove 'v' prefix (v0.11.0 → 0.11.0)
   - Applied to all version fields from OpenAPI spec
   - Ensures consistent semantic versioning format

2. **Commonalities type**: Ensure string type (0.4 → "0.4", strings unchanged)
   - Converts numbers to strings
   - Preserves existing strings exactly (including patch versions like "0.4.0")

3. **API names**: Convert to lowercase for consistency
   - Applied to api_name field extracted from server URLs
   - Ensures consistent naming across all APIs

These corrections are always applied and do not require any configuration files.

## Historical Facts Preserved

The following are NOT changed (preserved as historical facts):

- API name changes (e.g., "qod-provisioning" stays as-is)
- Repository names
- API titles

## Environment Variables

- `GITHUB_TOKEN`: GitHub API authentication (optional but recommended)
- `GITHUB_ORG`: GitHub organization (default: 'camaraproject')
- `API_LANDSCAPE_PATH`: Custom path to landscape file (optional)

## Testing

To test the complete pipeline locally:

```bash
# 1. Validate landscape configuration
node scripts/validate-landscape.js

# 2. Test analysis of a single release
node scripts/analyze-release.js --github QualityOnDemand r1.1

# 3. Generate reports with enrichment
node scripts/generate-reports.js

# 4. Generate HTML viewers
node scripts/generate-viewers.js
```

## Archived Scripts

Test scripts have been moved to the `archive/` folder:
- `test-pipeline.js`
- `test-update-master.js`
- `test-workflow-simple.js`

These are not part of the active workflow but kept for reference.

## Notes

- The workflow runs weekly or on manual trigger
- Format corrections happen during analysis, not as a separate step
- Enrichment happens at report generation time, not stored in master data
- The `previous_names` field in api-landscape.yaml handles API renames