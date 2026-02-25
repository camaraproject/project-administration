"""Thin GitHub REST API client for release progress collection.

Uses requests.Session with GITHUB_TOKEN for authentication.
All methods return parsed data or None on 404.
"""

import base64
import logging
import os
from typing import Dict, List, Optional

import requests

logger = logging.getLogger(__name__)

ORG = "camaraproject"


class RateLimitError(Exception):
    """Raised when GitHub API rate limit is exhausted."""


class GitHubAPI:
    """Thin REST client for GitHub API operations needed by the collector."""

    def __init__(self, token: Optional[str] = None):
        self.session = requests.Session()
        self.token = token or os.environ.get("GITHUB_TOKEN", "")
        if self.token:
            self.session.headers["Authorization"] = f"token {self.token}"
        self.session.headers["Accept"] = "application/vnd.github+json"
        self.session.headers["X-GitHub-Api-Version"] = "2022-11-28"
        self.api_calls = 0

    def _request(self, method: str, url: str, **kwargs) -> Optional[requests.Response]:
        """Make an API request with rate limit monitoring."""
        resp = self.session.request(method, url, **kwargs)
        self.api_calls += 1

        # Monitor rate limit
        remaining = resp.headers.get("X-RateLimit-Remaining")
        if remaining is not None:
            remaining = int(remaining)
            if remaining == 0:
                raise RateLimitError(
                    f"GitHub API rate limit exhausted after {self.api_calls} calls"
                )
            if remaining < 50:
                logger.warning("GitHub API rate limit low: %d remaining", remaining)

        return resp

    def _get(self, path: str, **kwargs) -> Optional[requests.Response]:
        """GET request to GitHub API."""
        url = f"https://api.github.com{path}"
        return self._request("GET", url, **kwargs)

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

    def find_release_issue(self, repo: str) -> Optional[Dict]:
        """Find an open release issue (label=release-issue).

        Returns {number, url} or None.
        """
        resp = self._get(
            f"/repos/{ORG}/{repo}/issues",
            params={
                "labels": "release-issue",
                "state": "open",
                "per_page": 1,
            },
        )
        if resp.status_code == 404:
            return None
        resp.raise_for_status()
        issues = resp.json()
        if issues:
            issue = issues[0]
            return {
                "number": issue["number"],
                "url": issue["html_url"],
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
