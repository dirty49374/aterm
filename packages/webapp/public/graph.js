import { localTerm } from './identity.js';
import {
  termDeclarationKey,
  termDeclarationTermKind,
  localTermKind,
  matchesTermKind,
} from './library-model.js';
import { ExploreGraphModel } from './graph-explore-model.js';
import { edgeCategories, defaultEdgeFilters } from './graph-state.js';
import { GraphModel } from './graph-model.js';
import { connectEdges, labelCandidates, nodeObstacles, placeEdgeLabel } from './graph-geometry.js';
import {
  layoutInput,
  applyLayout,
  LayoutScheduler,
  ForceLayoutWorker,
  layoutAlgorithms,
} from './graph-layout.js';

const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const plain = (s) =>
  String(s || '')
    .replace(/\s+/g, ' ')
    .trim();
const words = (text, max = 43) => {
  const lines = [''];
  for (const word of plain(text).split(' ')) {
    if (lines.at(-1).length + word.length + 1 > max && lines.at(-1)) lines.push('');
    lines[lines.length - 1] += (lines.at(-1) ? ' ' : '') + word;
  }
  return [clip(lines[0] || '', max), clip(lines.slice(1).join(' '), max)];
};

/** Compact visual labels retain the full phrase list for accessible reading. */
function edgeLabel(assertions) {
  const counts = new Map();
  for (const assertion of assertions)
    counts.set(assertion.phrase, (counts.get(assertion.phrase) || 0) + 1);
  const phrases = [...counts].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const all = phrases.map(([phrase, count]) => (count > 1 ? `${phrase} ×${count}` : phrase));
  return {
    lines: [...all.slice(0, 2), ...(all.length > 2 ? [`+${all.length - 2}`] : [])],
    title: all.join(' · '),
  };
}

