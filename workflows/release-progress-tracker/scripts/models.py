"""Data models for release progress tracking.

Dataclasses matching the releases-progress.yaml output schema.
Each class has a to_dict() method for YAML serialization.
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List, Optional

# Single source of truth for version constants — update here only
SCHEMA_VERSION = "1.5.0"
COLLECTOR_VERSION = "1.5.0"


class ProgressState(Enum):
    """Release progress state derived from repository artifacts."""
    NOT_PLANNED = "not_planned"
    PLANNED = "planned"
    SNAPSHOT_ACTIVE = "snapshot_active"
    DRAFT_READY = "draft_ready"
    PUBLISHED = "published"
    HISTORICAL = "historical"  # No release-plan.yaml; derived from releases-master.yaml only


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
    has_caller_workflow: Optional[bool] = None  # Transient — not serialized

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
    last_published: Optional['MilestoneRelease'] = None
    snapshot_api_versions: Optional[Dict[str, str]] = None
    warnings: List[ProgressWarning] = field(default_factory=list)
    source: Optional[str] = None  # "historical" for IMP-074 entries; omitted for active entries

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
        if self.last_published:
            d["last_published"] = self.last_published.to_dict()
        if self.snapshot_api_versions:
            d["snapshot_api_versions"] = self.snapshot_api_versions
        if self.warnings:
            d["warnings"] = [w.to_dict() for w in self.warnings]
        if self.source:
            d["source"] = self.source
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
    repos_fully_onboarded: int = 0
    repos_with_release_issue: int = 0
    repos_new: int = 0
    api_calls: int = 0
    duration_seconds: float = 0.0

    def to_dict(self) -> Dict:
        return {
            "repos_scanned": self.repos_scanned,
            "repos_with_plan": self.repos_with_plan,
            "repos_planned": self.repos_planned,
            "repos_fully_onboarded": self.repos_fully_onboarded,
            "repos_with_release_issue": self.repos_with_release_issue,
            "repos_new": self.repos_new,
            "api_calls": self.api_calls,
            "duration_seconds": round(self.duration_seconds, 1),
        }


@dataclass
class ProgressData:
    """Top-level output structure for releases-progress.yaml."""
    last_updated: str = ""            # When progress data last changed
    last_checked: str = ""            # When data was last collected (every run)
    releases_master_updated: str = "" # When releases-master.yaml was last modified
    schema_version: str = SCHEMA_VERSION
    collector_version: str = COLLECTOR_VERSION
    collection_stats: CollectionStats = field(default_factory=CollectionStats)  # Internal only
    data_changed: bool = True         # Internal flag, not serialized
    meta_releases: List[MetaReleaseSummary] = field(default_factory=list)
    progress: List[ProgressEntry] = field(default_factory=list)

    def to_dict(self) -> Dict:
        return {
            "metadata": {
                "last_updated": self.last_updated,
                "last_checked": self.last_checked,
                "releases_master_updated": self.releases_master_updated,
                "schema_version": self.schema_version,
                "collector_version": self.collector_version,
                "repos_scanned": self.collection_stats.repos_scanned,
                "repos_new": self.collection_stats.repos_new,
                "repos_with_plan": self.collection_stats.repos_with_plan,
                "repos_fully_onboarded": self.collection_stats.repos_fully_onboarded,
                "repos_with_release_issue": self.collection_stats.repos_with_release_issue,
            },
            "meta_releases": [m.to_dict() for m in self.meta_releases],
            "progress": [e.to_dict() for e in self.progress],
        }
