# Plan vs Apply Modes

## Plan Mode (Dry Run)

Plan mode simulates the campaign without creating any PRs or persistent changes.

**Behavior:**
- Writes changes into the repository clone
- Detects existing PRs by searching for base title + automated label
- Compares changes using two-stage detection:
  1. Compare against main branch
  2. If PR exists, compare against newest PR branch
- Records what would happen in plan artifacts
- Resets working tree (`git reset --hard && git clean -fd`)
- **Never creates PRs**

**Outputs:**
- `plan.md` - Human-readable summary with PR status
- `plan.jsonl` - Machine-readable records with PR metadata

**Example plan.md:**
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

**Example plan.jsonl:**
```json
{"repo":"camaraproject/QualityOnDemand","release_state":"public_release","pr_would_be_created":true,"reason":"new_changes","latest_public_release":"r3.2","newest_prerelease":null,"api_count":3,"timestamp":"2025-10-29T14:58:08.925Z","pr_status":"will_create"}
```

## Apply Mode

Apply mode executes the campaign and creates pull requests in target repositories.

**Behavior:**
- Same change detection as plan mode
- Commits changes to unique branch: `bulk/release-info-sync-{run_id}`
- Always creates new PR when changes detected (never updates existing PRs)
- Adds date and sequence to PR title: `[bulk] Title (2025-10-29-001)`
- Marks old PRs as superseded and converts them to draft
- Records actual outcomes in results artifacts

**Outputs:**
- `results.md` - Human-readable summary with PR URLs
- `results.jsonl` - Machine-readable records with PR metadata

**Example results.md:**
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

**Example results.jsonl:**
```json
{"repo":"camaraproject/QualityOnDemand","release_state":"public_release","pr_would_be_created":true,"reason":"new_changes","latest_public_release":"r3.2","newest_prerelease":null,"api_count":3,"timestamp":"2025-10-29T15:01:00.757Z","pr_status":"will_create","pr_url":"https://github.com/camaraproject/QualityOnDemand/pull/508"}
```

## PR Status Values

Both modes use simplified status tracking:

- **`will_create`** - Changes detected; new PR would be/was created
- **`no_change`** - Content identical to newest PR (or main); no action needed

## Change Detection Reasons

The workflow tracks why it made each decision:

- **`new_changes`** - Content differs from both main and existing PR
- **`duplicate_of_pr`** - Content identical to existing PR branch
- **`main_up_to_date`** - Main branch already has current content

## Two-Stage Change Detection

Prevents duplicate PRs and provides clear decision tracking:

### Stage 1: Compare Against Main
```bash
git diff --quiet -- README.md
```
- If no diff: `reason=main_up_to_date`, `changed=false` → STOP
- If diff exists: Continue to Stage 2

### Stage 2: Compare Against PR Branch (if PR exists)
```bash
git fetch origin {pr_branch}
git diff --quiet origin/{pr_branch} -- README.md
```
- If no diff: `reason=duplicate_of_pr`, `changed=false` → STOP
- If diff exists: `reason=new_changes`, `changed=true` → CREATE PR

### Decision Matrix

| Main Status | PR Exists | PR Content | Result | Reason |
|-------------|-----------|------------|--------|--------|
| Up-to-date | No | - | No action | `main_up_to_date` |
| Up-to-date | Yes | - | No action | `main_up_to_date` |
| Outdated | No | - | Create PR | `new_changes` |
| Outdated | Yes | Same | No action | `duplicate_of_pr` |
| Outdated | Yes | Different | Create PR | `new_changes` |

## PR Management

### PR Title Numbering

Format: `[bulk] Sync Release Information section (YYYY-MM-DD-NNN)`

- Date: Run date in UTC
- Sequence: Auto-increments for same-day runs (001, 002, 003)
- Search: Finds existing PRs with same date in title
- Increment: Adds 1 to highest sequence number found

**Example Progression:**
- First run on 2025-10-29: `(2025-10-29-001)`
- Second run same day: `(2025-10-29-002)`
- Next day: `(2025-10-29-001)` (sequence resets)

### Multiple PRs

The always-create-new-PR strategy means multiple open PRs are possible:

**When New PR Created:**
1. Creates new PR with incremented number
2. Finds old PR (by base title search)
3. Adds superseded warning to old PR
4. Converts old PR to draft status

