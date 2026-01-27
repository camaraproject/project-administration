# Changelog for project-administration

## Table of Contents

- **[r1.3](#r13)**
- **[r1.2](#r12)**
- **[r1.1](#r11)**

## r1.3

**Release focus: Release Plan Rollout campaign and extended Release Collector**

### Added

* **Release Plan Rollout campaign** (`campaign-release-plan-rollout.yml`)
  - Adds release-plan.yaml to all CAMARA API repositories
  - Supports dry-run mode for planning before execution
  - Handles repositories with releases, WIP repositories, and new repositories
  - Includes validation step and comprehensive error handling
  - Mustache templates for release-plan generation

* **Pre-release tracking** in Release Collector
  - Extended to track pre-releases with repositories array filter
  - Added release type filtering to portfolio and internal viewers
  - Filter visibility for r0.X releases

* **Release-metadata generation** with schema 2.0.0
  - New property naming conventions
  - Enhanced dry-run analysis for metadata upload

* **Theme toggle** for viewers embedded in iframes

* **Dependabot** for automated GitHub Actions updates

### Changed

* Aligned filter terminology with release-plan-schema conventions
* Updated GitHub Actions to latest versions
* Improved template formatting (ASCII characters for compatibility)

### Fixed

* Fixed release-collector creating empty PRs daily (#106)
* Fixed release_type visibility in viewers
* Fixed maintenance-release branch naming convention in README
* Fixed aggregate job to run in both dry-run and apply modes

### Documentation

* Comprehensive documentation for pre-releases, metadata generation, and production upload
* Updated release-collector QUICKSTART and README
* New documentation for release-plan-rollout campaign

---

## r1.2

**Release focus: Release Collector and Campaign workflows**

### Added

* **Release Collector** (`release-collector.yml`, `release-collector-production.yml`)
  - Automated collection and tracking of CAMARA API releases
  - Incremental and full analysis modes
  - Interactive HTML viewers with dark mode support
  - Multi-select category filtering
  - Latest patch version filtering
  - Staging deployment to GitHub Pages
  - Production deployment workflow for camaraproject.github.io

* **Campaign - API Version WIP Check** (`campaign-api-version-wip-check.yml`)
  - Verifies API files have wip versions after releases
  - Plan mode (dry-run) and apply mode
  - Documentation: [campaigns/api-version-wip-check/](campaigns/api-version-wip-check/)

* **Campaign - Release Info Sync** (`campaign-release-info.yml`)
  - Updates Release Information sections in API repository READMEs
  - Creates PRs with latest release details, API versions, and viewer links
  - Idempotent execution with change detection
  - Documentation: [campaigns/release-info/docs/](campaigns/release-info/docs/)

* **Reusable Actions** (`actions/`)
  - `campaign-finalize-per-repo` - Creates branches, PRs, and reports for campaigns
  - `campaign-finalize-issue-per-repo` - Creates issues for repositories
  - `ensure-delimited-section` - Ensures delimited sections exist in files
  - `read-api-version-compliance` - Reads API version compliance data
  - `read-release-data` - Reads release data from repositories
  - `render-mustache` - Renders Mustache templates
  - `replace-delimited-content` - Replaces content within delimited sections

* **Configuration files** (`config/`)
  - `api-landscape.yaml` - API portfolio metadata for enrichment
  - `meta-release-mappings.yaml` - Repository release cycle to meta-release mappings

* **Release data** (`data/`)
  - `releases-master.yaml` - Generated release metadata for all public API releases since Fall24 meta-release

### Changed

* Workflow file names harmonized with category prefixes
* Workflow display names standardized (e.g., "Campaign - Release Info Sync")
* Standard headers added to all workflow files
* Config files moved from workflows/release-collector/config/ to repository root
* API Repository Creation: Removed automated parent team assignment (maintainers team no longer has a dedicated parent after team restructuring)

### Removed

* **Bulk Repository Administration Workflows** - Replaced by campaign framework
  - `project-admin-single-repo-test.yml`
  - `project-admin-repository-worker.yml`
  - `project-admin-bulk-repository-changes.yml`
  - Associated bulk operations

* **API Releases Report** (`project-report-camara-api-releases.yml`) - Replaced by Release Collector

### Deprecated

* **Repository Overview Report** (`report-repository-overview.yml`) - Will be replaced in a future release

### Security

* Workflows now use Fine-grained Personal Access Tokens (FGPAT) with minimal required permissions
* `CAMARA_BULK_CHANGE_TOKEN` no longer needed (bulk framework removed)

---

## r1.1

**This is the first release of the CAMARA project-administration repository.**

The repository provides tooling and workflows to support the administration of CAMARA, maintained under the supervision of TSC and the Release Management working group.

### Please note:

The repository has no regular releases schedule. Workflows are continuously updated based on current needs. Tested versions are in the `main` branch, while versions under test are in other branches.

### Added

* **API Repository Creation Workflow** (`project-admin-api-repository-creation.yml`)
  - Automates creation of new API repositories from `Template_API_Repository`
  - Supports dry-run mode for validation without creating resources
  - Creates and configures repository teams with proper permissions
  - Handles CODEOWNERS setup, issue creation, and branch protection rules
  - Includes comprehensive input validation and error handling
  - Requires `repository-creation` environment with `GH_REPO_CREATE_TOKEN`

* **Bulk Repository Administration Workflows**
  - **Single Repository Test** (`project-admin-single-repo-test.yml`)
    - Test operations on individual repositories before bulk execution
    - Provides structured result display with detailed feedback
    - Supports dry-run mode for safe testing
  
  - **Repository Worker** (`project-admin-repository-worker.yml`)
    - Reusable workflow component for executing operations
    - Handles both API-based and file-based operations
    - Supports multiple commit strategies (pull-request, direct-with-warning)
  
  - **Bulk Repository Changes** (`project-admin-bulk-repository-changes.yml`)
    - Orchestrates operations across multiple repositories
    - Includes repository filtering by category and name patterns
    - Parallel execution with configurable limits

* **Available Bulk Operations**
  - `disable-wiki`: Safely disables GitHub wiki (only if no content)
  - `add-changelog-codeowners`: Adds release management team as CHANGELOG reviewers
  - `add-changelog-file`: Adds template CHANGELOG.md to repositories without releases
  - `update-swagger-links`: Migrates swagger editor links to CAMARA swagger-ui
  - `update-swagger-links-releases`: Updates swagger links in release descriptions
  - `update-api-readiness-checklist`: Adds line 13 (API description for marketing)

* **Repository Reporting Workflows**
  - **Repository Overview** (`project-report-camara-repository-overview.yml`)
    - Weekly automated reports with repository health monitoring
    - 9-point template compliance verification for API repositories
    - Activity analysis with simple and detailed modes
    - Organization-wide statistics by repository type
    - Scheduled to run weekly on Mondays at 07:35 UTC
  
  - **API Releases Report** (`project-report-camara-api-releases.yml`)
    - Parallel processing for 70% faster execution (3-5 minutes)
    - Meta-release analysis (Fall24/Spring25/Fall25 categorization)
    - API version tracking from OpenAPI specifications
    - Consistency validation between main branch and releases
    - Filters for pre-releases and legacy releases

### Changed

* Initial release - no changes from previous versions

### Deprecated

* The following bulk operations are already used, and now included in new repositories,
will be removed in a next release:
  - `disable-wiki`: Safely disables GitHub wiki (only if no content)
  - `add-changelog-codeowners`: Adds release management team as CHANGELOG reviewers
  - `update-api-readiness-checklist`: Adds line 13 (API description for marketing)

### Removed

* Initial release - no removed features

### Fixed

* Initial release - no fixes required

### Security

* All workflows require appropriate GitHub tokens with specific permissions:
  - `CAMARA_BULK_CHANGE_TOKEN` for bulk operations
  - `GH_REPO_CREATE_TOKEN` for repository creation (in protected environment)
  - `CAMARA_REPORT_TOKEN` for reporting workflows
* Repository creation workflow uses protected `repository-creation` environment
* Dry-run mode available for all modification operations

### Known Issues

* Bulk operations are limited to 5 parallel executions to avoid API rate limits

### What's Next

* Additional bulk operations for common administrative tasks
* Enhanced reporting capabilities

---

**Note:** This repository provides administrative tooling for the CAMARA project. For questions or issues, please open an issue in this repository or contact the CAMARA admin team at adm@lists.camaraproject.org