// A request body that reports how many bytes have been handed to the network.

const CHUNK = 64 * 1024;

/**
 * Streams `buffer` in chunks and calls `onProgress(sent, total)` as each one is taken, so the
 * number follows the connection instead of jumping to 100% when the whole body is queued.
 * fetch needs `duplex: 'half'` and an explicit content-length with a stream body.
 */
function progressBody(buffer, onProgress) {
  const total = buffer.byteLength;
  let sent = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (sent >= total) return controller.close();
      const end = Math.min(sent + CHUNK, total);
      controller.enqueue(new Uint8Array(buffer.buffer, buffer.byteOffset + sent, end - sent));
      sent = end;
      onProgress(sent, total);
    },
  });
  return { body: stream, headers: { 'content-length': String(total) }, init: { duplex: 'half' } };
}

module.exports = { progressBody, CHUNK };
