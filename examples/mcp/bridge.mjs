import { runTool } from '../../dist/agent/index.js';

/** The page must explicitly opt in; the token is sent in a frame, never in a URL. */
export function attachLiveBridge(board, { url, token, onStatus = () => {} }) {
  const address = new URL(url);
  if (
    address.protocol !== 'ws:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(address.hostname) ||
    address.pathname !== '/bridge'
  )
    throw new Error('Use a local ws://127.0.0.1:<port>/bridge endpoint.');
  if (typeof token !== 'string' || token.length < 32)
    throw new Error('A bridge token with at least 32 characters is required.');
  const socket = new WebSocket(address);
  let ready = false;
  socket.addEventListener('open', () => {
    socket.send(JSON.stringify({ type: 'hello', token }));
  });
  socket.addEventListener('close', () => {
    ready = false;
    onStatus('disconnected');
  });
  socket.addEventListener('error', () => onStatus('error'));
  socket.addEventListener('message', async (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (message.type === 'ready') {
      ready = true;
      onStatus('connected');
      return;
    }
    if (!ready || message.type !== 'call' || typeof message.id !== 'string') return;
    try {
      let result = await runTool(board, message.name, message.input);
      if (result instanceof Blob) {
        const bytes = new Uint8Array(await result.arrayBuffer());
        let binary = '';
        for (const byte of bytes) binary += String.fromCharCode(byte);
        result = {
          type: 'image',
          mimeType: result.type || 'image/png',
          data: btoa(binary),
        };
      }
      if (socket.readyState === WebSocket.OPEN)
        socket.send(JSON.stringify({ type: 'result', id: message.id, result }));
    } catch (error) {
      if (socket.readyState === WebSocket.OPEN)
        socket.send(
          JSON.stringify({
            type: 'result',
            id: message.id,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
    }
  });
  return () => socket.close(1000, 'Disconnected by the board owner');
}
