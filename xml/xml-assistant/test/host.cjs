const Module = require('node:module');
function createHost(source = '<root><book id="a">中文</book><book id="b"/></root>') {
  const listeners = {}, messages = [], commands = new Map(), changes = [], reveals = [];
  const config = { showAttributes: false, showText: false, maxFileSizeMB: 20 };
  const disposable = () => ({ dispose() {} });
  const event = name => callback => { (listeners[name] ||= []).push(callback); return disposable(); };
  const emit = (name, value) => Promise.all((listeners[name] || []).map(fn => fn(value)));
  const uri = { path: '/workspace/test.xml', toString: () => 'file:///workspace/test.xml' };
  const document = {
    uri, languageId: 'xml', version: 1, isClosed: false,
    getText: () => source,
    positionAt: offset => ({ line: 0, character: Math.min(Math.max(0, offset), source.length) }),
  };
  let provider, symbolProvider;
  const vscode = {
    Disposable: class { constructor(callback) { this.dispose = callback; } },
    Uri: { joinPath: (base, ...parts) => ({ path: `${base.path}/${parts.join('/')}`, toString() { return this.path; } }) },
    Range: class { constructor(start, end) { this.start = start; this.end = end; } },
    DocumentSymbol: class { constructor(name, detail, kind, range, selectionRange) { Object.assign(this, { name, detail, kind, range, selectionRange, children: [] }); } },
    SymbolKind: { Object: 18 }, TextEditorRevealType: { InCenterIfOutsideViewport: 2 },
    ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
    workspace: {
      getConfiguration: () => ({
        get: (key, fallback) => config[key] ?? fallback,
        inspect: key => ({ workspaceValue: config.workspaceOverrides?.[key] }),
        update: async (key, value, target) => { config[key] = value; changes.push({ key, value, target }); },
      }),
      onDidChangeTextDocument: event('text'), onDidCloseTextDocument: event('close'), onDidChangeConfiguration: event('config'),
    },
    window: {
      activeTextEditor: { document }, onDidChangeActiveTextEditor: event('active'),
      registerWebviewViewProvider: (id, instance) => { provider = instance; return disposable(); },
      showTextDocument: async (doc, options) => { reveals.push({ doc, options }); return { revealRange() {} }; },
      showErrorMessage: async text => { throw new Error(text); },
    },
    languages: { registerDocumentSymbolProvider: (selector, instance) => { symbolProvider = instance; return disposable(); } },
    commands: {
      registerCommand: (id, callback) => { commands.set(id, callback); return disposable(); },
      executeCommand: async (...args) => { changes.push({ command: args }); },
    },
  };
  const originalLoad = Module._load;
  Module._load = function (id, ...args) { return id === 'vscode' ? vscode : originalLoad.call(this, id, ...args); };
  const extensionPath = require.resolve('../dist/extension');
  delete require.cache[extensionPath];
  const context = { extensionUri: { path: 'extension' }, subscriptions: [] };
  try { require(extensionPath).activate(context); } finally { Module._load = originalLoad; }
  const view = {
    visible: true, onDidChangeVisibility: event('visibility'),
    webview: {
      html: '', cspSource: 'https://test.invalid', asWebviewUri: uri => uri,
      onDidReceiveMessage: event('message'),
      postMessage: async message => { messages.push(message); if (view.onPost) view.onPost(message); return true; },
    },
  };
  provider.resolveWebviewView(view);
  return { vscode, document, view, emit, messages, config, changes, reveals, commands, provider,
    get symbolProvider() { return symbolProvider; },
    edit: value => { source = value; document.version++; return emit('text', { document }); },
    dispose: () => context.subscriptions.forEach(item => item.dispose()),
  };
}
module.exports = { createHost };
