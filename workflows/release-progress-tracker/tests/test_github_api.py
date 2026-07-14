"""Tests for GitHub API client fallback behavior."""

import pytest
import requests

from scripts.github_api import GitHubAPI, RateLimitError, RETRY_ATTEMPTS


class FakeResponse:
    def __init__(self, status_code, payload, rate_limit_remaining="100"):
        self.status_code = status_code
        self._payload = payload
        self.headers = {"X-RateLimit-Remaining": rate_limit_remaining}

    def json(self):
        return self._payload

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


class ScriptedSession:
    """Stand-in for requests.Session that replays a scripted sequence.

    Each entry is either a FakeResponse to return or an Exception to raise.
    """

    def __init__(self, script):
        self._script = list(script)
        self.calls = 0

    def request(self, method, url, **kwargs):
        self.calls += 1
        if not self._script:
            raise AssertionError(f"unexpected request: {method} {url}")
        item = self._script.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


def _api_with_session(script):
    api = GitHubAPI(token="test-token", sleep=lambda _s: None)
    api.session = ScriptedSession(script)
    api.public_session = api.session
    return api


def test_find_release_issue_retries_public_when_auth_returns_empty(monkeypatch):
    api = GitHubAPI(token="test-token")
    calls = []

    def fake_get(path, public=False, **kwargs):
        calls.append(public)
        if not public:
            return FakeResponse(200, [])
        return FakeResponse(200, [{
            "number": 43,
            "html_url": "https://github.com/camaraproject/ReleaseTest/issues/43",
            "created_at": "2026-06-01T09:00:00Z",
            "body": (
                "<!-- release-automation:workflow-owned -->\n"
                "<!-- release-automation:release-tag:r1.3 -->\n"
                "**State:** `draft-ready`"
            ),
            "labels": [{"name": "release-issue"}],
        }])

    monkeypatch.setattr(api, "_get", fake_get)

    issue = api.find_release_issue("ReleaseTest", "r1.3")

    assert calls == [False, True]
    assert issue == {
        "number": 43,
        "url": "https://github.com/camaraproject/ReleaseTest/issues/43",
        "created_at": "2026-06-01T09:00:00Z",
        "body": (
            "<!-- release-automation:workflow-owned -->\n"
            "<!-- release-automation:release-tag:r1.3 -->\n"
            "**State:** `draft-ready`"
        ),
        "labels": ["release-issue"],
    }


# Retry behavior on transient errors (PA#209) -----------------------------------


@pytest.mark.parametrize("status", [502, 503, 504])
def test_request_retries_on_transient_status_then_succeeds(status):
    api = _api_with_session([
        FakeResponse(status, None),
        FakeResponse(200, {"ok": True}),
    ])
    resp = api._get("/some/path")
    assert resp.status_code == 200
    assert api.api_calls == 2


def test_request_retries_until_exhaustion_then_returns_last_response():
    api = _api_with_session([FakeResponse(503, None) for _ in range(RETRY_ATTEMPTS + 1)])
    resp = api._get("/some/path")
    assert resp.status_code == 503
    assert api.api_calls == RETRY_ATTEMPTS + 1


def test_request_no_retry_on_404():
    api = _api_with_session([FakeResponse(404, None)])
    resp = api._get("/missing")
    assert resp.status_code == 404
    assert api.api_calls == 1


def test_request_no_retry_on_2xx():
    api = _api_with_session([FakeResponse(200, {"ok": True})])
    resp = api._get("/ok")
    assert resp.status_code == 200
    assert api.api_calls == 1


def test_request_retries_on_connection_error():
    api = _api_with_session([
        requests.exceptions.ConnectionError("boom"),
        FakeResponse(200, {"ok": True}),
    ])
    resp = api._get("/some/path")
    assert resp.status_code == 200


def test_request_raises_after_repeated_connection_errors():
    api = _api_with_session([
        requests.exceptions.ConnectionError("boom")
        for _ in range(RETRY_ATTEMPTS + 1)
    ])
    with pytest.raises(requests.exceptions.ConnectionError):
        api._get("/some/path")


def test_request_raises_rate_limit_immediately_no_retry():
    """Rate-limit exhaustion is non-recoverable — no point retrying."""
    api = _api_with_session([
        FakeResponse(200, None, rate_limit_remaining="0"),
    ])
    with pytest.raises(RateLimitError):
        api._get("/some/path")
    assert api.api_calls == 1


# Review-PR listing for the Review Queue ----------------------------


def _pr(number, state, base_ref, *, merged_at=None, assignees=(), created_at="2026-07-01T00:00:00Z"):
    return {
        "number": number,
        "state": state,
        "html_url": f"https://github.com/camaraproject/QualityOnDemand/pull/{number}",
        "created_at": created_at,
        "closed_at": None if state == "open" else "2026-07-05T00:00:00Z",
        "merged_at": merged_at,
        "assignees": [{"login": login} for login in assignees],
        "body": "review body",
        "base": {"ref": base_ref},
    }


