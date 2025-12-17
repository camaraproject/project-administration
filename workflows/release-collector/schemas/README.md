# CAMARA Meta-Release Collector Schemas

This directory contains JSON Schema definitions for the data files used by the Meta-Release Collector workflow.

## Schemas

### master-metadata-schema.yaml
- **File**: `data/releases-master.yaml`
- **Purpose**: Defines structure for master metadata containing GitHub facts with format corrections
- **Key Points**:
  - Contains only verifiable GitHub data
  - Format corrections applied (v-prefix removal, commonalities as strings)
  - Historical facts preserved (API names, titles)

### api-landscape-schema.yaml
- **File**: `/config/api-landscape.yaml` (at repository root)
- **Purpose**: Defines structure for API enrichment data
- **Key Points**:
  - Portfolio categories, URLs, tooltips
  - Previous names for renamed APIs (optional field)
  - Published flag for visibility control

## Data Flow

```
GitHub Data → Format Corrections → Master Metadata
                                          ↓
                                   Runtime Enrichment ← API Landscape
                                          ↓
                                   Enriched Reports
```

## Validation

These schemas can be used with JSON Schema validators to ensure data files are properly formatted:

```bash
# Example validation with ajv-cli
npx ajv validate -s schemas/master-metadata-schema.yaml -d data/releases-master.yaml --spec=draft7
npx ajv validate -s schemas/api-landscape-schema.yaml -d config/api-landscape.yaml --spec=draft7
```

## Format Corrections Applied

The master metadata schema expects these format corrections to be applied:

1. **Version format**: Remove 'v' prefix (v0.11.0 → 0.11.0)
2. **Commonalities type**: Ensure string type (0.4 → "0.4", strings unchanged)
3. **API names**: Lowercase format

## Fields NOT Corrected

These fields are preserved as historical facts:

- API name changes (e.g., "qod-provisioning")
- Repository names
- API titles
- Commonalities patch versions (e.g., "0.6.0" stays as-is)