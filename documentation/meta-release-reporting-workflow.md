# Meta-Release Reporting Workflow v2

*Last updated: 2025-09-08*

## Overview

The `meta-release-reporting.yml` workflow is a GitHub Actions workflow for tracking and reporting on CAMARA API releases across meta-release cycles (Fall24, Spring25, Fall25, etc.). This v2 workflow replaces the original `project-report-camara-api-releases.yml`.

## Key Features

### Meta-Release Support
- **Fall25**: Tracks M3 pre-release window (July 10 - Aug 13, 2025) and M4 milestones
- **Spring25**: February - March 2025 release window
- **Fall24**: August - September 2024 release window
- Automatic categorization of releases into meta-release cycles
- Consistent handling of patch releases within meta-release series

### API Version Release Status Table
- Primary output for meta-release reports (Fall25, Spring25, Fall24)
- Shows target version, maturity level, current version
- Tracks M3 pre-release dates and M4 release/PR status
- Identifies new APIs vs existing ones
- Links directly to repositories and releases

### Data Export
- Generates structured JSON for external visualization
- Compatible with the CAMARA API Status Viewer
- Includes metadata and versioning
- Enables trend analysis and reporting dashboards

## Workflow Inputs

```yaml
report_type:
  description: 'Report type to generate'
  options:
    - 'fall25'       # Default - Fall 2025 meta-release
    - 'spring25'     # Spring 2025 meta-release
    - 'fall24'       # Fall 2024 meta-release
    - 'full'         # All repositories and releases
    - 'full-no-legacy' # All except legacy releases
  default: 'fall25'

include_prerelease:
  description: 'Include pre-releases in the report'
  default: true      # Changed from false in v1

recent_days_window:
  description: 'Recent releases section (0 to disable)'
  default: 30

show_repository_details:
  description: 'Include detailed repository analysis'
  default: false

show_prerelease_only_repos:
  description: 'Show repositories with only pre-releases'
  default: false

show_repos_without_releases:
  description: 'Show repositories without any releases'
  default: false

include_consistency_analysis:
  description: 'Include consistency analysis'
  default: false
```

## Report Sections

### 1. Executive Summary
Always displayed, showing:
- Total API repositories analyzed
- Repositories with releases/pre-releases/no releases
- Processing errors if any

### 2. Meta-Release Summary
For full reports, shows statistics by meta-release

### 3. API Version Release Status
For meta-release reports (Fall25, Spring25, Fall24), displays:
- API name and target version
- Maturity level (initial/stable)
- Current version in latest release
- M3 pre-release information
- M4 release or PR status
- Repository links
- New API indicators

### 4. Optional Sections
- **Recent Releases**: Releases within specified days window
- **Repository Details**: Detailed per-repository analysis
- **Pre-release Only Repos**: Repositories with only pre-releases (no public releases)
- **Repos Without Releases**: Repositories without any releases
- **Consistency Analysis**: Version and release consistency checks

## JSON Export Format

The workflow exports structured JSON for meta-release reports (Fall25, Spring25, Fall24) to enable visualization:

```json
{
  "metadata": {
    "generated": "2025-09-08T...",
    "metaRelease": "Fall25",
    "reportType": "fall25",
    "totalAPIs": 25
  },
  "apis": [
    {
      "name": "qod",
      "targetVersion": "1.0.0",
      "maturity": "stable",
      "currentVersion": "1.0.0-rc.1",
      "preRelease": {
        "tag": "r1.1-rc",
        "date": "2025-07-15",
        "url": "https://..."
      },
      "m4Release": {
        "type": "pr",
        "number": "123",
        "url": "https://..."
      },
      "repository": {
        "name": "QualityOnDemand",
        "url": "https://..."
      },
      "isNew": false
    }
  ]
}
```

## Viewing JSON Output

The JSON export can be visualized using the CAMARA API Status Viewer:
1. Download the JSON artifact from the workflow run
2. Open the viewer at https://camaraproject.github.io/api-status-viewer (coming soon)
3. Load the JSON file to see an interactive table with sorting and CSV export

Note: JSON export is currently only available for meta-release reports (Fall25, Spring25, Fall24), not for Full reports.

## Configuration

### Environment Variables
```yaml
# Processing Configuration
CONFIG_REPOS_PER_GROUP: '8'
CONFIG_MAX_PARALLEL: '6'
CONFIG_RELEASES_PER_PAGE: '100'
CONFIG_API_DELAY_MS: '300'

# Meta-release Windows
FALL25_M3_START: '2025-07-10'
FALL25_M3_END: '2025-08-13'
SPRING25_WINDOW_START: '2025-02-01'
SPRING25_WINDOW_END: '2025-03-31'
```

### API Name Equivalences
Handles renamed APIs (e.g., `qod-provisioning` → `qos-provisioning`)

## Usage Examples

### Generate Fall25 Report (Default)
```bash
# Uses defaults: fall25, includes pre-releases
gh workflow run meta-release-reporting.yml
```

### Generate Spring25 Report without Pre-releases
```bash
gh workflow run meta-release-reporting.yml \
  -f report_type=spring25 \
  -f include_prerelease=false
```

### Full Report with All Sections
```bash
gh workflow run meta-release-reporting.yml \
  -f report_type=full \
  -f show_repository_details=true \
  -f include_consistency_analysis=true
```

## Migration from v1

The original `project-report-camara-api-releases.yml` workflow remains available for backward compatibility but is deprecated. Key differences:

| Feature | v1 | v2 (meta-release-reporting) |
|---------|----|-----------------------------|
| Default report | full | fall25 |
| Pre-releases default | excluded | included |
| Release fetch limit | 20 | 100 |
| M4 PR detection | Not available | Fall25 milestone tracking |
| Code structure | Monolithic | Modular |

## Requirements

- **GitHub Token**: Uses the default `GITHUB_TOKEN` (all CAMARA repositories are public)
- **Optional**: `CAMARA_REPORT_TOKEN` can be used for higher API rate limits
- **Runtime**: Approximately 3-5 minutes for full organization scan

## Troubleshooting

### Rate Limit Issues
- Use `CAMARA_REPORT_TOKEN` with higher rate limits
- Reduce parallel processing if needed

### Missing Data
- Check if repositories have correct topics (sandbox-api-repository or incubating-api-repository)
- Verify release tags follow rX.Y format
- Ensure API definitions are in `code/API_definitions/`

### JSON Export Issues
- Verify the workflow completed successfully
- Check artifacts section of the workflow run
- Ensure JSON viewer has access to load the file

## Support

For issues or questions:
- Check the [workflow logs](https://github.com/camaraproject/project-administration/actions)
- Review this documentation
- Contact the CAMARA project administration team