import { beforeEach } from 'vitest';
import { ensureDomGlobals } from './dom-globals.js';

function renderClientConfig(): void {
  if (document.getElementById(RUNTIME_CONFIG_ELEMENT_ID)) return;
  const element = document.createElement('script');
  element.id = RUNTIME_CONFIG_ELEMENT_ID;
  element.type = 'application/json';
  element.textContent = JSON.stringify({
    version: 1,
    config: { app: { basePath: '/main' }, api: { baseURL: '/main/api' } },
  });
  document.head.append(element);
}

// Before the test file is imported, as the server renders it before the entry module runs: some modules resolve
// URLs at the top level.
renderClientConfig();
ensureDomGlobals();
beforeEach(() => {
  renderClientConfig();
  ensureDomGlobals();
});
