# Maintainer FAQ

Common questions about running and maintaining the Meta-Release Collector workflow.

## Basic Operations

### 1. How often should I run this workflow?

**Recommended**: Weekly on Mondays. Manual runs are needed after configuration changes or to fix data issues.

See [User Guide](docs/README.md#typical-workflows) for scheduling details.

### 2. What's the difference between incremental and full mode?

**Incremental**: Only processes new releases (fast, 1-2 minutes). Use for regular updates.

**Full**: Re-analyzes all releases (3-5 minutes). Use after configuration changes or to fix data.

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

## Pre-Releases and Release Types

### 13. How do pre-releases appear in the viewers?

Pre-releases are only visible in the **internal viewer**, which shows the release type as a text label (not a badge). The internal viewer allows filtering by release type.

**Note**: Closed meta-releases (Fall24) contain only public and maintenance releases - pre-releases are only relevant for open/upcoming meta-releases.

Release types:
- `pre-release-alpha` - Early development (version contains `-alpha.N`)
- `pre-release-rc` - Release candidate (version contains `-rc.N`)
- `public-release` - Public release of initial or stable API versions
- `maintenance-release` - Release on maintenance branch

### 14. Why don't I see r0.X releases?

Formal releases start at r1.1. Two existing r0.X releases are excluded from the collection - they were pre-releases accidentially created with these non-valid release tags.

## Archived Repositories

### 15. How are archived repositories handled?

Archived CAMARA API repositories (with the `archived-api-repository` topic) are included in the collection pipeline. Their releases remain in all reports with a `repository_archived: true` field in `releases-master.yaml`.

- Historical releases remain in meta-release reports (e.g., HomeDevicesQoD in Fall24)
- Viewers display archived repositories and APIs with an "Archived" badge
- Campaign workflows automatically skip archived repositories (PRs cannot be created on archived repos)
- Archived repositories appear in the `repositories[]` section of `releases-master.yaml`

After archiving a repository, run the workflow in **full** mode to ensure the `repository_archived` flag is applied to all existing release entries.

### 16. Workflow shows a warning about archived repository mismatch

The collector validates that the `archived-api-repository` topic and the GitHub `repo.archived` status are consistent. Two mismatch cases trigger warnings:

1. **Topic set but not archived on GitHub**: The repository has `archived-api-repository` topic but is not archived on GitHub. The repository may be in the process of being archived.
2. **Archived on GitHub but topic missing**: The repository is archived on GitHub but the maturity topic hasn't been updated to `archived-api-repository`. The governance process may not be complete.

In both cases, the mismatched repository is **skipped** from the current collection run. Warnings appear in:
- The PR body (### Warnings section)
- The workflow step summary

**To resolve**: Synchronize the two states — either archive the repository on GitHub or update the topic via the governance process. The next collection run will process the repository normally once both states are consistent.

## Production Deployment

### 17. What happens during production deploy?

The **Release Collector - Production Deploy** workflow does two things:
1. Deploys HTML viewers to camaraproject.github.io
2. Uploads release-metadata files (YAML/JSON) to each GitHub release as assets

### 18. Upload shows FAILED - what went wrong?

Common causes:
- **403 Forbidden**: Token lacks write permission for repository. The `PRODUCTION_DEPLOY_TOKEN` needs **Contents: Read and Write** permission.
- **404 Not Found**: Release doesn't exist in the repository.
- **Network errors**: Retry the workflow.

Check the workflow logs and upload report artifact for the specific error message.

### 19. Can I re-upload release metadata?

Yes. The upload uses `--clobber` mode, so running production deploy again will replace existing metadata files. The workflow shows **UPDATE** status for releases where files exist but content differs.

## Advanced

### 20. What files does the workflow commit?

Only `data/releases-master.yaml`, `data/release-artifacts/`, and `reports/*.json`. Viewers are NOT committed (available in artifacts and staging deployment).

### 21. How do I check what changed in a specific meta-release?

For new APIs within a meta-release you can use the meta-release viewer and order the "New" column with "True" values on top. To see the evolution of APIs across meta-releases use the Portfolio viewer.

### 22. The workflow is taking too long

See FAQ #2 for normal times. If significantly longer, check for API rate limits in logs or network issues.

See [User Guide](docs/README.md#workflow-timeout-or-very-slow) for troubleshooting.

## Getting More Help

- **Quick start**: [QUICKSTART.md](QUICKSTART.md)
- **Complete reference**: [User Guide](docs/README.md)
- **Architecture docs**: [docs/architecture/](docs/architecture/) (for developers)
- **Report issues**: Create an issue in the project-administration repository
