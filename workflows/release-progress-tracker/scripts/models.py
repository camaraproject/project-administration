"""Data models for release progress tracking.

Dataclasses matching the releases-progress.yaml output schema.
Each class has a to_dict() method for YAML serialization.
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List, Optional


class ProgressState(Enum):
    """Release progress state derived from repository artifacts."""
    NOT_PLANNED = "not_planned"
    PLANNED = "planned"
    SNAPSHOT_ACTIVE = "snapshot_active"
    DRAFT_READY = "draft_ready"
    PUBLISHED = "published"


@dataclass
class ProgressWarning:
    """Validation warning attached to a progress entry."""
    code: str       # e.g. "W001"
    message: str
    severity: str   # "warning" or "info"

    def to_dict(self) -> Dict:
        return {"code": self.code, "message": self.message, "severity": self.severity}


@dataclass
class ApiEntry:
    """API planned for a release (from release-plan.yaml)."""
    api_name: str
    target_api_version: str
    target_api_status: str
    main_contacts: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict:
        d = {
            "api_name": self.api_name,
            "target_api_version": self.target_api_version,
            "target_api_status": self.target_api_status,
        }
        if self.main_contacts:
            d["main_contacts"] = self.main_contacts
        return d


@dataclass
class ArtifactInfo:
    """Release artifacts found in the repository."""
    snapshot_branch: Optional[str] = None
    release_pr: Optional[Dict] = None       # {number, state, url}
    draft_release: Optional[Dict] = None    # {name, url}
    release_issue: Optional[Dict] = None    # {number, url}

    def to_dict(self) -> Dict:
        return {
            "snapshot_branch": self.snapshot_branch,
            "release_pr": self.release_pr,
            "draft_release": self.draft_release,
            "release_issue": self.release_issue,
        }


@dataclass
class CycleReleaseApi:
    """API version within a milestone release."""
    api_name: str
    api_version: Optional[str]  # None if milestone not achieved

    def to_dict(self) -> Dict:
        return {"api_name": self.api_name, "api_version": self.api_version}


@dataclass
class MilestoneRelease:
    """A milestone release (M1/M3/M4) within a meta-release cycle."""
    release_tag: Optional[str]
    release_date: Optional[str]
    apis: List[CycleReleaseApi] = field(default_factory=list)

    def to_dict(self) -> Dict:
        return {
            "release_tag": self.release_tag,
            "release_date": self.release_date,
            "apis": [a.to_dict() for a in self.apis],
        }


@dataclass
class CycleReleases:
    """M1/M3/M4 milestone releases for a repo in a meta-release cycle."""
    m1: Optional[MilestoneRelease] = None
    m3: Optional[MilestoneRelease] = None
    m4: Optional[MilestoneRelease] = None

    def to_dict(self) -> Dict:
        if not self.m1 and not self.m3 and not self.m4:
            return {}
        d = {}
        if self.m1:
            d["m1"] = self.m1.to_dict()
        if self.m3:
            d["m3"] = self.m3.to_dict()
        if self.m4:
            d["m4"] = self.m4.to_dict()
        return d


@dataclass
class PublishedContext:
    """Published release context from releases-master.yaml."""
    latest_public_release: Optional[str]
    newest_pre_release: Optional[str]

    def to_dict(self) -> Dict:
        return {
            "latest_public_release": self.latest_public_release,
            "newest_pre_release": self.newest_pre_release,
        }


@dataclass
class ProgressEntry:
    """Full progress entry for a repository."""
    repository: str
    github_url: str
    release_track: Optional[str] = None
    meta_release: Optional[str] = None
    target_release_tag: Optional[str] = None
    target_release_type: Optional[str] = None
    dependencies: Optional[Dict] = None
    apis: List[ApiEntry] = field(default_factory=list)
    state: ProgressState = ProgressState.NOT_PLANNED
    artifacts: ArtifactInfo = field(default_factory=ArtifactInfo)
    published_context: PublishedContext = field(
        default_factory=lambda: PublishedContext(None, None)
    )
    cycle_releases: CycleReleases = field(default_factory=CycleReleases)
    warnings: List[ProgressWarning] = field(default_factory=list)

    def to_dict(self) -> Dict:
        d = {
            "repository": self.repository,
            "github_url": self.github_url,
        }
        if self.release_track:
            d["release_track"] = self.release_track
        if self.meta_release:
            d["meta_release"] = self.meta_release
        d["target_release_tag"] = self.target_release_tag
        d["target_release_type"] = self.target_release_type
        if self.dependencies:
            d["dependencies"] = self.dependencies
        d["apis"] = [a.to_dict() for a in self.apis]
        d["state"] = self.state.value
        d["artifacts"] = self.artifacts.to_dict()
        d["published_context"] = self.published_context.to_dict()
        d["cycle_releases"] = self.cycle_releases.to_dict()
        if self.warnings:
            d["warnings"] = [w.to_dict() for w in self.warnings]
        return d


@dataclass
class MetaReleaseSummary:
    """Aggregate progress summary for a meta-release cycle."""
    name: str
    total_apis: int = 0
    m1_achieved: int = 0
    m3_achieved: int = 0
    m4_achieved: int = 0

    def to_dict(self) -> Dict:
        return {
            "name": self.name,
            "total_apis": self.total_apis,
            "m1_achieved": self.m1_achieved,
            "m3_achieved": self.m3_achieved,
            "m4_achieved": self.m4_achieved,
        }


@dataclass
class CollectionStats:
    """Statistics about the collection run."""
    repos_scanned: int = 0
    repos_with_plan: int = 0
    repos_planned: int = 0
    api_calls: int = 0
    duration_seconds: float = 0.0

    def to_dict(self) -> Dict:
        return {
            "repos_scanned": self.repos_scanned,
            "repos_with_plan": self.repos_with_plan,
            "repos_planned": self.repos_planned,
            "api_calls": self.api_calls,
            "duration_seconds": round(self.duration_seconds, 1),
        }


@dataclass
class ProgressData:
    """Top-level output structure for releases-progress.yaml."""
    last_updated: str = ""
    schema_version: str = "1.0.0"
    collector_version: str = "1.0.0"
    collection_stats: CollectionStats = field(default_factory=CollectionStats)
    meta_releases: List[MetaReleaseSummary] = field(default_factory=list)
    progress: List[ProgressEntry] = field(default_factory=list)

    def to_dict(self) -> Dict:
        return {
            "metadata": {
                "last_updated": self.last_updated,
                "schema_version": self.schema_version,
                "collector_version": self.collector_version,
                "collection_stats": self.collection_stats.to_dict(),
            },
            "meta_releases": [m.to_dict() for m in self.meta_releases],
            "progress": [e.to_dict() for e in self.progress],
        }
