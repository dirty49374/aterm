/** Read-only Knowledge and Viewpoint browsing, independent of the Working Set. */
export class ModelReference {
  constructor({ root, query, escape, markdown, codeBlock, termLink, shortPath, changed }) {
    Object.assign(this, { root, query, escape, markdown, codeBlock, termLink, shortPath, changed });
    this.type = 'knowledge';
    this.selected = { knowledge: '', viewpoint: '' };
    this.catalog = { knowledge: [], viewpoint: [] };
    this.epoch = 0;
    this.detailEpoch = 0;
    this.handlers = new AbortController();
    const on = (node, event, handler) =>
      node.addEventListener(event, handler, { signal: this.handlers.signal });
    on(root.querySelector('[data-reference-close]'), 'click', () => root.close());
    on(root, 'close', () => {
      ++this.epoch;
      ++this.detailEpoch;
      this.opener?.isConnected && this.opener.focus({ preventScroll: true });
      changed();
    });
    on(root.querySelector('[data-reference-search]'), 'input', () => this.renderList());
    on(root, 'click', (event) => {
      const tab = event.target.closest('[data-reference-tab]');
      if (tab) this.switchType(tab.dataset.referenceTab);
      const item = event.target.closest('[data-reference-item]');
      if (item) void this.select(item.dataset.referenceItem);
      const jump = event.target.closest('[data-reference-jump]');
      if (jump) {
        const target = root.querySelector(
          `[data-reference-anchor="${jump.dataset.referenceJump}"]`,
        );
        if (target?.tagName === 'DETAILS') target.open = true;
        target?.scrollIntoView({ block: 'start' });
      }
      if (event.target.closest('[data-reference-retry]')) void this.refresh();
      if (
        event.target.closest('[data-knowledge]') ||
        (event.target.closest('[data-term]') && !event.ctrlKey && !event.metaKey)
      )
        root.close();
    });
    on(root.querySelector('[role=tablist]'), 'keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const type =
        event.key === 'Home'
          ? 'knowledge'
          : event.key === 'End'
            ? 'viewpoint'
            : this.type === 'knowledge'
              ? 'viewpoint'
              : 'knowledge';
      this.switchType(type);
      root.querySelector(`[data-reference-tab=${type}]`).focus();
    });
  }
  get open() {
    return this.root.open;
  }
  async show(type = 'knowledge', id) {
    this.type = type;
    if (id !== undefined) this.selected[type] = id;
    this.root.querySelector('[data-reference-search]').value = '';
    if (!this.open) {
      this.opener = document.activeElement;
      this.root.showModal();
      this.root.querySelector('[data-reference-search]').focus();
    }
    this.changed();
    await this.refresh();
  }
  async refresh() {
    if (!this.open) return;
    const epoch = ++this.epoch;
    ++this.detailEpoch;
    this.root.querySelector('[data-reference-detail]').innerHTML =
      '<p class="empty-panel" role="status">Reading model reference…</p>';
    try {
      const [knowledge, viewpoint] = await Promise.all([
        this.query({ operation: 'knowledge-list' }),
        this.query({ operation: 'viewpoint', guidance: true }),
      ]);
      if (epoch !== this.epoch || !this.open) return;
      this.catalog = { knowledge: knowledge.knowledges, viewpoint: viewpoint.viewpoints };
      this.switchType(this.type);
    } catch (error) {
      if (epoch !== this.epoch || !this.open) return;
      this.root.querySelector('[data-reference-list]').innerHTML = '';
      this.root.querySelector('[data-reference-detail]').innerHTML =
        `<p class="empty-panel" role="alert">${this.escape(error.message)}</p><button class="text-button" data-reference-retry>Retry</button>`;
    }
  }
  switchType(type) {
    this.type = type;
    this.root.querySelector('[data-reference-search]').value = '';
    for (const tab of this.root.querySelectorAll('[data-reference-tab]')) {
      const active = tab.dataset.referenceTab === type;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    }
    const items = this.catalog[type];
    const id = this.selected[type] || this.id(items[0]);
    this.renderList();
    void this.select(id);
  }
  id(item) {
    return item?.id ?? item?.name ?? '';
  }
  renderList() {
    const focused = this.root
      .querySelector('[data-reference-list]')
      ?.contains(document.activeElement)
      ? document.activeElement.dataset.referenceItem
      : undefined;
    const search = this.root.querySelector('[data-reference-search]').value.trim().toLowerCase();
    const items = this.catalog[this.type].filter((item) =>
      [
        this.id(item),
        typeof item.description === 'string' ? item.description : item.description?.content,
        item.file || item.path,
      ].some((text) => text?.toLowerCase().includes(search)),
    );
    this.root.querySelector('[data-reference-count]').textContent =
      `${items.length} ${this.type === 'knowledge' ? 'Knowledges' : 'Viewpoints'}`;
    this.root.querySelector('[data-reference-list]').innerHTML =
      items
        .map((item) => {
          const id = this.id(item);
          const description =
            typeof item.description === 'string' ? item.description : item.description?.content;
          return `<button class="reference-item" data-reference-item="${this.escape(id)}" aria-current="${id === this.selected[this.type] ? 'true' : 'false'}"><strong>${this.escape(id)}</strong><span>${this.escape(description || 'No Description declared.')}</span><small>${this.type === 'knowledge' ? `${item.termCount} Terms` : `${item.termKinds.length} Term Kinds`}</small></button>`;
        })
        .join('') || '<p class="empty-panel">No matching results.</p>';
    if (focused)
      [...this.root.querySelectorAll('[data-reference-item]')]
        .find((item) => item.dataset.referenceItem === focused)
        ?.focus({ preventScroll: true });
  }
  async select(id) {
    const type = this.type;
    const epoch = ++this.detailEpoch;
    this.selected[type] = id;
    this.renderList();
    const detail = this.root.querySelector('[data-reference-detail]');
    detail.scrollTop = 0;
    const item = this.catalog[type].find((item) => this.id(item) === id);
    if (!item) {
      detail.innerHTML = `<p class="empty-panel">${id ? `${this.escape(id)} is no longer available.` : `No ${type === 'knowledge' ? 'Knowledge' : 'Viewpoint'} available.`}</p>`;
      return;
    }
    if (type === 'knowledge') {
      detail.innerHTML = this.renderKnowledge(item);
      return;
    }
    detail.innerHTML = '<p class="empty-panel" role="status">Reading Viewpoint…</p>';
    try {
      const result = await this.query({
        operation: 'viewpoint',
        viewpoints: [id],
        caseSensitive: true,
        guidance: true,
      });
      if (epoch !== this.detailEpoch || !this.open) return;
      const viewpoint = result.viewpoints.find((v) => v.name === id);
      detail.innerHTML = viewpoint
        ? this.renderViewpoint(viewpoint)
        : '<p class="empty-panel">Viewpoint is no longer available.</p>';
    } catch (error) {
      if (epoch === this.detailEpoch && this.open)
        detail.innerHTML = `<p class="empty-panel" role="alert">${this.escape(error.message)}</p><button class="text-button" data-reference-retry>Retry</button>`;
    }
  }
  link(type, id) {
    return `<button class="reference-chip" data-read-${type}="${this.escape(id)}">${this.escape(id)}</button>`;
  }
  renderKnowledge(item) {
    const { escape: e, markdown: md } = this;
    const section = (title, hint, text) =>
      `<section class="reference-section"><h3>${title}</h3><p class="reference-hint">${hint}</p>${text ? `<div class="prose">${md(text.content, item.id)}</div>` : `<p class="reference-absent">No ${title} declared.</p>`}</section>`;
    return `<header class="reference-document-header"><span class="reference-type">Knowledge</span><h2>${e(item.id)}</h2><p class="reference-path">${e(this.shortPath(item.file))}</p><div class="reference-actions"><span>${item.termCount} Terms</span><button class="text-button" data-knowledge="${e(item.id)}">Browse Terms</button></div></header>
      ${section('Description', 'For readers · What this Knowledge contains.', item.description)}
      ${section('Scope', 'For writers · What belongs here and what must be covered.', item.scope)}
      <section class="reference-section"><h3>Viewpoints</h3><div class="reference-chips">${item.viewpoints.map((id) => this.link('viewpoint', id)).join('') || '<p class="reference-absent">No Viewpoints declared.</p>'}</div></section>
      <details class="reference-section reference-terms"><summary>Terms <span>${item.termCount}</span></summary><div class="reference-term-list">${item.termDeclarations.map((term) => `<div>${this.termLink(term.id, term.name)}<small>${e(term.termKind)}</small></div>`).join('') || '<p class="reference-absent">No Terms declared.</p>'}</div></details>`;
  }
  renderViewpoint(item) {
    const { escape: e, markdown: md } = this;
    const knowledges = this.catalog.knowledge.filter((k) => k.viewpoints.includes(item.name));
    return `<header class="reference-document-header"><span class="reference-type">Viewpoint</span><h2>${e(item.name)}</h2><div class="prose">${md(item.description)}</div><p class="reference-path">${e(this.shortPath(item.path))}</p><nav class="reference-chips" aria-label="Viewpoint sections"><button class="reference-chip" data-reference-jump="guidance">Guidance</button><button class="reference-chip" data-reference-jump="kinds">Term Kinds (${item.termKinds.length})</button><button class="reference-chip" data-reference-jump="source">Original source</button></nav></header>
      <section class="reference-section"><h3>Used by</h3><div class="reference-chips">${knowledges.map((k) => this.link('knowledge', k.id)).join('') || '<p class="reference-absent">No Knowledge currently declares this Viewpoint.</p>'}</div></section>
      <section class="reference-section" data-reference-anchor="guidance"><h3>Guidance</h3>${item.guidance?.trim() ? `<div class="prose">${md(item.guidance)}</div>` : '<p class="reference-absent">No guidance declared.</p>'}</section>
      <section class="reference-section" data-reference-anchor="kinds"><h3>Term Kinds <span class="reference-count">${item.termKinds.length}</span></h3>${item.termKinds.map((kind, index) => `<details class="reference-kind" ${index === 0 ? 'open' : ''}><summary><strong>${e(item.name)}.${e(kind.name)}</strong><span>${kind.sections.length} sections</span></summary><div class="reference-kind-body"><div class="prose">${md(kind.description)}</div>${kind.sections.map((section) => `<section class="reference-schema-section"><h4><code>.${e(section.name)}</code><span>${e(section.type)}</span></h4>${section.description ? `<div class="prose">${md(section.description)}</div>` : ''}${(section.questions || []).map((q) => `<div class="reference-question"><h5>Question</h5><p>${e(q.ask)}</p>${q.frame ? `<p class="reference-frame">${e(q.frame)}</p>` : ''}</div>`).join('')}${section.example ? `<div class="reference-example"><h5>Example</h5><div class="prose">${md(section.example)}</div></div>` : ''}</section>`).join('')}</div></details>`).join('')}</section>
      <details class="reference-section" data-reference-anchor="source"><summary>Original source</summary>${this.codeBlock(item.source || '', 'markdown')}</details>`;
  }
  dispose() {
    ++this.epoch;
    ++this.detailEpoch;
    this.handlers.abort();
    if (this.open) this.root.close();
  }
}
