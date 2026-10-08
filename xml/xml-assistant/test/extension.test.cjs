const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHost } = require('./host.cjs');

test('activation, webview model, native document symbols, precise and version-safe navigation', async t => {
  const host = createHost(); t.after(host.dispose);
  await host.emit('message', { type: 'ready' });
  const message = host.messages.at(-1);
  assert.equal(message.model.nodes.length, 3);
  assert.equal(message.settings.showAttributes, false);
  const symbols = host.symbolProvider.provideDocumentSymbols(host.document, { isCancellationRequested: false });
  assert.equal(symbols[0].name, 'root');
  assert.equal(symbols[0].children.length, 2);
  await host.emit('message', { type: 'reveal', id: 1, uri: message.uri, version: 1 });
  assert.equal(host.reveals[0].options.selection.start.character, 7);
  await host.edit('<root><other/></root>');
  await host.emit('message', { type: 'reveal', id: 1, uri: message.uri, version: 1 });
  assert.equal(host.reveals.length, 1, 'stale ID must not navigate to another element');
});

test('UI settings honor workspace scope; invalid settings messages are ignored', async t => {
  const host = createHost(); t.after(host.dispose);
  host.config.workspaceOverrides = { showAttributes: false };
  await host.emit('message', { type: 'setting', key: 'showAttributes', value: true });
  assert.deepEqual(host.changes[0], { key: 'showAttributes', value: true, target: 2 });
  assert.ok(host.symbolProvider.provideDocumentSymbols(host.document, {})[0].children[0].name.includes('id="a"'));
  await host.emit('message', { type: 'setting', key: 'unrelated', value: true });
  assert.equal(host.changes.length, 1);
});

test('active editor changes, webview focus, document changes and close update the model', async t => {
  const host = createHost(); t.after(host.dispose);
  await host.emit('message', { type: 'ready' });
  await host.emit('active', undefined);
  host.provider.refresh();
  assert.equal(host.messages.at(-1).model.nodes.length, 3);
  await host.edit('<r><new/></r>');
  await new Promise(resolve => setTimeout(resolve, 250));
  assert.equal(host.messages.at(-1).model.nodes[1].name, 'new');
  await host.emit('active', { document: { languageId: 'javascript', uri: { path: '/app.js' } } });
  assert.equal(host.messages.at(-1).model, null);
  await host.emit('active', { document: host.document });
  await host.emit('close', host.document);
  assert.equal(host.messages.at(-1).model, null);
});

test('size limit produces actionable message rather than unbounded parsing', async t => {
  const host = createHost('<r>' + 'x'.repeat(1100000) + '</r>'); t.after(host.dispose);
  host.config.maxFileSizeMB = 1;
  await host.emit('message', { type: 'ready' });
  assert.equal(host.messages.at(-1).model.nodes.length, 0);
  assert.match(host.messages.at(-1).model.errors[0], /超过 1 MiB/);
});
