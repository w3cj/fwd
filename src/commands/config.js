import { FwdError } from '../errors.js';
import { saveState } from '../state.js';
import { validateHost } from './common.js';

/** @type {import('./common.js').Command} */
export default {
  name: 'config',
  summary: 'Get or set the default host',
  usage: ['fwd config set host <host>', 'fwd config get host', 'fwd config unset host'],
  description: [
    'The default host is used when --host is not given. An ~/.ssh/config alias works',
    'best, so keys, user and IP all come from your SSH setup:',
    '',
    '  Host vm',
    '    HostName 192.168.64.7',
    '    User cj',
    '',
    '  fwd config set host vm',
  ].join('\n'),
  args: [2, 3],
  host: 'none',
  positionals: [['set', 'get', 'unset'], ['host'], 'hosts'],

  async run({ args: [action, key, value], state }) {
    if (key !== 'host') throw new FwdError(`Unknown config key "${key}". Valid keys: host.`);
    if ((action === 'set') !== (value !== undefined)) {
      throw new FwdError(action === 'set' ? 'Missing value. Usage: fwd config set host <host>' : `Unexpected argument "${value}".`);
    }

    switch (action) {
      case 'get':
        if (!state.defaultHost) return 1;
        return void console.log(state.defaultHost);
      case 'set':
        validateHost(value);
        state.defaultHost = value;
        await saveState(state);
        return void console.log(`Default host set to ${value}`);
      case 'unset':
        state.defaultHost = null;
        await saveState(state);
        return void console.log('Default host cleared');
      default:
        throw new FwdError(`Unknown action "${action}". Use set, get or unset.`);
    }
  },
};
