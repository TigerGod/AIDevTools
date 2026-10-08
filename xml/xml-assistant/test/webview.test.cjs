const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { searchNodes } = require('../media/search');
const { createHost } = require('./host.cjs');
const { parseXml } = require('../dist/model');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function setup(t, source) {
  const host = createHost(source);
  const dom = new JSDOM(host.view.webview.html, { runScripts: 'outside-only', url: 'https://test.invalid/' });
  const { window } = dom;
  const messages = []; let state;
  window.acquireVsCodeApi = () => ({ getState: () => state, setState: value => { state = value; }, postMessage: value => { messages.push(value); host.emit('message', value); } });
  window.fetch = async () => ({ ok: true, text: async () => '' });
  window.URL.createObjectURL = () => 'blob:test'; window.URL.revokeObjectURL = () => {};
  window.scrollTo = () => {};
  window.Worker = class {
    postMessage(message) {
      if (message.type === 'init') { this.nodes = message.nodes; return; }
      setTimeout(() => {
        if (!this.dead) this.onmessage({ data: { request: message.request, ...searchNodes(this.nodes, message.query, message.regex, message.caseSensitive) } });
      }, 0);
    }
    terminate() { this.dead = true; }
  };
  host.view.onPost = message => window.dispatchEvent(new window.MessageEvent('message', { data: message }));
  window.eval(fs.readFileSync(path.join(__dirname, '../media/outline.js'), 'utf8'));
  t.after(() => { window.dispatchEvent(new window.Event('beforeunload')); dom.window.close(); host.dispose(); });
  return { host, window, messages, $: id => window.document.getElementById(id),
    rows: () => [...window.document.querySelectorAll('.tree-row')],
    query: async value => { const input = window.document.getElementById('search'); input.value = value; input.dispatchEvent(new window.Event('input')); await pause(230); },
  };
}

