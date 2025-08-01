const assert = require('assert');
const createHandleReport = require('../utils/moderation');

function mockRedis() {
  const zsets = new Map();
  const hashes = new Map();
  const expirations = new Set();
  return {
    async zAdd(key, { score, value }) {
      if (!zsets.has(key)) zsets.set(key, []);
      zsets.get(key).push({ score, value });
    },
    async zCount(key, min, max) {
      if (!zsets.has(key)) return 0;
      return zsets
        .get(key)
        .filter(item => item.score >= min && item.score <= max).length;
    },
    async expire(key) {
      expirations.add(`${key}:expired`);
    },
    async hSet(key, field, value) {
      if (!hashes.has(key)) hashes.set(key, {});
      hashes.get(key)[field] = value;
    }
  };
}

function test(desc, fn) {
  try { fn(); console.log(`\u2714 ${desc}`); } catch (e) { console.error(`\u2718 ${desc}`); console.error(e); process.exitCode=1; }
}

const events = [];
const io = {
  to: () => ({ emit: (e) => events.push(e) }),
  emit: (e) => events.push(e)
};
const pubClient = mockRedis();
const handleReport = createHandleReport({ pubClient, io });

(async () => {
  await handleReport('u1');
  await handleReport('u1');
  await new Promise(r => setTimeout(r, 2));
  test('not banned after two reports', () => {
    assert.strictEqual(events.length, 0);
  });
  await handleReport('u1');
  test('banned on third report', () => {
    assert.strictEqual(events.includes('app:banned'), true);
  });
})();
