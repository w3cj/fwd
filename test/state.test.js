import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import {
  findForward,
  getForwards,
  loadState,
  putForward,
  removeForward,
  saveState,
  statePath,
} from '../src/state.js';

/** @type {string} */
let dir;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'fwd-state-'));
  process.env.FWD_CONFIG_DIR = join(dir, 'nested', 'fwd');
});

afterEach(async () => {
  delete process.env.FWD_CONFIG_DIR;
  await rm(dir, { recursive: true, force: true });
});

test('a missing state file loads as empty', async () => {
  assert.deepEqual(await loadState(), { defaultHost: null, hosts: {} });
});

test('state round-trips through disk and leaves no temp files', async () => {
  const state = await loadState();
  state.defaultHost = 'vm';
  putForward(state, 'vm', { direction: 'local', local: 5173, to: '127.0.0.1', remote: 5173, addedAt: 'x' });
  await saveState(state);
  assert.deepEqual(await loadState(), state);
  assert.deepEqual(await readdir(join(dir, 'nested', 'fwd')), ['state.json']);
});

test('putForward replaces by local port and keeps forwards sorted', async () => {
  const state = await loadState();
  putForward(state, 'vm', { direction: 'local', local: 9000, to: '127.0.0.1', remote: 9000 });
  putForward(state, 'vm', { direction: 'local', local: 5173, to: '127.0.0.1', remote: 5173 });
  putForward(state, 'vm', { direction: 'local', local: 9000, to: '127.0.0.1', remote: 3000 });
  assert.deepEqual(
    getForwards(state, 'vm').map((f) => [f.local, f.remote]),
    [[5173, 5173], [9000, 3000]],
  );
  assert.equal(findForward(state, 'vm', 'local:9000')?.remote, 3000);
  assert.equal(findForward(state, 'other', 'local:9000'), undefined);
});

test('removing the last forward drops the host entry', async () => {
  const state = await loadState();
  putForward(state, 'vm', { direction: 'local', local: 5173, to: '127.0.0.1', remote: 5173 });
  removeForward(state, 'vm', 'local:5173');
  assert.deepEqual(state.hosts, {});
});

test('the state file records its format version', async () => {
  await saveState({ defaultHost: 'vm', hosts: {} });
  assert.equal(JSON.parse(await readFile(statePath(), 'utf8')).version, 2);
});

test('a state file from a newer fwd is refused, and unversioned files load', async () => {
  await saveState({ defaultHost: null, hosts: {} });
  await writeFile(statePath(), JSON.stringify({ version: 3, defaultHost: 'vm', hosts: {} }));
  await assert.rejects(loadState(), /newer version of fwd/);
  await writeFile(statePath(), JSON.stringify({ defaultHost: 'vm', hosts: {} }));
  assert.equal((await loadState()).defaultHost, 'vm');
});

test('version 1 forwards are migrated to directions', async () => {
  await saveState({ defaultHost: null, hosts: {} });
  const v1 = { local: 5173, remoteHost: 'db', remote: 5432, addedAt: '2026-10-01T14:02:00Z' };
  await writeFile(statePath(), JSON.stringify({ version: 1, defaultHost: 'vm', hosts: { vm: { forwards: [v1] } } }));
  assert.deepEqual(getForwards(await loadState(), 'vm'), [
    { direction: 'local', local: 5173, remote: 5432, to: 'db', addedAt: '2026-10-01T14:02:00Z' },
  ]);
});

test('local and reverse forwards on the same port are separate', async () => {
  const state = await loadState();
  putForward(state, 'vm', { direction: 'remote', local: 3000, remote: 3000, to: '127.0.0.1' });
  putForward(state, 'vm', { direction: 'local', local: 3000, remote: 3000, to: '127.0.0.1' });
  assert.deepEqual(getForwards(state, 'vm').map((f) => f.direction), ['local', 'remote']);
  removeForward(state, 'vm', 'remote:3000');
  assert.deepEqual(getForwards(state, 'vm').map((f) => f.direction), ['local']);
});

test('invalid JSON gives a readable error', async () => {
  await saveState({ defaultHost: null, hosts: {} });
  await writeFile(statePath(), '{ nope');
  await assert.rejects(loadState(), /not valid JSON/);
  assert.equal(await readFile(statePath(), 'utf8'), '{ nope');
});
