# API Version WIP Check Campaign

This campaign checks API version compliance across CAMARA API repositories, ensuring that the main branch uses work-in-progress (`wip`) versions as required by CAMARA guidelines.

## Purpose

After each CAMARA release, API versions on the main branch must be reset to `wip` to indicate work-in-progress code. This ensures clear distinction between released and unreleased versions and prepares repositories for the next development cycle.

This campaign:
- Scans all API repositories for version compliance
- Creates issues in non-compliant repositories
- Lists specific files requiring correction
- Provides clear instructions for maintainers

## What Gets Checked

### OpenAPI YAML Files (`code/API_definitions/*.yaml`)

| Check | Requirement |
|-------|-------------|
| `info.version` | Must be exactly `"wip"` |
| `servers[].url` | Must contain version segment `/vwip` |

### Gherkin Test Files (`code/Test_definitions/*.feature`)

| Check | Requirement |
|-------|-------------|
| Feature header | Version reference must be `vwip` |
| Resource URLs | Path must contain `/vwip/` |

## How to Run

### Plan Mode (Dry Run)

Preview what issues would be created without making any changes:

```
gh workflow run campaign-api-version-wip-check.yml \
  -f dry_run=true \
  -f include_sandbox=true \
  -f include_incubating=true
```

### Apply Mode

Create issues in non-compliant repositories:

```
gh workflow run campaign-api-version-wip-check.yml \
  -f dry_run=false \
  -f include_sandbox=true \
  -f include_incubating=true
```

### Test with Single Repository

Test against a specific repository:

```
gh workflow run campaign-api-version-wip-check.yml \
  -f dry_run=true \
  -f repository_filter=QualityOnDemand
```

## Workflow Inputs

| Input | Description | Default |
|-------|-------------|---------|
| `dry_run` | Plan mode - no issues created | `true` |
| `include_sandbox` | Include sandbox API repositories | `true` |
| `include_incubating` | Include incubating API repositories | `true` |
| `repository_filter` | Filter to specific repo name | (empty) |

## Repository Selection

Repositories are selected based on GitHub topics:
- `sandbox-api-repository`
- `incubating-api-repository`

Archived repositories are excluded.

## Issue Deduplication

The workflow checks for existing open issues with the same title before creating new ones. If an issue already exists, it will be skipped and recorded in the results.

## Artifacts

The workflow generates:
- **plan.md / results.md**: Human-readable summary
- **plan.jsonl / results.jsonl**: Machine-readable records

## References

- [CAMARA Release Workflow and Metadata Concept](https://github.com/camaraproject/ReleaseManagement/blob/main/documentation/SupportingDocuments/CAMARA-Release-Workflow-and-Metadata-Concept.md)
- [Original discussion: ReleaseManagement#328](https://github.com/camaraproject/ReleaseManagement/issues/328)
- [CAMARA API Design Guide - Versioning](https://github.com/camaraproject/Commonalities/blob/main/documentation/CAMARA-API-Design-Guide.md#7-versioning)
