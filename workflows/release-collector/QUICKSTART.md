# Meta-Release Collector - Quick Start

**For CAMARA Maintainers**: 2-minute guide to running the workflow

## What This Does

Automatically tracks all CAMARA API releases across repositories, categorizes them by meta-release (Fall24, Spring25, Fall25), and generates browsable HTML viewers.

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

   - Workflow runs for 5-15 minutes
   - You'll see 7 phases execute in the Actions UI:
     - Detect → Analyze (parallel) → Update → Generate Viewers → Publish → Deploy Staging → Summary
   - If updates found: Creates a PR with title "chore: Update CAMARA release metadata"
   - If no updates: Workflow completes without PR
   - Viewers available for preview at staging GitHub Pages URLs (in PR description)

   ![Workflow phases visualization](docs/images/workflow-visualization.png)

## Reviewing the PR

See [User Guide - PR Review Checklist](docs/README.md#if-pr-is-created) for the complete review checklist.

Then: **Squash and merge** to keep history clean

## After Merging - Deploy to Production

After merging the PR, deploy viewers to the public site:

1. **Navigate to Actions**
   - Go to: github.com/camaraproject/project-administration
   - Click **Actions** tab → **Release Collector - Production Deploy** → **Run workflow**

2. **Use default settings** (recommended)
   - Validates staging content matches main branch before deploying

3. **What Happens**
   - Viewers are published to: https://camaraproject.github.io/releases/
   - Links: [Fall24](https://camaraproject.github.io/releases/fall24.html) | [Spring25](https://camaraproject.github.io/releases/spring25.html) | [Fall25](https://camaraproject.github.io/releases/fall25.html)

## When to Use Full Re-analysis

Run **full** analysis when:
- You updated [api-landscape.yaml](../../config/api-landscape.yaml) (API categories, URLs, tooltips)
- You changed [meta-release-mappings.yaml](../../config/meta-release-mappings.yaml)
- You suspect data quality issues
- Templates were modified (force viewers also needed)

## Getting Help

- **Detailed guide**: [docs/README.md](docs/README.md)
- **Common questions**: [MAINTAINER-FAQ.md](MAINTAINER-FAQ.md)
- **Report issues**: Create issue in project-administration repository
