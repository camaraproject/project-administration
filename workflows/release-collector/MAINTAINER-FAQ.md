# Maintainer FAQ

Common questions about running and maintaining the Meta-Release Collector workflow.

## Basic Operations

### 1. How often should I run this workflow?

**Recommended**: Weekly on Mondays. Manual runs are needed after configuration changes or to fix data issues.

See [User Guide](docs/README.md#typical-workflows) for scheduling details.

### 2. What's the difference between incremental and full mode?

**Incremental**: Only processes new releases (fast, 2-5 minutes). Use for regular updates.

**Full**: Re-analyzes all releases (5-15 minutes). Use after configuration changes or to fix data.

See [User Guide](docs/README.md#analysis-scope) for complete details.

### 3. The workflow didn't create a PR. Is something wrong?

No, this is normal! The workflow only creates a PR when it detects changes (new releases or different data).

If no changes, the workflow completes successfully without a PR.

### 4. Where are the HTML viewers?

Viewers are NOT committed to the repository. Find them at:
1. **Staging preview**: Links in PR description (GitHub Pages)
2. **Artifacts**: Download from workflow run page
3. **Production** (Phase 4): Will be deployed to camaraproject.github.io

See [User Guide](docs/README.md#generated-files) for details.

### 5. What should I check before merging a PR?

See the PR review checklist in [User Guide](docs/README.md#if-pr-is-created) for the complete checklist.

Then **squash and merge** to keep history clean.

## Configuration

> **Note**: Configuration changes require **manual** workflow runs. Scheduled runs (incremental) do not detect config file changes.

### 6. How do I add a new API to the landscape?

Edit [config/api-landscape.yaml](../../config/api-landscape.yaml) with the API details, then manually run workflow with **full** analysis and **force_viewers** enabled.

See [User Guide](docs/README.md#adding-new-apis) for complete syntax and examples.

### 7. How do I change which meta-release a repository belongs to?

Edit [config/meta-release-mappings.yaml](../../config/meta-release-mappings.yaml), then manually run workflow with **full** analysis.

See [User Guide](docs/README.md#meta-release-mappingsyaml) for syntax.

### 8. An API changed names. How do I track it across releases?

Use the `previous_names` field in api-landscape.yaml. This ensures the API is tracked as a single entity despite the name change.

See [User Guide](docs/README.md#api-landscapeyaml) for configuration details.

## Troubleshooting

### 9. Workflow failed with "Enrichment not found for API X"

An API exists in releases but not in api-landscape.yaml. Add it to the landscape file and run **full** analysis.

See [User Guide](docs/README.md#workflow-failed-with-enrichment-not-found-for-api-x) for step-by-step solution.

### 10. Viewers show outdated data

Run workflow with **force_viewers: true** to regenerate all viewers. Viewers only regenerate when data or templates change.

### 11. I see "No changes detected" but I expected updates

This is normal when running incremental mode with no new releases, or when full mode generates identical data. Check workflow logs for "Found X releases to analyze" to verify.

See [User Guide](docs/README.md#no-pr-created-even-though-i-expected-changes) for diagnosis steps.

### 12. Can I test changes without creating a PR?

Yes! Use **execution_mode: dry-run** to run the workflow completely without committing or creating a PR. Download artifacts to review results.

## Advanced

### 13. What files does the workflow commit?

Only `data/releases-master.yaml` and `reports/*.json`. Viewers are NOT committed (available in artifacts and staging deployment).

### 14. How do I check what changed in a specific meta-release?

Compare the JSON reports in the PR diff (`reports/fall24.json`, `reports/spring25.json`, etc.). The diff shows new APIs, version changes, and maturity changes.

### 15. The workflow is taking too long

Normal times: 2-5 minutes (incremental), 5-15 minutes (full). If longer, check for API rate limits in logs or network issues.

See [User Guide](docs/README.md#workflow-timeout-or-very-slow) for troubleshooting.

## Getting More Help

- **Quick start**: [QUICKSTART.md](QUICKSTART.md)
- **Complete reference**: [User Guide](docs/README.md)
- **Architecture docs**: [docs/architecture/](docs/architecture/) (for developers)
- **Report issues**: Create an issue in the project-administration repository
