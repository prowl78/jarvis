const { describe, it } = require('node:test');
const assert = require('node:assert');

describe('hello world', () => {
  it('returns hello world', () => {
    assert.strictEqual('hello world', 'hello world');
  });
});
