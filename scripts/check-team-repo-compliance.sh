#!/usr/bin/env bash
# =========================================================================================
# CAMARA Project - Admin Script: Check Team-Repository Compliance
#
# Validates that GitHub team membership matches the documentation in each repository:
# - *_codeowners team members vs CODEOWNERS file (the '*' default line)
# - *_maintainers team members vs MAINTAINERS.MD file (the 'GitHub Name' column)
#
# Reports repositories with mismatches and lists compliant repositories.
#
# Uses GraphQL for team data collection, REST API for file content retrieval.
#
# PREREQUISITES:
# - gh CLI authenticated with org read access
# - jq installed (for JSON processing)
#
# USAGE:
#   ./check-team-repo-compliance.sh [--org camaraproject] [--verbose]
#   ./check-team-repo-compliance.sh --verbose
#
# =========================================================================================

set -euo pipefail

# Defaults
ORG="camaraproject"
VERBOSE=false

# Repositories to skip (use team references instead of individual users in CODEOWNERS,
# or have non-standard file structures)
SKIP_REPOS=".github Governance Commonalities EasyCLA camara-landscape camaraproject.github.io Template_API_Repository project-administration"

# Cross-cutting teams assigned to many repos for admin purposes.
# These are not API-specific and should not be compared against repo documentation.
CROSS_CUTTING_TEAMS="release-management_maintainers test-repo_maintainers admins commonalities_maintainers release-management_codeowners"

usage() {
  echo "Usage: $0 [--org <org>] [--verbose]"
  echo ""
  echo "Validates GitHub team membership against CODEOWNERS and MAINTAINERS.MD"
  echo "documentation in each repository (read-only, no changes are made)."
  echo ""
  echo "Options:"
  echo "  --org       GitHub organization (default: camaraproject)"
  echo "  --verbose   Show per-repo progress during file fetching"
  echo ""
  echo "Examples:"
  echo "  $0"
  echo "  $0 --org camaraproject --verbose"
  exit 1
}

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --org) ORG="$2"; shift 2 ;;
    --verbose) VERBOSE=true; shift ;;
    -h|--help) usage ;;
    *) echo "Unknown option: $1"; usage ;;
  esac
done

# ── Prerequisites Check ──────────────────────────────────────────────────────

if ! command -v jq &> /dev/null; then
  echo "Error: jq is required but not installed."
  echo "Install with: brew install jq"
  exit 1
fi

if ! gh auth status &> /dev/null; then
  echo "Error: gh CLI is not authenticated. Run: gh auth login"
  exit 1
fi

# ── Temp Directory ───────────────────────────────────────────────────────────

TMPDIR_WORK=$(mktemp -d)
trap 'rm -rf "$TMPDIR_WORK"' EXIT

# ── GraphQL Helper ───────────────────────────────────────────────────────────

# Run a paginated GraphQL query, collecting all pages into a single JSON array.
graphql_paginate() {
  local query="$1"
  local connection_path="$2"
  local output_file="$3"

  local cursor=""
  local page=0
  local all_nodes="[]"

  while true; do
    page=$((page + 1))
    if [ "$VERBOSE" = true ]; then
      echo "  Fetching page ${page}..."
    fi

    local result
    if [ -z "$cursor" ]; then
      result=$(gh api graphql -f query="${query}" \
        -f org="${ORG}" \
        2>&1) || {
        echo "Error: GraphQL query failed on page ${page}"
        echo "$result"
        return 1
      }
    else
      result=$(gh api graphql -f query="${query}" \
        -f org="${ORG}" \
        -f cursor="${cursor}" \
        2>&1) || {
        echo "Error: GraphQL query failed on page ${page}"
        echo "$result"
        return 1
      }
    fi

    local errors
    errors=$(echo "$result" | jq -r '.errors // empty')
    if [ -n "$errors" ] && [ "$errors" != "null" ]; then
      echo "Error: GraphQL returned errors:"
      echo "$errors" | jq .
      return 1
    fi

    local page_nodes
    page_nodes=$(echo "$result" | jq "${connection_path}.nodes")
    all_nodes=$(echo "$all_nodes" "$page_nodes" | jq -s '.[0] + .[1]')

    local has_next
    has_next=$(echo "$result" | jq -r "${connection_path}.pageInfo.hasNextPage")

    if [ "$has_next" = "true" ]; then
      cursor=$(echo "$result" | jq -r "${connection_path}.pageInfo.endCursor")
    else
      break
    fi
  done

  echo "$all_nodes" > "$output_file"

  if [ "$VERBOSE" = true ]; then
    local count
    count=$(echo "$all_nodes" | jq 'length')
    echo "  Collected ${count} items in ${page} page(s)"
  fi
}