export class GraphExplorer {
  constructor({
    query,
    escape,
    markdown,
    codeBlock,
    onRead,
    workingSet,
    onContext,
    onToggleContext,
    onModeChange = () => {},
    termUrl = (id) => `/#term=${encodeURIComponent(id)}&view=graph`,
    onChange = () => {},
    onDialogChange = () => {},
  }) {
    Object.assign(this, {
      query,
      escape,
      markdown,
      codeBlock,
      onRead,
      workingSet,
      onContext,
      onToggleContext,
      onModeChange,
      termUrl,
      onChange,
      onDialogChange,
    });
    this.mode = 'explore';
    this.recent = new Set();
    this.camera = { x: 0, y: 0, k: 1 };
    this.filters = defaultEdgeFilters();
    this.epoch = 0;
    this.readEpoch = 0;
    this.layout = null;
    this.layoutAlgorithm = 'layered';
    this.hideMode = 'selected';
    this.pointerTool = 'select';
    this.spaceDown = false;
  }
  async prepare(termDeclarations, knowledges, revision) {
    if (!this.sessions) {
      this.sessions = Object.fromEntries(
        [
          ['structure', new GraphModel(termDeclarations, knowledges)],
          ['explore', new ExploreGraphModel(termDeclarations, knowledges, [], this.workingSet)],
        ].map(([mode, model]) => [
          mode,
          {
            model,
            camera: { x: 0, y: 0, k: 1 },
            filters: defaultEdgeFilters(),
            layoutAlgorithm: 'layered',
            layoutDirty: true,
          },
        ]),
      );
      Object.assign(this, this.sessions[this.mode]);
      this.sessions.explore.model.placement = () =>
        this.mode === 'explore' && this.root?.isConnected
          ? { center: this.viewportCenter(), filters: this.filters }
          : {};
    }
    this.termDeclarations = termDeclarations;
    this.requestedRevision = revision;
    if (this.revision === revision) return;
    const result = await this.query({
      operation: 'relations',
      edgeOrigins: ['relation', 'reference'],
    });
    this.edges = result.relations || [];
    for (const [mode, session] of Object.entries(this.sessions)) {
      session.model.reconcile(termDeclarations, knowledges, this.edges);
      session.layoutDirty =
        mode === 'structure' || (mode === this.mode ? this.layoutDirty : session.layoutDirty);
    }
    this.layoutDirty = this.sessions[this.mode].layoutDirty;
    this.revision = revision;
    this.error = '';
    this.edgeDetail = null;
    this.popup = false;
  }
  async mount(root, selected, termDeclarations, revision, knowledges = []) {
    this.cancelGesture?.();
    this.layout ||= new LayoutScheduler(
      new globalThis.ELK({ workerUrl: '/elk-worker.min.js' }),
      new ForceLayoutWorker(),
    );
    if (root !== this.root) {
      ++this.epoch;
      this.layout.cancel();
    }
    this.root = root;
    await this.prepare(termDeclarations, knowledges, revision);
    this.active = selected;
    this.routeTerm = selected;
    this.render();
    if (this.layoutDirty || [...this.model.nodes.values()].some((n) => !n.laidOut))
      await this.arrange({ fit: true });
  }
  stop() {
    this.cancelDraw();
    this.cancelGesture?.();
    this.spaceDown = false;
    ++this.epoch;
    ++this.readEpoch;
    this.layout?.cancel();
    this.highlightEvents?.abort();
    const selector = this.root?.querySelector('.graph-edge-filter');
    if (selector) selector.open = false;
    this.busy = false;
    if (this.popup) this.closePopup();
  }
  async arrange({ fit = false } = {}) {
    this.cancelGesture?.();
    const epoch = this.epoch;
    this.error = '';
    this.root.querySelector('.graph-error').hidden = true;
    this.busy = true;
    this.layoutDirty = true;
    this.caption();
    try {
      const result = await this.layout.run(
        layoutInput(this.model, this.model.project(this.edges, this.filters).edges),
        this.layoutAlgorithm,
      );
      if (!result || epoch !== this.epoch || !this.root.isConnected) return false;
      applyLayout(this.model, result);
      this.layoutDirty = false;
      this.sessions[this.mode].layoutDirty = false;
      this.busy = false;
      this.draw();
      this.caption();
      if (fit) this.fit();
      return true;
    } catch (error) {
      if (epoch === this.epoch) {
        this.busy = false;
        this.error = 'Layout unavailable: ' + error.message;
        this.render();
      }
    }
  }
  async setMode(mode) {
    if (!this.sessions || mode === this.mode || !this.sessions[mode]) return;
    this.cancelGesture?.();
    this.spaceDown = false;
    this.sessions[this.mode] = {
      model: this.model,
      camera: this.camera,
      filters: this.filters,
      layoutAlgorithm: this.layoutAlgorithm,
      layoutDirty: this.layoutDirty,
    };
    ++this.epoch;
    this.layout.cancel();
    this.busy = false;
    this.popup = false;
    this.edgeDetail = null;
    this.mode = mode;
    this.recent.clear();
    Object.assign(this, this.sessions[mode]);
    this.onChange();
    await this.mount(
      this.root,
      this.routeTerm,
      this.termDeclarations,
      this.requestedRevision,
      this.model.knowledges,
    );
    this.onModeChange(this.mode);
  }
  included(term) {
    return this.sessions?.explore.model.nodes.has(term) || false;
  }
  async exploreSelected() {
    if (this.mode !== 'structure') return;
    this.cancelGesture?.();
    const terms = this.model.selectedTerms();
    if (!terms.length) return;
    const session = this.sessions.explore;
    if (session.model.replaceMembership(terms, { filters: session.filters }))
      session.layoutDirty = true;
    await this.setMode('explore');
    if (this.mode !== 'explore' || !this.root?.isConnected) return;
    this.fit();
    this.root.querySelector('.graph-canvas').focus();
  }
  viewportCenter() {
    const box = this.root.querySelector('.graph-canvas').getBoundingClientRect();
    return {
      x: (box.width / 2 - this.camera.x) / this.camera.k,
      y: (box.height / 2 - this.camera.y) / this.camera.k,
    };
  }
  changeMembership(changes, context = {}) {
    if (this.mode !== 'explore') return;
    this.cancelGesture?.();
    this.layout.cancel();
    this.busy = false;
    this.layoutDirty = false;
    this.edgeDetail = null;
    this.recent = new Set(
      this.model.applyMembership(changes, {
        center: this.viewportCenter(),
        filters: this.filters,
        ...context,
      }),
    );
    this.render();
    this.onChange();
    clearTimeout(this.recentTimer);
    this.recentTimer = setTimeout(() => {
      this.recent.clear();
      this.root
        ?.querySelectorAll('.recently-added')
        .forEach((n) => n.classList.remove('recently-added'));
    }, 1800);
  }
  async applyExploreCommand(operation, terms = []) {
    if (this.mode !== 'explore') return;
    if (terms.some((term) => !this.model.terms.has(term)))
      throw new Error('A requested Term is unavailable.');
    if (operation === 'set') {
      this.cancelGesture?.();
      this.layout.cancel();
      this.model.replaceMembership(terms, { center: this.viewportCenter(), filters: this.filters });
      this.render();
      this.onChange();
      if (!(await this.arrange({ fit: true })))
        throw new Error(this.error || 'Graph layout was interrupted.');
    } else {
      const targets = operation === 'clear' ? [...this.model.nodes.keys()] : terms;
      this.changeMembership(new Map(targets.map((term) => [term, operation === 'add'])));
    }
  }
  setIncluded(term, included) {
    this.changeMembership(new Map([[term, included]]));
  }
  openNeighbors(origin, returnTarget) {
    this.popup = {
      origin,
      changes: new Map(),
      search: '',
      termKind: '',
      viewpoint: '',
      phrase: '',
    };
    this.popupReturn = returnTarget || null;
    this.renderPopup();
    this.root.querySelector('[data-filter=search]')?.focus();
  }
  cardSummary(description, width) {
    const lines = words(description || '', Math.floor((width - 40) / 6.5));
    return `<text class="structure-summary" x="20" y="75">${this.escape(lines[0])}</text><text class="structure-summary" x="20" y="92">${this.escape(lines[1])}</text>`;
  }
  cardColor(termDeclarations) {
    const termKinds = termDeclarations.map((termDeclaration) =>
      localTermKind(termDeclaration.termKind),
    );
    return termKinds.includes('procedure')
      ? '#7fb7a7'
      : termKinds.includes('concept')
        ? '#a0b2d5'
        : '#d4a574';
  }
  exploreCard(id, node) {
    const e = this.escape,
      title = this.label(id);
    const termKinds = [...new Set(node.termDeclarations.map(termDeclarationTermKind))].join(' · ');
    const limit = Math.floor((node.width - 40) / 8.4);
    const description = node.termDeclarations
      .map((termDeclaration) => termDeclaration.definition)
      .filter(Boolean)
      .join(' · ');
    const color = this.cardColor(node.termDeclarations);
    const incoming = this.model.candidates(id, 'incoming', this.filters).length;
    const outgoing = this.model.candidates(id, 'outgoing', this.filters).length;
    const marker = (action, label, x, icon, extra = '') =>
      `<g class="explore-marker explore-${action}" data-${action}="${e(id)}" role="button" tabindex="0" aria-label="${e(label)} ${e(title)}" ${extra} transform="translate(${x},5)"><rect width="24" height="24" rx="5"/>${icon}<title>${e(label)}${action === 'neighbors' ? ` · ${incoming} incoming · ${outgoing} outgoing` : action === 'move' ? ' · Drag, or use arrow keys' : ''}</title></g>`;
    const move = '<path d="M12 4v16M4 12h16M9 7l3-3 3 3M9 17l3 3 3-3M7 9l-3 3 3 3M17 9l3 3-3 3"/>';
    return `<g class="structure-node term-node explore-node ${this.model.selection.has(id) ? 'selected' : ''} ${this.recent.has(id) ? 'recently-added' : ''}" transform="translate(${node.x},${node.y})" data-card="${e(id)}"><g class="structure-header" data-select="${e(id)}" role="button" tabindex="0" aria-label="Select ${e(title)}" aria-pressed="${this.model.selection.has(id)}"><rect class="structure-card" width="${node.width}" height="${node.height}" rx="10"/><path d="M1,16 V${node.height - 16}" stroke="${color}" stroke-width="3"/><text class="structure-type" x="20" y="24" fill="${color}">${e(clip(termKinds, Math.floor((node.width - 110) / 6)))}</text><text data-term="${e(id)}" class="structure-title term-drag" x="20" y="50">${e(clip(title, limit))}</text>${this.cardSummary(description, node.width)}<title>${e(id)}\n${e(termKinds)}\n${e(plain(description))}</title></g><g class="explore-markers">${marker('move', 'Move', node.width - 86, move)}${marker('neighbors', 'Add neighbors of', node.width - 59, '<path d="M12 6v12M6 12h12"/>', 'aria-haspopup="dialog"')}${marker('remove-node', 'Remove from graph', node.width - 32, '<path d="M7 7l10 10M7 17L17 7"/>')}</g><g class="structure-inspect" data-inspect="${e(id)}" role="button" tabindex="0" aria-label="Read ${e(title)}" transform="translate(${node.width - 49},${node.height - 29})"><rect width="35" height="19" rx="4"/><text x="17" y="13" text-anchor="middle">Read</text></g>${this.unshownBadge(id, node)}</g>`;
  }
  unshownBadge(id, node) {
    const counts = this.unshown.get(id);
    if (!counts?.total) return '';
    const description = `${counts.total} connections not shown · ${counts.incoming} incoming · ${counts.outgoing} outgoing. Selected Relation categories only.`;
    const explore = this.mode === 'explore';
    return `<g class="graph-unshown" data-unshown="${this.escape(id)}" data-incoming="${counts.incoming}" data-outgoing="${counts.outgoing}" role="img" tabindex="0" aria-label="${description}"><title>${description}</title><text x="${explore ? 16 : node.width - (node.expandable ? 52 : 16)}" y="${explore ? node.height - 13 : 24}" text-anchor="${explore ? 'start' : 'end'}">+${counts.total}</text></g>`;
  }
  label(id) {
    const node = this.model.describe(id);
    if (node?.origin === 'hidden') return `Hidden · ${node.roots.length}`;
    return node?.type === 'knowledge'
      ? node.knowledge
      : node?.type === 'group'
        ? (node.origin === 'authored' ? node.group.split('.').at(-1) : localTerm(node.term)) +
          ' group'
        : localTerm(node?.term || id || '');
  }
  metadata(id) {
    return [
      ...new Set((this.model.terms.get(id) || []).map((e) => `${e.viewpoint} / ${e.termKind}`)),
    ].join(' · ');
  }
  termLink(id) {
    return `<a href="${this.escape(this.termUrl(id))}" draggable="true" data-term="${this.escape(id)}">${this.escape(id)}</a>`;
  }
  relationSelector() {
    const e = this.escape;
    return `<details class="graph-edge-filter"><summary aria-label="Relation visibility"><span>Relations</span><strong data-edge-summary></strong><span aria-hidden="true">▾</span></summary><div class="graph-edge-options"><fieldset><legend>Show connections</legend><label class="graph-edge-all"><input type="checkbox" data-edge-all>Select all</label><div class="graph-edge-categories">${edgeCategories.map(({ id, label }) => `<label><input type="checkbox" data-edge-category="${e(id)}">${e(label)}</label>`).join('')}</div></fieldset></div></details>`;
  }
  syncRelationSelector() {
    const selector = this.root.querySelector('.graph-edge-filter');
    if (!selector) return;
    const selected = this.filters.categories;
    const count = selected.length;
    selector.querySelector('[data-edge-summary]').textContent =
      count === edgeCategories.length
        ? 'All'
        : count
          ? `${count}/${edgeCategories.length}`
          : 'None';
    const all = selector.querySelector('[data-edge-all]');
    all.checked = count === edgeCategories.length;
    all.indeterminate = count > 0 && count < edgeCategories.length;
    for (const input of selector.querySelectorAll('[data-edge-category]'))
      input.checked = selected.includes(input.dataset.edgeCategory);
  }
  positionRelationSelector() {
    const selector = this.root.querySelector('.graph-edge-filter[open]');
    if (!selector) return;
    const anchor = selector.querySelector('summary').getBoundingClientRect();
    const panel = selector.querySelector('.graph-edge-options');
    const top = Math.max(
      8,
      Math.min(anchor.bottom + 6, window.innerHeight - panel.offsetHeight - 8),
    );
    Object.assign(panel.style, {
      left: `${Math.max(8, Math.min(anchor.right - panel.offsetWidth, window.innerWidth - panel.offsetWidth - 8))}px`,
      top: `${top}px`,
      maxHeight: `${window.innerHeight - top - 8}px`,
    });
  }
  setEdgeCategories(categories) {
    this.cancelGesture?.();
    this.filters = { categories };
    this.edgeDetail = null;
    this.layout.cancel();
    this.busy = false;
    this.syncRelationSelector();
    this.caption();
    // Let native checkbox activation finish; rapid changes share one complete SVG update.
    this.cancelDraw();
    this.drawFrame = requestAnimationFrame(() => {
      this.drawFrame = null;
      if (this.root?.isConnected) this.draw();
    });
  }
  cancelDraw() {
    if (this.drawFrame != null) cancelAnimationFrame(this.drawFrame);
    this.drawFrame = null;
  }
  toolbar() {
    const e = this.escape,
      m = this.model;
    const button = (action, label, key, disabled = false) =>
      `<button data-action="${action}" aria-label="${label}" title="${label}${key ? ' (' + key + ')' : ''}" ${key ? `aria-keyshortcuts="${key}"` : ''} ${disabled ? 'disabled' : ''}>${label}</button>`;
    const path = m.focus ? m.path(m.focus) : [];
    return `<div class="graph-toolbar" role="toolbar" aria-label="Graph commands"><div class="graph-mode" role="group" aria-label="Graph mode">${['structure', 'explore'].map((mode) => `<button data-mode="${mode}" aria-pressed="${this.mode === mode}">${mode === 'structure' ? 'Structure' : 'Explore'}</button>`).join('')}</div>${this.mode === 'structure' ? `<nav class="graph-breadcrumb" aria-label="Graph focus"><button data-focus="" aria-label="All Knowledge">All Knowledge</button>${path.map((id) => `<span aria-hidden="true">/</span><button data-focus="${e(id)}" ${id === m.focus ? 'aria-current="location"' : ''}>${e(this.label(id))}</button>`).join('')}</nav>` : ''}${this.mode === 'explore' ? `<div class="graph-toolset graph-pointer-tools" role="group" aria-label="Canvas tool"><button data-tool="select" aria-pressed="${this.pointerTool === 'select'}" title="Drag blank Canvas to select Nodes">Select</button><button data-tool="pan" aria-pressed="${this.pointerTool === 'pan'}" title="Drag to pan; Space-drag temporarily pans in Select">Pan</button></div>` : ''}<div class="graph-toolset">${button('find', 'Find Term', '/')}${this.mode === 'structure' ? button('collapse-all', 'Collapse all', 'C') : button('remove', 'Remove from graph', 'Delete', !m.selection.size) + button('clear', 'Clear', '', !m.nodes.size)}${button('undo', 'Undo', 'Control+z', !m.history.length)}</div>${this.mode === 'structure' ? `<div class="graph-toolset graph-visibility-controls"><label class="graph-relation-filter"><span>Keep</span><select aria-label="Keep when hiding"><option value="selected" ${this.hideMode === 'selected' ? 'selected' : ''}>Selected only</option><option value="neighbors" ${this.hideMode === 'neighbors' ? 'selected' : ''}>Selected + neighbors</option></select></label>${button('hide-others', 'Hide others', 'H', !m.selectedNodes().size)}${button('unhide-selected', 'Unhide selected', 'U', ![...m.selectedNodes()].some((id) => m.hiddenRoot(id)))}${button('show-all', 'Show all', 'Shift+H', !m.hidden.size)}${button('explore-selected', 'Explore selected', 'E', !m.selectedTerms().length)}<span class="graph-selection-count">${m.selection.size} selected</span></div>` : `<span class="graph-selection-count">${m.selection.size} selected</span>`}<div class="graph-toolset">${button('arrange', 'Arrange', 'A')}${button('fit', 'Fit', 'F')}</div><label class="graph-relation-filter"><span>Layout</span><select aria-label="Graph layout">${layoutAlgorithms.map((layout) => `<option value="${layout.id}" ${this.layoutAlgorithm === layout.id ? 'selected' : ''}>${layout.label}</option>`).join('')}</select></label>${this.relationSelector()}</div>`;
  }
  render() {
    this.cancelDraw();
    if (!this.root?.isConnected) return;
    this.cancelGesture?.();
    if (this.active && !this.model.terms.has(this.active) && !this.model.describe(this.active)) {
      this.active = '';
      this.detail = null;
    }
    const e = this.escape;
    this.root.innerHTML = `<section class="graph-workspace" aria-label="Graph Explorer"><div class="graph-error" role="status" ${this.error ? '' : 'hidden'}>${e(this.error || '')}</div><div class="graph-body pane-collapsed"><div class="graph-stage">${this.toolbar()}<svg class="graph-canvas" aria-label="${this.mode === 'explore' ? 'Term exploration graph' : 'Knowledge structure graph'}" tabindex="0"><defs><marker id="graph-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L10 5L0 10" fill="#8f806c"/></marker></defs><g class="graph-world"></g><rect class="graph-selection-box" hidden/></svg><div class="graph-zoom"><button data-action="zoom-out" aria-label="Zoom out">−</button><span></span><button data-action="zoom-in" aria-label="Zoom in">+</button></div><div class="graph-caption" role="status"></div>${this.mode === 'explore' && !this.model.nodes.size ? `<div class="explore-empty"><strong>Follow a question.</strong><p>Add Terms from the checkboxes in the left tree,<br>then choose their incoming or outgoing neighbors.</p>${this.model.terms.has(this.active) ? `<button data-action="reveal">Add current Term</button><small>${e(this.label(this.active))}</small>` : ''}</div>` : ''}</div></div><div class="graph-popup-host"></div></section>`;
    this.syncRelationSelector();
    this.draw();
    this.renderPopup();
    this.bind();
    this.caption();
  }
  caption() {
    const el = this.root?.querySelector('.graph-caption');
    if (!el) return;
    const m = this.model,
      terms = new Set([...m.nodes.values()].filter((n) => n.type === 'term').map((n) => n.term))
        .size;
    const count =
      this.mode === 'explore'
        ? [...m.nodes.values()].reduce((n, node) => n + node.termDeclarations.length, 0)
        : [...m.nodes.values()].filter((n) => n.type === 'term').length;
    el.innerHTML = `<strong>${this.busy ? 'Arranging…' : `${terms} Terms · ${count} Term Declarations visible`}</strong><span>${this.mode === 'explore' ? 'Drag blank space to select · Drag Selection to move · Space-drag to pan' : 'Click to select · Shift-click to add · Chevron to expand'}</span>`;
  }
  draw() {
    const e = this.escape,
      m = this.model;
    const projection = m.project(this.edges, this.filters);
    this.drawnEdges = projection.edges;
    this.unshown = projection.unshown;
    const color = (id) => {
      const termDeclaration = m.termDeclarationMap.get(m.describe(id)?.termDeclaration);
      return this.cardColor(termDeclaration ? [termDeclaration] : []);
    };
    const shapes = [...m.nodes];
    const geometryKey = JSON.stringify([
      shapes.map(([id, n]) => [id, n.x, n.y, n.width, n.height, n.open]),
      this.drawnEdges,
    ]);
    if (geometryKey !== this.geometryKey) {
      this.edgeGeometry = connectEdges(m.nodes, this.drawnEdges);
      this.geometryKey = geometryKey;
    }
    const frames = shapes
      .filter(([, n]) => n.open)
      .map(
        ([id, n]) =>
          `<rect class="structure-frame" x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}" rx="14"/>`,
      )
      .join('');
    const labels = [];
    const obstacles = nodeObstacles(m.nodes);
    const labelStyle = getComputedStyle(this.root.querySelector('.graph-canvas'));
    this.labelMeasure ||= document.createElement('canvas').getContext('2d');
    this.labelMeasure.font = `${labelStyle.fontWeight} ${labelStyle.getPropertyValue('--edge-label-size')} ${labelStyle.fontFamily}`;
    const lineHeight = 14;
    const paths = this.drawnEdges
      .map((edge, index) => {
        const { path } = this.edgeGeometry[index];
        const { lines, title: label } = edgeLabel(edge.edges);
        const metrics = lines.map((line) => this.labelMeasure.measureText(line));
        const ascent = Math.max(...metrics.map((m) => m.actualBoundingBoxAscent));
        const descent = Math.max(...metrics.map((m) => m.actualBoundingBoxDescent));
        const width = Math.max(...metrics.map((m) => m.width));
        const height = ascent + descent + (lines.length - 1) * lineHeight;
        const box = placeEdgeLabel(
          labelCandidates(this.edgeGeometry[index]),
          width + 12,
          height + 8,
          obstacles,
        );
        obstacles.push(box);
        const cx = box.x + box.width / 2,
          cy = box.y + box.height / 2;
        labels.push(
          `<g class="graph-edge graph-edge-label" data-edge="${index}" aria-hidden="true"><path class="edge-label-leader" d="M${box.anchor.x},${box.anchor.y} L${cx},${cy}"/><rect rx="4" x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}"/><text text-anchor="middle" transform="translate(${cx},${box.y + 4 + ascent})">${lines.map((line, i) => `<tspan x="0" y="${i * lineHeight}">${e(line)}</tspan>`).join('')}</text></g>`,
        );
        return `<g class="graph-edge" data-edge="${index}" role="button" tabindex="0" aria-label="${e(label)}: ${e(this.label(edge.from))} to ${e(this.label(edge.to))}"><title>${e(label)}</title><path class="edge-hit" d="${path}"/><path class="edge-route" d="${path}" marker-end="url(#graph-arrow)"/></g>`;
      })
      .join('');
    const cards = shapes
      .map(([id, n]) =>
        this.mode === 'explore' ? this.exploreCard(id, n) : this.structureCard(id, n, color),
      )
      .join('');
    const world = this.root.querySelector('.graph-world');
    world.innerHTML = frames + paths + cards + labels.join('');
    this.transform();
    this.feedback();
  }
  structureDescription(doc, n, group, termDeclarations) {
    return doc
      ? doc.description?.content
      : n.origin === 'hidden'
        ? 'Open to choose items, then Unhide selected.'
        : n.origin === 'hidden'
          ? 'Hidden Group'
          : group
            ? n.origin === 'authored'
              ? `Term Declarations in ${n.group}.`
              : `${localTerm(n.term)} and its parts.`
            : termDeclarations[0]?.definition;
  }
  structureType(doc, n, group, termKinds) {
    return doc
      ? 'Knowledge'
      : n.origin === 'hidden'
        ? 'Hidden Group'
        : group
          ? n.origin === 'authored'
            ? 'Group'
            : `Group · ${termKinds} · has_part`
          : termKinds;
  }
  structureCard(id, n, color) {
    const m = this.model,
      e = this.escape;
    const doc = m.container(id),
      group = n.type === 'group',
      termDeclarations = n.termDeclaration ? [m.termDeclarationMap.get(n.termDeclaration)] : [],
      children = m.children.get(id) || [];
    const termKinds = [...new Set(termDeclarations.map(termDeclarationTermKind))].join(' · '),
      viewpoints = [...new Set(termDeclarations.map((v) => v.viewpoint).filter(Boolean))].join(
        ' · ',
      );
    const description = this.structureDescription(doc, n, group, termDeclarations);
    const count = m.memberTermDeclarations(id).length;
    const summary = this.cardSummary(
      description || (doc && !count ? 'No Terms in this Knowledge yet.' : ''),
      n.width,
    );
    const title = this.label(id);
    const label = `Select ${title}`;
    const type = this.structureType(doc, n, group, termKinds);
    return `<g class="structure-node ${group ? 'structure-group' : n.type === 'term' ? 'term-node' : ''} ${n.open ? 'expanded' : ''} ${n.hiddenBy ? 'hidden-member' : ''} ${m.selection.has(id) ? 'selected' : ''}" transform="translate(${n.x},${n.y})" data-card="${e(id)}"><g class="structure-header" data-select="${e(id)}" role="button" tabindex="0" aria-label="${e(label)}" aria-pressed="${m.selection.has(id)}">
        <rect class="structure-card" width="${n.width}" height="${n.open ? 82 : n.height}" rx="${n.open ? 12 : 10}"/>
        ${!n.open ? `<path d="M1,16 V${n.height - 16}" stroke="${color(id)}" stroke-width="3"/>` : ''}
        <text class="structure-type" x="20" y="24" fill="${color(id)}">${e(type)}</text>
        <text ${n.term ? `data-term="${e(n.term)}"` : ''} class="structure-title ${doc ? 'knowledge-name' : ''}" x="20" y="50">${e(clip(title, 32))}</text>
        ${n.open ? `<text class="structure-subtitle" x="20" y="72">${children.length} direct members · ${count} Term Declarations</text>` : `${summary}<text class="structure-subtitle" x="20" y="112">${n.expandable ? `${count} Term Declarations · Open to explore` : e(viewpoints)}</text>`}
        <title>${e(title)}\n${e(plain(description))}</title></g>
        ${this.structureControls(id, n, title)}</g>`;
  }
  structureControls(id, n, title) {
    const e = this.escape;
    return `${n.expandable ? `<g class="structure-toggle" data-toggle="${e(id)}" role="button" tabindex="0" aria-label="${n.open ? 'Collapse' : 'Expand'} ${e(title)}" aria-expanded="${n.open}" transform="translate(${n.width - 42},10)"><rect width="32" height="30" rx="5"/><path class="structure-chevron" d="${n.open ? 'M10,12 l5,5 l5,-5' : 'M12,10 l5,5 l-5,5'}"/></g>` : ''}
        <g class="structure-inspect" data-inspect="${e(id)}" role="button" tabindex="0" aria-label="Read ${e(title)}" transform="translate(${n.width - 48},${n.open ? 53 : 99})"><rect width="34" height="18" rx="4"/><text x="17" y="12" text-anchor="middle">Read</text></g>
        ${n.open && n.origin !== 'hidden' ? `<g class="structure-focus" data-focus="${e(id)}" role="button" tabindex="0" aria-label="Focus ${e(title)}" transform="translate(${n.width - 89},53)"><rect width="37" height="18" rx="4"/><text x="18" y="12" text-anchor="middle">Focus</text></g>` : ''}${this.unshownBadge(id, n)}`;
  }
  transform() {
    this.root
      .querySelector('.graph-world')
      ?.setAttribute(
        'transform',
        `translate(${this.camera.x},${this.camera.y}) scale(${this.camera.k})`,
      );
    const el = this.root.querySelector('.graph-zoom span');
    if (el) el.textContent = Math.round(this.camera.k * 100) + '%';
  }
  zoom(factor, point) {
    this.cancelGesture?.();
    const box = this.root.querySelector('.graph-canvas').getBoundingClientRect();
    point ||= { x: box.width / 2, y: box.height / 2 };
    const old = this.camera.k,
      k = Math.max(0.05, Math.min(2.5, old * factor));
    this.camera = {
      k,
      x: point.x - ((point.x - this.camera.x) * k) / old,
      y: point.y - ((point.y - this.camera.y) * k) / old,
    };
    this.transform();
  }
  fit() {
    this.cancelGesture?.();
    const nodes = [...this.model.nodes.values()].filter((n) => !n.parent);
    if (!nodes.length) return;
    const box = this.root.querySelector('.graph-canvas').getBoundingClientRect();
    const toolbar = this.root.querySelector('.graph-toolbar').getBoundingClientRect();
    const topInset = Math.max(40, toolbar.bottom - box.top + 24),
      availableHeight = Math.max(1, box.height - topInset - 64);
    const left = Math.min(...nodes.map((n) => n.x)),
      top = Math.min(...nodes.map((n) => n.y));
    const width = Math.max(...nodes.map((n) => n.x + n.width)) - left,
      height = Math.max(...nodes.map((n) => n.y + n.height)) - top;
    const k = Math.max(
      0.05,
      Math.min(1.1, (box.width - 80) / Math.max(1, width), availableHeight / Math.max(1, height)),
    );
    this.camera = {
      k,
      x: (box.width - width * k) / 2 - left * k,
      y: topInset + (availableHeight - height * k) / 2 - top * k,
    };
    this.transform();
  }
  panel() {
    this.onContext(this.contextContent(), this.active, this.edgeDetail);
  }
  contextContent() {
    const e = this.escape,
      m = this.model;
    if (this.edgeDetail) {
      return `<h2>Relations</h2>${this.edgeDetail.edges.map((r) => `<article class="graph-term-declaration">${this.termLink(r.source)}<p>${e(r.phrase)} · ${e(r.type)}</p>${this.termLink(r.target)}${(r.locations || []).map((l) => `<p><small>${e(l.file)}:${l.line}</small></p>`).join('')}</article>`).join('')}`;
    }
    const group = m.describe(this.active);
    if (group?.type === 'group') {
      const origin =
        group.origin === 'hidden'
          ? 'Hidden items retain their original membership. Use Unhide selected to bring them out.'
          : group.origin === 'authored'
            ? `${e(group.knowledge)} · ${e(group.group)}`
            : `${this.termLink(group.term)} and its parts`;
      return `<h2>${e(this.label(this.active))}</h2><p class="graph-panel-hint">${origin}</p><h3>Members</h3><div class="graph-member-links">${m
        .memberTermDeclarations(this.active)
        .map(
          (termDeclaration) =>
            `<div><span class="term-kind-badge">${e(termDeclaration.termKind)}</span> ${this.termLink(termDeclaration.id)}</div>`,
        )
        .join('')}</div>`;
    }
    const doc = m.container(this.active);
    if (doc) {
      const scope = this.termDeclarations.find((v) => v.knowledge === doc.id)?.scope?.content;
      return `<h2>${e(doc.id)}</h2>${doc.description ? `<div class="prose knowledge-description">${this.markdown(doc.description.content, doc.id)}</div>` : ''}<p class="graph-panel-hint">${e(doc.file)}</p>${scope ? `<h3>Scope</h3><div class="prose">${this.markdown(scope, doc.id)}</div>` : ''}<h3>Terms</h3><div class="graph-member-links">${m
        .members(this.active)
        .map((n) => this.termLink(n))
        .join('')}</div>`;
    }
    return '<p class="empty-panel">Read a Term or connection to see its Context.</p>';
  }
  async inspect(name) {
    const node = this.model.describe(name);
    if (node?.type === 'term') name = node.term;
    this.active = name;
    this.edgeDetail = null;
    if (node && node.type !== 'term') this.panel();
    else if (name) await this.onRead(name);
  }
  renderPopup() {
    const host = this.root.querySelector('.graph-popup-host');
    if (!host) return;
    this.onDialogChange(!!this.popup);
    this.root.querySelector('.graph-body').inert = !!this.popup;
    this.root.querySelector('.graph-toolbar').inert = !!this.popup;
    if (!this.popup) {
      host.innerHTML = '';
      return;
    }
    if (this.mode === 'explore') return this.renderExplorePopup(host);
    const e = this.escape;
    const matches = this.termDeclarations.filter(
      (termDeclaration) =>
        termDeclaration.id.toLowerCase().includes((this.search || '').toLowerCase()) &&
        (!this.termKind ||
          matchesTermKind(this.termKind, termDeclaration.termKind, termDeclaration.viewpoint)) &&
        (!this.viewpoint || termDeclaration.viewpoint === this.viewpoint),
    );
    const select = (key, label) =>
      `<select data-filter="${key}" aria-label="${label}"><option value="">All ${label}</option>${[
        ...new Set(
          this.termDeclarations
            .map((v) => (key === 'termKind' ? termDeclarationTermKind(v) : v[key]))
            .filter(Boolean),
        ),
      ]
        .sort()
        .map((v) => `<option ${this[key] === v ? 'selected' : ''}>${e(v)}</option>`)
        .join('')}</select>`;
    host.innerHTML = `<div class="graph-popup-backdrop"></div><section class="graph-popup structure-search" role="dialog" aria-modal="true" aria-label="Find Term"><header><strong>Find Term</strong><button data-action="close-popup" aria-label="Close popup">×</button></header><div class="graph-popup-filters"><input type="search" data-filter="search" aria-label="Filter Terms" placeholder="Find a Term…" value="${e(this.search || '')}">${select('viewpoint', 'Viewpoint')}${select('termKind', 'Term Kind')}</div><div class="graph-popup-meta">${matches.length} Term Declarations · Choose a Term Declaration to open its ancestors</div><div class="graph-popup-list">${matches.map((termDeclaration) => `<button class="structure-search-result" data-reveal="${e(termDeclaration.id)}" data-term-declaration="${e(termDeclarationKey(termDeclaration))}"><strong draggable="true" data-drag-term="${e(termDeclaration.id)}">${e(localTerm(termDeclaration.id))}</strong><span>${e(termDeclaration.knowledge)} · ${e(termDeclaration.termKind)}${termDeclaration.group ? ' · ' + e(termDeclaration.group) : ''}</span></button>`).join('') || '<p class="graph-panel-hint">No matching Terms.</p>'}</div></section>`;
  }
  renderExplorePopup(host) {
    const p = this.popup,
      e = this.escape,
      m = this.model;
    const allColumns = m.candidateColumns({ origin: p.origin, filters: this.filters });
    const columns = m.candidateColumns({ ...p, filters: this.filters });
    const all = [
      ...new Map(
        Object.values(allColumns)
          .flat()
          .map((row) => [row.id, row]),
      ).values(),
    ];
    const matches = new Set(
      Object.values(columns)
        .flat()
        .map((row) => row.id),
    );
    const termDeclarations = all.flatMap((row) => row.termDeclarations);
    const select = (key, title, values) =>
      `<select data-filter="${key}" aria-label="${title}"><option value="">All ${title}</option>${[
        ...new Set(values),
      ]
        .sort()
        .map(
          (value) =>
            `<option value="${e(value)}" ${p[key] === value ? 'selected' : ''}>${e(value)}</option>`,
        )
        .join('')}</select>`;
    const rowHtml = (row) => {
      const assertions = row.edges
        .map((edge) => `${this.label(edge.source)} → ${edge.phrase} → ${this.label(edge.target)}`)
        .join('\n');
      return `<label class="explore-neighbor-row"><input type="checkbox" data-member="${e(row.id)}" aria-label="Include ${e(row.id)} in graph"><span><strong draggable="true" data-drag-term="${e(row.id)}">${e(this.label(row.id))}</strong><small>${e(row.termDeclarations[0].knowledge)} · ${e([...new Set(row.termDeclarations.map(termDeclarationTermKind))].join(', '))}</small>${assertions ? `<span class="neighbor-phrases" title="${e(assertions)}">${e([...new Set(row.edges.map((edge) => edge.phrase))].join(' · '))}</span>` : ''}</span>${m.nodes.has(row.id) ? '<span class="on-graph">On graph</span>' : ''}</label>`;
    };
    const label = p.origin ? `Neighbors · ${this.label(p.origin)}` : 'Add Terms';
    host.innerHTML = `<div class="graph-popup-backdrop"></div><section class="graph-popup structure-search explore-popup ${p.origin ? 'neighbors-dialog' : ''}" role="dialog" aria-modal="true" aria-label="${e(label)}"><header><strong>${e(label)}</strong><button data-action="close-popup" aria-label="Close popup">×</button></header><div class="graph-popup-filters"><input type="search" data-filter="search" aria-label="Filter Terms" placeholder="${p.origin ? 'Find a neighbor…' : 'Find a Term…'}" value="${e(p.search)}">${
      p.origin
        ? select(
            'phrase',
            'Relations',
            Object.values(allColumns)
              .flat()
              .flatMap((row) => row.edges.map((edge) => edge.phrase)),
          )
        : ''
    }${select(
      'viewpoint',
      'Viewpoints',
      termDeclarations.map((termDeclaration) => termDeclaration.viewpoint),
    )}${select('termKind', 'Term Kinds', termDeclarations.map(termDeclarationTermKind))}</div><div class="graph-popup-meta"><span>${all.length} ${p.origin ? 'neighbors' : 'Terms'} · ${all.filter((row) => m.nodes.has(row.id)).length} on graph · ${matches.size} matching</span></div><div class="neighbor-columns">${Object.entries(
      columns,
    )
      .map(([direction, rows]) => {
        const title =
          direction === 'incoming' ? 'Incoming' : direction === 'outgoing' ? 'Outgoing' : 'Terms';
        return `<section class="neighbor-column" aria-label="${title}">${p.origin ? `<header><div><strong>${title}</strong><span>${rows.length} / ${allColumns[direction].length}</span></div><button data-bulk="${direction}">Select all</button></header>` : ''}<div class="graph-popup-list">${rows.map(rowHtml).join('') || '<p class="graph-panel-hint">No matching Terms.</p>'}</div></section>`;
      })
      .join(
        '',
      )}</div><footer><span data-pending aria-live="polite"></span><button data-bulk="all">Select all matching</button><button data-action="close-popup">Cancel</button><button class="primary" data-action="apply-membership">Apply</button></footer></section>`;
    this.syncMembershipDialog();
  }
  syncMembershipDialog() {
    const p = this.popup,
      m = this.model;
    const columns = m.candidateColumns({ ...p, filters: this.filters });
    this.root.querySelectorAll('[data-member]').forEach((input) => {
      input.checked = m.includedAfter(p.changes, input.dataset.member);
    });
    this.root.querySelectorAll('[data-bulk]').forEach((button) => {
      const scope = button.dataset.bulk;
      const rows = scope === 'all' ? Object.values(columns).flat() : columns[scope];
      const allChecked = rows.length && rows.every((row) => m.includedAfter(p.changes, row.id));
      const action = allChecked ? 'Deselect all' : 'Select all';
      button.textContent = action + (scope === 'all' ? ' matching' : '');
      button.setAttribute(
        'aria-label',
        `${action} ${scope === 'all' ? 'matching Terms' : scope + ' neighbors'}`,
      );
      button.disabled = !rows.length;
    });
    const added = [...p.changes.values()].filter(Boolean).length;
    this.root.querySelector('[data-pending]').textContent =
      `${added} to add · ${p.changes.size - added} to remove`;
    this.root.querySelector('[data-action=apply-membership]').disabled = !p.changes.size;
  }
  closePopup() {
    this.popup = false;
    this.renderPopup();
    (this.popupReturn?.isConnected
      ? this.popupReturn
      : this.root.querySelector('.graph-canvas')
    )?.focus();
    this.popupReturn = null;
  }
  async mutate(action) {
    this.cancelGesture?.();
    this.error = '';
    this.layout.cancel();
    this.busy = false;
    action();
    this.recent.clear();
    this.render();
    this.onChange();
    if (this.mode === 'structure') await this.arrange({ fit: true });
    else this.layoutDirty = false;
  }
  async command(action) {
    if (action === 'clear' && this.mode === 'explore') return this.applyExploreCommand('clear');
    if (action === 'explore-selected') return this.exploreSelected();
    if (action === 'find') {
      if (this.mode === 'explore')
        return this.openNeighbors(null, this.root.querySelector('[data-action=find]'));
      this.popup = true;
      this.search = '';
      this.renderPopup();
      this.root.querySelector('[data-filter=search]').focus();
      return;
    }
    if (action === 'close-popup') {
      this.closePopup();
      return;
    }
    if (action === 'apply-membership' && this.mode === 'explore' && this.popup) {
      const { changes, origin } = this.popup;
      this.popup = false;
      this.changeMembership(changes, { origin });
      this.root.querySelector('.graph-canvas').focus();
      return;
    }
    if (action === 'remove' && this.mode === 'explore')
      return this.changeMembership(new Map([...this.model.selection].map((id) => [id, false])));
    if (
      this.mode === 'explore' &&
      ['collapse-all', 'hide-others', 'unhide-selected', 'show-all'].includes(action)
    )
      return;
    if (action === 'collapse-all') return this.mutate(() => this.model.reset());
    if (action === 'hide-others')
      return this.mutate(() => this.model.hideOthers(this.hideMode, this.filters));
    if (action === 'unhide-selected') return this.mutate(() => this.model.unhideSelected());
    if (action === 'show-all') return this.mutate(() => this.model.showAll());
    if (action === 'undo') return this.mutate(() => this.model.undo());
    if (action === 'arrange') return this.arrange({ fit: true });
    if (action === 'fit') return this.fit();
    if (action === 'pane') return this.onToggleContext();
    if (action === 'reveal')
      return this.mode === 'explore'
        ? this.setIncluded(this.active, true)
        : this.mutate(() => this.model.reveal(this.active));
    if (action === 'zoom-in' || action === 'zoom-out')
      this.zoom(action === 'zoom-in' ? 1.2 : 1 / 1.2);
  }
  feedback() {
    if (!this.root) return;
    const targets = [
      this.pointerTarget,
      this.keyboardTarget?.matches?.(':focus-visible') ? this.keyboardTarget : null,
    ].filter((target) => target?.isConnected);
    const nodes = targets
      .map((target) => target.closest?.('[data-card]')?.dataset.card)
      .filter(Boolean);
    const indices = new Set(
      targets
        .map((target) => target.closest?.('[data-edge]')?.dataset.edge)
        .filter((index) => index !== undefined),
    );
    this.root.querySelectorAll('.structure-node').forEach((node) => {
      const selected = this.model.selection.has(node.dataset.card);
      node.classList.toggle('selected', selected);
      node.querySelector('[data-select]')?.setAttribute('aria-pressed', String(selected));
    });
    this.root.querySelectorAll('.graph-edge').forEach((el) => {
      const edge = this.drawnEdges[Number(el.dataset.edge)];
      const state = this.model.edgeFeedback(edge, nodes, indices.has(el.dataset.edge));
      for (const [name, enabled] of Object.entries(state)) el.classList.toggle(name, enabled);
      if (el.getAttribute('role') === 'button') {
        el.setAttribute('tabindex', state.concealed ? '-1' : '0');
        el.setAttribute('aria-hidden', String(state.concealed));
      }
    });
  }
  select(id, additive = false) {
    this.model.select(id, additive);
    this.selectionChanged();
  }
  selectionChanged() {
    this.root.querySelector('.graph-toolbar').outerHTML = this.toolbar();
    this.syncRelationSelector();
    this.feedback();
    this.caption();
  }
  bind() {
    this.highlightEvents?.abort();
    this.highlightEvents = new AbortController();
    let relationPointerActive = false;
    const closeRelationSelector = (event) => {
      const selector = this.root.querySelector('.graph-edge-filter[open]');
      if (selector && !selector.contains(event.target)) selector.open = false;
    };
    document.addEventListener(
      'pointerdown',
      (event) => {
        relationPointerActive = !!event.target.closest('.graph-edge-filter');
        closeRelationSelector(event);
      },
      { signal: this.highlightEvents.signal },
    );
    document.addEventListener(
      'focusin',
      (event) => {
        // Label presses can focus an ancestor before the checkbox receives focus.
        // Chromium 143 can crash if <details> closes during that native activation.
        if (!relationPointerActive) closeRelationSelector(event);
      },
      { signal: this.highlightEvents.signal },
    );
    for (const type of ['pointerup', 'pointercancel'])
      document.addEventListener(
        type,
        (event) => {
          relationPointerActive = false;
          closeRelationSelector(event);
        },
        {
          signal: this.highlightEvents.signal,
        },
      );
    window.addEventListener(
      'blur',
      () => {
        relationPointerActive = false;
      },
      { signal: this.highlightEvents.signal },
    );
    this.root.addEventListener(
      'toggle',
      (event) => {
        if (event.target.matches('.graph-edge-filter') && event.target.open)
          this.positionRelationSelector();
      },
      { capture: true, signal: this.highlightEvents.signal },
    );
    window.addEventListener('resize', () => this.positionRelationSelector(), {
      signal: this.highlightEvents.signal,
    });
    for (const type of ['pointerover', 'pointerout', 'focusin', 'focusout']) {
      this.root.addEventListener(
        type,
        (event) => {
          this[type.startsWith('pointer') ? 'pointerTarget' : 'keyboardTarget'] = type.endsWith(
            'out',
          )
            ? event.relatedTarget
            : event.target;
          this.feedback();
        },
        { signal: this.highlightEvents.signal },
      );
    }
    this.root.onclick = async (event) => {
      try {
        if (this.skipClick && event.detail && event.target.closest('.graph-canvas')) {
          this.skipClick = false;
          return;
        }
        const tool = event.target.closest('[data-tool]');
        if (tool) {
          this.cancelGesture?.();
          this.pointerTool = tool.dataset.tool;
          this.selectionChanged();
          this.pointerCursor();
          return;
        }
        const bulk = event.target.closest('[data-bulk]');
        if (bulk && this.popup) {
          const columns = this.model.candidateColumns({ ...this.popup, filters: this.filters });
          this.model.toggleMembership(
            this.popup.changes,
            bulk.dataset.bulk === 'all'
              ? Object.values(columns).flat()
              : columns[bulk.dataset.bulk],
          );
          this.syncMembershipDialog();
          return;
        }
        const mode = event.target.closest('[data-mode]');
        if (mode) return await this.setMode(mode.dataset.mode);
        const neighbors = event.target.closest('[data-neighbors]');
        if (neighbors) return this.openNeighbors(neighbors.dataset.neighbors, neighbors);
        const remove = event.target.closest('[data-remove-node]');
        if (remove) {
          this.setIncluded(remove.dataset.removeNode, false);
          this.root.querySelector('.graph-canvas').focus();
          return;
        }
        const move = event.target.closest('[data-move]');
        if (move) {
          if (!this.model.selection.has(move.dataset.move)) this.select(move.dataset.move);
          return;
        }
        const focus = event.target.closest('[data-focus]');
        if (focus) {
          await this.mutate(() => this.model.setFocus(focus.dataset.focus || null));
          return;
        }
        const reveal = event.target.closest('[data-reveal]');
        if (reveal) {
          this.popup = false;
          await this.mutate(() =>
            this.model.reveal(reveal.dataset.reveal, reveal.dataset.termDeclaration),
          );
          return;
        }
        const term = event.target.closest('[data-term]');
        if (term) {
          event.preventDefault();
          event.stopPropagation();
          this.render();
          await (this.onRead ? this.onRead(term.dataset.term) : this.inspect(term.dataset.term));
          return;
        }
        const toggle = event.target.closest('[data-toggle]');
        if (toggle) {
          const id = toggle.dataset.toggle;
          await this.mutate(() => {
            if (this.model.expanded.has(id)) this.model.collapse(id);
            else {
              this.model.expand(id);
              if (this.model.container(id)) {
                this.model.focus = id;
                this.model.sync();
              }
            }
          });
          return;
        }
        const selected = event.target.closest('[data-select]');
        if (selected) {
          this.select(selected.dataset.select, event.shiftKey || event.ctrlKey || event.metaKey);
          return;
        }
        const inspect = event.target.closest('[data-inspect]');
        if (inspect) {
          this.render();
          const target = this.model.describe(inspect.dataset.inspect);
          await (this.onRead && target?.type === 'term'
            ? this.onRead(target.term)
            : this.inspect(inspect.dataset.inspect));
          return;
        }
        const edge = event.target.closest('[data-edge]');
        if (edge) {
          ++this.readEpoch;
          this.edgeDetail = this.drawnEdges[Number(edge.dataset.edge)];
          this.panel();
          this.render();
          return;
        }
        if (event.target.matches('.graph-popup-backdrop')) {
          this.closePopup();
          return;
        }
        const action = event.target.closest('[data-action]')?.dataset.action;
        if (action) await this.command(action);
        else if (event.target.closest('.graph-canvas')) this.select(null);
      } catch (error) {
        this.error = error.message;
        this.render();
      }
    };
    this.root.onchange = (event) => {
      if (event.target.matches('[data-member]')) {
        const id = event.target.dataset.member;
        this.model.stageMembership(this.popup.changes, id, event.target.checked);
        this.syncMembershipDialog();
        return;
      }
      if (event.target.matches('[aria-label="Keep when hiding"]')) {
        this.hideMode = event.target.value;
        return;
      }
      if (event.target.matches('[aria-label="Graph layout"]')) {
        this.layoutAlgorithm = event.target.value;
        this.arrange({ fit: true });
        return;
      }
      if (event.target.matches('[data-edge-all]')) {
        this.setEdgeCategories(event.target.checked ? edgeCategories.map(({ id }) => id) : []);
        return;
      }
      if (event.target.matches('[data-edge-category]')) {
        this.setEdgeCategories(
          [...this.root.querySelectorAll('[data-edge-category]:checked')].map(
            (input) => input.dataset.edgeCategory,
          ),
        );
        return;
      }
      const key = event.target.dataset.filter;
      if (key) {
        (this.mode === 'explore' ? this.popup : this)[key] = event.target.value;
        this.renderPopup();
        this.root.querySelector(`[data-filter="${key}"]`)?.focus();
      }
    };
    this.root.oninput = (event) => {
      if (event.target.dataset.filter === 'search') {
        const { selectionStart, selectionEnd } = event.target;
        (this.mode === 'explore' ? this.popup : this).search = event.target.value;
        this.renderPopup();
        const input = this.root.querySelector('[data-filter=search]');
        input.focus();
        input.setSelectionRange(selectionStart, selectionEnd);
      }
    };
    this.root.onkeydown = (event) => this.handleGraphKey(event);
    const svg = this.root.querySelector('.graph-canvas');
    this.bindPointer(svg);
  }
  handleGraphKey(event) {
    const selector = event.target.closest('.graph-edge-filter');
    if (selector) {
      event.stopPropagation();
      if (event.key === 'Escape' && selector.open) {
        event.preventDefault();
        event.stopPropagation();
        selector.open = false;
        selector.querySelector('summary').focus();
      }
      return;
    }
    if (this.popup) {
      this.handlePopupKey(event);
      return;
    }
    if (event.target.matches('input,select,textarea')) return;
    if (event.key === 'Escape' && this.gestureActive) {
      event.preventDefault();
      event.stopPropagation();
      this.cancelGesture();
      return;
    }
    if (
      event.code === 'Space' &&
      this.mode === 'explore' &&
      event.target.matches('.graph-canvas')
    ) {
      event.preventDefault();
      this.spaceDown = true;
      this.pointerCursor();
      return;
    }
    if (this.gestureActive) return;
    if (event.target.matches('[data-move]') && event.key.startsWith('Arrow')) {
      this.moveFromKeyboard(event);
      return;
    }
    if (this.activateOrPanKey(event)) return;
    this.handleShortcut(event);
  }
  activateOrPanKey(event) {
    if (
      ['Enter', ' '].includes(event.key) &&
      event.target.matches(
        '[data-select],[data-toggle],[data-inspect],[data-edge],[data-focus],[data-neighbors],[data-move],[data-remove-node]',
      )
    ) {
      event.preventDefault();
      event.target.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          shiftKey: event.shiftKey,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
        }),
      );
      return true;
    }
    if (event.target.matches('.graph-canvas') && event.key.startsWith('Arrow')) {
      event.preventDefault();
      this.camera.x += event.key === 'ArrowLeft' ? 50 : event.key === 'ArrowRight' ? -50 : 0;
      this.camera.y += event.key === 'ArrowUp' ? 50 : event.key === 'ArrowDown' ? -50 : 0;
      this.transform();
      return true;
    }
    return false;
  }
  handlePopupKey(event) {
    if (this.popup && event.key === 'Tab') {
      const items = [
        ...this.root.querySelectorAll(
          '.graph-popup button:not(:disabled),.graph-popup input,.graph-popup select',
        ),
      ];
      const first = items[0],
        last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
      return;
    }
    if (event.key === 'Escape' && this.popup) {
      event.preventDefault();
      event.stopPropagation();
      this.closePopup();
      return;
    }
  }
  moveFromKeyboard(event) {
    event.preventDefault();
    const id = event.target.dataset.move,
      step = event.shiftKey ? 50 : 10;
    this.layout.cancel();
    this.busy = this.layoutDirty = false;
    const move = this.model.startMove(id);
    this.model.previewMove(
      move,
      event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0,
      event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0,
    );
    this.model.finishMove(move);
    this.draw();
    this.selectionChanged();
    [...this.root.querySelectorAll('[data-move]')]
      .find((node) => node.dataset.move === id)
      ?.focus();
  }
  handleShortcut(event) {
    let action = {
      '/': 'find',
      c: 'collapse-all',
      a: 'arrange',
      f: 'fit',
      t: 'pane',
      h: event.shiftKey ? 'show-all' : 'hide-others',
      u: 'unhide-selected',
      e: 'explore-selected',
      '+': 'zoom-in',
      '=': 'zoom-in',
      '-': 'zoom-out',
    }[event.key.toLowerCase()];
    if (this.mode === 'explore' && ['Delete', 'Backspace'].includes(event.key)) action = 'remove';
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') action = 'undo';
    else if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (action) {
      event.preventDefault();
      event.stopPropagation();
      this.command(action).catch((error) => {
        this.error = error.message;
        this.render();
      });
    }
  }
  pointerCursor() {
    const svg = this.root?.querySelector('.graph-canvas');
    if (!svg) return;
    svg.classList.toggle(
      'select-tool',
      this.mode === 'explore' && this.pointerTool === 'select' && !this.spaceDown,
    );
    svg.classList.toggle(
      'pan-tool',
      this.mode !== 'explore' || this.pointerTool === 'pan' || this.spaceDown,
    );
  }
  bindPointer(svg) {
    const model = this.model;
    let gesture = null,
      frame = null;
    const point = (event) => {
      const box = svg.getBoundingClientRect();
      return { x: event.clientX - box.x, y: event.clientY - box.y };
    };
    const world = (p, camera) => ({
      x: (p.x - camera.x) / camera.k,
      y: (p.y - camera.y) / camera.k,
    });
    const paint = () => {
      frame = null;
      const g = gesture;
      if (!g) return;
      const dx = g.current.x - g.start.x,
        dy = g.current.y - g.start.y;
      if (!g.started && Math.hypot(dx, dy) <= 4) return;
      if (!g.started) {
        g.started = true;
        if (g.kind !== 'pan') {
          this.layout.cancel();
          this.busy = this.layoutDirty = false;
        }
        if (g.kind === 'move') g.move = model.startMove(g.id);
      }
      if (g.kind === 'pan') {
        this.camera = { ...g.camera, x: g.camera.x + dx, y: g.camera.y + dy };
        this.transform();
      } else if (g.kind === 'move') {
        model.previewMove(g.move, dx / g.camera.k, dy / g.camera.k);
        this.draw();
        this.selectionChanged();
      } else {
        model.selectBox(
          world(g.start, g.camera),
          world(g.current, g.camera),
          g.additive ? g.selection : [],
        );
        const box = svg.querySelector('.graph-selection-box');
        box.removeAttribute('hidden');
        for (const [key, value] of Object.entries({
          x: Math.min(g.start.x, g.current.x),
          y: Math.min(g.start.y, g.current.y),
          width: Math.abs(dx),
          height: Math.abs(dy),
        }))
          box.setAttribute(key, String(value));
        this.selectionChanged();
      }
    };
    const finish = (commit = true) => {
      if (!gesture) return;
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      if (commit) paint();
      const g = gesture;
      gesture = null;
      this.gestureActive = false;
      this.skipClick = true;
      if (g.move) model.finishMove(g.move, commit);
      else if (!commit) {
        model.selection = new Set(g.selection);
        this.camera = g.camera;
      } else if (!g.started) {
        if (g.kind === 'box' || this.mode === 'structure') {
          if (!g.additive) model.select(null);
        } else if (g.kind === 'move') {
          if (!g.handle || !model.selection.has(g.id)) model.select(g.id, g.additive && !g.handle);
        }
      }
      if (svg.hasPointerCapture(g.pointerId)) svg.releasePointerCapture(g.pointerId);
      svg.querySelector('.graph-selection-box')?.setAttribute('hidden', '');
      svg.classList.remove('gesture-moving', 'gesture-panning', 'gesture-selecting');
      this.draw();
      this.selectionChanged();
      this.pointerCursor();
    };
    this.cancelGesture = () => finish(false);
    svg.onpointerdown = (event) => {
      this.skipClick = false;
      if (gesture || !event.isPrimary || ![0, 1].includes(event.button)) return;
      const handle = event.target.closest('[data-move]');
      const header = event.target.closest('[data-select]');
      if (
        event.target.closest(
          '[data-term],[data-neighbors],[data-remove-node],[data-inspect],[data-toggle],[data-focus]',
        )
      )
        return;
      const explore = this.mode === 'explore';
      const pan = explore
        ? event.button === 1 || this.spaceDown || this.pointerTool === 'pan'
        : !event.target.closest('[role=button],[data-edge]');
      const id = handle?.dataset.move || header?.dataset.select;
      const kind =
        explore && handle
          ? 'move'
          : pan
            ? 'pan'
            : explore && header && model.selection.has(id)
              ? 'move'
              : explore && !event.target.closest('[role=button],[data-edge]')
                ? 'box'
                : null;
      if (!kind) return;
      event.preventDefault();
      svg.focus({ preventScroll: true });
      const start = point(event);
      gesture = {
        kind,
        id,
        handle: !!handle,
        start,
        current: start,
        camera: { ...this.camera },
        selection: new Set(model.selection),
        additive: event.shiftKey || event.ctrlKey || event.metaKey,
        pointerId: event.pointerId,
        started: false,
      };
      this.gestureActive = true;
      svg.setPointerCapture(event.pointerId);
      svg.classList.add(
        kind === 'move'
          ? 'gesture-moving'
          : kind === 'pan'
            ? 'gesture-panning'
            : 'gesture-selecting',
      );
    };
    svg.onpointermove = (event) => {
      if (!gesture || event.pointerId !== gesture.pointerId) return;
      gesture.current = point(event);
      if (frame === null) frame = requestAnimationFrame(paint);
    };
    svg.onpointerup = (event) => {
      if (!gesture || event.pointerId !== gesture.pointerId) return;
      gesture.current = point(event);
      finish(true);
    };
    svg.onpointercancel = () => finish(false);
    svg.onlostpointercapture = () => finish(false);
    svg.onwheel = (event) => {
      event.preventDefault();
      if (!gesture) this.zoom(Math.exp(-event.deltaY * 0.001), point(event));
    };
    window.addEventListener(
      'keyup',
      (event) => {
        if (event.code === 'Space') {
          this.spaceDown = false;
          this.pointerCursor();
        }
      },
      { signal: this.highlightEvents.signal },
    );
    window.addEventListener(
      'blur',
      () => {
        this.spaceDown = false;
        finish(false);
        this.pointerCursor();
      },
      { signal: this.highlightEvents.signal },
    );
    this.pointerCursor();
  }
}
