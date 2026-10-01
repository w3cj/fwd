import { FwdError } from '../errors.js';
import { isPortListening } from '../ports.js';
import { describe, forwardKey, keyOf, parsePort } from '../spec.js';
import { cancelForward, checkMaster } from '../ssh.js';
import { findForward, getForwards, removeForward, saveState } from '../state.js';

/** @type {import('./common.js').Command} */
export default {
  name: 'rm',
  summary: 'Stop forwarding a port and forget it',
  usage: ['fwd rm <port> [--reverse] [--host <host>]', 'fwd rm --all [--host <host>]'],
  description: [
    'Cancels the forward and removes it from saved state. If the SSH master is not',
    'running, only the saved state is updated. <port> is the listening port: the',
    'local port, or the remote port with --reverse.',
  ].join('\n'),
  args: [0, 1],
  positionals: ['ports'],
  options: {
    all: { type: 'boolean', help: 'Remove every forward for the host' },
    reverse: { type: 'boolean', help: 'Remove the reverse forward listening on <port> on the host' },
  },

  async run({ args, flags, state, host }) {
    if (Boolean(flags.all) === (args.length === 1)) {
      throw new FwdError('Pass either a port or --all. Usage: fwd rm <port> or fwd rm --all');
    }
    let targets = getForwards(state, host);
    if (!flags.all) {
      const port = parsePort(args[0], 'port');
      const direction = flags.reverse ? 'remote' : 'local';
      const fwd = findForward(state, host, forwardKey(direction, port));
      if (!fwd) {
        const flipped = findForward(state, host, forwardKey(direction === 'local' ? 'remote' : 'local', port));
        const hint = flipped ? ` Did you mean \`fwd rm ${port}${flags.reverse ? '' : ' --reverse'}\`?` : ' See `fwd ls`.';
        throw new FwdError(`No saved ${flags.reverse ? 'reverse ' : ''}forward on port ${port} for ${host}.${hint}`);
      }
      targets = [fwd];
    }
    if (!targets.length) return void console.log(`No saved forwards for ${host}.`);

    const master = await checkMaster(host);
    let failed = 0;
    for (const fwd of targets) {
      try {
        if (master.alive) await cancelForward(host, fwd);
      } catch (err) {
        // Cancel fails if the forward wasn't active (e.g. "broken"); that's
        // fine to forget. If a local port is still listening, keep it saved.
        if (fwd.direction === 'local' && (await isPortListening(fwd.local))) {
          console.error(`fwd: ${/** @type {Error} */ (err).message}`);
          console.error(`fwd: kept port ${fwd.local} in state; \`fwd down\` stops all forwards for ${host}.`);
          failed++;
          continue;
        }
      }
      removeForward(state, host, keyOf(fwd));
      console.log(`Removed ${describe(fwd, host)}`);
    }
    await saveState(state);
    return failed ? 1 : 0;
  },
};
