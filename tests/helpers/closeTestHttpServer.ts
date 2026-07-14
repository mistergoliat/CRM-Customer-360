import type { Server } from "node:http";

/**
 * Local test HTTP servers (http.createServer + server.listen) used as HTTP
 * doubles across the test suite leave keep-alive sockets open after the
 * last request completes - Node's fetch/undici client does not close the
 * connection, so a plain server.close() never invokes its callback (it
 * waits for the connection count to reach zero). Order matters: close()
 * must run first so no new connection can be accepted while idle/keep-alive
 * sockets are being torn down.
 */
export async function closeTestHttpServer(server: Server): Promise<void> {
  if (!server.listening) return;

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });

    server.closeIdleConnections?.();
    server.closeAllConnections?.();
  });
}
