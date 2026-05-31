import { defineManifest } from '@crxjs/vite-plugin';
import pkg from './package.json';

const DOC_HOST_MATCHES = ['https://docs.google.com/*'];

export default defineManifest({
  manifest_version: 3,
  name: pkg.displayName,
  short_name: 'ProofOS',
  version: pkg.version,
  description: pkg.description,
  // Floor driven by chrome.sidePanel.open() (116) and optional_host_permissions (119).
  // Bumping to 120 for headroom.
  minimum_chrome_version: '120',
  icons: {
    16: 'logo-16.png',
    32: 'logo-32.png',
    48: 'logo-48.png',
    128: 'logo-128.png',
  },
  action: {
    default_title: 'Open ProofOS panel',
    default_icon: {
      16: 'logo-16.png',
      32: 'logo-32.png',
      48: 'logo-48.png',
      128: 'logo-128.png',
    },
  },
  background: {
    service_worker: 'src/background/main.ts',
    type: 'module',
  },
  content_scripts: [
    {
      js: ['src/content/main.ts'],
      matches: DOC_HOST_MATCHES,
      run_at: 'document_idle',
      all_frames: true,
    },
  ],
  permissions: ['sidePanel', 'tabs', 'storage', 'contextMenus', 'clipboardWrite'],
  host_permissions: [
    'http://localhost/*',
    'https://api.openai.com/*',
    // Required so the service worker can hit docs.google.com/document/d/{id}/export
    // with the user's session cookies — the page's own service worker blocks fetches
    // that originate from a content script.
    'https://docs.google.com/*',
    // The Docs export endpoint 302s to doc-{shard}-{region}-docstext.googleusercontent.com
    // (the CDN that actually serves the text). Without this entry the redirect target
    // is subject to standard CORS and gets blocked because the CDN sets ACAO: * which
    // is illegal alongside credentials: 'include'.
    'https://*.googleusercontent.com/*',
  ],
  optional_host_permissions: ['http://*/*', 'https://*/*'],
  side_panel: {
    default_path: 'src/sidepanel/index.html',
  },
});