# ── File Parsing Helpers ─────────────────────────────────────────────────────

# Parse CODEOWNERS file: extract usernames from the '*' default line.
# Returns lowercased, sorted usernames (one per line).
parse_codeowners() {
  local content="$1"
  local star_line
  star_line=$(echo "$content" | grep '^[*]' | head -1 || true)
  if [ -z "$star_line" ]; then
    return
  fi
  echo "$star_line" | \
    sed 's/^[*][[:space:]]*//' | tr ' ' '\n' | \
    sed 's/@//' | \
    grep -v '/' | \
    grep -v '^$' | \
    tr '[:upper:]' '[:lower:]' | sort -u
}

# Parse MAINTAINERS.MD file: extract GitHub usernames from the table.
# Returns lowercased, sorted usernames (one per line).
parse_maintainers() {
  local content="$1"
  # Skip header row (containing GitHub Name/Username) and separator rows (containing ---)
  # Extract third pipe-separated field, trim whitespace
  local table_rows
  table_rows=$(echo "$content" | grep '^|' | grep -iv 'github' | grep -v '[-][-][-]' || true)
  if [ -z "$table_rows" ]; then
    return
  fi
  echo "$table_rows" | \
    awk -F'|' '{print $4}' | \
    sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | \
    sed 's/^@//' | \
    grep -v '^$' | \
    tr '[:upper:]' '[:lower:]' | sort -u
}

# ── Data Collection ──────────────────────────────────────────────────────────

echo "=== Team-Repository Compliance Check ==="
echo "Organization: ${ORG}"
echo ""

echo "Collecting team data..."

TEAMS_QUERY='
query($org: String!, $cursor: String) {
  organization(login: $org) {
    teams(first: 100, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        slug
        repositories(first: 100) {
          totalCount
          nodes { name isArchived }
        }
        members(first: 100) {
          totalCount
          nodes { login }
        }
      }
    }
  }
}'

graphql_paginate "$TEAMS_QUERY" ".data.organization.teams" "${TMPDIR_WORK}/teams.json"

# Warn about nested pagination truncation
jq -r '.[] | select(.repositories.totalCount > 100) | "  WARNING: Team \(.slug) has \(.repositories.totalCount) repos (only first 100 fetched)"' \
  "${TMPDIR_WORK}/teams.json"
jq -r '.[] | select(.members.totalCount > 100) | "  WARNING: Team \(.slug) has \(.members.totalCount) members (only first 100 fetched)"' \
  "${TMPDIR_WORK}/teams.json"

# ── Phase 2: Build repo → team mapping ───────────────────────────────────────

# Build cross-cutting teams as JSON array for jq filtering
CROSS_CUTTING_JSON=$(printf '%s\n' $CROSS_CUTTING_TEAMS | jq -R . | jq -s .)

# Extract API-specific teams ending in _codeowners or _maintainers (excluding cross-cutting)
# Output: JSON array of {slug, type, repos: [names], members: [logins]}
jq --argjson skip "$CROSS_CUTTING_JSON" '[.[] |
  select(.slug | test("_(codeowners|maintainers)$")) |
  select(.slug as $s | $skip | index($s) | not) |
  {
    slug,
    type: (if (.slug | endswith("_codeowners")) then "codeowners" else "maintainers" end),
    repos: [.repositories.nodes[] | select(.isArchived == false) | .name],
    members: [.members.nodes[].login | ascii_downcase] | sort
  } |
  select(.repos | length > 0)
]' "${TMPDIR_WORK}/teams.json" > "${TMPDIR_WORK}/team_repo_map.json"

