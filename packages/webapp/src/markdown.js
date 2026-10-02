import MarkdownIt from 'markdown-it';
import taskLists from 'markdown-it-task-lists';
import hljs from 'highlight.js/lib/common';
import trm from './languages/trm.js';
import mermaid from './languages/mermaid.js';
import { termIdentity, termTokens } from '../../core/src/syntax-module/identity.js';

const escape = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const webUrl = (url) => /^https?:\/\//i.test(url);
const rasterUrl = (url) =>
  /^data:image\/(?:png|jpeg|gif|webp|avif);base64,[a-z0-9+/=\s]+$/i.test(url);

hljs.registerLanguage('trm', trm);
hljs.registerLanguage('mermaid', mermaid);

/** Synchronous HTML is shared by Term Declarations, Scope, Knowledge and Graph reading. */
export function createMarkdownRenderer(termLink) {
  const md = new MarkdownIt({ html: false, linkify: true }).use(taskLists);
  md.validateLink = (url) => webUrl(url) || rasterUrl(url);
  const grammar = termTokens('trm');
  md.inline.ruler.before('emphasis', 'aterm', (state, silent) => {
    if (state.src[state.pos] !== '_') return false;
    grammar.lastIndex = state.pos;
    const match = grammar.exec(state.src);
    if (!match || match.index !== state.pos) return false;
    if (!silent) {
      const linked = !state.linkLevel && (state.env.knowledge || match[0].includes(':'));
      const token = state.push(linked ? 'aterm' : 'text', '', 0);
      token.content = match[0];
    }
    state.pos += match[0].length;
    return true;
  });
  md.renderer.rules.aterm = (tokens, index, options, env) =>
    termLink(termIdentity(tokens[index].content, env.knowledge), tokens[index].content);
  md.renderer.rules.link_open = (tokens, index, options, env, renderer) => {
    const token = tokens[index];
    if (webUrl(token.attrGet('href') || '')) {
      token.attrSet('target', '_blank');
      token.attrSet('rel', 'noopener noreferrer');
    } else token.attrs = token.attrs.filter(([key]) => key !== 'href');
    return renderer.renderToken(tokens, index, options);
  };
  md.renderer.rules.image = (tokens, index, options, env, renderer) => {
    const token = tokens[index];
    token.attrSet('alt', token.content);
    token.attrSet('loading', 'lazy');
    token.attrSet('referrerpolicy', 'no-referrer');
    return renderer.renderToken(tokens, index, options);
  };
  md.renderer.rules.table_open = () => '<div class="table-wrap"><table>';
  md.renderer.rules.table_close = () => '</table></div>';

  function codeBlock(source, language = '') {
    const name = language.trim().split(/\s+/)[0].toLowerCase();
    let content = escape(source);
    if (name && hljs.getLanguage(name)) {
      try {
        content = hljs.highlight(source, { language: name, ignoreIllegals: true }).value;
      } catch {
        /* Literal source remains readable when highlighting cannot complete. */
      }
    }
    return `<div class="markdown-code"><div class="markdown-code-bar"><span>${escape(name || 'text')}</span><button type="button" data-copy-code aria-label="Copy code" aria-live="polite">Copy</button></div><pre><code class="hljs">${content}</code></pre></div>`;
  }
  md.renderer.rules.code_block = (tokens, index) => codeBlock(tokens[index].content);
  md.renderer.rules.fence = (tokens, index) => {
    const token = tokens[index];
    const language = token.info.trim().split(/\s+/)[0].toLowerCase();
    if (language !== 'mermaid') return codeBlock(token.content, language);
    return `<figure class="markdown-diagram" data-mermaid><div class="markdown-code-bar"><span>mermaid</span><button type="button" data-diagram-size aria-pressed="false">Actual size</button></div><div class="markdown-diagram-preview" tabindex="0" role="region" aria-label="Mermaid diagram" aria-live="polite"><p>Rendering diagram…</p></div><details class="markdown-diagram-source"><summary>Mermaid source</summary>${codeBlock(token.content, 'mermaid')}</details></figure>`;
  };
  function markdown(text, knowledge, section) {
    const env = { knowledge };
    if (section === 'relations')
      return (
        '<ul class="relation-declarations">' +
        String(text || '')
          .split('\n')
          .filter((line) => line.trim())
          .map((line) => `<li>${md.renderInline(line, env)}</li>`)
          .join('') +
        '</ul>'
      );
    return md.render(String(text || ''), env);
  }
  return { markdown, codeBlock };
}

