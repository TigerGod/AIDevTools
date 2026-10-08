"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseXml = parseXml;
exports.symbolLabel = symbolLabel;
const saxes_1 = require("saxes");
/** SAX parsing preserves UTF-16 offsets for VS Code and never resolves external entities. */
function parseXml(source, maxNodes = 100_000) {
    const nodes = [];
    const roots = [];
    const stack = [];
    const counts = new Map();
    const errors = [];
    let maxDepth = 0;
    let tagStart = 0;
    const parser = new saxes_1.SaxesParser({ xmlns: false, position: true });
    parser.on('error', error => { if (errors.length < 8)
        errors.push(error.message); });
    parser.on('opentagstart', () => { tagStart = source.lastIndexOf('<', parser.position - 1); });
    parser.on('opentag', tag => {
        if (nodes.length >= maxNodes)
            throw new Error(`标签数量超过 ${maxNodes.toLocaleString()}，已停止解析；当前显示部分结果。`);
        const parent = stack.at(-1);
        const node = {
            id: nodes.length, name: tag.name,
            attributes: Object.entries(tag.attributes).map(([name, value]) => ({ name, value: String(value) })),
            text: '', parent: parent?.id ?? null, children: [],
            start: tagStart, nameStart: tagStart + 1, nameEnd: tagStart + 1 + tag.name.length,
            end: parser.position, depth: stack.length,
        };
        nodes.push(node);
        if (parent)
            parent.children.push(node.id);
        else
            roots.push(node.id);
        counts.set(node.name, (counts.get(node.name) ?? 0) + 1);
        maxDepth = Math.max(maxDepth, node.depth + 1);
        stack.push(node);
    });
    parser.on('closetag', () => { const node = stack.pop(); if (node)
        node.end = parser.position; });
    const appendText = (value) => { const node = stack.at(-1); if (node)
        node.text += value; };
    parser.on('text', appendText);
    parser.on('cdata', appendText);
    try {
        parser.write(source).close();
    }
    catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
    }
    for (const node of stack)
        node.end = source.length;
    for (const node of nodes)
        node.text = node.text.trim();
    return {
        nodes, roots, errors, maxDepth,
        statistics: Array.from(counts, ([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    };
}
function symbolLabel(node, attributes, text) {
    return [node.name,
        attributes ? node.attributes.map(attribute => `${attribute.name}="${attribute.value}"`).join(' ') : '',
        text ? node.text.replace(/\s+/g, ' ') : '',
    ].filter(Boolean).join('  ');
}
//# sourceMappingURL=model.js.map