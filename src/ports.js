import net from 'node:net';

/**
 * True if something accepts TCP connections on 127.0.0.1:<port>.
 * @param {number} port
 * @param {number} [timeoutMs]
 * @returns {Promise<boolean>}
 */
export function isPortListening(port, timeoutMs = 500) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    /** @param {boolean} result */
    const done = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

/**
 * @param {number} port
 * @returns {Promise<boolean>}
 */
function canBind(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen({ port, host: '127.0.0.1', exclusive: true }, () => {
      server.close(() => resolve(true));
    });
  });
}

/**
 * True if ssh should be able to listen on localhost:<port>. Both checks are
 * needed: on macOS a wildcard listener doesn't always block a 127.0.0.1 bind.
 * @param {number} port
 * @returns {Promise<boolean>}
 */
export async function isPortFree(port) {
  return !(await isPortListening(port)) && (await canBind(port));
}
