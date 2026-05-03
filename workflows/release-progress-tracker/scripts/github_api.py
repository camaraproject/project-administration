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
                "body": body,
                "labels": [label.get("name", "") for label in issue.get("labels", [])],
            }
        return None

    def find_release_pr(self, repo: str, snapshot_branch: str) -> Optional[Dict]:
        """Find a PR targeting a snapshot branch (release-review → snapshot).

        Returns {number, state, url} or None.
        """
        resp = self._get(
            f"/repos/{ORG}/{repo}/pulls",
            params={
                "base": snapshot_branch,
                "state": "all",
                "per_page": 1,
            },
        )
        if resp.status_code == 404:
            return None
        resp.raise_for_status()
        prs = resp.json()
        if prs:
            pr = prs[0]
            return {
                "number": pr["number"],
                "state": pr["state"],
                "url": pr["html_url"],
            }
        return None
