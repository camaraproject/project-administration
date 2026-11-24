const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const ViewerLib = require(path.join(__dirname, '..', 'templates', 'viewer-lib.js'));
const LIST = ['Fall24', 'Spring25', 'Fall25', 'Spring26', 'Sync26'];
const resolve = (search) => ViewerLib.resolveMetaReleaseView(search, LIST);

// [search, expected status, expected meta-release, expected selector shown]
const TABLE = [
  // no value: newest, selector shown unless selector=false
  ['', 'ok', 'Sync26', true],
  ['?meta-release=', 'ok', 'Sync26', true],
  ['?selector=true', 'ok', 'Sync26', true],
  ['?selector=false', 'ok', 'Sync26', false],
  ['?selector=maybe', 'ok', 'Sync26', true],
  // valid value: selector hidden unless selector=true
  ['?meta-release=Fall25', 'ok', 'Fall25', false],
  ['?meta-release=Fall25&selector=true', 'ok', 'Fall25', true],
  ['?meta-release=Fall25&selector=false', 'ok', 'Fall25', false],
  ['?meta-release=Fall25&selector=maybe', 'ok', 'Fall25', false],
  // case-insensitive match returns the list's spelling
  ['?meta-release=fall25', 'ok', 'Fall25', false],
  ['?meta-release=SPRING26&selector=true', 'ok', 'Spring26', true],
  // unknown value: message, selector shown unless selector=false
  ['?meta-release=Fall99', 'unknown', null, true],
  ['?meta-release=Fall99&selector=true', 'unknown', null, true],
  ['?meta-release=Fall99&selector=false', 'unknown', null, false],
  ['?meta-release=Fall99&selector=maybe', 'unknown', null, true]
];

for (const [search, status, metaRelease, selector] of TABLE) {
  test(`resolveMetaReleaseView ${JSON.stringify(search)}`, () => {
    const view = resolve(search);
    assert.strictEqual(view.status, status);
    assert.strictEqual(view.metaRelease, metaRelease);
    assert.strictEqual(view.showSelector, selector);
  });
}

test('resolveMetaReleaseView returns the requested value unchanged for the message', () => {
  const markup = '<img src=x onerror=alert(1)>';
  const view = resolve(`?meta-release=${encodeURIComponent(markup)}`);
  assert.strictEqual(view.status, 'unknown');
  assert.strictEqual(view.requested, markup);
});

test('resolveMetaReleaseView with an empty list is unavailable', () => {
  assert.strictEqual(ViewerLib.resolveMetaReleaseView('', []).status, 'empty');
});
