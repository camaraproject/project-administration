# OWASP Linting Campaign

This campaign scans CAMARA API repositories for OWASP Spectral findings and creates one issue per affected repository.

## Purpose

- Detect OWASP-related schema and API definition issues in `code/API_definitions`
- Provide detailed, file-level issue text for maintainers
- Support dry-run planning before creating issues

## How to Run

### Dry Run (plan only)

```bash
gh workflow run campaign-owasp-linting.yml \
  -f dry_run=true \
  -f include_sandbox=true \
  -f include_incubating=true
```

### Apply (create issues)

```bash
gh workflow run campaign-owasp-linting.yml \
  -f dry_run=false \
  -f include_sandbox=true \
  -f include_incubating=true
```

### Test Single Repository

```bash
gh workflow run campaign-owasp-linting.yml \
  -f dry_run=true \
  -f repository_filter=QualityOnDemand
```

### Test Multiple Repositories

```bash
gh workflow run campaign-owasp-linting.yml \
  -f dry_run=true \
  -f repository_filter=\"ReleaseTest,ConsentInfo,QualityOnDemand\"
```

## Inputs

- `dry_run` (default `true`): plan mode without issue creation
- `include_sandbox` (default `true`): include repositories with topic `sandbox-api-repository`
- `include_incubating` (default `true`): include repositories with topic `incubating-api-repository`
- `repository_filter` (default empty): optional single repository name or comma-separated list of names
- `exclude_repos` (default `DeviceStatus,KnowYourCustomer`): comma-separated exclusions
- `rule_profile` (default `api4-target`): `api4-target` or `full-camara-owasp`

## Token Requirements (FGPAT)

This campaign requires a Fine-Grained Personal Access Token stored as repository secret:

- Secret name: `BULK_CAMPAIGN_TOKEN`
- Repository access: all target CAMARA API repositories included in the campaign scope
- Repository permissions:
  - `Issues`: **Read and write** (required for deduplication checks and issue creation)
  - `Contents`: **Read-only** (required for checkout of target repositories)

The workflow now validates that `BULK_CAMPAIGN_TOKEN` is present before executing per-repo checks.

## Dry-Run Artifacts

- `plan.md`: summary report
- `plan.jsonl`: machine-readable summary records
- `plan-issue-texts.md`: full rendered issue text per affected repository

## Deduplication

The campaign checks for an open issue with the same title and skips creating duplicates.
