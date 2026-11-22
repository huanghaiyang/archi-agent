// Browser-side incident reporting. Cheap, best-effort, never throws: the server
// writes these into the same JSON-lines system log under scope "client" so a
// failed API call or a WASM crash can be correlated with the request log.

const MAX_MESSAGE = 400;

export function reportClientError(scope, message, fields = {}, level = 'error') {
  try {
    const payload = {
      scope,
      level,
      message: String(message || 'client error').slice(0, MAX_MESSAGE),
      fields,
      url: `${location.pathname}${location.search}`.slice(0, 300),
    };
    fetch('/api/client-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* reporting must never affect the UI */
  }
}

let installed = false;

export function installClientLogging() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('error', (event) => {
    // Image / script 404s surface here too; keep them at warn, real exceptions error.
    const isElement = event.target && event.target !== window;
    reportClientError(
      'browser',
      event.message || `load failed: ${event.target?.src || event.target?.href || ''}`,
      { source: event.filename, line: event.lineno, column: event.colno, element: isElement },
      isElement ? 'warn' : 'error',
    );
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    reportClientError('browser', reason?.message || String(reason || 'unhandled rejection'), {
      name: reason?.name,
      stack: String(reason?.stack || '').slice(0, 900),
    }, 'error');
  });
}
