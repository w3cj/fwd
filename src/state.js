import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { FwdError } from './errors.js';
import { configDir } from './paths.js';
import { keyOf, listenPort } from './spec.js';

/** @typedef {import('./spec.js').Forward} Forward */

/**
 * @typedef {object} State
 * @property {string | null} defaultHost
 * @property {Record<string, { forwards: Forward[] }>} hosts
 */

// Bump when the file format changes, and migrate older versions in loadState.
const STATE_VERSION = 2;

/**
 * Version 1 (and unversioned 0.1.0 files) only had local forwards, with the
 * dialled address in `remoteHost`.
 * @param {{ local: number, remote: number, remoteHost: string, addedAt?: string }} fwd
 * @returns {Forward}
 */
function migrateV1Forward({ local, remote, remoteHost, addedAt }) {
  return { direction: 'local', local, remote, to: remoteHost, ...(addedAt && { addedAt }) };
}

export function statePath() {
  return join(configDir(), 'state.json');
}

/** @returns {Promise<State>} */
export async function loadState() {
  let raw;
  try {
    raw = await readFile(statePath(), 'utf8');
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') {
      return { defaultHost: null, hosts: {} };
    }
    throw err;
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new FwdError(`State file ${statePath()} is not valid JSON: ${/** @type {Error} */ (err).message}`);
  }
  // Files written by 0.1.0 have no version; they're the same format as 1.
  const version = data.version ?? 1;
  if (version > STATE_VERSION) {
    throw new FwdError(`State file ${statePath()} was written by a newer version of fwd. Upgrade fwd to use it.`);
  }
  const hosts = data.hosts ?? {};
  if (version < 2) {
    for (const entry of Object.values(hosts)) entry.forwards = entry.forwards.map(migrateV1Forward);
  }
  return { defaultHost: data.defaultHost ?? null, hosts };
}

/**
 * Write to a temp file and rename it into place so a crash can't leave a
 * half-written state file.
 * @param {State} state
 */
export async function saveState(state) {
  const file = statePath();
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    await writeFile(tmp, `${JSON.stringify({ version: STATE_VERSION, ...state }, null, 2)}\n`);
    await rename(tmp, file);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

/**
 * @param {State} state
 * @param {string} host
 * @returns {Forward[]}
 */
export function getForwards(state, host) {
  return state.hosts[host]?.forwards ?? [];
}

/**
 * @param {State} state
 * @param {string} host
 * @param {string} key From forwardKey/keyOf.
 * @returns {Forward | undefined}
 */
export function findForward(state, host, key) {
  return getForwards(state, host).find((f) => keyOf(f) === key);
}

/**
 * Store forwards sorted by direction then listen port, dropping the host once
 * it has none.
 * @param {State} state
 * @param {string} host
 * @param {Forward[]} forwards
 */
function setForwards(state, host, forwards) {
  if (forwards.length) {
    state.hosts[host] = { ...state.hosts[host], forwards: forwards.sort((a, b) => a.direction.localeCompare(b.direction) || listenPort(a) - listenPort(b)) };
  } else {
    delete state.hosts[host];
  }
}

/**
 * Add or replace the forward that listens on the same port.
 * @param {State} state
 * @param {string} host
 * @param {Forward} fwd
 */
export function putForward(state, host, fwd) {
  setForwards(state, host, [...getForwards(state, host).filter((f) => keyOf(f) !== keyOf(fwd)), fwd]);
}

/**
 * @param {State} state
 * @param {string} host
 * @param {string} key From forwardKey/keyOf.
 */
export function removeForward(state, host, key) {
  setForwards(state, host, getForwards(state, host).filter((f) => keyOf(f) !== key));
}
