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

## Inputs

- `dry_run` (default `true`): plan mode without issue creation
- `include_sandbox` (default `true`): include repositories with topic `sandbox-api-repository`
- `include_incubating` (default `true`): include repositories with topic `incubating-api-repository`
- `repository_filter` (default empty): test against one repository name
- `exclude_repos` (default `DeviceStatus,KnowYourCustomer`): comma-separated exclusions
- `rule_profile` (default `api4-target`): `api4-target` or `full-camara-owasp`

## Dry-Run Artifacts

- `plan.md`: summary report
- `plan.jsonl`: machine-readable summary records
- `plan-issue-texts.md`: full rendered issue text per affected repository

## Deduplication

The campaign checks for an open issue with the same title and skips creating duplicates.
