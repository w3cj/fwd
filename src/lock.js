import { link, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FwdError } from './errors.js';
import { configDir } from './paths.js';

const TIMEOUT_MS = 60_000;

function lockPath() {
  return join(configDir(), 'lock');
}

/** @param {number} pid */
function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return /** @type {NodeJS.ErrnoException} */ (err).code === 'EPERM';
  }
}

/**
 * Create the lock file atomically with our pid already in it: write a temp
 * file, then hard-link it into place (link fails if the lock exists).
 * @returns {Promise<boolean>}
 */
async function tryAcquire() {
  const file = lockPath();
  const tmp = `${file}.${process.pid}`;
  await writeFile(tmp, String(process.pid));
  try {
    await link(tmp, file);
    return true;
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'EEXIST') return false;
    throw err;
  } finally {
    await rm(tmp, { force: true });
  }
}

/**
 * Run fn while holding an exclusive lock, so concurrent fwd commands can't
 * lose each other's state updates or start two masters for one host. A lock
 * left by a process that no longer exists is taken over.
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withLock(fn) {
  await mkdir(configDir(), { recursive: true });
  const started = Date.now();
  let waiting = false;

  while (!(await tryAcquire())) {
    const holder = Number(await readFile(lockPath(), 'utf8').catch(() => ''));
    if (holder && !isRunning(holder)) {
      await rm(lockPath(), { force: true });
      continue;
    }
    if (Date.now() - started > TIMEOUT_MS) {
      throw new FwdError(`Another fwd command (pid ${holder}) is still running. If it's stuck, stop it and try again.`);
    }
    if (!waiting && Date.now() - started > 1000) {
      console.error(`fwd: waiting for another fwd command (pid ${holder}) to finish...`);
      waiting = true;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  try {
    return await fn();
  } finally {
    await rm(lockPath(), { force: true });
  }
}
