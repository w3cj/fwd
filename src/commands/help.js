import { FwdError } from '../errors.js';
import { commandHelp, mainHelp } from '../help.js';
import { findCommand } from './index.js';

/** @type {import('./common.js').Command} */
export default {
  name: 'help',
  summary: 'Show help for fwd or a command',
  usage: ['fwd help [<command>]'],
  args: [0, 1],
  host: 'none',
  readonly: true,
  positionals: ['commands'],

  async run({ args: [name] }) {
    if (name === undefined) return void console.log(mainHelp());
    const cmd = findCommand(name);
    if (cmd.hidden) throw new FwdError(`Unknown command "${name}". Run \`fwd help\` to see the commands.`);
    console.log(commandHelp(cmd));
  },
};
