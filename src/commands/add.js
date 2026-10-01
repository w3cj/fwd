import { FwdError } from '../errors.js';
import { describe, keyOf, listenPort, parseSpec, sameTarget } from '../spec.js';
import { findForward, getForwards, putForward, saveState } from '../state.js';
import { applyForward, bringUp, printResults } from './common.js';

/** @type {import('./common.js').Command} */
export default {
  name: 'add',
  summary: 'Forward a port to (or, with --reverse, from) the host',
  usage: ['fwd add <local>[:<remote>] [--reverse] [--to <addr>] [--host <host>]'],
  description: [
    'Forwards localhost:<local> to <remote> on the host (defaults to the same port).',
    'With --reverse, the host listens on <remote> and forwards to localhost:<local>.',
    'Starts the SSH master if it is not running and restores saved forwards.',
    '',
    'Examples:',
    '  fwd add 5173                  localhost:5173 -> host:5173',
    '  fwd add 8080:3000             localhost:8080 -> host:3000',
    '  fwd add 5432 --to db          localhost:5432 -> db:5432, as reached from the host',
    '  fwd add 3000 --reverse        host:3000 -> localhost:3000',
    '  fwd add 3000:8000 --reverse   host:8000 -> localhost:3000',
  ].join('\n'),
  args: [1, 1],
  options: {
    reverse: { type: 'boolean', help: 'Listen on the host and forward to this machine (ssh -R)' },
    to: { type: 'string', value: 'addr', help: 'Address to connect to from the other side (default 127.0.0.1)' },
  },

  async run({ args, flags, state, host }) {
    const fwd = parseSpec(args[0], {
      to: typeof flags.to === 'string' ? flags.to : undefined,
      reverse: Boolean(flags.reverse),
    });

    // Local listeners share this machine, so they clash across hosts; remote
    // listeners only clash on the same host.
    const key = keyOf(fwd);
    for (const savedHost of fwd.direction === 'local' ? Object.keys(state.hosts) : [host]) {
      const other = findForward(state, savedHost, key);
      if (other && !(savedHost === host && sameTarget(other, fwd))) {
        const rm = `fwd rm ${listenPort(other)}${other.direction === 'remote' ? ' --reverse' : ''} --host ${savedHost}`;
        throw new FwdError(`That port is already used by ${describe(other, savedHost)}. Run \`${rm}\` first.`);
      }
    }

    const saved = findForward(state, host, key);
    const others = getForwards(state, host).filter((f) => f !== saved);
    const { started, results } = await bringUp(host, others);
    printResults(host, results.filter((r) => r.result !== 'active'));

    const result = await applyForward(host, fwd, { ours: !started && saved !== undefined });
    putForward(state, host, { ...fwd, addedAt: saved?.addedAt ?? new Date().toISOString() });
    await saveState(state);
    console.log(`${result === 'active' ? 'Already forwarding' : 'Forwarding'} ${describe(fwd, host)}`);
  },
};
