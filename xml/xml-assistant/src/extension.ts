import * as vscode from 'vscode';
import { randomBytes } from 'crypto';
import { parseXml, symbolLabel, XmlModel } from './model';

const xmlExtensions = /\.(xml|xsd|xsl|xslt|svg|wsdl|xaml|config|plist|resx|props|targets|csproj|vbproj|fsproj|nuspec)$/i;
const languages = ['xml', 'xsl', 'svg'];
function isXml(document: vscode.TextDocument): boolean {
  return languages.includes(document.languageId) || xmlExtensions.test(document.uri.path);
}

class Models {
  private cache?: { uri: string; version: number; limit: number; model: XmlModel };
  get(document: vscode.TextDocument): XmlModel {
    const uri = document.uri.toString();
    const limit = vscode.workspace.getConfiguration('xmlAssistant', document.uri).get<number>('maxFileSizeMB', 20);
    if (this.cache?.uri === uri && this.cache.version === document.version && this.cache.limit === limit) return this.cache.model;
    const source = document.getText();
    const model = Buffer.byteLength(source, 'utf8') > limit * 1024 * 1024
      ? { nodes: [], roots: [], statistics: [], maxDepth: 0, errors: [`文件超过 ${limit} MiB，请在 XML Assistant 设置中调整大小上限。`] }
      : parseXml(source);
    this.cache = { uri, version: document.version, limit, model };
    return model;
  }
  clear() { this.cache = undefined; }
}

