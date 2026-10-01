import { setTimeout as sleep } from 'node:timers/promises';
import { FwdError } from '../errors.js';
import { withLock } from '../lock.js';
import { checkMaster } from '../ssh.js';
import { getForwards, loadState } from '../state.js';
import { bringUp, forwardStatus, printResults, resolveHost } from './common.js';

/** @typedef {import('./common.js').Log} Log */

/** @type {Log} */
function log(message) {
  console.log(`[${new Date().toTimeString().slice(0, 8)}] ${message}`);
}

/**
 * Check one host and repair it if the master is down or a forward is broken.
 * State is re-read every time so forwards added or removed meanwhile are
 * picked up.
 * @param {string} host
 */
async function check(host) {
  const forwards = getForwards(await loadState(), host);
  if (!forwards.length) return;
  const master = await checkMaster(host);
  const statuses = await Promise.all(forwards.map((fwd) => forwardStatus(fwd, master.alive)));
  if (statuses.every((s) => s === 'active')) return;

  log(master.alive ? `${host}: some forwards are broken, re-applying` : `${host}: master is down, reconnecting`);
  await withLock(async () => {
    const { results } = await bringUp(host, getForwards(await loadState(), host), log);
    printResults(host, results.filter((r) => r.result !== 'active'), log);
  });
}

/** @type {import('./common.js').Command} */
export default {
  name: 'watch',
  summary: 'Keep forwards up, reconnecting when the connection drops',
  usage: ['fwd watch [--interval <seconds>] [--host <host> | --all-hosts]'],
  description: [
    'Runs in the foreground, checking every few seconds. If the master has died',
    '(VM restart, sleep, network change) it reconnects and restores saved forwards;',
    'if a local forward stopped listening it is re-applied. Stop with Ctrl+C; the',
    'master keeps running.',
  ].join('\n'),
  args: [0, 0],
  host: 'self',
  readonly: true,
  options: {
    interval: { type: 'string', value: 'seconds', help: 'How often to check (default 5)' },
    'all-hosts': { type: 'boolean', help: 'Watch every host with saved forwards' },
  },

  async run({ flags, state }) {
    if (flags['all-hosts'] && flags.host !== undefined) throw new FwdError('Use either --host or --all-hosts, not both.');
    const host = flags['all-hosts'] ? null : resolveHost(state, flags.host);
    const seconds = flags.interval === undefined ? 5 : Number(flags.interval);
    if (!(seconds > 0)) throw new FwdError(`Invalid --interval "${flags.interval}": expected a positive number of seconds.`);

    const stop = new AbortController();
    for (const signal of /** @type {const} */ (['SIGINT', 'SIGTERM'])) process.once(signal, () => stop.abort());

    log(`Watching ${host ?? 'all hosts'} every ${seconds}s. Press Ctrl+C to stop.`);
    // Only report an error when it changes, so an unreachable host doesn't
    // print the same line every interval.
    /** @type {Map<string, string>} */
    const lastError = new Map();
    while (!stop.signal.aborted) {
      const hosts = host ? [host] : Object.keys((await loadState()).hosts);
      for (const h of hosts) {
        try {
          await check(h);
          if (lastError.delete(h)) log(`${h}: recovered`);
        } catch (err) {
          const message = /** @type {Error} */ (err).message;
          if (lastError.get(h) !== message) log(`${h}: ${message}`);
          lastError.set(h, message);
        }
      }
      await sleep(seconds * 1000, undefined, { signal: stop.signal }).catch(() => {});
    }
    log('Stopped watching.');
  },
};
