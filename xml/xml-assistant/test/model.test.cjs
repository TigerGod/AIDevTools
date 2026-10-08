const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseXml, symbolLabel } = require('../dist/model');
const { searchNodes } = require('../media/search');

test('nested elements, namespaces, self closing elements and statistics', () => {
  const model = parseXml('<r xmlns:p="urn:test"><p:item id="1"/><p:item id="2"><leaf/></p:item></r>');
  assert.deepEqual(model.errors, []);
  assert.deepEqual(model.roots, [0]);
  assert.deepEqual(model.nodes.map(n => [n.name, n.parent, n.children]), [
    ['r', null, [1, 2]], ['p:item', 0, []], ['p:item', 0, [3]], ['leaf', 2, []],
  ]);
  assert.equal(model.maxDepth, 3);
  assert.equal(model.statistics.find(t => t.name === 'p:item').count, 2);
});

test('UTF-16 ranges select the exact source element including astral Unicode', () => {
  const source = '\uFEFF<?xml version="1.0"?>\r\n<根><item title="😀 > &amp;">你好😀<子/></item><!-- <fake/> --></根>';
  const model = parseXml(source);
  assert.deepEqual(model.errors, []);
  for (const node of model.nodes) {
    assert.equal(source.slice(node.nameStart, node.nameEnd), node.name);
    assert.ok(source.slice(node.start, node.end).startsWith(`<${node.name}`));
    assert.ok(source.slice(node.start, node.end).endsWith('>'));
  }
  assert.equal(source.slice(model.nodes[1].start, model.nodes[1].end), '<item title="😀 > &amp;">你好😀<子/></item>');
  assert.equal(model.nodes[1].attributes[0].value, '😀 > &');
});

test('comments, instructions and DOCTYPE are excluded; CDATA and entities are text', () => {
  const source = '<!DOCTYPE r [<!ELEMENT r ANY>]><?check test?><r>A &amp; B<![CDATA[<not-a-tag/>]]><child>&#x1F600;</child>尾部</r>';
  const model = parseXml(source);
  assert.deepEqual(model.errors, []);
  assert.equal(model.nodes.length, 2);
  assert.equal(model.nodes[0].text, 'A & B<not-a-tag/>尾部');
  assert.equal(model.nodes[1].text, '😀');
});

test('external/custom entities are never expanded', () => {
  const model = parseXml('<!DOCTYPE r [<!ENTITY leak SYSTEM "file:///private.txt">]><r>&leak;</r>');
  assert.ok(model.errors.length);
  assert.equal(model.nodes[0].text, '&leak;');
});

test('incomplete and invalid XML keeps usable partial results with diagnostics', () => {
  for (const source of ['<r><child>text', '<r><x></r>', '<r a="1" a="2"/>', '<a/><b/>']) {
    const model = parseXml(source);
    assert.ok(model.errors.length, source);
    assert.ok(model.nodes.length, source);
  }
});

test('node limit stops processing and reports partial results', () => {
  const model = parseXml('<r><x/><x/><x/></r>', 3);
  assert.equal(model.nodes.length, 3);
  assert.ok(model.errors.some(error => error.includes('停止解析')));
});

test('deep trees do not depend on JavaScript recursive traversal', () => {
  const model = parseXml('<n>'.repeat(2500) + 'text' + '</n>'.repeat(2500));
  assert.equal(model.maxDepth, 2500);
  assert.deepEqual(model.errors, []);
});

test('labels default to tag names; optional properties contain all attributes and text', () => {
  const node = parseXml('<item a="1" b="2">hello\nworld</item>').nodes[0];
  assert.equal(symbolLabel(node, false, false), 'item');
  assert.equal(symbolLabel(node, true, true), 'item  a="1" b="2"  hello world');
});

const searchModel = parseXml('<root><Book code="AbC.12" status="ready">中文 &amp; text</Book><book code="AbC.34"><![CDATA[<demo/>]]></book></root>');
test('search finds tag names, attribute names, attribute values and decoded text independently of display', () => {
  for (const [query, ids] of [['book', [1, 2]], ['status', [1]], ['AbC.12', [1]], ['中文 &', [1]], ['<demo/>', [2]]]) {
    assert.deepEqual(searchNodes(searchModel.nodes, query, false, false).matches.map(m => m.id), ids);
  }
});

test('literal punctuation, case sensitivity, regex, invalid regex and zero-width regex', () => {
  assert.equal(searchNodes(searchModel.nodes, '.', false, false).matches.length, 2);
  assert.deepEqual(searchNodes(searchModel.nodes, 'Book', false, true).matches.map(m => m.id), [1]);
  assert.deepEqual(searchNodes(searchModel.nodes, '^AbC\\.\\d{2}$', true, true).matches.map(m => m.id), [1, 2]);
  assert.ok(searchNodes(searchModel.nodes, '[', true, false).error);
  assert.equal(searchNodes(searchModel.nodes, '^', true, false).matches.length, 3);
  assert.deepEqual(searchNodes(searchModel.nodes, '', false, false).matches, []);
  for (const query of ['[', '(', '\\', '*', '$', '^', '?', '+', '{', '|']) {
    assert.equal(searchNodes(searchModel.nodes, query, false, false).error, '');
  }
});
