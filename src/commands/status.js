import { checkMaster, logPath, socketPath } from '../ssh.js';
import { getForwards, statePath } from '../state.js';

/** @type {import('./common.js').Command} */
export default {
  name: 'status',
  summary: 'Show the SSH master for a host',
  usage: ['fwd status [--host <host>]'],
  description: 'Shows the host, control socket, whether the master is alive, and its PID.',
  args: [0, 0],
  readonly: true,

  async run({ state, host }) {
    const master = await checkMaster(host);
    const rows = [
      ['Host', `${host}${host === state.defaultHost ? ' (default)' : ''}`],
      ['Master', master.alive ? 'running' : 'not running'],
      ['PID', master.alive && master.pid ? String(master.pid) : '-'],
      ['Forwards', `${getForwards(state, host).length} saved`],
      ['Socket', socketPath(host)],
      ['Log', logPath(host)],
      ['State', statePath()],
    ];
    for (const [label, value] of rows) console.log(`${label.padEnd(9)} ${value}`);
  },
};
