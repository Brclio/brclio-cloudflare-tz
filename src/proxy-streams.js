// Copyright (C) 2026 Brclio. GPL-2.0-only.
// A proxy handshake can share one TCP chunk with the first application bytes.
// Emit that prefix before pulling the socket, without awaiting an unconsumed
// TransformStream write or eagerly draining the whole connection.
export function prependSocketData(socket, prefix) {
  if (!prefix?.byteLength) return socket;
  let buffered = prefix;
  let reader = null;
  let controller = null;
  let closing = false;
  let closeTask = null;
  const releaseReader = () => {
    try { reader?.releaseLock(); } catch {}
    reader = null;
  };
  const close = () => {
    if (closeTask) return closeTask;
    closing = true;
    buffered = null;
    try { controller?.close(); } catch {}
    closeTask = (async () => {
      try {
        await socket.close();
      } finally {
        try { await reader?.cancel(); } catch {}
        releaseReader();
      }
    })();
    return closeTask;
  };
  const readable = new ReadableStream({
    start(value) { controller = value; },
    async pull(value) {
      if (closing) return;
      if (buffered) {
        const first = buffered;
        buffered = null;
        value.enqueue(first);
        return;
      }
      try {
        reader ||= socket.readable.getReader();
        const { done, value: chunk } = await reader.read();
        if (closing) return;
        if (done) {
          releaseReader();
          value.close();
        } else if (chunk?.byteLength) {
          value.enqueue(chunk);
        }
      } catch (error) {
        releaseReader();
        if (!closing) value.error(error);
      }
    },
    cancel() { return close(); },
  });
  return { readable, writable: socket.writable, opened: socket.opened, closed: socket.closed, close };
}
