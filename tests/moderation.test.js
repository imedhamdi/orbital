const assert = require('assert');
const createHandleReport = require('../utils/moderation');

function mockRedis() {
  const store = new Map();
  return {
    async sAdd(key, value) {
      if (!store.has(key)) store.set(key, new Set());
      store.get(key).add(value);
    },
    async sCard(key) {
      return store.has(key) ? store.get(key).size : 0;
    },
    async expire(key) {
      store.set(`${key}:expired`, true);
    }
  };
}

function test(desc, fn) {
  try { fn(); console.log(`\u2714 ${desc}`); } catch (e) { console.error(`\u2718 ${desc}`); console.error(e); process.exitCode=1; }
}

const events = [];
const io = { to: () => ({ emit: (e) => events.push(e) }) };
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