# Build list of unique repos that have at least one relevant team, excluding special repos
jq -r '.[].repos[]' "${TMPDIR_WORK}/team_repo_map.json" | sort -u > "${TMPDIR_WORK}/repos_raw.txt"

# Filter out skipped repos
> "${TMPDIR_WORK}/repos_to_check.txt"
SKIPPED=0
while IFS= read -r repo; do
  skip=false
  for skip_repo in $SKIP_REPOS; do
    if [ "$repo" = "$skip_repo" ]; then
      skip=true
      break
    fi
  done
  if [ "$skip" = true ]; then
    SKIPPED=$((SKIPPED + 1))
    if [ "$VERBOSE" = true ]; then
      echo "  Skipping ${repo} (excluded)"
    fi
  else
    echo "$repo" >> "${TMPDIR_WORK}/repos_to_check.txt"
  fi
done < "${TMPDIR_WORK}/repos_raw.txt"

TOTAL_REPOS=$(wc -l < "${TMPDIR_WORK}/repos_to_check.txt" | tr -d ' ')

echo "Checking ${TOTAL_REPOS} repositories (${SKIPPED} excluded)..."
echo ""

# ── Phase 3: Fetch files and compare ─────────────────────────────────────────

COMPLIANT=0
MISMATCHED=0
MISMATCH_OUTPUT=""

