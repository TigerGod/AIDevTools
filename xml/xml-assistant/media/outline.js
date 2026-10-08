(function () {
  'use strict';
  const vscode = acquireVsCodeApi();
  const $ = id => document.getElementById(id);
  const saved = vscode.getState() || {};
  let documents = saved.documents || {};
  let uri = '', version = 0, parseLimit = 0, model = null;
  let settings = { showAttributes: false, showText: false };
  let hidden = new Set(), collapsed = new Set(), searchCollapsed = new Set();
  let matches = null, searchError = '', searching = false;
  let worker = null, workerSource = null, workerGeneration = 0, request = 0;
  let timeout, debounce, visibleIds = [], selected = null, pageSize = 1000;
  let treeEntries = new Map();
  let regex = Boolean(saved.regex), caseSensitive = Boolean(saved.caseSensitive);
  $('search').value = saved.query || '';
  $('regex').setAttribute('aria-pressed', String(regex));
  $('case').setAttribute('aria-pressed', String(caseSensitive));

  function save() {
    if (uri) documents[uri] = { hidden: [...hidden], collapsed: [...collapsed] };
    const keys = Object.keys(documents);
    if (keys.length > 20) for (const key of keys.slice(0, keys.length - 20)) delete documents[key];
    vscode.setState({ query: $('search').value, regex, caseSensitive, documents });
  }
  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function color(name) {
    let hash = 0;
    for (const character of name) hash = (hash * 31 + character.codePointAt(0)) | 0;
    return `color-${(hash >>> 0) % 8}`;
  }
  function stopWorker() {
    workerGeneration++;
    if (worker) worker.terminate();
    worker = null;
    clearTimeout(timeout);
  }
  async function getWorker() {
    if (worker) return worker;
    const generation = workerGeneration;
    if (!workerSource) {
      const response = await fetch(document.body.dataset.worker);
      if (!response.ok) throw new Error('无法加载搜索模块');
      workerSource = await response.text();
    }
    if (generation !== workerGeneration) return null;
    if (worker) return worker;
    const url = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
    try { worker = new Worker(url); } finally { URL.revokeObjectURL(url); }
    worker.postMessage({ type: 'init', nodes: model?.nodes || [] });
    worker.onmessage = event => {
      if (event.data.request !== request) return;
      clearTimeout(timeout);
      matches = event.data.error ? null : new Map(event.data.matches.map(match => [match.id, match]));
      searchError = event.data.error;
      searching = false;
      renderTree();
    };
    worker.onerror = () => failSearch('搜索模块运行失败，请修改搜索内容后重试。');
    return worker;
  }
  function failSearch(message) {
    stopWorker();
    searchError = message; searching = false; matches = null;
    renderTree();
  }
  async function search() {
    clearTimeout(debounce);
    clearTimeout(timeout);
    const current = ++request;
    const query = $('search').value;
    searchError = ''; matches = null; searchCollapsed.clear(); pageSize = 1000;
    // Discard any in-flight expression before issuing another query.
    if (searching) stopWorker();
    searching = Boolean(query && model);
    save(); renderTree();
    if (!searching) return;
    try {
      const target = await getWorker();
      if (!target || current !== request) return;
      target.postMessage({ type: 'search', request: current, query, regex, caseSensitive });
      timeout = setTimeout(() => {
        if (current === request) failSearch('搜索超时（1 秒），请简化正则表达式或缩小搜索范围。');
      }, 1000);
    } catch (error) {
      if (current === request) failSearch(`搜索不可用：${error.message}`);
    }
  }
  function renderTags() {
    const fragment = document.createDocumentFragment();
    for (const tag of model?.statistics || []) {
      const button = element('button', `tag-chip ${color(tag.name)}${hidden.has(tag.name) ? ' is-hidden' : ''}`);
      button.dataset.tag = tag.name;
      button.setAttribute('aria-pressed', String(!hidden.has(tag.name)));
      button.setAttribute('aria-label', `${tag.name}，${tag.count} 个，${hidden.has(tag.name) ? '已隐藏，点击显示' : '已显示，点击隐藏该类标签'}`);
      button.title = `${tag.name} · ${tag.count} 个\n点击${hidden.has(tag.name) ? '显示' : '隐藏'}该类标签，其他类别的子节点保持显示`;
      button.append(element('span', 'dot', '●'), element('span', 'tag-name', tag.name), element('span', 'tag-count', String(tag.count)));
      fragment.append(button);
    }
    $('tags').replaceChildren(fragment);
    $('tag-total').textContent = model ? `${model.statistics.length} 类` : '';
    $('summary').textContent = model ? `${model.nodes.length.toLocaleString()} 个标签 · ${model.maxDepth} 层${hidden.size ? ` · 隐藏 ${hidden.size} 类` : ''}` : '';
    $('reset-tags').disabled = hidden.size === 0;
  }
  function reveal(id) {
    selected = id;
    for (const row of $('tree').children) row.setAttribute('aria-selected', String(Number(row.dataset.id) === id));
    vscode.postMessage({ type: 'reveal', id, uri, version });
  }
  function rowFor(node, entry, expanded) {
    const row = element('div', `tree-row ${color(node.name)}${matches?.has(node.id) ? ' match' : ''}`);
    row.dataset.id = String(node.id);
    row.id = `node-${node.id}`;
    row.setAttribute('role', 'treeitem');
    row.setAttribute('aria-level', String(entry.depth + 1));
    row.setAttribute('aria-selected', String(selected === node.id));
    row.setAttribute('aria-setsize', String(entry.siblings.length));
    row.setAttribute('aria-posinset', String(entry.position));
    if (entry.children.length) row.setAttribute('aria-expanded', String(expanded));
    row.tabIndex = selected === node.id ? 0 : -1;
    row.setAttribute('aria-label', node.name);
    row.title = [node.name, ...node.attributes.map(a => `${a.name}="${a.value}"`), node.text].filter(Boolean).join('\n');
    const indent = element('span', 'indent');
    for (let i = 0; i < Math.min(entry.depth, 24); i++) indent.append(element('span', 'indent-step'));
    const toggle = element('span', `chevron${entry.children.length ? '' : ' leaf'}`, expanded ? '⌄' : '›');
    toggle.dataset.toggle = 'true'; toggle.setAttribute('aria-hidden', 'true');
    const icon = element('span', 'node-icon', entry.children.length ? '◇' : '‹›');
    icon.setAttribute('aria-hidden', 'true');
    const content = element('span', 'node-content');
    content.append(element('span', 'node-name', node.name));
    if (settings.showAttributes && node.attributes.length) {
      const attributes = element('span', 'attributes');
      for (const attribute of node.attributes) {
        const item = element('span', 'attribute');
        item.append(element('span', 'attribute-name', attribute.name), document.createTextNode(`="${attribute.value}"`));
        attributes.append(item);
      }
      content.append(attributes);
    }
    if (settings.showText && node.text) content.append(element('span', 'node-text', node.text));
    const match = matches?.get(node.id);
    if (match) {
      const detail = element('span', 'match-detail');
      detail.append(document.createTextNode(`${match.kind} · ${match.before}`), element('mark', '', match.hit || '∅'), document.createTextNode(match.after));
      content.append(detail);
    }
    row.append(indent, toggle, icon, content);
    return row;
  }
  function renderTree(focusId) {
    const tree = $('tree');
    const scroll = window.scrollY;
    const nodes = model?.nodes || [];
    const included = new Uint8Array(nodes.length), folded = new Uint8Array(nodes.length);
    let matchCount = 0;
    for (const node of nodes) {
      if (!hidden.has(node.name) && (!matches || matches.has(node.id))) {
        included[node.id] = 1;
        if (matches) matchCount++;
      }
    }
    for (let i = nodes.length - 1; i >= 0; i--) {
      if (included[i] && nodes[i].parent !== null) included[nodes[i].parent] = 1;
    }
    // Project through hidden ancestors without changing source IDs or source ranges.
    // Hidden nodes cannot suppress descendants through either filtering or collapse state.
    treeEntries = new Map();
    const roots = [], nearest = new Int32Array(nodes.length).fill(-1);
    for (const node of nodes) {
      const parentId = node.parent === null ? -1 : nearest[node.parent];
      nearest[node.id] = parentId;
      if (!included[node.id] || hidden.has(node.name)) continue;
      const parent = treeEntries.get(parentId);
      const siblings = parent ? parent.children : roots;
      siblings.push(node.id);
      treeEntries.set(node.id, {
        parent: parentId === -1 ? null : parentId, depth: parent ? parent.depth + 1 : 0,
        children: [], siblings, position: siblings.length,
      });
      nearest[node.id] = node.id;
    }
    const collapseSet = matches ? searchCollapsed : collapsed;
    visibleIds = [];
    const fragment = document.createDocumentFragment();
    for (const [id, entry] of treeEntries) {
      folded[id] = Number(entry.parent !== null && (folded[entry.parent] || collapseSet.has(entry.parent)));
      if (folded[id]) continue;
      visibleIds.push(id);
      if (visibleIds.length <= pageSize) {
        fragment.append(rowFor(nodes[id], entry, !collapseSet.has(id)));
      }
    }
    tree.replaceChildren(fragment);
    const first = tree.querySelector('.tree-row');
    if (first && !tree.querySelector('[tabindex="0"]')) first.tabIndex = 0;
    tree.tabIndex = first ? -1 : 0;
    $('empty').hidden = Boolean(first);
    $('empty').textContent = !model ? '打开 XML 文件，查看标签结构与统计。'
      : hidden.size && !visibleIds.length ? '当前筛选下没有可见标签，试试“全部显示”。'
      : matches && !visibleIds.length ? '没有匹配的标签、属性或文本。' : '文件中没有可显示的 XML 标签。';
    $('load-more').hidden = visibleIds.length <= pageSize;
    $('load-more').textContent = `显示更多（已显示 ${Math.min(pageSize, visibleIds.length)} / ${visibleIds.length}）`;
    $('search-status').textContent = searchError || (searching ? '正在搜索…' : matches ? `${matchCount} 个匹配标签 · 保留祖先层级` : '标签名 / 属性名 / 属性值 / 文本');
    $('search-status').classList.toggle('error', Boolean(searchError));
    $('search').setAttribute('aria-invalid', String(Boolean(searchError)));
    if (focusId !== undefined) $(`node-${focusId}`)?.focus();
    else if (window.scrollTo) window.scrollTo(0, scroll);
  }
  function toggle(id) {
    const set = matches ? searchCollapsed : collapsed;
    if (set.has(id)) set.delete(id); else set.add(id);
    save(); renderTree(id);
  }
  $('tags').addEventListener('click', event => {
    const button = event.target.closest('[data-tag]');
    if (!button) return;
    const name = button.dataset.tag;
    if (hidden.has(name)) hidden.delete(name); else hidden.add(name);
    pageSize = 1000; save(); renderTags(); renderTree();
    [...$('tags').children].find(item => item.dataset.tag === name)?.focus();
  });
  $('reset-tags').addEventListener('click', () => { hidden.clear(); save(); renderTags(); renderTree(); });
  $('search').addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(search, 180); });
  $('search').addEventListener('keydown', event => {
    if (event.key === 'Escape') { $('search').value = ''; search(); }
    if (event.key === 'ArrowDown') { event.preventDefault(); $('tree').firstElementChild?.focus(); }
  });
  $('regex').addEventListener('click', () => { regex = !regex; $('regex').setAttribute('aria-pressed', String(regex)); search(); });
  $('case').addEventListener('click', () => { caseSensitive = !caseSensitive; $('case').setAttribute('aria-pressed', String(caseSensitive)); search(); });
  $('expand').addEventListener('click', () => { (matches ? searchCollapsed : collapsed).clear(); save(); renderTree(); });
  $('collapse').addEventListener('click', () => {
    const set = matches ? searchCollapsed : collapsed;
    for (const [id, entry] of treeEntries) if (entry.children.length) set.add(id);
    save(); renderTree();
  });
  $('settings-button').addEventListener('click', () => {
    $('settings').hidden = !$('settings').hidden;
    $('settings-button').setAttribute('aria-expanded', String(!$('settings').hidden));
  });
  for (const [id, key] of [['show-attributes', 'showAttributes'], ['show-text', 'showText']]) {
    $(id).addEventListener('change', () => {
      settings[key] = $(id).checked; renderTree();
      vscode.postMessage({ type: 'setting', key, value: $(id).checked });
    });
  }
  $('all-settings').addEventListener('click', () => vscode.postMessage({ type: 'settings' }));
  $('tree').addEventListener('click', event => {
    const row = event.target.closest('[data-id]');
    if (!row) return;
    const id = Number(row.dataset.id);
    if (event.target.closest('[data-toggle]') && treeEntries.get(id)?.children.length) toggle(id);
    else { reveal(id); row.focus(); }
  });
  $('tree').addEventListener('keydown', event => {
    const row = event.target.closest('[data-id]');
    if (!row) return;
    const id = Number(row.dataset.id), entry = treeEntries.get(id);
    const index = visibleIds.indexOf(id), set = matches ? searchCollapsed : collapsed;
    let target;
    switch (event.key) {
      case 'ArrowDown': target = visibleIds[Math.min(index + 1, visibleIds.length - 1)]; break;
      case 'ArrowUp': target = visibleIds[Math.max(0, index - 1)]; break;
      case 'Home': target = visibleIds[0]; break;
      case 'End': target = visibleIds.at(-1); break;
      case 'ArrowRight': if (entry.children.length && set.has(id)) toggle(id); else if (entry.children.length) target = entry.children[0]; break;
      case 'ArrowLeft': if (entry.children.length && !set.has(id)) toggle(id); else target = entry.parent; break;
      case 'Enter': case ' ': reveal(id); break;
      default: return;
    }
    event.preventDefault();
    if (target !== undefined && target !== null) {
      const position = visibleIds.indexOf(target);
      if (position >= pageSize) { pageSize = position + 1; renderTree(); }
      $(`node-${target}`)?.focus();
    }
  });
  $('load-more').addEventListener('click', () => { pageSize += 1000; renderTree(); });
  window.addEventListener('message', event => {
    const message = event.data;
    if (message.type !== 'model') return;
    const changedDocument = uri !== message.uri;
    const changedContent = changedDocument || version !== message.version || parseLimit !== message.parseLimit;
    if (changedDocument) {
      save(); uri = message.uri;
      const state = documents[uri] || {};
      hidden = new Set(state.hidden || []); collapsed = new Set(state.collapsed || []);
      selected = null;
    } else if (changedContent) {
      // Numeric node IDs can change when elements are inserted or removed.
      collapsed.clear(); selected = null;
    }
    version = message.version; parseLimit = message.parseLimit; model = message.model; settings = message.settings;
    const names = new Set(model?.statistics.map(tag => tag.name) || []);
    hidden = new Set([...hidden].filter(name => names.has(name)));
    $('filename').textContent = message.filename || 'XML 大纲';
    $('filename').title = uri || '当前 XML 文件';
    $('show-attributes').checked = settings.showAttributes;
    $('show-text').checked = settings.showText;
    $('errors').hidden = !model?.errors.length;
    $('errors').textContent = model?.errors.length ? `XML 解析提示（以下可能是部分结果）\n${model.errors.join('\n')}` : '';
    renderTags();
    if (changedContent || !worker) { stopWorker(); search(); } else renderTree();
  });
  window.addEventListener('beforeunload', stopWorker);
  vscode.postMessage({ type: 'ready' });
})();
