// Development preview of the actual webview HTML and assets, backed by a mock VS Code API.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createHost } = require('./host.cjs');
const host = createHost(fs.readFileSync(path.join(__dirname, '../examples/catalog.xml'), 'utf8'));
const port = Number(process.env.XML_PREVIEW_PORT || 4318);
const origin = `http://127.0.0.1:${port}`;
const server = http.createServer(async (request, response) => {
  if (request.url === '/' && request.method === 'GET') {
    const nonce = /nonce="([a-f0-9]+)"/.exec(host.view.webview.html)[1];
    const bridge = `<script nonce="${nonce}">window.acquireVsCodeApi = () => ({getState:()=>undefined,setState:()=>{},postMessage: async message => { const response = await fetch('/message',{method:'POST',body:JSON.stringify(message)}); const data = await response.json(); if(data) window.dispatchEvent(new MessageEvent('message',{data})); }});</script>`;
    const html = host.view.webview.html.replaceAll('extension/media/', '/media/').replaceAll('https://test.invalid', origin).replace('<body ', '<body class="vscode-light" ').replace(/<script nonce=/, `${bridge}<script nonce=`);
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end(html); return;
  }
  if (request.url === '/message' && request.method === 'POST') {
    let body = ''; for await (const chunk of request) body += chunk;
    try {
      const count = host.messages.length;
      await host.emit('message', JSON.parse(body));
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(host.messages.length > count ? host.messages.at(-1) : null));
    } catch { response.writeHead(400); response.end('null'); }
    return;
  }
  const assets = { '/media/outline.js': 'text/javascript', '/media/search.js': 'text/javascript', '/media/outline.css': 'text/css' };
  if (assets[request.url]) {
    response.writeHead(200, { 'Content-Type': assets[request.url] });
    response.end(fs.readFileSync(path.join(__dirname, '..', request.url))); return;
  }
  response.writeHead(404); response.end();
});
server.listen(port, '127.0.0.1', () => console.log(`XML webview preview: ${origin}`));
