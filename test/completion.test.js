import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { BIN, runFwd } from './helpers/cli.js';

/** @type {string} */
let dir;
/** @type {Record<string, string>} */
let env;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'fwd-completion-'));
  // The scripts call `fwd __complete`, so fwd has to be on PATH.
  await mkdir(join(dir, 'bin'));
  await symlink(BIN, join(dir, 'bin', 'fwd'));
  env = { FWD_CONFIG_DIR: join(dir, 'config'), FWD_SSH: '/bin/false', PATH: `${join(dir, 'bin')}:${process.env.PATH}` };
  await mkdir(env.FWD_CONFIG_DIR);
  const forward = (/** @type {'local' | 'remote'} */ direction, /** @type {number} */ port) => ({
    direction,
    local: port,
    remote: port,
    to: '127.0.0.1',
  });
  await writeFile(
    join(env.FWD_CONFIG_DIR, 'state.json'),
    JSON.stringify({
      version: 2,
      defaultHost: 'vm',
      hosts: {
        vm: { forwards: [forward('local', 5173), forward('remote', 3000)] },
        db: { forwards: [forward('local', 5432)] },
      },
    }),
  );
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

/**
 * Run the generated bash completion for a command line; a trailing space
 * means completing a new, empty word.
 * @param {string} line
 * @returns {Promise<string[]>}
 */
function bashComplete(line) {
  const words = line.split(' ');
  const script = [
    'source <(fwd completion bash)',
    `COMP_WORDS=(${words.map((w) => `'${w}'`).join(' ')})`,
    `COMP_CWORD=${words.length - 1}`,
    '_fwd',
    'printf "%s\\n" "${COMPREPLY[@]}"',
  ].join('\n');
  return new Promise((resolve, reject) => {
    execFile('bash', ['-c', script], { env: { ...process.env, ...env } }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${err.message}\n${stderr}`));
      else resolve(stdout.split('\n').filter(Boolean).sort());
    });
  });
}

test('bash completes commands, without hidden ones', async () => {
  const words = await bashComplete('fwd ');
  for (const name of ['add', 'rm', 'ls', 'up', 'down', 'status', 'watch', 'config', 'completion', 'help']) {
    assert.ok(words.includes(name), name);
  }
  assert.ok(!words.includes('__complete'));
  assert.deepEqual(await bashComplete('fwd w'), ['watch']);
});

test('bash completes options per command', async () => {
  assert.deepEqual(await bashComplete('fwd add --'), ['--help', '--host', '--reverse', '--to']);
  assert.deepEqual(await bashComplete('fwd config --'), ['--help']);
});

test('bash completes saved ports for rm, honouring --host', async () => {
  assert.deepEqual(await bashComplete('fwd rm '), ['3000', '5173']);
  assert.deepEqual(await bashComplete('fwd rm --host db '), ['5432']);
  assert.deepEqual(await bashComplete('fwd rm 5173 '), []);
});

test('bash completes hosts for --host and config set host', async () => {
  assert.deepEqual(await bashComplete('fwd ls --host '), ['db', 'vm']);
  assert.deepEqual(await bashComplete('fwd config '), ['get', 'set', 'unset']);
  assert.deepEqual(await bashComplete('fwd config set '), ['host']);
  assert.deepEqual(await bashComplete('fwd config set host '), ['db', 'vm']);
});

test('bash does not complete free-form values', async () => {
  assert.deepEqual(await bashComplete('fwd add --to '), []);
  assert.deepEqual(await bashComplete('fwd completion '), ['bash', 'fish', 'zsh']);
});

test('bash completes command names after help', async () => {
  const words = await bashComplete('fwd help ');
  assert.ok(words.includes('rm') && words.includes('help'));
  assert.ok(!words.includes('__complete'));
  assert.deepEqual(await bashComplete('fwd help rm '), []);
});

test('unknown shells are rejected', async () => {
  const { code, stderr } = await runFwd(['completion', 'tcsh'], env);
  assert.equal(code, 1);
  assert.match(stderr, /Unknown shell "tcsh"/);
});

/** @param {string} shell */
function has(shell) {
  try {
    execFileSync('sh', ['-c', `command -v ${shell}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

test('zsh script parses', { skip: !has('zsh') && 'zsh not installed' }, async () => {
  const { stdout } = await runFwd(['completion', 'zsh'], env);
  execFileSync('zsh', ['-n'], { input: stdout });
});

test('fish script parses', { skip: !has('fish') && 'fish not installed' }, async () => {
  const { stdout } = await runFwd(['completion', 'fish'], env);
  execFileSync('fish', ['--no-execute'], { input: stdout });
});
