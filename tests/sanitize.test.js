const assert = require('assert');
const sanitize = require('../utils/sanitize');

function test(description, fn) {
  try {
    fn();
    console.log(`\u2714 ${description}`);
  } catch (e) {
    console.error(`\u2718 ${description}`);
    console.error(e);
    process.exitCode = 1;
  }
}

test('escapes html and trims', () => {
  const input = '<script>alert(1)</script>hello world';
  const result = sanitize(input);
  assert.strictEqual(result, '&lt;script&gt;alert(1)&lt;/script&gt;hello world');
});

test('returns empty string for non strings', () => {
  assert.strictEqual(sanitize(null), '');
});
