# campaign-reconcile-per-repo

Per-repo finalization for **reconciliation** campaigns: ongoing rollout of a
canonical template (caller workflows, shared configs, etc.) to
already-onboarded repositories.

## Behaviour

The caller workflow has already built the target template state into the
`repo/` working tree (e.g. fetched a caller workflow file from
`camaraproject/tooling` into `repo/.github/workflows/...`). This action
takes it from there.

| Repo state (after caller built `repo/`) | Existing PR on stable branch? | Outcome |
|--|--|--|
| In sync (no diff vs main) | no  | No-op. |
| In sync (no diff vs main) | yes | Close the PR with a comment — repo is now in sync. |
| Drift vs main | no  | Push a fresh branch built from main + template, open PR with stable title. |
| Drift vs main | yes, bot-authored, rebuild tree matches PR branch tip | No-op push (tree equality check) — existing PR left untouched, codeowner approvals preserved. |
| Drift vs main | yes, bot-authored, rebuild tree differs from PR branch tip | Rebuild branch from main + template, `git push --force-with-lease`. Existing PR updates automatically; no second PR. |
| Drift vs main | yes, branch HEAD has **non-bot** commits | Abort. Operator merges or closes the PR first. Next run either reconciles cleanly (if merged to main) or waits for the branch to be reclaimed. |

The stable **branch name** and **PR title** are inputs — reusable for any
template-propagation campaign.

## Contract with the caller workflow

- Caller checks out the target repo to `repo/` with `fetch-depth: 0` and
  an app token for `origin`.
- Caller configures git identity (bot name + noreply email) before
  calling this action.
- Caller has written the desired target state into `repo/` (e.g. copied
  a file from the template source).
- This action compares the working tree against `main`, chooses the right
  outcome (create / update / close / no-op / abort), and records a
  per-repo artifact row.

## Safety model

- `--force-with-lease` on push — aborts if `origin` moved since last fetch.
- Non-bot commit guard — examines commits between the stable branch and
  `main` and aborts if any commit's author email does not match
  `bot_email_pattern` (default: `^[0-9]+\+.*\[bot\]@users\.noreply\.github\.com$`).
- The action **does not** configure git identity — caller's responsibility.

## Inputs

See `action.yml` for the full schema. Key fields:

- `branch` — stable branch name (e.g. `camara/release-automation-update`).
- `pr_title` — stable PR title.
- `target_files` — space-separated list of files the caller built into
  `repo/`.
- `bot_email_pattern` — override if the bot identity differs from the
  CAMARA default.

## Outputs (artifact fields)

Each per-repo run records a JSONL row with:

- `pr_status`: `will_create` | `will_update_existing` | `no_change_vs_existing_pr` | `will_close_stale` | `no_change` | `aborted`
- `reason`: `new_changes` | `in_sync_with_existing_pr` | `in_sync` | `non_bot_commits_on_branch` | `error`
- `tree_match`: `true` when the rebuilt tree matches the existing PR branch tip (push was skipped)
- `pr_number`, `pr_url` (if applicable)
- `non_bot_shas` (only on abort)
- Any campaign-specific fields threaded through `campaign_data`
