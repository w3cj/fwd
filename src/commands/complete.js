import { listenPort } from '../spec.js';
import { getForwards } from '../state.js';

// Called by the completion scripts for values that depend on saved state.
/** @type {import('./common.js').Command} */
export default {
  name: '__complete',
  summary: 'Print completion candidates',
  usage: ['fwd __complete hosts|ports [--host <host>]'],
  args: [1, 1],
  host: 'self',
  readonly: true,
  hidden: true,

  async run({ args: [what], flags, state }) {
    /** @type {(string | number)[]} */
    let values = [];
    if (what === 'hosts') {
      values = [state.defaultHost ?? '', ...Object.keys(state.hosts)];
    } else if (what === 'ports') {
      const host = typeof flags.host === 'string' ? flags.host : state.defaultHost;
      values = host ? getForwards(state, host).map(listenPort) : [];
    }
    // Write strings, not console.log(number): numbers get ANSI colours when
    // FORCE_COLOR is set, which would end up in the completions.
    const lines = [...new Set(values.map(String))].filter(Boolean);
    if (lines.length) process.stdout.write(`${lines.join('\n')}\n`);
  },
};
