# Architecture Documentation

This directory contains architectural decision records (ADRs) and technical documentation for developers and contributors working on the Meta-Release Collector workflow.

## For Maintainers

**You don't need to read these documents to run or maintain the workflow.** See the main [User Guide](../README.md) for operational instructions, or [QUICKSTART.md](../../QUICKSTART.md) for a 2-minute guide.

## For Developers

These documents explain the architectural decisions and implementation details:

## Architectural Decision Records (ADRs)

### [ADR-0001: Feature-Grouped Organization](0001-feature-grouped-organization.md)
**Date**: 2025-10-30
**Status**: Accepted

Explains the decision to organize the workflow in a feature-grouped directory structure (`workflows/release-collector/`) rather than a flat layout.

**Key decision**: Group all related files (scripts, config, templates, docs) under a single directory for better maintainability.

### [ADR-0002: Runtime Enrichment Architecture](0002-runtime-enrichment-architecture.md)
**Date**: 2025-09-22
**Status**: Accepted

Explains the core architectural pattern: separating GitHub facts (master metadata) from portfolio metadata (landscape), with enrichment applied at runtime during report generation.

**Key decision**: Keep master metadata pure (only GitHub facts), apply portfolio metadata at runtime.

### [ADR-0003: Archived Repository Handling](0003-archived-repository-handling.md)
**Date**: 2026-02-21
**Status**: Accepted

Explains how archived CAMARA API repositories are handled in the Release Collector pipeline, preserving historical release data while marking archived entries.

**Key decision**: Include archived repos via `archived-api-repository` topic with `repository_archived: true` field. No filtering in reports; campaigns skip archived repos.

## Related Documentation

- [User Guide](../README.md) - Operational guide for running the workflow
- [Scripts README](../../scripts/README.md) - Script implementation details
- [Schemas README](../../schemas/README.md) - Data structure definitions

## Contributing

When making significant architectural changes:
1. Document the decision in a new ADR
2. Follow the ADR template structure
3. Include context, decision, consequences, and alternatives
4. Reference related ADRs and documents
