# XML Assistant

A colorful XML outline for VS Code 1.90+, with tag statistics, text/attribute controls, and literal or regular-expression search. The current UI is in Chinese; see the [full user guide](./README.md).

Install the generated VSIX through **Extensions → Install from VSIX**, open an XML file, then expand **XML 大纲** in Explorer. The command **XML Assistant: 打开 XML 大纲** focuses the view.

- All levels show tag names by default. The gear menu enables all attributes and/or direct text content, including CDATA.
- Search tag names, attribute names, attribute values and text regardless of display settings. Toggle `.*` for regex and `Aa` for case sensitivity. Matches retain their ancestors and show a highlighted excerpt.
- Colored chips count each qualified tag name across the whole document. Each chip hides/shows only its own category. Other descendants remain visible, promoted to the nearest visible ancestor (or to the root level), in source order. Restoring one category leaves other hidden categories unchanged. Counts remain unchanged by filters.
- Click a tree node to select its source tag. Arrow keys navigate and expand/collapse the tree.
- A DocumentSymbolProvider also populates native Outline and breadcrumbs. VS Code's public API does not allow a custom search box, statistics header, or arbitrary colors inside native Outline, so the full interface lives in its own Explorer view.

Settings: `xmlAssistant.showAttributes` (false), `xmlAssistant.showText` (false), and `xmlAssistant.maxFileSizeMB` (20, configurable from 1 to 100 MiB).

The parser supports namespaces, Unicode, self-closing elements and incomplete XML diagnostics. Custom and external DTD entities are not expanded. Processing stays local. Files are capped at 100,000 elements, initial tree rendering at 1,000 visible nodes (load more on demand), and Worker searches at one second. Partial results are explicitly labeled.

## Development

Node.js 20.19+ is required. Open this directory in VS Code and press F5 to launch the extension with the [sample XML](./examples/catalog.xml).

```sh
npm ci
npm run compile
npm test
npm run package
```

Tests cover parsing, source offsets, search, VS Code API interactions and webview behavior. [host-integration.cjs](./test/host-integration.cjs) runs inside an actual VS Code extension host. `node test/preview.cjs` serves the actual webview assets with a mock API for browser checks.

The local package uses publisher `xml-assistant-local`; replace it with your registered publisher before Marketplace publication. This is a desktop/remote extension, not a browser Web Extension.
