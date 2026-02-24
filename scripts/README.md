# Admin Scripts

Scripts for managing the `camaraproject` GitHub organization. All scripts are read-only unless noted otherwise.

## Prerequisites

- [gh CLI](https://cli.github.com/) authenticated with org read access
- [jq](https://jqlang.github.io/jq/) installed (`brew install jq`)

## Scripts

### check-teams-and-members.sh

Audits organization teams and members to identify:
- **Unused teams** — not associated with any active (non-archived) repository
- **Orphaned members** — not belonging to any team that has active repositories

Teams are classified as directly active (own repos), indirectly active (parent of active teams), or unused. Members are considered active only if they belong to at least one directly-active team, since parent teams inherit child members automatically.

Configurable exceptions: `ADMIN_TEAMS` for teams with org-wide access, `EXCLUDED_MEMBERS` for members with special roles.

```bash
./check-teams-and-members.sh [--org camaraproject] [--verbose]
```

### check-team-repo-compliance.sh

Validates that GitHub team membership matches repository documentation:
- **`*_codeowners` teams** are compared against the `CODEOWNERS` file (`*` line)
- **`*_maintainers` teams** are compared against the `MAINTAINERS.MD` file (GitHub username column)

Reports mismatches (members in team but not in file, or in file but not in team) and lists compliant repositories.

Configurable exceptions: `SKIP_REPOS` for repositories with non-standard structures, `CROSS_CUTTING_TEAMS` for teams assigned across many repos for administrative purposes.

```bash
./check-team-repo-compliance.sh [--org camaraproject] [--verbose]
```

### apply-release-rulesets.sh

Creates or updates the repository ruleset required by the release automation workflow. Protects `release-snapshot/**` branches so that only the `camara-release-automation` GitHub App can create, push, and delete them, while humans must use PRs with required approvals.

**Note:** This script modifies repository settings. Requires a Fine-grained PAT with Repository Administration write access.

```bash
./apply-release-rulesets.sh --repos "ReleaseTest,QualityOnDemand" [--org camaraproject] [--dry-run]
```
