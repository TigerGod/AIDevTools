import { SaxesParser } from 'saxes';

export interface XmlNode {
  id: number;
  name: string;
  attributes: { name: string; value: string }[];
  text: string;
  parent: number | null;
  children: number[];
  start: number;
  nameStart: number;
  nameEnd: number;
  end: number;
  depth: number;
}
export interface XmlModel {
  nodes: XmlNode[];
  roots: number[];
  statistics: { name: string; count: number }[];
  errors: string[];
  maxDepth: number;
}

/** SAX parsing preserves UTF-16 offsets for VS Code and never resolves external entities. */
export function parseXml(source: string, maxNodes = 100_000): XmlModel {
  const nodes: XmlNode[] = [];
  const roots: number[] = [];
  const stack: XmlNode[] = [];
  const counts = new Map<string, number>();
  const errors: string[] = [];
  let maxDepth = 0;
  let tagStart = 0;
  const parser = new SaxesParser({ xmlns: false, position: true });
  parser.on('error', error => { if (errors.length < 8) errors.push(error.message); });
  parser.on('opentagstart', () => { tagStart = source.lastIndexOf('<', parser.position - 1); });
  parser.on('opentag', tag => {
    if (nodes.length >= maxNodes) throw new Error(`标签数量超过 ${maxNodes.toLocaleString()}，已停止解析；当前显示部分结果。`);
    const parent = stack.at(-1);
    const node: XmlNode = {
      id: nodes.length, name: tag.name,
      attributes: Object.entries(tag.attributes).map(([name, value]) => ({ name, value: String(value) })),
      text: '', parent: parent?.id ?? null, children: [],
      start: tagStart, nameStart: tagStart + 1, nameEnd: tagStart + 1 + tag.name.length,
      end: parser.position, depth: stack.length,
    };
    nodes.push(node);
    if (parent) parent.children.push(node.id); else roots.push(node.id);
    counts.set(node.name, (counts.get(node.name) ?? 0) + 1);
    maxDepth = Math.max(maxDepth, node.depth + 1);
    stack.push(node);
  });
  parser.on('closetag', () => { const node = stack.pop(); if (node) node.end = parser.position; });
  const appendText = (value: string) => { const node = stack.at(-1); if (node) node.text += value; };
  parser.on('text', appendText);
  parser.on('cdata', appendText);
  try { parser.write(source).close(); }
  catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
  for (const node of stack) node.end = source.length;
  for (const node of nodes) node.text = node.text.trim();
  return {
    nodes, roots, errors, maxDepth,
    statistics: Array.from(counts, ([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
  };
}

export function symbolLabel(node: XmlNode, attributes: boolean, text: boolean): string {
  return [node.name,
    attributes ? node.attributes.map(attribute => `${attribute.name}="${attribute.value}"`).join(' ') : '',
    text ? node.text.replace(/\s+/g, ' ') : '',
  ].filter(Boolean).join('  ');
}