test('default tree, all attributes/text controls, navigation and keyboard expansion', async t => {
  const app = await setup(t);
  assert.equal(app.rows().length, 3);
  assert.equal(app.window.document.querySelector('.attributes'), null);
  app.$('settings-button').click();
  assert.equal(app.$('settings').hidden, false);
  app.$('show-attributes').click(); app.$('show-text').click();
  assert.equal(app.window.document.querySelectorAll('.attributes').length, 2);
  assert.equal(app.window.document.querySelector('.node-text').textContent, '中文');
  app.rows()[1].click();
  assert.equal(app.host.reveals.length, 1);
  app.$('collapse').click(); assert.equal(app.rows().length, 1);
  app.rows()[0].dispatchEvent(new app.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  assert.equal(app.rows().length, 3);
});

test('statistics hide only the selected category, promote children and retain counts', async t => {
  const app = await setup(t, '<root><group><item/></group><item/></root>');
  app.$('tags').querySelector('[data-tag="group"]').click();
  assert.deepEqual(app.rows().map(row => row.querySelector('.node-name').textContent), ['root', 'item', 'item']);
  assert.deepEqual(app.rows().map(row => row.getAttribute('aria-level')), ['1', '2', '2']);
  assert.deepEqual(app.rows().slice(1).map(row => row.getAttribute('aria-posinset')), ['1', '2']);
  assert.equal(app.rows()[1].getAttribute('aria-setsize'), '2');
  assert.match(app.$('tags').querySelector('[data-tag="item"]').textContent, /2/);
  app.$('reset-tags').click(); assert.equal(app.rows().length, 4);
  app.$('tags').querySelector('[data-tag="root"]').click();
  assert.deepEqual(app.rows().map(row => row.querySelector('.node-name').textContent), ['group', 'item', 'item']);
  assert.deepEqual(app.rows().map(row => row.getAttribute('aria-level')), ['1', '2', '1']);
  app.$('tags').querySelector('[data-tag="group"]').click();
  assert.deepEqual(app.rows().map(row => row.getAttribute('aria-level')), ['1', '1']);
  app.$('tags').querySelector('[data-tag="item"]').click();
  assert.equal(app.rows().length, 0); assert.equal(app.$('empty').hidden, false);
  app.$('tags').querySelector('[data-tag="root"]').click();
  assert.equal(app.rows().length, 1, 'showing a parent must not restore hidden categories');
  assert.equal(app.rows()[0].hasAttribute('aria-expanded'), false, 'no visible descendants means a leaf');
});

test('hidden collapsed ancestors do not fold promoted children; keyboard uses visible parents', async t => {
  const app = await setup(t, '<root><group><group><item/></group></group><other/></root>');
  app.rows()[1].querySelector('[data-toggle]').click();
  assert.equal(app.rows().length, 3);
  app.$('tags').querySelector('[data-tag="group"]').click();
  assert.deepEqual(app.rows().map(row => row.querySelector('.node-name').textContent), ['root', 'item', 'other']);
  assert.equal(app.rows()[1].getAttribute('aria-level'), '2');
  app.rows()[1].dispatchEvent(new app.window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
  assert.equal(app.window.document.activeElement, app.rows()[0]);
  app.rows()[0].dispatchEvent(new app.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  assert.equal(app.window.document.activeElement, app.rows()[1]);
  app.rows()[1].click();
  assert.equal(app.host.reveals.at(-1).options.selection.start.character, 21);
  app.$('tags').querySelector('[data-tag="group"]').click();
  assert.equal(app.rows().length, 3, 'restoring a node restores its own saved collapse state');
});

test('search reaches descendants through hidden ancestors and counts only visible matches', async t => {
  const app = await setup(t, '<root><group><item key="unique"/><other/></group></root>');
  app.$('tags').querySelector('[data-tag="group"]').click();
  await app.query('unique');
  assert.deepEqual(app.rows().map(row => row.querySelector('.node-name').textContent), ['root', 'item']);
  assert.equal(app.rows()[1].getAttribute('aria-level'), '2');
  assert.match(app.$('search-status').textContent, /1 个匹配/);
  app.$('tags').querySelector('[data-tag="root"]').click();
  assert.equal(app.rows()[0].getAttribute('aria-level'), '1');
  app.$('tags').querySelector('[data-tag="item"]').click();
  assert.match(app.$('search-status').textContent, /0 个匹配/);
  app.$('tags').querySelector('[data-tag="group"]').click();
  assert.equal(app.rows().length, 0, 'restoring another category does not restore hidden matches');
});

test('Maven XML category switches retain every other element and source order', async t => {
  const source = process.env.XML_TEST_FILE ? fs.readFileSync(process.env.XML_TEST_FILE, 'utf8')
    : '<project><build><plugins><plugin><artifactId>compiler</artifactId></plugin></plugins></build><dependencies><dependency><artifactId>junit</artifactId></dependency></dependencies></project>';
  const model = parseXml(source);
  const app = await setup(t, source);
  const hidden = new Set();
  for (const name of ['build', 'plugins', 'plugin', 'dependencies', 'dependency', 'project']) {
    app.$('tags').querySelector(`[data-tag="${name}"]`).click();
    hidden.add(name);
    assert.deepEqual(app.rows().map(row => Number(row.dataset.id)), model.nodes.filter(node => !hidden.has(node.name)).map(node => node.id));
  }
  app.$('reset-tags').click();
  assert.equal(app.rows().length, model.nodes.length);
});

test('search keeps ancestors, highlights attributes with display disabled, and reports regex errors', async t => {
  const app = await setup(t, '<root><group><item key="unique-value"/></group><other/></root>');
  app.$('collapse').click();
  await app.query('unique');
  assert.deepEqual(app.rows().map(row => row.querySelector('.node-name').textContent), ['root', 'group', 'item']);
  assert.equal(app.window.document.querySelector('mark').textContent, 'unique');
  assert.equal(app.window.document.querySelector('.attributes'), null);
  assert.match(app.$('search-status').textContent, /1 个匹配/);
  app.$('regex').click(); await app.query('[');
  assert.match(app.$('search-status').textContent, /正则表达式无效/);
  await app.query('no-such-tag'); assert.equal(app.rows().length, 0);
  app.$('search').dispatchEvent(new app.window.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal(app.rows().length, 1, 'original expansion state survives search');
});

test('XML content is rendered as text and cannot inject HTML', async t => {
  const app = await setup(t, '<root payload="&lt;img src=x onerror=alert(1)&gt;"><![CDATA[<script>alert(1)</script>]]></root>');
  app.$('show-attributes').click(); app.$('show-text').click();
  assert.equal(app.$('tree').querySelector('img,script'), null);
  assert.match(app.$('tree').textContent, /<script>alert\(1\)<\/script>/);
});

test('pagination bounds initial DOM size without losing nodes', async t => {
  const app = await setup(t, '<root>' + '<item/>'.repeat(1500) + '</root>');
  assert.equal(app.rows().length, 1000);
  assert.equal(app.$('load-more').hidden, false);
  app.$('load-more').click(); assert.equal(app.rows().length, 1501);
});

test('worker timeout is visible and restores an operable tree', async t => {
  const app = await setup(t);
  app.window.Worker = class { postMessage() {} terminate() {} };
  await app.query('(a+)+$');
  await pause(1050);
  assert.match(app.$('search-status').textContent, /搜索超时/);
  assert.equal(app.rows().length, 3);
});
