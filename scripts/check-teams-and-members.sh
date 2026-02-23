#!/usr/bin/env bash
# =========================================================================================
# CAMARA Project - Admin Script: Check Teams and Members
#
# Audits the GitHub organization to identify:
# - Unused teams: not associated with any active (non-archived) repository
# - Orphaned members: not belonging to any team that has active repositories
#
# A team is "active" if it has at least one non-archived repository, or if it is a
# parent (recursively) of such a team. For member analysis, only directly-active teams
# count (teams with their own active repos), because parent teams inherit child members.
#
# Uses GraphQL to minimize API calls (2-3 calls total instead of 90+).
#
# PREREQUISITES:
# - gh CLI authenticated with org read access
# - jq installed (for JSON processing)
#
# USAGE:
#   ./check-teams-and-members.sh [--org camaraproject] [--verbose]
#   ./check-teams-and-members.sh --verbose
#
# =========================================================================================

set -euo pipefail

# Defaults
ORG="camaraproject"
VERBOSE=false

# Administrative teams that have org-wide repo access (not via direct repo assignment).
# These are excluded from the "unused" analysis since their access is managed at org level.
ADMIN_TEAMS="release-management_reviewers"

# Members with special roles that are expected to have no team assignments.
# These are excluded from the "orphaned members" analysis.
EXCLUDED_MEMBERS="askb camarapmo-bot thelinuxfoundation"

