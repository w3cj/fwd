import { FwdError } from './errors.js';

/**
 * 'local' listens on this machine and connects from the host (ssh -L).
 * 'remote' listens on the host and connects from this machine (ssh -R).
 * @typedef {'local' | 'remote'} Direction
 */

/**
 * @typedef {object} Forward
 * @property {Direction} direction
 * @property {number} local Port on this machine.
 * @property {number} remote Port on the host.
 * @property {string} to Address dialled by the connecting side: from the host
 *   for local forwards, from this machine for remote ones.
 * @property {string} [addedAt]
 */

const DEFAULT_TO = '127.0.0.1';

/**
 * @param {string} value
 * @param {string} label
 * @returns {number}
 */
export function parsePort(value, label) {
  if (!/^\d+$/.test(value)) {
    throw new FwdError(`Invalid ${label} "${value}": expected a number.`);
  }
  const port = Number(value);
  if (port < 1 || port > 65535) {
    throw new FwdError(`Invalid ${label} ${port}: must be between 1 and 65535.`);
  }
  return port;
}

/**
 * Parse "5173" or "8080:3000" (<local>:<remote> in both directions).
 * @param {string} input
 * @param {{ to?: string, reverse?: boolean }} [options]
 * @returns {Forward}
 */
export function parseSpec(input, { to, reverse = false } = {}) {
  const parts = input.split(':');
  if (parts.length > 2) {
    throw new FwdError(
      `Invalid forward "${input}". Use <local> or <local>:<remote>, and --to <addr> for a different address.`,
    );
  }
  const local = parsePort(parts[0], 'local port');
  const remote = parts.length === 2 ? parsePort(parts[1], 'remote port') : local;
  /** @type {Forward} */
  const fwd = { direction: reverse ? 'remote' : 'local', local, remote, to: parseAddress(to) };

  const listen = listenPort(fwd);
  if (listen < 1024) {
    const suggestion = reverse ? `${local}:${remote + 8000} --reverse` : `${local + 8000}:${remote}`;
    throw new FwdError(
      `${reverse ? 'Remote' : 'Local'} port ${listen} is privileged (below 1024). Listen on a higher port, e.g. \`fwd add ${suggestion}\`.`,
    );
  }
  return fwd;
}

/**
 * @param {string | undefined} to
 * @returns {string}
 */
function parseAddress(to) {
  if (to === undefined) return DEFAULT_TO;
  // Accept "[::1]" as well as "::1"; brackets are added back when talking to ssh.
  const address = to.replace(/^\[(.*)\]$/, '$1');
  if (!address || /[\s[\]/]/.test(address)) {
    throw new FwdError(`Invalid --to address "${to}".`);
  }
  return address;
}

/**
 * The port that is listened on: on this machine for local forwards, on the
 * host for remote ones.
 * @param {Forward} fwd
 */
export function listenPort(fwd) {
  return fwd.direction === 'local' ? fwd.local : fwd.remote;
}

/**
 * Identifies a forward within a host: two forwards with the same key would
 * listen on the same port.
 * @param {Direction} direction
 * @param {number} port The listen port.
 */
export function forwardKey(direction, port) {
  return `${direction}:${port}`;
}

/** @param {Forward} fwd */
export function keyOf(fwd) {
  return forwardKey(fwd.direction, listenPort(fwd));
}

/** @param {string} address */
function bracket(address) {
  return address.includes(':') ? `[${address}]` : address;
}

/**
 * The -L/-R arguments for ssh. `-O cancel` must receive exactly the same
 * spec that `-O forward` did.
 * @param {Forward} fwd
 * @returns {[string, string]}
 */
export function toSshArgs(fwd) {
  return fwd.direction === 'local'
    ? ['-L', `${fwd.local}:${bracket(fwd.to)}:${fwd.remote}`]
    : ['-R', `${fwd.remote}:${bracket(fwd.to)}:${fwd.local}`];
}

/**
 * @param {Forward} a
 * @param {Forward} b
 */
export function sameTarget(a, b) {
  return a.direction === b.direction && a.local === b.local && a.remote === b.remote && a.to === b.to;
}

/** @param {string} address */
function isLoopback(address) {
  return address === DEFAULT_TO || address === 'localhost';
}

/**
 * Human-readable forward, e.g. "localhost:5173 -> vm:5173",
 * "localhost:5432 -> db:5432 (via vm)" or "vm:3000 -> localhost:3000".
 * @param {Forward} fwd
 * @param {string} host
 */
export function describe(fwd, host) {
  if (fwd.direction === 'remote') {
    return `${host}:${fwd.remote} -> ${isLoopback(fwd.to) ? 'localhost' : bracket(fwd.to)}:${fwd.local}`;
  }
  const target = isLoopback(fwd.to) ? `${host}:${fwd.remote}` : `${bracket(fwd.to)}:${fwd.remote} (via ${host})`;
  return `localhost:${fwd.local} -> ${target}`;
}
