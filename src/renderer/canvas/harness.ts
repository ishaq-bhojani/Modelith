import type { ArtifactLang } from './artifacts.js'

/**
 * Messages across the canvas ↔ harness boundary (artifact-canvas spec §6.3).
 * The harness runs in a sandboxed, opaque-origin iframe, so `event.origin` is
 * the useless string "null" — both sides validate `event.source` identity
 * instead (see useHarness.ts and the harness script below).
 */
export type ParentToHarness =
  | { type: 'render'; kind: 'html' | 'svg'; content: string }
  | { type: 'selectMode'; enabled: boolean }

export type HarnessToParent =
  | { type: 'ready' }
  | { type: 'selected'; outerHTML: string; path: string }
  | { type: 'error'; message: string }

/**
 * The CSP hash of the harness's inline bootstrap script (below), as `sha256-…`.
 *
 * The harness runs in an `srcdoc` iframe. Chromium makes an `srcdoc` (and
 * `blob:`/`data:`) document INHERIT the embedder's CSP, and the app ships
 * `script-src 'self'` — which would block the bootstrap and thus every artifact.
 * Rather than weaken the app policy to `'unsafe-inline'`, the app's `script-src`
 * allow-lists exactly this one script by hash. A unit test recomputes the hash
 * from the script text and asserts it appears in the CSP, so any edit to the
 * bootstrap fails the build instead of silently breaking the canvas.
 */
export const HARNESS_SCRIPT_HASH = 'sha256-tqZDCWU/6winVZ/e07XEDI44DtUYwsri9yTPsWBrFIs='

/** What kind of content the harness renders for a given artifact language. */
export function renderKindFor(lang: ArtifactLang): 'html' | 'svg' {
  // Mermaid is compiled to SVG in the renderer before it ever crosses the
  // boundary (spec §2.2), so the harness only ever sees html or svg.
  return lang === 'html' ? 'html' : 'svg'
}

/**
 * The harness document, set once as the iframe's `srcdoc`. It carries its own
 * strict CSP: `default-src 'none'` forbids ALL network (fetch/XHR/WebSocket/
 * remote images/fonts), so model-authored code cannot exfiltrate the
 * conversation or phone home. `script-src 'unsafe-inline'` is deliberate —
 * model scripts SHOULD run; that is what makes the canvas live — but they can
 * only touch this throwaway, network-less document.
 *
 * `innerHTML` does not execute <script> tags, so after injecting HTML the
 * harness re-creates each script element (the standard technique) to run them.
 */
export const HARNESS_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; base-uri 'none'; form-action 'none'">
<style>
  html, body { margin: 0; height: 100%; background: #fff; color: #111; font: 14px/1.5 system-ui, sans-serif; }
  #root { min-height: 100%; box-sizing: border-box; }
  .oc-select-outline { outline: 2px solid #494fdf !important; outline-offset: -1px; cursor: pointer !important; }
</style>
</head>
<body>
<div id="root"></div>
<script>
(function () {
  var parentWin = window.parent;
  var root = document.getElementById('root');
  var selecting = false;
  var lastOutlined = null;

  function post(msg) { parentWin.postMessage(msg, '*'); }

  function runScripts() {
    var scripts = root.querySelectorAll('script');
    for (var i = 0; i < scripts.length; i++) {
      var old = scripts[i];
      var s = document.createElement('script');
      for (var j = 0; j < old.attributes.length; j++) {
        s.setAttribute(old.attributes[j].name, old.attributes[j].value);
      }
      s.textContent = old.textContent;
      old.parentNode.replaceChild(s, old);
    }
  }

  function render(content) {
    try {
      root.innerHTML = content;
      runScripts();
    } catch (err) {
      post({ type: 'error', message: String(err && err.message ? err.message : err) });
    }
  }

  function pathOf(el) {
    var parts = [];
    while (el && el !== root && el.nodeType === 1) {
      var p = el.parentNode;
      if (!p) break;
      var idx = Array.prototype.indexOf.call(p.children, el) + 1;
      parts.unshift(el.tagName.toLowerCase() + ':nth-child(' + idx + ')');
      el = p;
    }
    return parts.join(' > ');
  }

  document.addEventListener('mouseover', function (e) {
    if (!selecting) return;
    if (lastOutlined) lastOutlined.classList.remove('oc-select-outline');
    lastOutlined = e.target;
    if (lastOutlined && lastOutlined.classList) lastOutlined.classList.add('oc-select-outline');
  }, true);

  document.addEventListener('click', function (e) {
    if (!selecting) return;
    e.preventDefault();
    e.stopPropagation();
    var el = e.target;
    if (lastOutlined) lastOutlined.classList.remove('oc-select-outline');
    selecting = false;
    var html = el && el.outerHTML ? el.outerHTML.slice(0, 2048) : '';
    post({ type: 'selected', outerHTML: html, path: pathOf(el) });
  }, true);

  window.addEventListener('message', function (e) {
    // Only the embedding window may command this frame. The origin is opaque
    // ("null"), so source identity is the check that matters.
    if (e.source !== parentWin) return;
    var msg = e.data || {};
    if (msg.type === 'render') render(msg.content);
    else if (msg.type === 'selectMode') {
      selecting = !!msg.enabled;
      if (!selecting && lastOutlined) lastOutlined.classList.remove('oc-select-outline');
    }
  });

  post({ type: 'ready' });
})();
</script>
</body>
</html>`
