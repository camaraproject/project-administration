# Release Information Campaign

This campaign automatically updates the "Release Information" section in README.md files across CAMARA API repositories.

## Purpose

Maintains consistent and up-to-date release information across all CAMARA API repositories. Supports four repository categories:

1. **no_release** - Repositories with no releases yet (placeholder text)
2. **prerelease_only** - Repositories with only pre-releases (alpha, rc)
3. **public_release** - Repositories with public releases
4. **public_with_prerelease** - Repositories with public release + newer pre-release

Content includes:
- Latest release tag and link (public or pre-release)
- API versions and specifications
- Links to YAML definitions and API viewers (ReDoc, Swagger UI)
- References to CHANGELOG and other releases

## Setup and Prerequisites

### Required: GitHub Token Configuration

This campaign requires a Fine-Grained Personal Access Token (FGPAT) with permissions to create branches and pull requests across multiple repositories.

**Token Requirements:**
- **Token type:** Fine-grained personal access token (not classic PAT)
- **Repository permissions needed:**
  - Contents: Read and write
  - Pull requests: Read and write
- **Why needed:** The workflow needs to create branches and PRs in target repositories (not just the project-administration repository where it runs)

**Installation Steps:**

1. **Create a Fine-Grained Personal Access Token (FGPAT):**
   - Go to GitHub Settings → Developer settings → Personal access tokens → Fine-grained tokens
   - Click "Generate new token"
   - Configure:
     - Token name: `CAMARA Bulk Campaigns`
     - Expiration: Choose appropriate duration (recommend 1 year)
     - Resource owner: Select the organization (e.g., `camaraproject`)
     - Repository access: Choose "All repositories" or select specific repos
     - Permissions:
       - Repository permissions → Contents: Read and write
       - Repository permissions → Pull requests: Read and write

2. **Add Token as Repository Secret:**
   - Navigate to the project-administration repository
   - Go to Settings → Secrets and variables → Actions
   - Click "New repository secret"
   - Name: `BULK_CAMPAIGN_TOKEN`
   - Value: Paste your generated token
   - Click "Add secret"

3. **Verify Token Configuration:**
   - The workflow file references this secret as `secrets.BULK_CAMPAIGN_TOKEN`
   - No code changes needed if the secret is named correctly

**Troubleshooting Token Issues:**

- **"Resource not accessible by integration":** Token lacks required permissions. Regenerate with correct scopes.
- **"Bad credentials":** Token may be expired or incorrect. Verify secret value in repository settings.
- **403 errors:** Token may not have access to target repositories. Check repository access configuration.

## Usage

### Plan Mode (Dry Run)

Test the campaign without making any changes:

1. Navigate to [Actions → campaign-release-info](../../.github/workflows/campaign-release-info.yml)
2. Click "Run workflow"
3. Leave `dry_run` checked (default)
4. Run the workflow
5. Review the generated `plan.md` and `plan.jsonl` artifacts

**Plan mode behavior:**
- Writes changes to target repo clones
- Detects existing PRs and compares against them
- Creates plan artifacts showing which PRs would be created
- Resets working tree (no changes persist)
- **Does NOT create any PRs**

### Apply Mode (Create PRs)

Apply changes and create pull requests:

1. Test with plan mode first
2. Uncheck `dry_run` option when running workflow
3. Run the workflow
4. PRs will be created with dated titles (e.g., `[bulk] Sync Release Information section (2025-10-29-001)`)
5. Verify PRs in target repositories

**Apply mode behavior:**
- Detects newest existing PR for comparison
- Commits changes to unique branch with run ID
- Creates new PR when changes are detected
- Multiple PRs may exist; codeowners close old ones after review
- Generates `results.md` and `results.jsonl` artifacts with PR URLs

## Configuration

### Workflow Inputs

When running the workflow, configure these inputs:

| Input | Type | Default | Description |
|-------|------|---------|-------------|
| `dry_run` | boolean | true | Plan mode (no PRs created) |
| `include` | string | "" | Filter to specific repos (comma-separated) |
| `include_no_release` | boolean | false | Process repos with no releases |
| `include_prerelease_only` | boolean | false | Process repos with only pre-releases |
| `include_public_release` | boolean | false | Process repos with public releases |
| `include_public_with_prerelease` | boolean | false | Process repos with public + newer pre-release |

**Note:** All category inputs default to false. You must enable at least one category to process any repositories.

### Environment Variables

Edit [.github/workflows/campaign-release-info.yml](../../.github/workflows/campaign-release-info.yml):

```yaml
env:
  ORG: camaraproject                # Target organization
  RELEASES_FILE: data/releases-master.yaml
  BRANCH: bulk/release-info-sync-${{ github.run_id }}  # Unique branch per run
  PR_TITLE: "[bulk] Sync Release Information section"  # Date added automatically
  PR_BODY: "Automated update of README Release Information section"
```

**Key Configuration Options:**
- `BRANCH`: Branch name pattern (run_id makes each run unique)
- `PR_TITLE`: Base PR title (date and sequence number added automatically)

## Understanding Results

### Plan Output Example

```markdown
### camaraproject/QualityOnDemand
- WOULD apply
- PR status: New PR would be created
- Reason: new changes detected
- release_state: public_release
- latest_public_release: r3.2
- newest_prerelease: N/A
- api_count: 3
```

### Apply Output Example

```markdown
### camaraproject/QualityOnDemand
- WOULD apply
- PR status: New PR would be created
- Reason: new changes detected
- PR URL: https://github.com/camaraproject/QualityOnDemand/pull/508
- release_state: public_release
- latest_public_release: r3.2
- newest_prerelease: N/A
- api_count: 3
```

### PR Status Values

- **`will_create`** - Changes detected; new PR created
- **`no_change`** - Content identical to newest PR or main; no update needed (idempotent)

### Reason Values

- **`new_changes`** - Content differs from both main and existing PR
- **`duplicate_of_pr`** - Content identical to existing PR
- **`main_up_to_date`** - Main already has current content

## Error Handling

Repositories without Release Information section markers will be reported as errors:

```markdown
### camaraproject/SimSwap
- ERROR: Release Information section markers not found in README.md
- Failed at step: ensure-delimiters
- Status: Skipped
- latest_public_release: r3.2
- api_count: 2
```

These repos need manual addition of section markers before the campaign can update them.

## Troubleshooting

### No changes detected (all repos show no_change)
**Cause:** Content already up-to-date
**Solution:** Expected behavior - campaign is idempotent

### ERROR: Release Information section markers not found
**Cause:** README.md missing delimited section markers
**Solution:** Manually add markers to README.md:
```markdown
<!-- CAMARA:RELEASE-INFO:START -->
_This section is managed by project-administration_
<!-- CAMARA:RELEASE-INFO:END -->
```

### Repository shows "no_release" or "prerelease_only" state
**Cause:** Repository has no public releases yet
**Solution:** This is expected behavior. Enable `include_no_release` or `include_prerelease_only` to process these repositories with appropriate templates.

### PRs not created in apply mode
**Cause:** Check results.md for status:
- `no_change` - Content identical (expected, idempotent)
- Error status - See error message

## Further Documentation

- [Architecture Overview](01-architecture.md) - System design and workflow
- [Plan vs Apply Modes](02-plan-apply.md) - Detailed mode comparison and PR management
- [Actions Reference](04-actions.md) - Reusable actions documentation
- [ADR-0001: Campaign Architecture](ADR/0001-campaign-architecture.md) - Architecture decisions
