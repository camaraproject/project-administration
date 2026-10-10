/**
 * Metadata-only extraction for legacy OpenAPI files.
 *
 * Releases without a native release-metadata.yaml are described by only four
 * fields of their OpenAPI file: servers[0].url, info.version, info.title and
 * info.x-camara-commonalities. This module cuts the top-level `info` and
 * `servers` sections out of the raw text and parses only those, so the rest of
 * the document (paths, schemas, examples, callbacks) is never inspected and
 * cannot cause an API to be dropped.
 *
 * It does not validate the OpenAPI document; validation is a separate concern.
 */

const yaml = require('js-yaml');

const SECTIONS = ['info', 'servers'];

// A top-level mapping key: starts in column 0, plain or quoted.
const TOP_LEVEL_KEY = /^(?:"([^"]+)"|'([^']+)'|([^\s#'"\-][^:]*?))\s*:(?:\s|$)/;

/**
 * Split the document into the raw text of its top-level `info` and `servers`
 * sections. Lines that are indented, blank, comments, or block-sequence items
 * at column 0 belong to the section above them.
 */
function cutSections(content) {
  const lines = content.replace(/^﻿/, '').split(/\r?\n/);
  const cut = {};
  let current = null;

  for (const line of lines) {
    if (/^(---|\.\.\.)(\s|$)/.test(line)) {
      current = null;
      continue;
    }

    const isContinuation = line === '' || /^\s/.test(line) || line.startsWith('#') || /^-(\s|$)/.test(line);
    if (!isContinuation) {
      const match = line.match(TOP_LEVEL_KEY);
      const key = match ? (match[1] || match[2] || match[3]).trim() : null;
      current = SECTIONS.includes(key) && !(key in cut) ? key : null;
      if (current) {
        cut[current] = [];
      }
    }

    if (current) {
      cut[current].push(line);
    }
  }

  return cut;
}

/**
 * Extract `info` and `servers` from a legacy OpenAPI file.
 *
 * @param {string} content - Raw OpenAPI file text
 * @returns {{info: object, servers?: Array}} Parsed sections (no other keys)
 * @throws {Error} When there is no top-level `info` section or the extracted
 *   sections are not valid YAML
 */
function extractLegacyMetadata(content) {
  const cut = cutSections(content);

  if (!cut.info) {
    throw new Error('no top-level info section found');
  }

  const snippet = SECTIONS
    .filter(key => cut[key])
    .map(key => cut[key].join('\n'))
    .join('\n');

  const parsed = yaml.load(snippet);
  if (!parsed || typeof parsed !== 'object' || !parsed.info || typeof parsed.info !== 'object') {
    throw new Error('top-level info section is not a mapping');
  }

  const result = { info: parsed.info };
  if (parsed.servers !== undefined) {
    result.servers = parsed.servers;
  }
  return result;
}

module.exports = { extractLegacyMetadata };