let mermaidModule;
const diagramCache = new Map();
function diagram(source) {
  if (!diagramCache.has(source)) {
    const result = (mermaidModule ||= import('./mermaid.js')).then((module) =>
      module.renderDiagram(source),
    );
    diagramCache.set(source, result);
    if (diagramCache.size > 32) diagramCache.delete(diagramCache.keys().next().value);
  }
  return diagramCache.get(source);
}

async function renderDiagrams(root) {
  const figures = [
    ...(root.matches?.('[data-mermaid]') ? [root] : []),
    ...root.querySelectorAll('[data-mermaid]'),
  ];
  for (const figure of figures) {
    if (!figure.isConnected || figure.dataset.rendered) continue;
    figure.dataset.rendered = 'pending';
    const source = figure.querySelector('code').textContent;
    // Each figure owns its result; replacing a view never receives an older render.
    void diagram(source)
      .then(({ url, width, height }) => {
        if (!figure.isConnected) return;
        const img = document.createElement('img');
        img.src = url;
        img.alt = 'Mermaid diagram';
        if (width && height) {
          img.width = width;
          img.height = height;
        }
        figure.querySelector('.markdown-diagram-preview').replaceChildren(img);
        figure.dataset.rendered = 'ready';
      })
      .catch((error) => {
        if (!figure.isConnected) return;
        const message = document.createElement('p');
        message.className = 'markdown-diagram-error';
        message.textContent = 'Diagram unavailable: ' + error.message;
        figure.querySelector('.markdown-diagram-preview').replaceChildren(message);
        figure.querySelector('details').open = true;
        figure.dataset.rendered = 'error';
      });
  }
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      /* Try the HTTP fallback. */
    }
  }
  const active = document.activeElement;
  const field = document.createElement('textarea');
  field.value = text;
  field.className = 'markdown-copy-buffer';
  document.body.append(field);
  field.select();
  try {
    if (!document.execCommand('copy')) throw new Error('Clipboard is unavailable.');
  } finally {
    field.remove();
    active?.focus({ preventScroll: true });
  }
}

/** One lifecycle handles newly inserted Markdown in every reading surface. */
export function observeMarkdown(root) {
  const observer = new MutationObserver((records) => {
    for (const record of records)
      for (const node of record.addedNodes) if (node.nodeType === 1) void renderDiagrams(node);
  });
  observer.observe(root, { childList: true, subtree: true });
  void renderDiagrams(root);
  root.addEventListener('click', async (event) => {
    const size = event.target.closest('[data-diagram-size]');
    if (size) {
      event.preventDefault();
      event.stopPropagation();
      const preview = size.closest('[data-mermaid]').querySelector('.markdown-diagram-preview');
      const actual = preview.classList.toggle('actual-size');
      size.setAttribute('aria-pressed', String(actual));
      size.textContent = actual ? 'Fit width' : 'Actual size';
      return;
    }
    const button = event.target.closest('[data-copy-code]');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    try {
      await copyText(button.closest('.markdown-code').querySelector('code').textContent);
      button.textContent = 'Copied';
    } catch {
      button.textContent = 'Copy failed';
    }
    setTimeout(() => {
      if (button.isConnected) button.textContent = 'Copy';
    }, 2000);
  });
  return observer;
}
