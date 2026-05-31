export type ExtensionContext =
  | 'content-script'
  | 'background'
  | 'popup'
  | 'options'
  | 'sidebar'
  | 'devtools'
  | 'unknown';

export function getExtensionContext(): ExtensionContext {
  // Check if we're in the background script/service worker
  if (
    typeof globalThis !== 'undefined' &&
    (globalThis as any)?.ServiceWorkerGlobalScope !== undefined
  ) {
    return 'background';
  }

  // Check for extension pages using URL
  if (typeof window !== 'undefined' && window.location) {
    const url = window.location.href;
    if (url.includes('chrome-extension://') || url.includes('moz-extension://')) {
      if (url.includes('popup')) {
        return 'popup';
      }
      if (url.includes('options')) {
        return 'options';
      }
      if (url.includes('sidepanel')) {
        return 'sidebar';
      }
      if (url.includes('devtools')) {
        return 'devtools';
      }
    }
  }

  return 'content-script';
}
