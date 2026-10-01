// The only module that knows ssh's command-line syntax.
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FwdError } from './errors.js';
import { configDir } from './paths.js';
import { describe, toSshArgs } from './spec.js';

/** @typedef {import('./spec.js').Forward} Forward */

// FWD_SSH lets tests (or users) point at a wrapper, e.g. one that adds -F.
function sshBin() {
  return process.env.FWD_SSH || 'ssh';
}

function sockDir() {
  return join(configDir(), 'sock');
}

/**
 * macOS caps Unix socket paths at 104 bytes, so use a short hash rather than
 * the raw host string.
 * @param {string} host
 */
export function socketPath(host) {
  const hash = createHash('sha256').update(host).digest('hex').slice(0, 16);
  return join(sockDir(), hash);
}

/** @param {string} host */
export function logPath(host) {
  return `${socketPath(host)}.log`;
}

/**
 * @param {string[]} args
 * @returns {Promise<{ code: number, stderr: string }>}
 */
function run(args) {
  return new Promise((resolve, reject) => {
    execFile(sshBin(), args, { timeout: 15_000 }, (err, _stdout, stderr) => {
      if (err && /** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') {
        reject(notFound());
        return;
      }
      const code = err ? (typeof err.code === 'number' ? err.code : 1) : 0;
      resolve({ code, stderr: stderr.replace(/\r/g, '').trim() });
    });
  });
}

function notFound() {
  return new FwdError(`Could not run "${sshBin()}". Is OpenSSH installed and on your PATH?`);
}

/**
 * Control commands only talk to the master's socket, so they skip the ssh
 * config: otherwise `-O forward` would also send every LocalForward in it.
 * @param {string} host
 * @param {string} op
 * @param {string[]} [extra]
 */
function control(host, op, extra = []) {
  return run(['-F', 'none', '-S', socketPath(host), '-O', op, ...extra, '--', host]);
}

/**
 * Turn ssh's stderr from a failed control command into a readable error.
 * @param {string} host
 * @param {string} action
 * @param {string} stderr
 */
function controlError(host, action, stderr) {
  if (/control socket connect|no such file|connection refused/i.test(stderr)) {
    return new FwdError(`Could not ${action}: the SSH master for ${host} is not running.`);
  }
  const detail = stderr.replace(/^mux_?client\w*: /gm, '');
  return new FwdError(`Could not ${action}: ${detail || 'ssh exited with an error'}`);
}

/**
 * @param {string} host
 * @returns {Promise<{ alive: true, pid: number | null } | { alive: false }>}
 */
export async function checkMaster(host) {
  const { code, stderr } = await control(host, 'check');
  if (code !== 0) return { alive: false };
  const match = /pid=(\d+)/.exec(stderr);
  return { alive: true, pid: match ? Number(match[1]) : null };
}

/**
 * Start a ControlMaster in the background. stdin is inherited and ssh uses
 * /dev/tty for passphrase and host-key prompts. stdout/stderr are not
 * inherited because the backgrounded master would hold them open forever
 * (breaking `fwd up | cat`); ssh logs to a file instead and we show that on
 * failure.
 *
 * ClearAllForwardings drops LocalForward/RemoteForward lines from the user's
 * ssh config: fwd's state is the only source of forwards, and with
 * ExitOnForwardFailure a busy config port would stop the master starting.
 * @param {string} host
 */
export async function startMaster(host) {
  await mkdir(sockDir(), { recursive: true, mode: 0o700 });
  const log = logPath(host);
  await writeFile(log, '');
  const args = [
    '-M',
    '-S', socketPath(host),
    '-fN',
    '-E', log,
    '-o', 'ControlPersist=no',
    '-o', 'ExitOnForwardFailure=yes',
    '-o', 'ClearAllForwardings=yes',
    '-o', 'ConnectTimeout=10',
    '-o', 'ServerAliveInterval=15',
    '-o', 'ServerAliveCountMax=3',
    '--', host,
  ];
  /** @type {number} */
  const code = await new Promise((resolve, reject) => {
    const child = spawn(sshBin(), args, { stdio: ['inherit', 'ignore', 'ignore'] });
    child.once('error', (err) => {
      reject(/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT' ? notFound() : err);
    });
    child.once('exit', (exitCode) => resolve(exitCode ?? 1));
  });
  if (code !== 0) {
    const output = (await readFile(log, 'utf8').catch(() => '')).trim();
    const detail = output ? `\n${output.replace(/^/gm, '  ')}` : '';
    throw new FwdError(`Could not connect to ${host} (ssh exited with code ${code}).${detail}`);
  }
}

/**
 * @param {string} host
 */
export async function stopMaster(host) {
  const { code, stderr } = await control(host, 'exit');
  if (code !== 0) throw controlError(host, 'stop the SSH master', stderr);
}

/**
 * Remove a socket file left behind by a master that died uncleanly.
 * @param {string} host
 */
export async function removeSocket(host) {
  await rm(socketPath(host), { force: true });
}

/**
 * ssh can exit 0 even when the master rejected the request (e.g. cancelling a
 * forward it doesn't have), so check stderr as well.
 * @param {string} host
 * @param {'forward' | 'cancel'} op
 * @param {Forward} fwd
 * @param {string} action
 */
async function forwardRequest(host, op, fwd, action) {
  const { code, stderr } = await control(host, op, toSshArgs(fwd));
  if (code !== 0 || /request failed/i.test(stderr)) throw controlError(host, action, stderr);
}

/**
 * @param {string} host
 * @param {Forward} fwd
 */
export function addForward(host, fwd) {
  return forwardRequest(host, 'forward', fwd, `forward ${describe(fwd, host)}`);
}

/**
 * @param {string} host
 * @param {Forward} fwd
 */
export function cancelForward(host, fwd) {
  return forwardRequest(host, 'cancel', fwd, `cancel ${describe(fwd, host)}`);
}
