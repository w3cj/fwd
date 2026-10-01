import { checkMaster, removeSocket, stopMaster } from '../ssh.js';
import { getForwards } from '../state.js';

/** @type {import('./common.js').Command} */
export default {
  name: 'down',
  summary: 'Stop the SSH master (saved forwards are kept)',
  usage: ['fwd down [--host <host>]'],
  description: 'Closes the connection and every forward on it. Saved forwards are kept so `fwd up` can restore them.',
  args: [0, 0],

  async run({ state, host }) {
    if (!(await checkMaster(host)).alive) {
      await removeSocket(host);
      return void console.log(`SSH master for ${host} is not running.`);
    }
    await stopMaster(host);
    console.log(`Stopped SSH master for ${host}.`);
    const count = getForwards(state, host).length;
    if (count) console.log(`${count} saved forward${count === 1 ? '' : 's'} kept; \`fwd up\` restores them.`);
  },
};
