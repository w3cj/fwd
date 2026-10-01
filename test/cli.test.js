// CLI behaviour that doesn't need a running sshd.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { runFwd } from './helpers/cli.js';

/** @type {string} */
let dir;
/** @type {Record<string, string>} */
let env;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'fwd-cli-'));
  // FWD_SSH points at something that isn't ssh so nothing can reach a real host.
  env = { FWD_CONFIG_DIR: dir, FWD_SSH: '/bin/false' };
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

test('--help lists every command', async () => {
  const { code, stdout } = await runFwd(['--help'], env);
  assert.equal(code, 0);
  for (const name of ['add', 'rm', 'ls', 'up', 'down', 'status', 'watch', 'config', 'completion', 'help']) {
    assert.match(stdout, new RegExp(`^  ${name}\\s`, 'm'));
  }
});

test('each command has its own --help', async () => {
  for (const name of ['add', 'rm', 'ls', 'up', 'down', 'status', 'watch', 'config', 'completion', 'help']) {
    const { code, stdout } = await runFwd([name, '--help'], env);
    assert.equal(code, 0, name);
    assert.match(stdout, new RegExp(`^Usage: fwd ${name}`), name);
  }
});

test('--version prints the package version', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const { stdout } = await runFwd(['--version'], env);
  assert.equal(stdout.trim(), pkg.version);
});

test('unknown commands and options fail with a hint', async () => {
  let result = await runFwd(['nope'], env);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Unknown command "nope"/);

  result = await runFwd(['ls', '--bogus'], env);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Unknown option '--bogus'\.\nRun `fwd ls --help`/);
});

test('commands need a host', async () => {
  const { code, stderr } = await runFwd(['ls'], env);
  assert.equal(code, 1);
  assert.match(stderr, /No host set/);
});

test('config set/get/unset host', async () => {
  assert.equal((await runFwd(['config', 'get', 'host'], env)).code, 1);
  assert.equal((await runFwd(['config', 'set', 'host', 'vm'], env)).code, 0);
  assert.equal((await runFwd(['config', 'get', 'host'], env)).stdout, 'vm\n');
  const state = JSON.parse(await readFile(join(dir, 'state.json'), 'utf8'));
  assert.equal(state.defaultHost, 'vm');
  assert.equal((await runFwd(['config', 'unset', 'host'], env)).code, 0);
  assert.equal((await runFwd(['config', 'get', 'host'], env)).code, 1);
});

test('hosts that look like ssh options are rejected', async () => {
  const { code, stderr } = await runFwd(['ls', '--host=-oProxyCommand=x'], env);
  assert.equal(code, 1);
  assert.match(stderr, /Invalid host/);
});

test('privileged ports are rejected before ssh is involved', async () => {
  const { code, stderr } = await runFwd(['add', '80', '--host', 'vm'], env);
  assert.equal(code, 1);
  assert.match(stderr, /privileged/);
});

test('rm of an unknown port explains what is saved', async () => {
  const { code, stderr } = await runFwd(['rm', '5173', '--host', 'vm'], env);
  assert.equal(code, 1);
  assert.match(stderr, /No saved forward on port 5173 for vm/);
});

test('a failed connection shows ssh exit status and nothing is saved', async () => {
  const { code, stderr } = await runFwd(['add', '5173', '--host', 'vm'], env);
  assert.equal(code, 1);
  assert.match(stderr, /Could not connect to vm/);
  const state = JSON.parse(await readFile(join(dir, 'state.json'), 'utf8').catch(() => '{}'));
  assert.equal(state.hosts?.vm, undefined);
});

test('rm takes either a port or --all', async () => {
  for (const args of [['rm'], ['rm', '5173', '--all']]) {
    const { code, stderr } = await runFwd([...args, '--host', 'vm'], env);
    assert.equal(code, 1);
    assert.match(stderr, /either a port or --all/);
  }
});

test('--host and --all-hosts are mutually exclusive', async () => {
  const { code, stderr } = await runFwd(['ls', '--all-hosts', '--host', 'vm'], env);
  assert.equal(code, 1);
  assert.match(stderr, /either --host or --all-hosts/);
});

test('a lock left by a dead process is taken over', async () => {
  // Pids are capped well below this on Linux and macOS, so nothing has it.
  await writeFile(join(dir, 'lock'), '99999999');
  const { code, stderr } = await runFwd(['config', 'set', 'host', 'vm'], env);
  assert.equal(code, 0, stderr);
  await assert.rejects(readFile(join(dir, 'lock')), { code: 'ENOENT' });
});

test('commands wait for a live lock to be released', async () => {
  await writeFile(join(dir, 'lock'), String(process.pid));
  const pending = runFwd(['config', 'set', 'host', 'vm'], env);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  await rm(join(dir, 'lock'));
  const { code, stderr } = await pending;
  assert.equal(code, 0, stderr);
  assert.match(stderr, new RegExp(`waiting for another fwd command \\(pid ${process.pid}\\)`));
});

test('read-only commands ignore the lock', async () => {
  await writeFile(join(dir, 'lock'), String(process.pid));
  try {
    const { code, stdout } = await runFwd(['status', '--host', 'vm'], env);
    assert.equal(code, 0);
    assert.match(stdout, /^Host\s+vm/m);
  } finally {
    await rm(join(dir, 'lock'));
  }
});

test('watch validates its interval', async () => {
  const { code, stderr } = await runFwd(['watch', '--interval', '0', '--host', 'vm'], env);
  assert.equal(code, 1);
  assert.match(stderr, /Invalid --interval "0"/);
});

test('__complete is hidden from help', async () => {
  const { stdout } = await runFwd(['--help'], env);
  assert.doesNotMatch(stdout, /__complete/);
});

test('help is a listed command that shows command help', async () => {
  const main = await runFwd(['help'], env);
  assert.equal(main.code, 0);
  assert.match(main.stdout, /^  help\s+Show help for fwd or a command$/m);

  const rm = await runFwd(['help', 'rm'], env);
  assert.equal(rm.code, 0);
  assert.equal(rm.stdout, (await runFwd(['rm', '--help'], env)).stdout);
});

test('help rejects unknown and hidden commands', async () => {
  for (const name of ['nope', '__complete']) {
    const { code, stderr } = await runFwd(['help', name], env);
    assert.equal(code, 1, name);
    assert.match(stderr, new RegExp(`Unknown command "${name}"`));
  }
});