def test_list_release_prs_matches_tag_prefix_across_states(monkeypatch):
    api = GitHubAPI(token="t")
    page = [
        _pr(42, "open", "release-snapshot/r4.1-newsha", assignees=["alice"]),
        _pr(40, "closed", "release-snapshot/r4.1-oldsha", assignees=["bob"]),   # discarded
        _pr(39, "closed", "main", merged_at="2026-06-19T12:00:00Z"),            # unrelated
        _pr(38, "open", "release-snapshot/r4.10-xyz"),                          # different tag
    ]

    def fake_get(path, public=False, params=None, **kwargs):
        assert path.endswith("/pulls")
        assert params["state"] == "all"
        return FakeResponse(200, page if params.get("page", 1) == 1 else [])

    monkeypatch.setattr(api, "_get", fake_get)

    prs = api.list_release_prs("QualityOnDemand", "r4.1")

    # Only the two r4.1 snapshot PRs; r4.10 (prefix disambiguation) and main excluded.
    assert [p["number"] for p in prs] == [42, 40]
    current, discarded = prs
    assert current["state"] == "open"
    assert current["assignees"] == ["alice"]
    assert current["merged"] is False
    assert discarded["state"] == "closed"
    assert discarded["assignees"] == ["bob"]
    assert discarded["merged"] is False
    assert discarded["base_ref"] == "release-snapshot/r4.1-oldsha"


def test_list_release_prs_paginates(monkeypatch):
    api = GitHubAPI(token="t")
    full_page = [_pr(1000 + i, "closed", "main") for i in range(100)]
    match = _pr(50, "closed", "release-snapshot/r4.1-abc", assignees=["carol"])

    def fake_get(path, public=False, params=None, **kwargs):
        if params.get("page", 1) == 1:
            return FakeResponse(200, full_page)   # 100 -> forces page 2
        if params["page"] == 2:
            return FakeResponse(200, [match])      # <100 -> stop
        raise AssertionError("should not fetch page 3")

    monkeypatch.setattr(api, "_get", fake_get)

    prs = api.list_release_prs("QualityOnDemand", "r4.1")
    assert [p["number"] for p in prs] == [50]


def test_list_release_prs_404_returns_empty(monkeypatch):
    api = GitHubAPI(token="t")
    monkeypatch.setattr(api, "_get", lambda *a, **k: FakeResponse(404, None))
    assert api.list_release_prs("QualityOnDemand", "r4.1") == []


def test_list_release_prs_stops_at_release_issue_date(monkeypatch):
    api = GitHubAPI(token="t")
    # A full page (100) sorted newest-first: one recent Review PR, then 99 older
    # PRs predating the release issue. The not_before cutoff must exclude the old
    # ones AND halt paging (no Review PR can predate its release issue).
    page1 = [_pr(42, "open", "release-snapshot/r4.1-new",
                 created_at="2026-07-01T00:00:00Z", assignees=["alice"])]
    page1 += [_pr(1000 + i, "closed", "main", created_at="2026-05-01T00:00:00Z")
              for i in range(99)]

    fetched = []

    def fake_get(path, public=False, params=None, **kwargs):
        fetched.append(params.get("page", 1))
        return FakeResponse(200, page1 if params.get("page", 1) == 1 else [])

    monkeypatch.setattr(api, "_get", fake_get)

    prs = api.list_release_prs("QualityOnDemand", "r4.1",
                               not_before="2026-06-15T00:00:00Z")
    assert [p["number"] for p in prs] == [42]   # pre-release-issue PRs excluded
    assert fetched == [1]                        # scan halted; page 2 never fetched


def test_get_pr_reviews_normalizes(monkeypatch):
    api = GitHubAPI(token="t")

    def fake_get(path, public=False, params=None, **kwargs):
        assert path.endswith("/pulls/42/reviews")
        return FakeResponse(200, [
            {"user": {"login": "alice"}, "state": "APPROVED",
             "submitted_at": "2026-07-02T00:00:00Z"},
            {"user": {"login": "bob"}, "state": "COMMENTED",
             "submitted_at": "2026-07-03T00:00:00Z"},
        ])

    monkeypatch.setattr(api, "_get", fake_get)

    reviews = api.get_pr_reviews("QualityOnDemand", 42)
    assert reviews == [
        {"user": "alice", "state": "APPROVED", "submitted_at": "2026-07-02T00:00:00Z"},
        {"user": "bob", "state": "COMMENTED", "submitted_at": "2026-07-03T00:00:00Z"},
    ]


def test_get_codeowners_caches_per_repo(monkeypatch):
    api = GitHubAPI(token="t")
    calls = []

    def fake_get_file_content(repo, path, ref="main"):
        calls.append((repo, path))
        return {"QualityOnDemand": "* @alice"}.get(repo)

    monkeypatch.setattr(api, "get_file_content", fake_get_file_content)

    first = api.get_codeowners("QualityOnDemand")
    second = api.get_codeowners("QualityOnDemand")
    other_repo = api.get_codeowners("EdgeApplicationManagement")

    assert first == "* @alice"
    assert second == "* @alice"
    assert other_repo is None
    # One fetch per distinct repo, not per call.
    assert calls == [("QualityOnDemand", "CODEOWNERS"), ("EdgeApplicationManagement", "CODEOWNERS")]
