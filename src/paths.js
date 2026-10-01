import { homedir } from 'node:os';
import { join } from 'node:path';

// State, sockets and logs live in $XDG_CONFIG_HOME/fwd (~/.config/fwd by
// default). FWD_CONFIG_DIR is an override so tests don't touch the real one.
export function configDir() {
  if (process.env.FWD_CONFIG_DIR) return process.env.FWD_CONFIG_DIR;
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return join(base, 'fwd');
}