class OutlineView implements vscode.WebviewViewProvider, vscode.Disposable {
  private view?: vscode.WebviewView;
  private document?: vscode.TextDocument;
  private timer?: ReturnType<typeof setTimeout>;
  private disposables: vscode.Disposable[] = [];
  constructor(private extensionUri: vscode.Uri, private models: Models) {
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(editor => {
        // Moving focus into the webview must not discard the associated XML document.
        if (editor) {
          this.document = isXml(editor.document) ? editor.document : undefined;
          this.refresh();
        }
      }),
      vscode.workspace.onDidChangeTextDocument(event => {
        if (event.document === this.document) this.schedule();
      }),
      vscode.workspace.onDidCloseTextDocument(document => {
        if (document === this.document) { this.document = undefined; this.refresh(); }
      }),
      vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('xmlAssistant')) this.refresh();
      }),
    );
  }
  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view;
    const media = vscode.Uri.joinPath(this.extensionUri, 'media');
    view.webview.options = { enableScripts: true, localResourceRoots: [media] };
    const nonce = randomBytes(16).toString('hex');
    const resource = (name: string) => view.webview.asWebviewUri(vscode.Uri.joinPath(media, name)).toString();
    view.webview.html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${view.webview.cspSource}; script-src 'nonce-${nonce}'; worker-src blob:; connect-src ${view.webview.cspSource}; img-src ${view.webview.cspSource};">
      <link rel="stylesheet" href="${resource('outline.css')}"><title>XML 大纲</title></head>
      <body data-worker="${resource('search.js')}">
      <header>
        <div class="search-bar"><span class="search-icon" aria-hidden="true">⌕</span><input id="search" type="search" placeholder="搜索标签、属性、文本…" aria-label="搜索标签、属性和文本" autocomplete="off" spellcheck="false"><button id="case" class="mode" aria-label="区分大小写" title="区分大小写" aria-pressed="false">Aa</button><button id="regex" class="mode" aria-label="使用正则表达式" title="使用正则表达式" aria-pressed="false">.*</button></div>
        <div id="search-status" class="status" role="status" aria-live="polite"></div>
        <div class="section-label"><span>标签统计 <span id="tag-total"></span></span><button id="reset-tags" class="text-button" title="恢复全部标签">全部显示</button></div>
        <div id="tags" class="tags" aria-label="标签统计及显示筛选"></div>
        <div id="summary" class="summary"></div>
        <div class="toolbar"><span id="filename" title="当前 XML 文件">XML 大纲</span><div><button id="expand" title="展开全部" aria-label="展开全部">⊞</button><button id="collapse" title="折叠全部" aria-label="折叠全部">⊟</button><button id="settings-button" title="显示设置" aria-label="显示设置" aria-expanded="false">⚙</button></div></div>
        <section id="settings" class="settings" aria-label="显示设置" hidden><label><input type="checkbox" id="show-attributes"> 显示所有属性</label><label><input type="checkbox" id="show-text"> 显示文本内容</label><p>对所有层级生效 · 自动保存</p><button id="all-settings" class="text-button">更多设置 ↗</button></section>
      </header>
      <div id="errors" class="errors" role="status" hidden></div>
      <main id="tree" role="tree" aria-label="XML 标签树" tabindex="0"></main>
      <div id="empty" class="empty">打开 XML 文件，查看标签结构与统计。</div>
      <button id="load-more" class="load-more" hidden>显示更多节点</button>
      <footer>点击标签定位源码 · 按类别独立隐藏 / 显示标签，保留子节点</footer>
      <script nonce="${nonce}" src="${resource('outline.js')}"></script></body></html>`;
    this.disposables.push(view.webview.onDidReceiveMessage(async message => {
      if (!message || typeof message !== 'object') return;
      try {
        switch (message.type) {
          case 'ready': this.refresh(); break;
          case 'reveal': await this.reveal(message); break;
          case 'setting':
            if (['showAttributes', 'showText'].includes(message.key) && typeof message.value === 'boolean') {
              const configuration = vscode.workspace.getConfiguration('xmlAssistant', this.document?.uri);
              const inspected = configuration.inspect(message.key);
              const target = inspected?.workspaceFolderValue !== undefined ? vscode.ConfigurationTarget.WorkspaceFolder
                : inspected?.workspaceValue !== undefined ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
              await configuration.update(message.key, message.value, target);
              this.refresh();
            }
            break;
          case 'settings': await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:xml-assistant-local.xml-assistant'); break;
        }
      } catch (error) {
        void vscode.window.showErrorMessage(`XML Assistant: ${error instanceof Error ? error.message : String(error)}`);
        this.refresh();
      }
    }), view.onDidChangeVisibility(() => { if (view.visible) this.refresh(); }));
    const editor = vscode.window.activeTextEditor;
    if (editor) this.document = isXml(editor.document) ? editor.document : undefined;
  }
  private async reveal(message: { id?: unknown; uri?: unknown; version?: unknown }) {
    const document = this.document;
    if (!document || document.isClosed || document.uri.toString() !== message.uri || document.version !== message.version || typeof message.id !== 'number') return;
    const node = this.models.get(document).nodes[message.id];
    if (!node) return;
    const range = new vscode.Range(document.positionAt(node.nameStart), document.positionAt(node.nameEnd));
    const editor = await vscode.window.showTextDocument(document, { preserveFocus: true, preview: true, selection: range });
    editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  }
  private schedule() { clearTimeout(this.timer); this.timer = setTimeout(() => this.refresh(), 200); }
  refresh() {
    clearTimeout(this.timer);
    if (!this.view?.visible) return;
    const document = this.document;
    const configuration = vscode.workspace.getConfiguration('xmlAssistant', document?.uri);
    void this.view.webview.postMessage({
      type: 'model', uri: document?.uri.toString() ?? '', version: document?.version ?? 0,
      parseLimit: configuration.get('maxFileSizeMB', 20),
      filename: document ? document.uri.path.split('/').at(-1) : '',
      model: document ? this.models.get(document) : null,
      settings: { showAttributes: configuration.get('showAttributes', false), showText: configuration.get('showText', false) },
    });
  }
  dispose() { clearTimeout(this.timer); this.disposables.forEach(disposable => disposable.dispose()); }
}

export function activate(context: vscode.ExtensionContext) {
  const models = new Models();
  const view = new OutlineView(context.extensionUri, models);
  const selectors: vscode.DocumentSelector = [
    ...languages.map(language => ({ language })),
    { pattern: '**/*.{xml,xsd,xsl,xslt,svg,wsdl,xaml,config,plist,resx,props,targets,csproj,vbproj,fsproj,nuspec}' },
  ];
  const registerSymbols = () => vscode.languages.registerDocumentSymbolProvider(selectors, {
      provideDocumentSymbols(document, token) {
        const model = models.get(document);
        if (token.isCancellationRequested) return [];
        const config = vscode.workspace.getConfiguration('xmlAssistant', document.uri);
        const symbols = model.nodes.map(node => new vscode.DocumentSymbol(
          symbolLabel(node, config.get('showAttributes', false), config.get('showText', false)), '',
          vscode.SymbolKind.Object,
          new vscode.Range(document.positionAt(node.start), document.positionAt(Math.max(node.end, node.nameEnd))),
          new vscode.Range(document.positionAt(node.nameStart), document.positionAt(node.nameEnd)),
        ));
        for (const node of model.nodes) symbols[node.id].children = node.children.map(id => symbols[id]);
        return model.roots.map(id => symbols[id]);
      },
    }, { label: 'XML Assistant' });
  let symbolRegistration = registerSymbols();
  context.subscriptions.push(view,
    vscode.window.registerWebviewViewProvider('xmlAssistant.outline', view),
    new vscode.Disposable(() => symbolRegistration.dispose()),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('xmlAssistant')) {
        // Re-registration invalidates VS Code's native Outline symbol cache.
        symbolRegistration.dispose();
        symbolRegistration = registerSymbols();
      }
    }),
    vscode.commands.registerCommand('xmlAssistant.focus', () => vscode.commands.executeCommand('xmlAssistant.outline.focus')),
    vscode.commands.registerCommand('xmlAssistant.settings', () => vscode.commands.executeCommand('workbench.action.openSettings', '@ext:xml-assistant-local.xml-assistant')),
    vscode.commands.registerCommand('xmlAssistant.refresh', () => { models.clear(); view.refresh(); }),
  );
}
