// Copyright (C) 2026 Brclio. GPL-2.0-only.
// One budget covers opening the socket, every negotiation fragment and the
// first application write. Established tunnels do not retain this timer.
export function closeProxySocket(socket) {
  try { Promise.resolve(socket?.close()).catch(() => {}); } catch {}
}

export function createProxyHandshakeDeadline(socket, timeoutMs = 10000, label = 'Proxy') {
  const value = Number(timeoutMs);
  const budget = Number.isFinite(value) && value > 0 ? Math.min(value, 60000) : 10000;
  let expired = null, timer, closing = false;
  const close = () => {
    if (closing) return;
    closing = true;
    closeProxySocket(socket);
  };
  const failure = new Promise((_, reject) => {
    timer = setTimeout(() => {
      expired = new Error(`${label} handshake timed out`);
      close();
      reject(expired);
    }, budget);
  });
  // Native sockets may reject closed when opening or TLS authentication fails.
  Promise.resolve(socket?.closed).catch(() => {});
  failure.catch(() => {});
  return {
    async wait(operation) {
      if (expired) throw expired;
      return Promise.race([
        Promise.resolve().then(() => {
          if (expired) throw expired;
          return operation();
        }),
        failure,
      ]);
    },
    close,
    dispose() { clearTimeout(timer); },
  };
}