usage() {
  echo "Usage: $0 [--org <org>] [--verbose]"
  echo ""
  echo "Audits GitHub organization teams and members to find unused teams"
  echo "and orphaned members (read-only, no changes are made)."
  echo ""
  echo "Options:"
  echo "  --org       GitHub organization (default: camaraproject)"
  echo "  --verbose   Show detailed progress during data collection"
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
# Arguments:
#   $1 - query template (must use $cursor variable for pagination)
#   $2 - jq path to the paginated connection (e.g., ".data.organization.teams")
#   $3 - output file path
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

    # Build gh command: omit cursor on first page (GraphQL null), pass it on subsequent pages
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

    # Check for GraphQL errors
    local errors
    errors=$(echo "$result" | jq -r '.errors // empty')
    if [ -n "$errors" ] && [ "$errors" != "null" ]; then
      echo "Error: GraphQL returned errors:"
      echo "$errors" | jq .
      return 1
    fi

    # Extract nodes from this page
    local page_nodes
    page_nodes=$(echo "$result" | jq "${connection_path}.nodes")

    # Merge into all_nodes
    all_nodes=$(echo "$all_nodes" "$page_nodes" | jq -s '.[0] + .[1]')

    # Check for next page
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

# ── Data Collection ──────────────────────────────────────────────────────────

echo "=== Team & Member Audit ==="
echo "Organization: ${ORG}"
echo ""

# Query 1: All teams with repos, members, and parent info
echo "Collecting teams..."

TEAMS_QUERY='
query($org: String!, $cursor: String) {
  organization(login: $org) {
    teams(first: 100, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        slug
        name
        parentTeam { slug }
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

# Warn about potential pagination truncation in nested fields
jq -r '.[] | select(.repositories.totalCount > 100) | "  WARNING: Team \(.slug) has \(.repositories.totalCount) repos (only first 100 fetched)"' \
  "${TMPDIR_WORK}/teams.json"
jq -r '.[] | select(.members.totalCount > 100) | "  WARNING: Team \(.slug) has \(.members.totalCount) members (only first 100 fetched)"' \
  "${TMPDIR_WORK}/teams.json"

# Query 2: All org members
echo "Collecting org members..."

MEMBERS_QUERY='
query($org: String!, $cursor: String) {
  organization(login: $org) {
    membersWithRole(first: 100, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes { login }
    }
  }
}'

graphql_paginate "$MEMBERS_QUERY" ".data.organization.membersWithRole" "${TMPDIR_WORK}/members.json"

# Extract sorted member logins (lowercased for consistent comm comparisons)
jq -r '.[].login' "${TMPDIR_WORK}/members.json" | tr '[:upper:]' '[:lower:]' | sort -u > "${TMPDIR_WORK}/org_members.txt"

TOTAL_MEMBERS=$(wc -l < "${TMPDIR_WORK}/org_members.txt" | tr -d ' ')
TOTAL_TEAMS=$(jq 'length' "${TMPDIR_WORK}/teams.json")

echo ""

# ── Phase 2: Analyze Teams ───────────────────────────────────────────────────

if [ "$VERBOSE" = true ]; then
  echo "Analyzing teams..."
fi

# Directly active teams: have at least one non-archived repo, or are administrative teams
jq -r '.[] | select([.repositories.nodes[] | select(.isArchived == false)] | length > 0) | .slug' \
  "${TMPDIR_WORK}/teams.json" > "${TMPDIR_WORK}/directly_active_teams.txt"

# Add administrative teams (org-wide access, not assigned per-repo)
for admin_team in $ADMIN_TEAMS; do
  if jq -e --arg slug "$admin_team" '.[] | select(.slug == $slug)' "${TMPDIR_WORK}/teams.json" > /dev/null 2>&1; then
    echo "$admin_team" >> "${TMPDIR_WORK}/directly_active_teams.txt"
  fi
done
sort -u -o "${TMPDIR_WORK}/directly_active_teams.txt" "${TMPDIR_WORK}/directly_active_teams.txt"

# Build parent map: child -> parent
jq -r '.[] | select(.parentTeam != null) | "\(.slug)\t\(.parentTeam.slug)"' \
  "${TMPDIR_WORK}/teams.json" > "${TMPDIR_WORK}/parent_map.tsv"

# All team slugs
jq -r '.[].slug' "${TMPDIR_WORK}/teams.json" | sort > "${TMPDIR_WORK}/all_teams.txt"

# Propagate activity upward through parent chain
# Start with directly active teams, then add their parents recursively
cp "${TMPDIR_WORK}/directly_active_teams.txt" "${TMPDIR_WORK}/all_active_teams.txt"

changed=true
while [ "$changed" = true ]; do
  changed=false
  while IFS=$'\t' read -r child parent; do
    if grep -qxiF "$child" "${TMPDIR_WORK}/all_active_teams.txt" && \
       ! grep -qxiF "$parent" "${TMPDIR_WORK}/all_active_teams.txt"; then
      echo "$parent" >> "${TMPDIR_WORK}/all_active_teams.txt"
      changed=true
    fi
  done < "${TMPDIR_WORK}/parent_map.tsv"
  sort -o "${TMPDIR_WORK}/all_active_teams.txt" "${TMPDIR_WORK}/all_active_teams.txt"
done

# Indirectly active = in all_active but not in directly_active
comm -23 "${TMPDIR_WORK}/all_active_teams.txt" "${TMPDIR_WORK}/directly_active_teams.txt" \
  > "${TMPDIR_WORK}/indirectly_active_teams.txt"

# Unused teams = all teams minus all active teams
comm -23 "${TMPDIR_WORK}/all_teams.txt" "${TMPDIR_WORK}/all_active_teams.txt" \
  > "${TMPDIR_WORK}/unused_teams.txt"

DIRECTLY_ACTIVE=$(wc -l < "${TMPDIR_WORK}/directly_active_teams.txt" | tr -d ' ')
INDIRECTLY_ACTIVE=$(wc -l < "${TMPDIR_WORK}/indirectly_active_teams.txt" | tr -d ' ')
UNUSED_TEAMS=$(wc -l < "${TMPDIR_WORK}/unused_teams.txt" | tr -d ' ')

# ── Phase 3: Analyze Members ────────────────────────────────────────────────

if [ "$VERBOSE" = true ]; then
  echo "Analyzing members..."
fi

# Collect members from directly-active teams only (lowercased for consistent comparison)
# (Parent teams inherit child members, so only leaf/directly-active teams count)
while IFS= read -r team_slug; do
  jq -r --arg slug "$team_slug" \
    '.[] | select(.slug == $slug) | .members.nodes[].login' \
    "${TMPDIR_WORK}/teams.json"
done < "${TMPDIR_WORK}/directly_active_teams.txt" | tr '[:upper:]' '[:lower:]' | sort -u > "${TMPDIR_WORK}/active_members.txt"

ACTIVE_MEMBERS=$(wc -l < "${TMPDIR_WORK}/active_members.txt" | tr -d ' ')

# Orphaned members = org members not in any directly-active team
comm -23 "${TMPDIR_WORK}/org_members.txt" "${TMPDIR_WORK}/active_members.txt" \
  > "${TMPDIR_WORK}/orphaned_members_raw.txt"

# Remove excluded members (special roles)
for excluded in $EXCLUDED_MEMBERS; do
  excluded_lower=$(echo "$excluded" | tr '[:upper:]' '[:lower:]')
  echo "$excluded_lower"
done | sort -u > "${TMPDIR_WORK}/excluded_members.txt"

comm -23 "${TMPDIR_WORK}/orphaned_members_raw.txt" "${TMPDIR_WORK}/excluded_members.txt" \
  > "${TMPDIR_WORK}/orphaned_members.txt"

ORPHANED_MEMBERS=$(wc -l < "${TMPDIR_WORK}/orphaned_members.txt" | tr -d ' ')

# Build reverse lookup: for each orphaned member, find their teams
# (case-insensitive match since comparison files are lowercased)

# Create lowercase-to-original-case mapping from org members data
jq -r '.[].login | [ascii_downcase, .] | @tsv' \
  "${TMPDIR_WORK}/members.json" > "${TMPDIR_WORK}/login_case_map.tsv"

> "${TMPDIR_WORK}/orphaned_details.txt"
while IFS= read -r member; do
  # Restore original case from org members data
  original_login=$(grep -m1 "^${member}	" "${TMPDIR_WORK}/login_case_map.tsv" | cut -f2)
  original_login="${original_login:-$member}"

  teams=$(jq -r --arg login "$member" \
    '[.[] | select(.members.nodes | map(.login | ascii_downcase) | index($login)) | .slug] | join(", ")' \
    "${TMPDIR_WORK}/teams.json")
  if [ -z "$teams" ]; then
    printf "  %-30s (no teams)\n" "$original_login" >> "${TMPDIR_WORK}/orphaned_details.txt"
  else
    printf "  %-30s teams: %s\n" "$original_login" "$teams" >> "${TMPDIR_WORK}/orphaned_details.txt"
  fi
done < "${TMPDIR_WORK}/orphaned_members.txt"

# ── Phase 4: Report ─────────────────────────────────────────────────────────

echo "Teams: ${TOTAL_TEAMS} total | ${DIRECTLY_ACTIVE} directly active | ${INDIRECTLY_ACTIVE} indirectly active (parent only) | ${UNUSED_TEAMS} unused"
echo "Members: ${TOTAL_MEMBERS} total | ${ACTIVE_MEMBERS} in active teams | ${ORPHANED_MEMBERS} orphaned"
echo ""

# Unused teams
if [ "$UNUSED_TEAMS" -gt 0 ]; then
  echo "=== Unused Teams ==="
  echo "(not associated with any active repository, directly or via child teams)"
  echo ""

  while IFS= read -r team_slug; do
    parent=$(jq -r --arg slug "$team_slug" \
      '.[] | select(.slug == $slug) | .parentTeam.slug // empty' \
      "${TMPDIR_WORK}/teams.json")
    archived_repos=$(jq -r --arg slug "$team_slug" \
      '.[] | select(.slug == $slug) | [.repositories.nodes[] | select(.isArchived == true) | .name] | join(", ")' \
      "${TMPDIR_WORK}/teams.json")
    all_repos=$(jq -r --arg slug "$team_slug" \
      '.[] | select(.slug == $slug) | [.repositories.nodes[].name] | join(", ")' \
      "${TMPDIR_WORK}/teams.json")

    parent_info=""
    if [ -n "$parent" ]; then
      parent_info="(parent: ${parent})"
    fi

    repo_info=""
    if [ -n "$archived_repos" ]; then
      repo_info="[archived repos: ${archived_repos}]"
    elif [ -n "$all_repos" ]; then
      repo_info="[repos: ${all_repos}]"
    else
      repo_info="[no repos]"
    fi

    printf "  %-40s %-25s %s\n" "$team_slug" "$parent_info" "$repo_info"
  done < "${TMPDIR_WORK}/unused_teams.txt"
  echo ""
fi

# Indirectly active teams (informational)
if [ "$INDIRECTLY_ACTIVE" -gt 0 ]; then
  echo "=== Indirectly Active Teams ==="
  echo "(active only because they are parent of an active team — no own active repos)"
  echo ""

  while IFS= read -r team_slug; do
    # Find which active child teams make this parent active
    children_list=()
    while IFS=$'\t' read -r child parent; do
      if [ "$parent" = "$team_slug" ] && grep -qxiF "$child" "${TMPDIR_WORK}/all_active_teams.txt"; then
        children_list+=("$child")
      fi
    done < <(grep -F "$team_slug" "${TMPDIR_WORK}/parent_map.tsv" 2>/dev/null)
    child_count=${#children_list[@]}
    printf "  %-40s %d active child team(s)\n" "$team_slug" "$child_count"
  done < "${TMPDIR_WORK}/indirectly_active_teams.txt"
  echo ""
fi

# Orphaned members
if [ "$ORPHANED_MEMBERS" -gt 0 ]; then
  echo "=== Orphaned Members ==="
  echo "(not in any directly-active team — only in inactive or parent-only teams)"
  echo ""
  cat "${TMPDIR_WORK}/orphaned_details.txt"
  echo ""
fi

# Active teams reference (verbose only, or summarized)
if [ "$VERBOSE" = true ]; then
  echo "=== Active Teams Reference ==="
  echo "(teams directly associated with active repositories)"
  echo ""

  while IFS= read -r team_slug; do
    repos=$(jq -r --arg slug "$team_slug" \
      '.[] | select(.slug == $slug) | [.repositories.nodes[] | select(.isArchived == false) | .name] | join(", ")' \
      "${TMPDIR_WORK}/teams.json")
    member_count=$(jq -r --arg slug "$team_slug" \
      '.[] | select(.slug == $slug) | .members.totalCount' \
      "${TMPDIR_WORK}/teams.json")
    printf "  %-40s repos: %-50s members: %s\n" "$team_slug" "$repos" "$member_count"
  done < "${TMPDIR_WORK}/directly_active_teams.txt"
  echo ""
fi

echo "=== Summary ==="
echo "Teams: ${TOTAL_TEAMS} total | ${DIRECTLY_ACTIVE} directly active | ${INDIRECTLY_ACTIVE} indirectly active | ${UNUSED_TEAMS} unused"
echo "Members: ${TOTAL_MEMBERS} total | ${ACTIVE_MEMBERS} in active teams | ${ORPHANED_MEMBERS} orphaned"
