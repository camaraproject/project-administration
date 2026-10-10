const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const { extractLegacyMetadata } = require('../scripts/lib/legacy-metadata');

const fixture = name => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

test('fixture body is not parseable as a full document', () => {
  assert.throws(() => yaml.load(fixture('legacy-broken-paths.yaml')));
});

test('extracts info and servers when the rest of the document is invalid', () => {
  const spec = extractLegacyMetadata(fixture('legacy-broken-paths.yaml'));
  assert.strictEqual(spec.info.title, 'Device Status');
  assert.strictEqual(spec.info.version, 'v2.1.0');
  assert.strictEqual(spec.info['x-camara-commonalities'], '0.4.0');
  assert.strictEqual(spec.servers[0].url, '{apiRoot}/device-status/v2');
});

test('does not return sections other than info and servers', () => {
  const spec = extractLegacyMetadata(fixture('legacy-broken-paths.yaml'));
  assert.deepStrictEqual(Object.keys(spec).sort(), ['info', 'servers']);
});

test('accepts a block sequence indented at column 0 under servers', () => {
  const spec = extractLegacyMetadata('info:\n  title: T\n  version: 1.0.0\nservers:\n- url: https://x.example/api-a/v1\npaths: {}\n');
  assert.strictEqual(spec.servers[0].url, 'https://x.example/api-a/v1');
});

test('accepts flow-style info and CRLF line endings', () => {
  const spec = extractLegacyMetadata('openapi: 3.0.3\r\ninfo: {title: T, version: 0.1.0}\r\npaths: {}\r\n');
  assert.strictEqual(spec.info.version, '0.1.0');
  assert.strictEqual(spec.servers, undefined);
});

test('ignores comments and document markers between sections', () => {
  const spec = extractLegacyMetadata('---\n# header\ninfo:\n  title: T\n  version: 1.0.0\n# note\n\nservers:\n  - url: https://x.example/a/v1\n');
  assert.strictEqual(spec.info.title, 'T');
  assert.strictEqual(spec.servers.length, 1);
});

test('throws when there is no top-level info section', () => {
  assert.throws(() => extractLegacyMetadata('openapi: 3.0.3\npaths: {}\n'), /no top-level info section/);
});

test('throws a parse error when the info section itself is invalid', () => {
  assert.throws(() => extractLegacyMetadata('info:\n  title: [unclosed\n  version: 1\n'));
});