while IFS= read -r repo; do
  if [ "$VERBOSE" = true ]; then
    echo "  Checking ${repo}..."
  fi

  repo_has_mismatch=false
  repo_output=""

  # Find codeowners team(s) for this repo
  codeowners_teams=$(jq -r --arg repo "$repo" \
    '.[] | select(.type == "codeowners" and (.repos | index($repo))) | .slug' \
    "${TMPDIR_WORK}/team_repo_map.json")

  # Find maintainers team(s) for this repo
  maintainers_teams=$(jq -r --arg repo "$repo" \
    '.[] | select(.type == "maintainers" and (.repos | index($repo))) | .slug' \
    "${TMPDIR_WORK}/team_repo_map.json")

  # --- Check CODEOWNERS ---
  if [ -n "$codeowners_teams" ]; then
    # Fetch CODEOWNERS file (use if to handle 404 without triggering set -e)
    codeowners_content=""
    if gh api "repos/${ORG}/${repo}/contents/CODEOWNERS" \
      -H "Accept: application/vnd.github.raw" > "${TMPDIR_WORK}/fetch_tmp.txt" 2>/dev/null; then
      codeowners_content=$(cat "${TMPDIR_WORK}/fetch_tmp.txt")
    fi

    if [ -z "$codeowners_content" ]; then
      repo_output="${repo_output}  CODEOWNERS: file not found\n"
      repo_has_mismatch=true
    else
      file_users=$(parse_codeowners "$codeowners_content")

      while IFS= read -r team_slug; do
        team_members=$(jq -r --arg slug "$team_slug" \
          '.[] | select(.slug == $slug) | .members[]' \
          "${TMPDIR_WORK}/team_repo_map.json")

        # Compare using temp files for comm
        echo "$team_members" > "${TMPDIR_WORK}/team_users.txt"
        echo "$file_users" > "${TMPDIR_WORK}/file_users.txt"

        in_team_not_file=$(comm -23 "${TMPDIR_WORK}/team_users.txt" "${TMPDIR_WORK}/file_users.txt" | grep -v '^$' || true)
        in_file_not_team=$(comm -13 "${TMPDIR_WORK}/team_users.txt" "${TMPDIR_WORK}/file_users.txt" | grep -v '^$' || true)

        if [ -n "$in_team_not_file" ] || [ -n "$in_file_not_team" ]; then
          repo_output="${repo_output}  codeowners team (${team_slug}) vs CODEOWNERS:\n"
          while IFS= read -r user; do
            [ -z "$user" ] && continue
            repo_output="${repo_output}    + ${user}  (in team, not in file)\n"
          done <<< "$in_team_not_file"
          while IFS= read -r user; do
            [ -z "$user" ] && continue
            repo_output="${repo_output}    - ${user}  (in file, not in team)\n"
          done <<< "$in_file_not_team"
          repo_has_mismatch=true
        fi
      done <<< "$codeowners_teams"
    fi
  fi

  # --- Check MAINTAINERS.MD ---
  if [ -n "$maintainers_teams" ]; then
    # Fetch MAINTAINERS.MD file (use if to handle 404 without triggering set -e)
    maintainers_content=""
    if gh api "repos/${ORG}/${repo}/contents/MAINTAINERS.MD" \
      -H "Accept: application/vnd.github.raw" > "${TMPDIR_WORK}/fetch_tmp.txt" 2>/dev/null; then
      maintainers_content=$(cat "${TMPDIR_WORK}/fetch_tmp.txt")
    fi

    if [ -z "$maintainers_content" ]; then
      repo_output="${repo_output}  MAINTAINERS.MD: file not found\n"
      repo_has_mismatch=true
    else
      file_users=$(parse_maintainers "$maintainers_content")

      while IFS= read -r team_slug; do
        team_members=$(jq -r --arg slug "$team_slug" \
          '.[] | select(.slug == $slug) | .members[]' \
          "${TMPDIR_WORK}/team_repo_map.json")

        echo "$team_members" > "${TMPDIR_WORK}/team_users.txt"
        echo "$file_users" > "${TMPDIR_WORK}/file_users.txt"

        in_team_not_file=$(comm -23 "${TMPDIR_WORK}/team_users.txt" "${TMPDIR_WORK}/file_users.txt" | grep -v '^$' || true)
        in_file_not_team=$(comm -13 "${TMPDIR_WORK}/team_users.txt" "${TMPDIR_WORK}/file_users.txt" | grep -v '^$' || true)

        if [ -n "$in_team_not_file" ] || [ -n "$in_file_not_team" ]; then
          repo_output="${repo_output}  maintainers team (${team_slug}) vs MAINTAINERS.MD:\n"
          while IFS= read -r user; do
            [ -z "$user" ] && continue
            repo_output="${repo_output}    + ${user}  (in team, not in file)\n"
          done <<< "$in_team_not_file"
          while IFS= read -r user; do
            [ -z "$user" ] && continue
            repo_output="${repo_output}    - ${user}  (in file, not in team)\n"
          done <<< "$in_file_not_team"
          repo_has_mismatch=true
        fi
      done <<< "$maintainers_teams"
    fi
  fi

  if [ "$repo_has_mismatch" = true ]; then
    MISMATCH_OUTPUT="${MISMATCH_OUTPUT}Repository: ${repo}\n${repo_output}\n"
    MISMATCHED=$((MISMATCHED + 1))
  else
    COMPLIANT=$((COMPLIANT + 1))
    echo "$repo" >> "${TMPDIR_WORK}/compliant_repos.txt"
  fi

done < "${TMPDIR_WORK}/repos_to_check.txt"

# ── Phase 4: Report ─────────────────────────────────────────────────────────

echo "Repos checked: ${TOTAL_REPOS} | Compliant: ${COMPLIANT} | Mismatches: ${MISMATCHED}"
echo ""

if [ "$MISMATCHED" -gt 0 ]; then
  echo "=== Mismatches ==="
  echo ""
  printf "%b" "$MISMATCH_OUTPUT"
fi

if [ "$COMPLIANT" -gt 0 ]; then
  echo "=== Compliant Repositories ==="
  if [ -f "${TMPDIR_WORK}/compliant_repos.txt" ]; then
    sed 's/$/, /' "${TMPDIR_WORK}/compliant_repos.txt" | tr -d '\n' | sed 's/, $//' | fold -s -w 78 | sed 's/^/  /'
  fi
  echo ""
fi

echo "=== Summary ==="
echo "Repos checked: ${TOTAL_REPOS} | Compliant: ${COMPLIANT} | Mismatches: ${MISMATCHED}"
