import { getForwards } from '../state.js';
import { bringUp, pidSuffix, printResults } from './common.js';

/** @type {import('./common.js').Command} */
export default {
  name: 'up',
  summary: 'Start the SSH master and restore saved forwards',
  usage: ['fwd up [--host <host>]'],
  description: 'Use after a reboot, VM restart or network drop. Forwards that are already active are left alone.',
  args: [0, 0],

  async run({ state, host }) {
    const { started, pid, results } = await bringUp(host, getForwards(state, host));
    if (!started) console.log(`SSH master for ${host} is already running${pidSuffix(pid)}`);
    printResults(host, results);
    return results.some((r) => r.error) ? 1 : 0;
  },
};
