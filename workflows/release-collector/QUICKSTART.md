# Meta-Release Collector - Quick Start

**For CAMARA Maintainers**: 2-minute guide to running the workflow

## What This Does

Automatically tracks all CAMARA API releases across repositories (including pre-releases), categorizes them by meta-release (Fall24, Spring25, Fall25, Spring26), and generates browsable HTML viewers. Also generates release-metadata files for each release.

## Scheduled Runs

The workflow runs automatically **daily at 04:35 UTC** with these settings:
- Analysis scope: `incremental` (only new releases)
- Execution mode: `pr` (creates PR if updates found)

When new releases are detected, a PR is created automatically. Maintainers receive notifications and can review/merge when convenient.

## Manual Runs

1. **Navigate to Actions**
   - Go to: github.com/camaraproject/project-administration
   - Click **Actions** tab → **Release Collector v3** → **Run workflow**

2. **Use These Settings**

   **For weekly updates** (recommended):
   ```
   Analysis scope:  incremental
   Execution mode:  pr
   Debug mode:      false
   Force viewers:   false
   ```

   **For fixing data issues or after config changes**:
   ```
   Analysis scope:  full
   Execution mode:  pr
   Debug mode:      false
   Force viewers:   true
   ```

   **For testing without creating PR**:
   ```
   Analysis scope:  incremental (or full)
   Execution mode:  dry-run
   ```

3. **What Happens Next**

   - Workflow runs for 3-5 minutes
   - You'll see 8 phases execute in the Actions UI:
     - Detect → Analyze (parallel) → Update → Generate Metadata → Generate Viewers → Publish → Deploy Staging → Summary
   - If updates found: Creates a PR with title "Review: CAMARA release data updates from Release Collector bot"
   - If no updates: Workflow completes without PR
   - Viewers available for preview at staging GitHub Pages URLs (in PR description)
   - Release-metadata files (YAML/JSON) staged for each release in `data/release-artifacts/`

   ![Workflow phases visualization](docs/images/workflow-visualization.png)

## Reviewing the PR

See [User Guide - PR Review Checklist](docs/README.md#if-pr-is-created) for the complete review checklist.

Then: **Squash and merge** to keep history clean

## After Merging - Deploy to Production

After merging the PR, deploy viewers and upload release metadata to the public site:

1. **Navigate to Actions**
   - Go to: github.com/camaraproject/project-administration
   - Click **Actions** tab → **Release Collector - Production Deploy** → **Run workflow**

2. **Configure options** (defaults are usually fine)

   | Option | Default | Description |
   |--------|---------|-------------|
   | `deploy_viewers` | `true` | Deploy HTML viewers to production |
   | `upload_metadata` | `true` | Upload release-metadata to GitHub releases |
   | `upload_releases` | (empty) | Filter: e.g., "QualityOnDemand/r1.2". Empty = all |
   | `ref` | (empty) | Used only for rollback: commit SHA from main history. Leave empty for normal deployment (latest from main branch) |
   | `allow_branch` | `false` | Emergency or test: set `true` to deploy from current branch instead of main |
   | `dry_run` | `false` | Preview mode: set `true` to show what would happen without deploying |

3. **What Happens**
   - Viewers are published to: https://camaraproject.github.io/releases/
   - Links: [Spring26](https://camaraproject.github.io/releases/spring26.html) | [Fall25](https://camaraproject.github.io/releases/fall25.html) | [Spring25](https://camaraproject.github.io/releases/spring25.html) | [Fall24](https://camaraproject.github.io/releases/fall24.html)
   - Release-metadata files (YAML/JSON) uploaded to each GitHub release as assets
   - Upload report artifact generated showing NEW/UPDATE/CURRENT status for each release

   **Safety**: By default, the workflow validates that staging content matches main branch before deploying.

## When to Use Full Analysis

> **Important**: Config file changes are NOT automatically detected. You MUST manually run a full analysis after changing any config file - scheduled runs (incremental) will not pick up these changes.

Run **full** analysis when:
- You updated [api-landscape.yaml](../../config/api-landscape.yaml) (API categories, URLs, tooltips)
- You changed [meta-release-mappings.yaml](../../config/meta-release-mappings.yaml)
- You suspect data quality issues
- Templates were modified (force viewers also needed)

## Getting Help

- **Detailed guide**: [docs/README.md](docs/README.md)
- **Common questions**: [MAINTAINER-FAQ.md](MAINTAINER-FAQ.md)
- **Report issues**: Create issue in project-administration repository
