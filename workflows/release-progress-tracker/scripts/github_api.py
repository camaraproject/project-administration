"""Thin GitHub REST API client for release progress collection.

Uses authenticated requests when available and can fall back to public
requests for artifacts that do not require repository-scoped access.
All methods return parsed data or None on 404.
"""

import base64
import logging
import os
import time
from typing import Dict, List, Optional

import requests

logger = logging.getLogger(__name__)

ORG = "camaraproject"

RETRY_STATUS_CODES = frozenset({502, 503, 504})
RETRY_ATTEMPTS = 3
RETRY_BACKOFF_SECONDS = (1, 2, 4)


class RateLimitError(Exception):
    """Raised when GitHub API rate limit is exhausted."""


class GitHubAPI:
    """Thin REST client for GitHub API operations needed by the collector."""

    def __init__(self, token: Optional[str] = None, sleep=time.sleep):
        self.session = requests.Session()
        self.public_session = requests.Session()
        self.token = token or os.environ.get("GITHUB_TOKEN", "")
        if self.token:
            self.session.headers["Authorization"] = f"token {self.token}"
        for session in (self.session, self.public_session):
            session.headers["Accept"] = "application/vnd.github+json"
            session.headers["X-GitHub-Api-Version"] = "2022-11-28"
        self.api_calls = 0
        # Injectable so tests can avoid real backoff sleeps.
        self._sleep = sleep
        self._codeowners_cache: Dict[str, Optional[str]] = {}

    def _request(
        self,
        method: str,
        url: str,
        *,
        public: bool = False,
        **kwargs,
    ) -> Optional[requests.Response]:
        """Make an API request with rate-limit monitoring and transient retry.

        Retries up to RETRY_ATTEMPTS times on HTTP 502/503/504 and on
        connection / timeout errors with exponential backoff (1s, 2s, 4s).
        404 and other 4xx responses are returned to the caller without
        retry. Rate-limit exhaustion raises RateLimitError immediately.
        """
        session = self.public_session if public or not self.token else self.session

        for attempt in range(RETRY_ATTEMPTS + 1):
            try:
                resp = session.request(method, url, **kwargs)
            except (requests.exceptions.ConnectionError,
                    requests.exceptions.Timeout) as exc:
                if attempt < RETRY_ATTEMPTS:
                    delay = RETRY_BACKOFF_SECONDS[attempt]
                    logger.warning(
                        "Request to %s failed (%s); retrying in %ds (attempt %d/%d)",
                        url, exc.__class__.__name__, delay,
                        attempt + 1, RETRY_ATTEMPTS,
                    )
                    self._sleep(delay)
                    continue
                logger.error(
                    "Request to %s failed after %d attempts: %s",
                    url, RETRY_ATTEMPTS, exc,
                )
                raise

            self.api_calls += 1

            # Rate-limit check first: an exhausted budget should abort
            # collection regardless of status code on this response.
            remaining = resp.headers.get("X-RateLimit-Remaining")
            if remaining is not None:
                remaining_int = int(remaining)
                if remaining_int == 0:
                    raise RateLimitError(
                        f"GitHub API rate limit exhausted after {self.api_calls} calls"
                    )
                if remaining_int < 50:
                    logger.warning("GitHub API rate limit low: %d remaining", remaining_int)

            if resp.status_code in RETRY_STATUS_CODES and attempt < RETRY_ATTEMPTS:
                delay = RETRY_BACKOFF_SECONDS[attempt]
                logger.warning(
                    "Request to %s returned %d; retrying in %ds (attempt %d/%d)",
                    url, resp.status_code, delay,
                    attempt + 1, RETRY_ATTEMPTS,
                )
                self._sleep(delay)
                continue

            if resp.status_code in RETRY_STATUS_CODES:
                logger.error(
                    "Request to %s returned %d after %d attempts",
                    url, resp.status_code, RETRY_ATTEMPTS,
                )

            return resp

        raise RuntimeError(f"Request to {url} exhausted retries unexpectedly")

    def _get(self, path: str, public: bool = False, **kwargs) -> Optional[requests.Response]:
        """GET request to GitHub API."""
        url = f"https://api.github.com{path}"
        return self._request("GET", url, public=public, **kwargs)

    def get_file_content(
        self, repo: str, path: str, ref: str = "main"
    ) -> Optional[str]:
        """Get file content from a repository. Returns None on 404."""
        resp = self._get(
            f"/repos/{ORG}/{repo}/contents/{path}",
            params={"ref": ref},
        )
        if resp.status_code == 404:
            return None
        resp.raise_for_status()

        data = resp.json()
        if data.get("encoding") == "base64":
            return base64.b64decode(data["content"]).decode("utf-8")
        return data.get("content")

    def get_codeowners(self, repo: str) -> Optional[str]:
        """Get a repo's CODEOWNERS file content from its default branch.

        Cached per repo within a run — the Review Queue only needs one fetch
        per repo even when a repo has more than one ongoing review row.
        """
        if repo not in self._codeowners_cache:
            self._codeowners_cache[repo] = self.get_file_content(repo, "CODEOWNERS")
        return self._codeowners_cache[repo]

    def list_branches(self, repo: str, prefix: str = "") -> List[str]:
        """List branch names, optionally filtered by prefix. Handles pagination."""
        branches = []
        page = 1
        while True:
            resp = self._get(
                f"/repos/{ORG}/{repo}/branches",
                params={"per_page": 100, "page": page},
            )
            resp.raise_for_status()
            data = resp.json()
            if not data:
                break
            for b in data:
                name = b["name"]
                if not prefix or name.startswith(prefix):
                    branches.append(name)
            if len(data) < 100:
                break
            page += 1
        return branches

    def tag_exists(self, repo: str, tag: str) -> bool:
        """Check if a git tag exists in the repository."""
        resp = self._get(f"/repos/{ORG}/{repo}/git/ref/tags/{tag}")
        return resp.status_code == 200

    def get_draft_releases(self, repo: str) -> List[Dict]:
        """Get all draft releases for a repository."""
        resp = self._get(
            f"/repos/{ORG}/{repo}/releases",
            params={"per_page": 30},
        )
        if resp.status_code == 404:
            return []
        resp.raise_for_status()
        return [r for r in resp.json() if r.get("draft")]

    def find_release_issue(
        self,
        repo: str,
        target_tag: Optional[str] = None,
    ) -> Optional[Dict]:
        """Find an open workflow-owned release issue for a release tag."""
        issue = self._find_release_issue(repo, target_tag, public=False)
        if issue is None and self.token:
            issue = self._find_release_issue(repo, target_tag, public=True)
        return issue

    def _find_release_issue(
        self,
        repo: str,
        target_tag: Optional[str],
        *,
        public: bool,
    ) -> Optional[Dict]:
        resp = self._get(
            f"/repos/{ORG}/{repo}/issues",
            params={
                "labels": "release-issue",
                "state": "open",
                "per_page": 20,
            },
            public=public,
        )
        if resp.status_code == 404:
            return None
        resp.raise_for_status()
        issues = resp.json()
        for issue in issues:
            body = issue.get("body", "") or ""
            if "<!-- release-automation:workflow-owned -->" not in body:
                continue
            if target_tag:
                marker = f"<!-- release-automation:release-tag:{target_tag} -->"
                if marker not in body:
                    continue
            return {
                "number": issue["number"],
                "url": issue["html_url"],
                "created_at": issue.get("created_at"),
                "body": body,
                "labels": [label.get("name", "") for label in issue.get("labels", [])],
            }
        return None

    @staticmethod
    def _normalize_pr(pr: Dict) -> Dict:
        """Reduce a raw PR object to the fields the Review Queue needs."""
        return {
            "number": pr.get("number"),
            "state": pr.get("state"),
            "url": pr.get("html_url"),
            "created_at": pr.get("created_at"),
            "closed_at": pr.get("closed_at"),
            "merged": bool(pr.get("merged_at")),
            "assignees": [
                a.get("login")
                for a in (pr.get("assignees") or [])
                if a.get("login")
            ],
            "body": pr.get("body") or "",
            "base_ref": ((pr.get("base") or {}).get("ref")) or "",
        }

    def list_release_prs(
        self,
        repo: str,
        target_tag: str,
        not_before: Optional[str] = None,
        max_pages: int = 10,
    ) -> List[Dict]:
        """List all Release Review PRs for a tag — open and closed, newest first.

        Release Review PRs target a ``release-snapshot/{tag}-{suffix}`` branch.
        ``/discard-snapshot`` deletes that snapshot branch, so a discarded PR
        points at a branch that no longer exists and cannot be found by an exact
        ``base=`` query. We therefore page the repo's PRs (newest first) and
        match the base branch by the ``release-snapshot/{tag}-`` prefix. The
        trailing hyphen disambiguates ``r4.1`` from ``r4.10``.

        ``not_before`` (the release-issue creation timestamp) bounds the scan:
        no Review PR for a tag can predate its release issue, so once the
        newest-first listing reaches a PR created before it, paging stops. This
        keeps busy repos to the current cycle's PR window instead of their whole
        history. (A rare release-issue recreation could set a later bound and
        omit older discarded PRs; ``max_pages`` remains the hard backstop.)
        """
        prefix = f"release-snapshot/{target_tag}-"
        prs: List[Dict] = []
        page = 1
        while page <= max_pages:
            resp = self._get(
                f"/repos/{ORG}/{repo}/pulls",
                params={
                    "state": "all",
                    "sort": "created",
                    "direction": "desc",
                    "per_page": 100,
                    "page": page,
                },
            )
            if resp.status_code == 404:
                return prs
            resp.raise_for_status()
            data = resp.json()
            if not data:
                break
            reached_bound = False
            for pr in data:
                if not_before and (pr.get("created_at") or "") < not_before:
                    # Newest-first: everything from here on is older than the
                    # release issue and cannot belong to this tag.
                    reached_bound = True
                    break
                base_ref = ((pr.get("base") or {}).get("ref")) or ""
                if base_ref.startswith(prefix):
                    prs.append(self._normalize_pr(pr))
            if reached_bound or len(data) < 100:
                break
            page += 1
        else:
            logger.warning(
                "%s: Review-PR listing for %s hit the %d-page cap; "
                "older discarded PRs may be omitted",
                repo, target_tag, max_pages,
            )
        return prs

    def get_pr_reviews(self, repo: str, pr_number: int) -> List[Dict]:
        """List a PR's reviews (chronological) as {user, state, submitted_at}."""
        reviews: List[Dict] = []
        page = 1
        while True:
            resp = self._get(
                f"/repos/{ORG}/{repo}/pulls/{pr_number}/reviews",
                params={"per_page": 100, "page": page},
            )
            if resp.status_code == 404:
                return reviews
            resp.raise_for_status()
            data = resp.json()
            if not data:
                break
            for review in data:
                reviews.append({
                    "user": (review.get("user") or {}).get("login"),
                    "state": review.get("state"),
                    "submitted_at": review.get("submitted_at"),
                })
            if len(data) < 100:
                break
            page += 1
        return reviews
