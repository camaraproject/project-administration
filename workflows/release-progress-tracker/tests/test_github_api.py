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
