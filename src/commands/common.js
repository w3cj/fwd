import { FwdError } from '../errors.js';
import { isPortFree, isPortListening } from '../ports.js';
import { describe } from '../spec.js';
import { addForward, checkMaster, removeSocket, startMaster } from '../ssh.js';

/** @typedef {import('../spec.js').Forward} Forward */
/** @typedef {import('../state.js').State} State */

/**
 * @typedef {object} Option
 * @property {'string' | 'boolean'} type
 * @property {string} help
 * @property {string} [short]
 * @property {string} [value] Placeholder shown in help, e.g. "addr" for --to <addr>.
 * @property {Completion} [complete] How shells complete the option's value.
 */

/**
 * What shell completion offers for an argument: fixed words, command names,
 * saved hosts, or the saved listen ports for the host.
 * @typedef {string[] | 'commands' | 'hosts' | 'ports'} Completion
 */

/** @typedef {(message: string) => void} Log */

/**
 * @typedef {object} Context
 * @property {string[]} args
 * @property {Record<string, string | boolean | undefined>} flags
 * @property {State} state
 * @property {string} host The resolved host; empty unless `Command.host` is unset.
 */

/**
 * @typedef {object} Command
 * @property {string} name
 * @property {string} summary
 * @property {string[]} usage
 * @property {string} [description]
 * @property {[min: number, max: number]} args Allowed number of positional arguments.
 * @property {'none' | 'self'} [host] By default the host is resolved for the command.
 *   'self': --host is accepted but the command resolves it. 'none': no host at all.
 * @property {true} [readonly] Doesn't change state or the master, so skips the lock.
 * @property {true} [hidden] Left out of help and shell completion.
 * @property {Completion[]} [positionals] Shell completion for each positional argument.
 * @property {Record<string, Option>} [options]
 * @property {(ctx: Context) => Promise<number | void>} run
 */

/** @param {string} host */
export function validateHost(host) {
  if (!host || host.startsWith('-') || /\s/.test(host)) {
    throw new FwdError(`Invalid host "${host}".`);
  }
}

/**
 * @param {State} state
 * @param {string | boolean | undefined} flag
 */
export function resolveHost(state, flag) {
  const host = typeof flag === 'string' ? flag : state.defaultHost;
  if (!host) {
    throw new FwdError('No host set. Run `fwd config set host <host>` or pass --host <host>.');
  }
  validateHost(host);
  return host;
}

/** @param {number | null | undefined} pid */
export function pidSuffix(pid) {
  return pid ? ` (pid ${pid})` : '';
}

/**
 * Make sure a master is running for host, replacing a stale socket if the
 * previous one died uncleanly. `started` means no forwards are active yet.
 * @param {string} host
 * @returns {Promise<{ started: boolean, pid: number | null }>}
 */
async function ensureMaster(host) {
  const status = await checkMaster(host);
  if (status.alive) return { started: false, pid: status.pid };

  await removeSocket(host);
  await startMaster(host);

  // -f returns once the master is set up, but give it a moment just in case.
  for (let i = 0; i < 10; i++) {
    const check = await checkMaster(host);
    if (check.alive) return { started: true, pid: check.pid };
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new FwdError(`Started ssh for ${host}, but its control socket isn't responding.`);
}

/**
 * Send a forward to the master unless it's already active. `ours` says
 * whether the master may already have it: then a listener on a local port is
 * taken to be the forward; otherwise it belongs to another process.
 *
 * Remote ports can't be probed from here, but the master accepts a repeated
 * request for a forward it already has, so they're always (re)sent.
 * @param {string} host
 * @param {Forward} fwd
 * @param {{ ours: boolean }} options
 * @returns {Promise<'active' | 'added'>}
 */
export async function applyForward(host, fwd, { ours }) {
  if (fwd.direction === 'local') {
    if (ours && (await isPortListening(fwd.local))) return 'active';
    if (!(await isPortFree(fwd.local))) {
      throw new FwdError(`Local port ${fwd.local} is already in use by another process.`);
    }
  }
  await addForward(host, fwd);
  return ours && fwd.direction === 'remote' ? 'active' : 'added';
}

/**
 * 'down' if the master isn't running, 'broken' if a local forward's port isn't
 * listening, else 'active'. Remote forwards can't be checked individually.
 * @param {Forward} fwd
 * @param {boolean} masterAlive
 * @returns {Promise<'active' | 'down' | 'broken'>}
 */
export async function forwardStatus(fwd, masterAlive) {
  if (!masterAlive) return 'down';
  if (fwd.direction === 'remote') return 'active';
  return (await isPortListening(fwd.local)) ? 'active' : 'broken';
}

/**
 * @typedef {object} ForwardResult
 * @property {Forward} fwd
 * @property {'active' | 'added'} [result]
 * @property {Error} [error]
 */

/**
 * Start the master if needed, then apply each forward, collecting failures
 * instead of stopping at the first.
 * @param {string} host
 * @param {Forward[]} forwards
 * @param {Log} [log]
 */
export async function bringUp(host, forwards, log = console.log) {
  const master = await ensureMaster(host);
  if (master.started) log(`Started SSH master for ${host}${pidSuffix(master.pid)}`);

  /** @type {ForwardResult[]} */
  const results = [];
  for (const fwd of forwards) {
    try {
      results.push({ fwd, result: await applyForward(host, fwd, { ours: !master.started }) });
    } catch (err) {
      results.push({ fwd, error: /** @type {Error} */ (err) });
    }
  }
  return { ...master, results };
}

/**
 * @param {string} host
 * @param {ForwardResult[]} results
 * @param {Log} [log]
 */
export function printResults(host, results, log = console.log) {
  for (const { fwd, result, error } of results) {
    const label = (error ? 'failed' : result ?? '').padEnd(6);
    log(`  ${label}  ${describe(fwd, host)}${error ? `: ${error.message}` : ''}`);
  }
}
