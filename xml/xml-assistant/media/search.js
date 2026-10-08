/* Shared between the isolated Web Worker and Node's regression tests. */
(function (scope) {
  'use strict';
  function searchNodes(nodes, query, regex, caseSensitive) {
    if (!query) return { matches: [], error: '' };
    let expression;
    try {
      expression = new RegExp(regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), caseSensitive ? 'u' : 'iu');
    } catch (error) { return { matches: [], error: `正则表达式无效：${error.message}` }; }
    const matches = [];
    for (const node of nodes) {
      const fields = [{ kind: '标签', value: node.name }];
      for (const attribute of node.attributes) {
        fields.push({ kind: '属性名', value: attribute.name }, { kind: `@${attribute.name}`, value: attribute.value });
      }
      fields.push({ kind: '文本', value: node.text });
      for (const field of fields) {
        const match = expression.exec(field.value);
        if (!match) continue;
        const start = Math.max(0, match.index - 30);
        const end = Math.min(field.value.length, match.index + match[0].length + 60);
        matches.push({ id: node.id, kind: field.kind,
          before: (start > 0 ? '…' : '') + field.value.slice(start, match.index),
          hit: match[0].slice(0, 160),
          after: (match[0].length > 160 ? '…' : '') + field.value.slice(match.index + match[0].length, end) + (end < field.value.length ? '…' : ''),
        });
        break;
      }
    }
    return { matches, error: '' };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { searchNodes };
  if (typeof scope.importScripts === 'function') {
    let nodes = [];
    scope.onmessage = event => {
      if (event.data.type === 'init') { nodes = event.data.nodes; return; }
      const { request, query, regex, caseSensitive } = event.data;
      scope.postMessage({ request, ...searchNodes(nodes, query, regex, caseSensitive) });
    };
  }
})(typeof self === 'undefined' ? globalThis : self);
