import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FwdError } from '../src/errors.js';
import { describe, keyOf, listenPort, parseSpec, toSshArgs } from '../src/spec.js';

test('a single port forwards to the same remote port on 127.0.0.1', () => {
  assert.deepEqual(parseSpec('5173'), { direction: 'local', local: 5173, remote: 5173, to: '127.0.0.1' });
});

test('local:remote maps to a different remote port', () => {
  assert.deepEqual(parseSpec('8080:3000'), { direction: 'local', local: 8080, remote: 3000, to: '127.0.0.1' });
});

test('--reverse keeps <local>:<remote> order but listens on the host', () => {
  const fwd = parseSpec('3000:8000', { reverse: true });
  assert.deepEqual(fwd, { direction: 'remote', local: 3000, remote: 8000, to: '127.0.0.1' });
  assert.equal(listenPort(fwd), 8000);
  assert.equal(keyOf(fwd), 'remote:8000');
  assert.equal(keyOf(parseSpec('8000')), 'local:8000');
});

test('--to sets the dialled address, and IPv6 brackets are optional', () => {
  assert.equal(parseSpec('5432', { to: 'db' }).to, 'db');
  assert.equal(parseSpec('5432', { to: '[::1]' }).to, '::1');
  assert.equal(parseSpec('5432', { to: '::1' }).to, '::1');
});

test('rejects malformed specs', () => {
  for (const bad of ['', 'abc', '80a', '1:2:3', '0', '70000', '8080:', ':3000', '8080:0', '-1']) {
    assert.throws(() => parseSpec(bad), FwdError, bad);
  }
  assert.throws(() => parseSpec('5432', { to: '' }), FwdError);
  assert.throws(() => parseSpec('5432', { to: 'a b' }), FwdError);
});

test('rejects privileged listen ports only', () => {
  assert.throws(() => parseSpec('80'), /Local port 80 is privileged.*fwd add 8080:80/);
  assert.equal(parseSpec('8080:80').remote, 80);
  assert.throws(() => parseSpec('3000:80', { reverse: true }), /Remote port 80 is privileged.*fwd add 3000:8080 --reverse/);
  assert.equal(parseSpec('80:8080', { reverse: true }).local, 80);
});

test('toSshArgs builds -L and -R arguments and brackets IPv6', () => {
  assert.deepEqual(toSshArgs(parseSpec('8080:3000')), ['-L', '8080:127.0.0.1:3000']);
  assert.deepEqual(toSshArgs(parseSpec('5432', { to: '::1' })), ['-L', '5432:[::1]:5432']);
  assert.deepEqual(toSshArgs(parseSpec('3000:8000', { reverse: true })), ['-R', '8000:127.0.0.1:3000']);
});

test('describe shows which side listens and where traffic goes', () => {
  assert.equal(describe(parseSpec('8080:3000'), 'vm'), 'localhost:8080 -> vm:3000');
  assert.equal(describe(parseSpec('5432', { to: 'db' }), 'vm'), 'localhost:5432 -> db:5432 (via vm)');
  assert.equal(describe(parseSpec('3000:8000', { reverse: true }), 'vm'), 'vm:8000 -> localhost:3000');
  assert.equal(describe(parseSpec('5432', { reverse: true, to: 'nas' }), 'vm'), 'vm:5432 -> nas:5432');
});