**Codeowner Workflow:**
1. Review newest PR (highest number for today's date)
2. Close and delete old PRs after merging new one
3. Old PRs are marked as draft to prevent accidental merge

### Superseded PR Warning

When creating new PR while old PR exists:

```markdown
⚠️ **This PR has been superseded by #{new_pr_number}**

Please review and merge the newer PR instead. This PR has been converted to draft status.
```

### Outdated PR Warning

When main is up-to-date but old PR still open:

```markdown
⚠️ **This PR appears outdated**

Main branch already contains up-to-date content. Consider closing this PR.

Detected by [workflow run {run_id}]({run_url})
```

## Unique Branch Strategy

Each workflow run creates a unique branch:

**Branch Name:** `bulk/release-info-sync-{github.run_id}`

**Advantages:**
- No force-push needed
- All history preserved
- No conflicts between concurrent runs
- Easy to identify which run created which PR

**Example:**
- Run ID 12345: `bulk/release-info-sync-12345`
- Run ID 12346: `bulk/release-info-sync-12346`

## Idempotency

The campaign is idempotent at multiple levels:

### Content Idempotency
- Compares rendered content against target
- No changes if content already current
- Status: `no_change`

### PR Idempotency
- Compares against existing PR branch
- No new PR if identical to existing PR
- Status: `duplicate_of_pr`

### Run Idempotency
- Safe to run multiple times
- Creates new PR only when content differs
- Old PRs automatically marked as superseded

## Error Handling

Repositories that fail during processing are recorded:

**Example error in results.md:**
```markdown
### camaraproject/SimSwap
- ERROR: Release Information section markers not found in README.md
- Failed at step: ensure-delimiters
- Status: Skipped
- latest_public_release: r3.2
- api_count: 2
```

**Example error in results.jsonl:**
```json
{"repo":"camaraproject/SimSwap","latest_public_release":"r3.2","api_count":2,"timestamp":"2025-10-29T16:19:35.891Z","error":true,"error_message":"Release Information section markers not found in README.md","error_step":"ensure-delimiters","status":"error"}
```

**Error Workflow:**
- Workflow continues with `continue-on-error: true`
- Error captured and passed to finalize action
- All repositories recorded (no silent failures)
- Error details included for troubleshooting

## Data Source

Campaign reads from `data/releases-master.yaml`, which contains two main sections:

### Repositories Section

Used for category-based filtering:

```yaml
repositories:
  - repository: DeviceLocation
    github_url: https://github.com/camaraproject/DeviceLocation/releases/tag/r3.2
    latest_public_release: r3.2
    newest_pre_release: null
```

**Release State Detection:**
| `latest_public_release` | `newest_pre_release` | State |
|-------------------------|---------------------|-------|
| null | null | `no_release` |
| null | rX.Y | `prerelease_only` |
| rX.Y | null | `public_release` |
| rX.Y | rX.Z | `public_with_prerelease` |

### Releases Section

Contains detailed release information:

```yaml
releases:
  - repository: DeviceLocation
    release_tag: r3.2
    release_date: '2025-09-16T11:41:00Z'
    meta_release: Fall25
    github_url: https://github.com/camaraproject/DeviceLocation/releases/tag/r3.2
    apis:
      - api_name: geofencing-subscriptions
        file_name: geofencing-subscriptions
        api_version: 0.5.0
        api_title: Device Geofencing Subscriptions
        commonalities: '0.6'
```

**Release Data Logic:**
1. Look up repository in `repositories` section to determine release state
2. Find matching release(s) in `releases` section for public and/or pre-release tags
3. Include all APIs from the relevant release(s)

## Artifacts

### Plan Mode Artifacts
- `plan.md` - Markdown summary per repository
- `plan.jsonl` - JSONL records per repository
- Aggregated into single files by aggregate job

### Apply Mode Artifacts
- `results.md` - Markdown summary per repository with PR URLs
- `results.jsonl` - JSONL records per repository with PR metadata
- Uploaded per-job (no aggregation in apply mode)

### Artifact Naming
- Plan: `plan-{run_id}-{job-index}` → aggregated to `plan`
- Apply: `results-{run_id}-{job-index}`
