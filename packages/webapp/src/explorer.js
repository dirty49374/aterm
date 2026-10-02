import {
  scopedTermDeclarations,
  knowledgeCatalog,
  libraryGroups,
  groupTree,
  termDeclarationKey,
  termDeclarationTermKind,
  localTermKind,
  serverProtocol,
} from './library-model.js';
import { localTerm, termKnowledge } from './identity.js';
import { readRoute, routeUrl } from '../public/routes.js';
import { UISessionConnection } from './ui-session.js';
import { NotesReader } from './notes.js';
import { QueryWorkspace } from './query-workspace.js';
import { ModelReference } from './model-reference.js';
import { LibraryNavigation } from './navigation.js';
import { WorkingSet } from '../public/working-set.js';
import { installTermDrag } from './term-drag.js';
import { TermPreview } from './term-preview.js';
import { GraphExplorer } from './graph.js';
import { createMarkdownRenderer, observeMarkdown } from './markdown.js';
export function createExplorer(router) {
  const initialRoute = readRoute(router.state.location);
  let routeApplying = 0,
    routeEpoch = 0,
    commandRunning = false,
    graphReady = Promise.resolve();
  let session;
  const workingSet = new WorkingSet(initialRoute.terms || []);
  let initialized = !!initialRoute.terms;
  const expanded = new Map();
  const reads = new Map();
  const pane = { tab: 'context', open: false, width: 380 };
  const $ = (selector) => document.querySelector(selector);
  const icons = {
    knowledge:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v16M12 5C9 3 6 3 3 4v15c3-1 6-1 9 2 3-3 6-3 9-2V4c-3-1-6-1-9 1Z"/></svg>',
    group:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7V5a1 1 0 0 1 1-1h5l2 3h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Z"/></svg>',
    file: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6M9 16h6"/></svg>',
    term: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5H4v14h4M16 5h4v14h-4M10 8l4 8"/></svg>',
  };

  const state = {
    home: '',
    revision: -1,
    termDeclarations: [],
    knowledges: [],
    diagnostics: [],
    warnings: [],
    files: [],
    ...initialRoute,
    detail: null,
    relations: [],
    occurrences: [],
    external: [],
    matchNames: null,
    searchEpoch: 0,
    detailEpoch: 0,
    refreshing: false,
    refreshError: false,
    reading: false,
    refreshAgain: false,
    offline: true,
  };
  const escape = (value) =>
    String(value ?? '').replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
    );
  const shortPath = (path = '') =>
    path.startsWith(state.home.replace(/\/[^/]+$/, '') + '/')
      ? path.slice(state.home.replace(/\/[^/]+$/, '').length + 1)
      : path;
  const urlFor = (term) =>
    routeUrl({ ...state, page: 'term', selected: term, terms: [term], tab: 'term-declarations' });
  const termLink = (term, label = term) =>
    `<a class="term-link" href="${escape(urlFor(term))}" draggable="true" data-term="${escape(term)}">${escape(label)}</a>`;
  const { markdown, codeBlock } = createMarkdownRenderer(termLink);
  const notes = new NotesReader({
    root: $('#notes-pane'),
    toggle: $('#notes-toggle'),
    markdown,
    changed: () => session?.reportSoon(),
    onOpen: () => showPane('note', true),
  });
  const modelReference = new ModelReference({
    root: $('#model-reference'),
    query,
    escape,
    markdown,
    codeBlock,
    termLink,
    shortPath,
    changed: () => session?.reportSoon(),
  });
  const queries = new QueryWorkspace({
    root: $('#graphql-main'),
    escape,
    termLink,
    codeBlock,
    terms: () => state.termDeclarations,
    changed: () => session?.reportSoon(),
    openTerms: async (ids, tab) => {
      state.page = 'term';
      state.tab = tab;
      workingSet.replace(ids);
      await renderTerm();
      if (tab === 'graph') {
        await graph.setMode('explore');
        await graph.applyExploreCommand('set', ids);
      }
      saveUrl(true);
    },
  });
  function showPage(page) {
    state.page = page;
    $('#main').hidden = page === 'graphql';
    $('#graphql-main').hidden = page !== 'graphql';
    $('.view-tabs .tabs').hidden = page === 'graphql';
    for (const button of document.querySelectorAll('[data-page]')) {
      if (button.dataset.page === (page === 'graphql' ? 'graphql' : 'term'))
        button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    }
  }
  function renderQueries() {
    showPage('graphql');
    graph.stop();
    document.body.classList.remove('graph-open');
    $('#active-term').textContent = 'GraphQL';
    $('#working-more').hidden = true;
    $('#term-status').textContent = 'Saved queries · Parameters · Term results';
    $('#copy-term').disabled = true;
    document.title = 'GraphQL · Aterm';
    queries.renderResult();
    saveUrl();
  }
  async function query(query) {
    const response = await fetch('/api/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Aterm-Protocol': String(serverProtocol) },
      body: JSON.stringify({ home: state.home, query }),
      signal: AbortSignal.timeout(30000),
    });
    const result = await response.json();
    if (!response.ok || result.error)
      throw new Error(result.error?.message || 'Could not read the model.');
    return result;
  }
  function connection(text, mode = '') {
    $('#connection').className = 'connection ' + mode;
    $('#connection span').textContent = text;
  }
  function notice(message) {
    $('#notice').hidden = !message;
    $('#notice').textContent = message || '';
  }
  function toast(message) {
    $('#toast').textContent = message;
    $('#toast').hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => {
      $('#toast').hidden = true;
    }, 2200);
  }
  function saveUrl(push = false) {
    if (routeApplying) return;
    const next = routeUrl({ ...state, terms: workingSet.terms, mode: graph.mode });
    const current = router.state.location;
    if (
      current.pathname + current.search + current.hash !== next ||
      JSON.stringify(current.state?.terms) !== JSON.stringify(workingSet.terms)
    )
      void router.navigate(next, { replace: !push, state: { terms: workingSet.terms } });
    session?.reportSoon();
  }
  function renderFilters() {
    for (const field of ['termKind', 'viewpoint']) {
      const choices = [
        ...new Set(
          scopedTermDeclarations(state.termDeclarations, state.knowledge)
            .map((termDeclaration) =>
              field === 'termKind'
                ? termDeclarationTermKind(termDeclaration)
                : termDeclaration[field],
            )
            .filter(Boolean),
        ),
      ].sort();
      if (state[field] && !choices.includes(state[field])) choices.push(state[field]);
      $('#' + field).innerHTML =
        `<option value="">All ${field === 'termKind' ? 'Term Kinds' : 'viewpoints'}</option>` +
        choices
          .map((choice) => `<option value="${escape(choice)}">${escape(choice)}</option>`)
          .join('');
      $('#' + field).value = state[field];
    }
  }
  const expandedLibraryBranches = new Set();
  const libraryBranchTerms = new Map();
  const libraryBranchId = (node) => JSON.stringify([node.knowledge, node.group]);
  function syncGraphMembership() {
    for (const input of document.querySelectorAll('[data-graph-member]'))
      input.checked = workingSet.has(input.dataset.graphMember);
    for (const input of document.querySelectorAll('[data-library-member]')) {
      const terms = libraryBranchTerms.get(input.dataset.libraryMember) || [];
      const included = terms.filter((term) => workingSet.has(term)).length;
      input.checked = terms.length > 0 && included === terms.length;
      input.indeterminate = included > 0 && included < terms.length;
      input.disabled = !terms.length;
    }
    for (const button of document.querySelectorAll('[data-add-term]')) {
      button.disabled = workingSet.has(button.dataset.addTerm);
      button.textContent = button.disabled ? 'In Working Set' : 'Add to Working Set';
    }
  }
  function renderLibrary() {
    renderKnowledgeContext();
    libraryBranchTerms.clear();
    const sorted = libraryGroups(state.termDeclarations, state);
    $('#term-count').textContent = sorted.length;
    const renderNode = (node) => {
      const terms = new Map();
      for (const termDeclaration of node.termDeclarations) {
        if (!terms.has(termDeclaration.id)) terms.set(termDeclaration.id, []);
        terms.get(termDeclaration.id).push(termDeclaration);
      }
      const contents =
        node.children.map(renderNode).join('') +
        [...terms]
          .map(
            ([name, termDeclarations]) =>
              `<div class="term-row"><input type="checkbox" class="graph-member-checkbox" data-graph-member="${escape(name)}" aria-label="Include ${escape(name)} in Working Set" title="Include in Working Set" ${workingSet.has(name) ? 'checked' : ''}><button class="term-button ${name === state.selected ? 'active' : ''}" draggable="true" data-term="${escape(name)}" title="${escape(name)}" ${name === state.selected ? 'aria-current="page"' : ''}><span class="term-copy"><span class="term-name">${escape(localTerm(name))}</span><span class="term-kind" title="${escape(termDeclarations.map(termDeclarationTermKind).join(', '))}">${escape([...new Set(termDeclarations.map((termDeclaration) => localTermKind(termDeclaration.termKind)))].join(', '))}</span></span></button></div>`,
          )
          .join('');
      const id = libraryBranchId(node);
      libraryBranchTerms.set(id, [
        ...new Set([
          ...node.children.flatMap((child) => libraryBranchTerms.get(libraryBranchId(child))),
          ...terms.keys(),
        ]),
      ]);
      const label = node.group ? `Group ${node.group}` : `Knowledge ${node.knowledge}`;
      const heading = `<span class="library-branch-icon" aria-hidden="true">${node.group ? icons.group : icons.knowledge}</span><span class="library-branch-name">${escape(node.group ? node.group.split('.').at(-1) : node.knowledge)}</span>`;
      return `<details class="library-group ${node.group ? '' : 'library-knowledge'}" data-library-branch="${escape(id)}" ${expandedLibraryBranches.has(id) || state.q ? 'open' : ''}><summary aria-label="${escape(label)}" title="Toggle ${escape(label)}"><input type="checkbox" class="graph-member-checkbox" data-library-member="${escape(id)}" aria-label="Include Terms in ${escape(label)} in Working Set" title="Toggle matching Terms in Working Set">${heading}${!node.group ? `<button class="reference-info" data-read-knowledge="${escape(node.knowledge)}" aria-label="Read Knowledge ${escape(node.knowledge)}" title="Read Description and Scope">ⓘ</button>` : ''}</summary><div class="library-group-content">${contents}</div></details>`;
    };
    $('#term-list').innerHTML = sorted.length
      ? groupTree(sorted.flatMap(([, termDeclarations]) => termDeclarations))
          .map(renderNode)
          .join('')
      : `<div class="library-empty">${state.knowledge && !state.knowledges.some((k) => k.id === state.knowledge) ? 'This Knowledge is no longer available.' : !scopedTermDeclarations(state.termDeclarations, state.knowledge).length ? 'No Terms in this Knowledge yet.' : 'No matching Terms.'}<br><button class="text-button" id="clear-library-filters">Clear search and filters</button><button class="text-button" data-knowledge="">Browse All Knowledge</button></div>`;
    syncGraphMembership();
  }
  $('#term-list').addEventListener('change', (event) => {
    const branch = event.target.closest('[data-library-member]');
    if (branch) {
      const terms = libraryBranchTerms.get(branch.dataset.libraryMember) || [];
      workingSet.apply(terms.map((term) => [term, branch.checked]));
      return;
    }
    const input = event.target.closest('[data-graph-member]');
    if (input) workingSet.apply([[input.dataset.graphMember, input.checked]]);
  });
  $('#term-list').addEventListener(
    'toggle',
    (event) => {
      const id = event.target.dataset.libraryBranch;
      if (!id || state.q) return;
      if (event.target.open) expandedLibraryBranches.add(id);
      else expandedLibraryBranches.delete(id);
    },
    true,
  );

  function renderKnowledgeContext() {
    const catalog = knowledgeCatalog(state.knowledges, state.termDeclarations);
    const selected = catalog.find((k) => k.id === state.knowledge);
    $('#knowledge-label').textContent = state.knowledge || 'All Knowledge';
    $('#knowledge-picker').title = selected
      ? [selected.description?.content, shortPath(selected.file)].filter(Boolean).join('\n')
      : state.knowledge || 'Browse all Knowledge';
    $('#knowledge-summary').textContent = state.knowledge
      ? selected
        ? `${selected.terms} Terms · ${shortPath(selected.file).split('/').at(-1)}`
        : 'Knowledge unavailable'
      : `${catalog.length} Knowledges · ${new Set(state.termDeclarations.map((e) => e.id)).size} Terms`;
    $('#search').placeholder = state.knowledge ? 'Find a Term here…' : 'Find across Knowledge…';
    $('#active-knowledge').textContent = state.knowledge || 'All Knowledge';
    $('#active-knowledge').title = 'Choose library Knowledge';
    $('#library-scope').hidden = true;
    $('#reading-context').hidden = true;
  }
  let knowledgeOpener;
  function openKnowledge() {
    knowledgeOpener = document.activeElement;
    $('#knowledge-search').value = '';
    renderKnowledgeOptions();
    $('#knowledge-dialog').showModal();
    $('#knowledge-search').focus();
  }
  function renderKnowledgeOptions() {
    const phrase = $('#knowledge-search').value.trim().toLowerCase();
    const catalog = knowledgeCatalog(state.knowledges, state.termDeclarations);
    const choices = [
      {
        id: '',
        file: `${catalog.length} Knowledges`,
        terms: new Set(state.termDeclarations.map((e) => e.id)).size,
      },
      ...catalog,
    ];
    $('#knowledge-options').innerHTML =
      choices
        .filter(
          (k) =>
            !k.id ||
            (k.id + ' ' + (k.description?.content || '') + ' ' + k.file)
              .toLowerCase()
              .includes(phrase),
        )
        .map(
          (k) =>
            `<button class="knowledge-option ${state.knowledge === k.id ? 'selected' : ''}" data-knowledge="${escape(k.id)}" aria-pressed="${state.knowledge === k.id}"><span class="knowledge-option-icon" aria-hidden="true">${k.id ? '◫' : '▦'}</span><span class="knowledge-option-copy"><strong>${escape(k.id || 'All Knowledge')}</strong>${k.description ? `<span class="knowledge-description">${escape(k.description.content)}</span>` : ''}<small>${escape(k.id ? shortPath(k.file) : k.file)}</small></span><span class="knowledge-option-count">${k.terms} Terms</span><span class="knowledge-check" aria-hidden="true">${state.knowledge === k.id ? '✓' : ''}</span></button>`,
        )
        .join('') +
      (phrase &&
      !catalog.some((k) =>
        (k.id + ' ' + (k.description?.content || '') + ' ' + k.file).toLowerCase().includes(phrase),
      )
        ? '<p class="library-empty">No matching Knowledge. Try an ID, description or filename.</p>'
        : '');
  }
  async function chooseKnowledge(knowledge) {
    state.knowledge = knowledge;
    state.termKind = '';
    state.viewpoint = '';
    state.matchNames = null;
    state.searchEpoch++;
    if ($('#knowledge-dialog').open) $('#knowledge-dialog').close();
    renderFilters();
    renderLibrary();
    $('#term-list').scrollTop = 0;
    saveUrl(true);
    await search();
  }
  function renderInspector(data) {
    const outgoing = data.relations.filter((r) => r.source === data.selected);
    const incoming = data.relations.filter(
      (r) => r.target === data.selected && r.source !== data.selected,
    );
    const cards = (relations, direction) =>
      relations
        .map((r) => {
          const term = direction === 'outgoing' ? r.target : r.source;
          return `<a class="connection-card" href="${escape(urlFor(term))}" draggable="true" data-term="${escape(term)}"><span class="relation-phrase">${escape(r.phrase)}</span><span class="relation-term">${escape(term)}</span></a>`;
        })
        .join('');
    const sources = [...new Map(data.external.map((r) => [`${r.source}:${r.file}`, r])).values()];
    return `<aside class="inspector" aria-label="Term context"><section class="inspector-section"><div class="inspector-heading"><h2>Connections</h2><span>${data.relations.length} Relations</span></div><div class="direction-label"><span class="direction-icon">↗</span> Outgoing <span>${outgoing.length}</span></div>${cards(outgoing, 'outgoing') || '<p class="empty-context">No outgoing Relations.</p>'}<div class="direction-label"><span class="direction-icon">↙</span> Incoming <span>${incoming.length}</span></div>${cards(incoming, 'incoming') || '<p class="empty-context">No incoming Relations.</p>'}</section><section class="inspector-section"><div class="inspector-heading"><h2>In source code</h2><span>${sources.length} files</span></div>${
      sources
        .slice(0, 8)
        .map(
          (r) =>
            `<button class="source-link" data-reference="${escape(r.file)}">${icons.file}<span>${escape(r.file.split('/').at(-1))}<small>ext.${escape(r.source)}: ${escape(r.file)}:${r.line}</small></span></button>`,
        )
        .join('') ||
      '<p class="empty-context">No exact Term tokens in the configured source files.</p>'
    }${sources.length > 8 ? '<button class="text-button" data-context-references>View all source references</button>' : ''}</section><section class="inspector-section"><div class="inspector-heading"><h2>Reading this Term</h2></div><p class="empty-context">Each Term has one Term Declaration.<br>References connect the whole Term.</p></section></aside>`;
  }
  function renderTermDeclarations(data) {
    if (!data.detail.termDeclarations.length)
      return '<div class="empty-panel">Select a Term from the library, or explore the Knowledge graph.</div>';
    return `<div class="term-declarations">${data.detail.termDeclarations.map((termDeclaration, index) => `<article class="term-declaration"><header class="term-declaration-top"><div class="term-declaration-type"><span class="term-kind-badge ${escape(localTermKind(termDeclaration.termKind))}">${escape(termDeclaration.termKind)}</span><span class="term-declaration-viewpoint">${termDeclaration.viewpoint ? `<button class="text-button reference-viewpoint-link" data-read-viewpoint="${escape(termDeclaration.viewpoint)}" title="Read Viewpoint">${escape(termDeclaration.viewpoint)}</button>` : 'Unclassified'}${termDeclaration.group ? ` · ${escape(termDeclaration.group)}` : ''}</span></div><span class="term-declaration-number">Term Declaration</span></header><div class="term-declaration-source">${icons.file}<span>${escape(shortPath(termDeclaration.file))}:${termDeclaration.line}</span></div><div class="term-declaration-sections">${termDeclaration.sections.map((section) => `<section class="content-section ${section.key === 'definition' ? 'definition' : ''}"><h2 class="section-title">${escape(section.key[0].toUpperCase() + section.key.slice(1))}</h2><div class="prose">${section.filetype !== 'md' ? codeBlock(section.content, section.filetype === 'ts' ? 'typescript' : section.filetype) : markdown(section.content, termDeclaration.knowledge, section.key)}</div></section>`).join('')}</div>${termDeclaration.scope ? `<details class="scope" data-scope="${escape(termDeclaration.file)}"><summary>Knowledge scope</summary><div class="prose">${markdown(termDeclaration.scope.content, termDeclaration.knowledge)}</div></details>` : ''}</article>`).join('')}</div>`;
  }
  function highlight(text, term) {
    return escape(text)
      .split(escape(term))
      .join(`<mark>${escape(term)}</mark>`);
  }
  function renderReferences(data) {
    return `<div class="references-view"><div class="reference-heading"><h2>Source code</h2><span>${data.external.length} exact occurrences</span></div>${data.external.map((o) => `<article class="reference-block" data-source="${escape(o.file)}"><header><span>${icons.file} ext.${escape(o.source)}: ${escape(o.file)}</span><span>Line ${o.line}, column ${o.column}</span></header><pre><span class="line-number">${o.line}</span>${highlight(o.text, data.selected)}</pre></article>`).join('') || '<div class="empty-panel">No source references for this Term.<br>Source search uses the named globs in externalSources in aterm.yaml.</div>'}<div class="reference-heading" style="margin-top:35px"><h2>In the model</h2><span>${data.occurrences.length} occurrences</span></div>${data.occurrences.map((o) => `<article class="reference-block"><header><span>${termLink(o.term)} <span class="term-declaration-viewpoint">${escape(o.termKind)}</span></span><span>${escape(shortPath(o.file))}:${o.line}</span></header><pre>${o.lines.map((line) => `<span class="line-number">${line.line}</span>${highlight(line.text, data.selected)}`).join('\n')}</pre></article>`).join('') || '<div class="empty-panel">No corpus references.</div>'}</div>`;
  }
  const graph = new GraphExplorer({
    query,
    workingSet,
    onContext: (html, id, edge) => {
      ++state.detailEpoch;
      state.reading = false;
      state.selected = '';
      state.graphContext = { id, edge };
      $('#context-content').innerHTML = html;
      showPane('context', true);
      saveUrl(true);
    },
    onToggleContext: () => showPane('context', !pane.open || pane.tab !== 'context'),
    escape,
    markdown,
    codeBlock,
    onChange: () => {
      syncGraphMembership();
      session?.reportSoon();
    },
    onModeChange: () => saveUrl(true),
    onRead: (term) => selectTerm(term, { push: true, preserve: true }),
    termUrl: urlFor,
    onDialogChange: (open) => {
      navigation.blocked = open;
      navigation.render();
      for (const node of document.querySelectorAll(
        '.topbar,.view-tabs,#library-divider,#context-pane',
      ))
        node.inert = open;
    },
  });
  function showPane(tab, open = true) {
    pane.tab = tab;
    pane.open = open;
    $('#context-pane').hidden = !open;
    $('#context-divider').hidden = !open;
    $('#context-content').hidden = tab !== 'context';
    $('#context-heading').textContent = tab === 'note' ? 'Note' : 'Context';
    notes.show(open && tab === 'note');
    for (const button of document.querySelectorAll('[data-pane]')) {
      button.setAttribute('aria-selected', String(open && button.dataset.pane === tab));
      button.tabIndex = button.dataset.pane === tab ? 0 : -1;
    }
    $('.shell-body').style.setProperty('--context-width', pane.width + 'px');
    session?.reportSoon();
  }
  function loadTerm(term) {
    if (reads.has(term)) return reads.get(term).promise;
    const revision = state.revision;
    const record = {};
    record.promise = Promise.all([
      query({ operation: 'show', termPatterns: [term], caseSensitive: true }),
      query({
        operation: 'relations',
        termPatterns: [term],
        edgeOrigins: ['relation'],
        caseSensitive: true,
      }),
      query({ operation: 'grep', referencePattern: term, caseSensitive: true }),
    ])
      .then(([detail, relationResult, references]) => {
        const data = {
          selected: term,
          detail,
          relations: relationResult.relations || [],
          occurrences: references.occurrences || [],
          external: references.externalOccurrences || [],
        };
        if (revision === state.revision) record.data = data;
        return data;
      })
      .catch((error) => {
        record.error = error.message;
        throw error;
      });
    reads.set(term, record);
    return record.promise;
  }
  function renderWorkingSet() {
    if (!workingSet.terms.length)
      return `<div class="working-empty"><span>Working Set</span><h1>Put a few Terms side by side.</h1><p>Choose a Term in the tree, use its checkbox, or drag any Term here.</p><p>Term Declarations, References and Explore share this same set.</p></div>`;
    return `<div class="working-cards">${workingSet.terms
      .map((term, index) => {
        const termDeclarations = state.termDeclarations.filter(
          (termDeclaration) => termDeclaration.id === term,
        );
        if (!expanded.has(term)) expanded.set(term, index === 0);
        const open = expanded.get(term);
        const data = { detail: { termDeclarations } };
        let content = '';
        if (open && state.tab === 'term-declarations') content = renderTermDeclarations(data);
        if (open && state.tab === 'references') {
          const record = reads.get(term);
          content = record?.data
            ? renderReferences(record.data)
            : `<p class="empty-panel">${escape(record?.error || 'Reading references…')}</p>`;
          if (!record)
            void loadTerm(term)
              .catch(() => {})
              .then(() => {
                if (state.tab === 'references' && state.page !== 'diagnostics') renderReader();
              });
        }
        return `<article class="working-card ${open ? 'expanded' : ''}" data-working-term="${escape(term)}">
        <header class="working-card-header"><button class="card-toggle" data-expand-term="${escape(term)}" aria-expanded="${open}" aria-label="${open ? 'Collapse' : 'Expand'} ${escape(term)}">${open ? '⌄' : '›'}</button><div class="working-card-title"><h2>${termLink(term, localTerm(term))}</h2><div class="working-attributes">${escape(termKnowledge(term))} <span>·</span> ${termDeclarations.map((termDeclaration) => escape(termDeclarationTermKind(termDeclaration))).join(' · ')}</div></div><button class="icon-button" data-remove-term="${escape(term)}" aria-label="Remove ${escape(term)} from Working Set" title="Remove from Working Set">×</button></header>
        ${!open ? `<div class="working-definition">${termDeclarations.map((termDeclaration) => `<div class="prose">${termDeclarations.length > 1 ? `<span class="term-kind-badge">${escape(termDeclarationTermKind(termDeclaration))}</span>` : ''}${markdown(termDeclaration.sections.find((section) => section.key === 'definition')?.content || '', termDeclaration.knowledge)}</div>`).join('')}</div>` : `<div class="working-card-body">${content}</div>`}</article>`;
      })
      .join('')}</div>`;
  }
  function renderReader() {
    const body = $('#term-panel');
    if (!body || state.tab === 'graph' || state.page !== 'term') return;
    const scroll = body.scrollTop;
    body.innerHTML = renderWorkingSet();
    body.scrollTop = scroll;
  }
  async function renderTerm() {
    showPage('term');
    const main = $('#main');
    main.classList.add('term-page');
    document.body.classList.toggle('graph-open', state.tab === 'graph');
    for (const button of document.querySelectorAll('[data-tab]')) {
      button.setAttribute('aria-selected', String(button.dataset.tab === state.tab));
      button.tabIndex = button.dataset.tab === state.tab ? 0 : -1;
    }
    const first = workingSet.terms[0];
    const title = first ? localTerm(first) : 'No Terms';
    const remaining = Math.max(0, workingSet.terms.length - 1);
    $('#active-term').innerHTML = first ? termLink(first, title) : title;
    $('#active-term').title = first || 'Empty Working Set';
    $('#working-more').hidden = !remaining;
    $('#working-more').textContent = `${remaining} more`;
    $('#working-more').title = workingSet.terms.slice(1).join('\n');
    $('#copy-term').disabled = !workingSet.terms.length;
    $('#copy-term').title = 'Copy Working Set Terms';
    const count = state.termDeclarations.filter((termDeclaration) =>
      workingSet.has(termDeclaration.id),
    ).length;
    $('#term-status').textContent =
      `${workingSet.terms.length} ${workingSet.terms.length === 1 ? 'Term' : 'Terms'} · ${count} ${count === 1 ? 'Term Declaration' : 'Term Declarations'}`;
    document.title = `${title}${remaining ? ` · ${remaining} more` : ''} · Aterm`;
    syncGraphMembership();
    if (state.tab === 'graph') {
      if (!main.querySelector('#graph-root')) {
        main.innerHTML =
          '<div class="view-body" id="term-panel" role="tabpanel" aria-label="Graph"><div id="graph-root"></div></div>';
        graphReady = graph.mount(
          $('#graph-root'),
          state.selected,
          state.termDeclarations,
          state.revision,
          state.knowledges,
        );
        await graphReady;
      } else graph.render();
    } else {
      graph.stop();
      if (main.querySelector('#graph-root') || !main.querySelector('#term-panel'))
        main.innerHTML =
          '<div class="view-body" id="term-panel" role="tabpanel" tabindex="0"></div>';
      $('#term-panel').setAttribute('aria-label', state.tab);
      renderReader();
    }
  }
  let membershipPending = false;
  const unsubscribeWorkingSet = workingSet.subscribe(() => {
    initialized = true;
    syncGraphMembership();
    if (membershipPending) return;
    membershipPending = true;
    queueMicrotask(() => {
      membershipPending = false;
      saveUrl(true);
      if (state.page === 'term' && !state.refreshing) void renderTerm();
    });
  });
  async function selectTab(tab) {
    state.page = 'term';
    state.tab = tab;
    saveUrl(true);
    await renderTerm();
  }
  function renderDiagnostics() {
    document.body.classList.remove('graph-open');
    $('#main').classList.remove('term-page');
    graph.stop();
    showPage('diagnostics');
    saveUrl();
    state.detailEpoch++;
    state.reading = false;
    const issues = [...state.diagnostics, ...state.warnings];
    $('#main').innerHTML =
      `<div class="diagnostics-view"><div class="term-overline">Workspace health</div><h1>${state.diagnostics.length ? 'The model needs attention.' : 'Your model checks out.'}</h1><p>${state.termDeclarations.length} Term Declarations across ${state.files.length} files. Structural checks verify declarations and references.</p>${issues.map((issue) => `<article class="diagnostic"><p>${escape(issue.message)}</p><small>${escape(shortPath(issue.file))}:${issue.line}</small></article>`).join('') || '<div class="empty-panel">No structural diagnostics.<br>Scope coverage and semantic completeness still need review.</div>'}<button class="text-button" id="back-term">Return to Working Set</button></div>`;
  }
  let draggingTerm = false;
  const termPreview = new TermPreview({
    root: $('#term-preview'),
    termDeclarations: (term) =>
      state.termDeclarations.filter((termDeclaration) => termDeclaration.id === term),
    blocked: () =>
      draggingTerm ||
      graph.gestureActive ||
      !!graph.popup ||
      state.refreshing ||
      $('#knowledge-dialog').open ||
      modelReference.open,
    copy: (term) => navigator.clipboard.writeText(term),
    render: (term, termDeclarations) =>
      `<header class="term-preview-header"><h2>${termLink(term)}</h2><button type="button" class="term-preview-copy" data-copy-preview aria-label="Copy Term name" title="Copy qualified Term name"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/></svg></button></header><div class="term-preview-body">${termDeclarations.map((termDeclaration) => `<section><div class="term-preview-kind">${escape(termDeclarationTermKind(termDeclaration))}</div><div class="prose">${termDeclaration.definition ? markdown(termDeclaration.definition, termDeclaration.knowledge) : '<p class="muted">No Definition available.</p>'}</div></section>`).join('')}</div><p class="term-preview-status" data-preview-status role="status"></p>`,
  });
  const disposeDrag = installTermDrag({
    main: $('#main'),
    accepts: (term) =>
      state.termDeclarations.some((termDeclaration) => termDeclaration.id === term),
    changed: (active) => {
      draggingTerm = active;
      if (active) {
        termPreview.close();
        if (modelReference.open) $('#model-reference').close();
      }
      session?.reportSoon();
    },
    drop: (term) => {
      if (graph.popup) graph.closePopup();
      workingSet.apply([[term, true]]);
      toast(`${localTerm(term)} in Working Set`);
    },
  });
  $('#main').addEventListener('click', (event) => {
    const expand = event.target.closest('[data-expand-term]');
    if (expand) {
      const id = expand.dataset.expandTerm;
      expanded.set(id, !expanded.get(id));
      renderReader();
      [...document.querySelectorAll('[data-expand-term]')]
        .find((button) => button.dataset.expandTerm === id)
        ?.focus({ preventScroll: true });
    }
    const remove = event.target.closest('[data-remove-term]');
    if (remove) workingSet.apply([[remove.dataset.removeTerm, false]]);
  });
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-pane]');
    if (button) showPane(button.dataset.pane, !(pane.open && pane.tab === button.dataset.pane));
    const add = event.target.closest('[data-add-term]');
    if (add) workingSet.apply([[add.dataset.addTerm, true]]);
  });
  $('#context-close').addEventListener('click', () => {
    showPane(pane.tab, false);
    $(`[data-pane=${pane.tab}]`).focus({ preventScroll: true });
  });
  $('#context-pane').addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      $('#context-close').click();
    }
  });
  $('.reader-tabs').addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    showPane(pane.tab === 'context' ? 'note' : 'context');
    $(`[data-pane=${pane.tab}]`).focus();
  });
  let resizingContext;
  const divider = $('#context-divider');
  const resizeContext = (width) => {
    pane.width = Math.max(
      280,
      Math.min(680, innerWidth - (navigation.docked ? navigation.width : 0) - 260, width),
    );
    $('.shell-body').style.setProperty('--context-width', pane.width + 'px');
    divider.setAttribute('aria-valuenow', String(Math.round(pane.width)));
  };
  divider.addEventListener('pointerdown', (event) => {
    resizingContext = { x: event.clientX, width: pane.width };
    divider.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  divider.addEventListener('pointermove', (event) => {
    if (resizingContext) resizeContext(resizingContext.width + resizingContext.x - event.clientX);
  });
  for (const type of ['pointerup', 'pointercancel'])
    divider.addEventListener(type, () => {
      resizingContext = null;
    });
  divider.addEventListener('keydown', (event) => {
    if (['ArrowLeft', 'ArrowRight'].includes(event.key)) {
      event.preventDefault();
      resizeContext(pane.width + (event.key === 'ArrowLeft' ? 20 : -20));
    }
  });
  async function selectTerm(term, { push = true, open = true } = {}) {
    state.graphContext = null;
    state.selected = term;
    graph.active = term;
    saveUrl(push);
    renderLibrary();
    const epoch = ++state.detailEpoch;
    state.reading = true;
    if (open) showPane('context', true);
    const scroll = open ? 0 : $('#context-content').scrollTop;
    $('#context-content').innerHTML = `<p class="empty-panel">Reading ${escape(term)}…</p>`;
    try {
      const data = await loadTerm(term);
      if (epoch !== state.detailEpoch) return;
      if (!data.detail.ambiguity && data.detail.termDeclarations.length) {
        term = data.detail.termDeclarations[0].id;
        data.selected = term;
        graph.active = term;
      }
      Object.assign(state, data);
      saveUrl(false);
      if (data.detail.ambiguity) {
        $('#context-content').innerHTML =
          `<p>${escape(data.detail.ambiguity.hint)}</p>${data.detail.ambiguity.candidates.map((c) => termLink(c.id)).join('<br>')}`;
        return;
      }
      $('#context-content').innerHTML =
        `<div class="context-term-heading"><h2>${termLink(term, localTerm(term))}</h2><p><button class="text-button" data-read-knowledge="${escape(termKnowledge(term))}" title="Read Knowledge Description and Scope">${escape(termKnowledge(term))}</button></p><button class="text-button" data-add-term="${escape(term)}">Add to Working Set</button></div>${data.detail.termDeclarations.length ? renderTermDeclarations(data) + renderInspector(data) : '<p class="empty-panel">Term unavailable in this revision.</p>'}`;
      syncGraphMembership();
      $('#context-content').scrollTop = scroll;
    } catch (error) {
      if (epoch === state.detailEpoch)
        $('#context-content').innerHTML = `<p class="empty-panel">${escape(error.message)}</p>`;
    } finally {
      if (epoch === state.detailEpoch) state.reading = false;
      session?.reportSoon();
    }
  }
  async function search() {
    const epoch = ++state.searchEpoch;
    state.matchNames = null;
    renderLibrary();
    if (
      !state.q ||
      !state.home ||
      state.diagnostics.length ||
      (state.knowledge && !state.knowledges.some((k) => k.id === state.knowledge))
    )
      return;
    try {
      const result = await query({
        operation: 'search',
        searchText: state.q,
        ...(state.knowledge ? { knowledge: state.knowledge } : {}),
        externalSources: {},
      });
      if (epoch !== state.searchEpoch) return;
      state.matchNames = new Set(result.termDeclarations.map(termDeclarationKey));
      renderLibrary();
    } catch (error) {
      if (epoch === state.searchEpoch) notice(error.message);
    }
  }
  function acceptCheckResult(result) {
    state.termDeclarations = result.termDeclarations;
    reads.clear();
    state.knowledges = result.knowledges || [];
    void modelReference.refresh();
    if ($('#knowledge-dialog').open) renderKnowledgeOptions();
    state.files = result.files;
    state.diagnostics = result.diagnostics;
    state.warnings = result.warnings || [];
    $('#diagnostics-label').textContent = state.diagnostics.length
      ? `${state.diagnostics.length} errors`
      : 'Model checks passed';
    $('#diagnostics-button').classList.toggle('has-errors', !!state.diagnostics.length);
    $('.check-symbol').textContent = state.diagnostics.length ? '!' : '✓';
    $('#model-summary').textContent =
      `${new Set(state.termDeclarations.map((termDeclaration) => termDeclaration.id)).size} Terms / ${state.termDeclarations.length} Term Declarations / ${state.files.length} files`;
    renderFilters();
    renderLibrary();
  }
  function reconcileWorkingSet() {
    const ids = new Set(state.termDeclarations.map((termDeclaration) => termDeclaration.id));
    if (!initialized) {
      const matches = [...ids].filter(
        (id) => id === state.selected || localTerm(id) === state.selected,
      );
      const first = state.selected
        ? matches.length === 1
          ? matches[0]
          : undefined
        : scopedTermDeclarations(state.termDeclarations, state.knowledge)[0]?.id;
      workingSet.replace(first ? [first] : []);
      initialized = true;
    } else workingSet.replace(workingSet.terms.filter((id) => ids.has(id)));
  }
  async function refreshGraphContext() {
    if (state.graphContext) {
      if (state.graphContext.edge || !graph.model.describe(state.graphContext.id)) {
        state.graphContext = null;
        $('#context-content').innerHTML =
          '<p class="empty-panel">This Graph context changed. Read a current Node or connection to continue.</p>';
      } else await graph.inspect(state.graphContext.id);
    }
  }
  async function refreshReadingViews() {
    notice('');
    reconcileWorkingSet();
    await graph.prepare(state.termDeclarations, state.knowledges, state.revision);
    await refreshGraphContext();
    if (state.page === 'diagnostics') renderDiagnostics();
    else if (state.page === 'graphql') renderQueries();
    else {
      await renderTerm();
      if (state.tab === 'graph' && graph.layoutDirty) await graph.arrange({ fit: false });
    }
    if (state.selected)
      await selectTerm(state.selected, {
        push: false,
        open: pane.open && pane.tab === 'context',
      });
    await search();
    connection('Connected');
  }
  async function refresh() {
    if (!state.home) return;
    if (state.refreshing) {
      state.refreshAgain = true;
      return;
    }
    graph.cancelGesture?.();
    termPreview.close();
    state.refreshing = true;
    state.refreshError = false;
    $('#refresh').disabled = true;
    connection('Updating', 'pending');
    try {
      const result = await query({ operation: 'check' });
      acceptCheckResult(result);
      if (state.diagnostics.length) {
        notice('The current model has errors. Resolve the diagnostics to resume reading.');
        renderDiagnostics();
        connection('Model errors', 'offline');
      } else {
        await refreshReadingViews();
      }
    } catch (error) {
      state.refreshError = true;
      notice(error.message);
      connection('Refresh failed', 'offline');
    } finally {
      state.refreshing = false;
      $('#refresh').disabled = false;
      if (state.refreshAgain) {
        state.refreshAgain = false;
        await refresh();
      }
    }
  }
  async function acceptHealth(health) {
    const changed = state.offline || state.revision !== health.revision;
    state.home = health.home;
    notes.setHome(health.home);
    queries.setHome(health.home);
    state.offline = false;
    const workspace = health.home.replace(/\/[^/]+$/, '');
    $('#workspace-name').textContent = workspace.split('/').at(-1) || 'Workspace';
    $('#workspace-path').textContent = workspace;
    $('#workspace-path').title = workspace;
    if (!health.ready) {
      state.refreshError = true;
      notice(health.error?.message || 'The server cannot refresh this model.');
      connection('Refresh error', 'offline');
    } else if (changed || state.refreshError) {
      state.revision = health.revision;
      $('#revision').textContent = `Revision ${health.revision}`;
      await refresh();
    }
  }
  const navigation = new LibraryNavigation({
    changed: () => session?.reportSoon(),
    interacting: () =>
      draggingTerm ||
      termPreview.open ||
      !!graph.popup ||
      $('#knowledge-dialog').open ||
      modelReference.open,
  });
  $('#knowledge-picker').addEventListener('click', openKnowledge);
  $('#model-reference-open').addEventListener('click', () => {
    termPreview.close();
    void modelReference.show('knowledge', state.knowledge || undefined);
  });
  $('#active-knowledge').addEventListener('click', openKnowledge);
  $('#library-scope').addEventListener('click', openKnowledge);
  $('#close-knowledge').addEventListener('click', () => $('#knowledge-dialog').close());
  $('#knowledge-dialog').addEventListener('close', () => knowledgeOpener?.focus());
  $('#knowledge-search').addEventListener('input', renderKnowledgeOptions);
  $('#knowledge-dialog').addEventListener('keydown', (event) => {
    if (event.key === 'Tab') {
      const controls = [...$('#knowledge-dialog').querySelectorAll('button, input')];
      const first = controls[0],
        last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
    const options = [...$('#knowledge-options').querySelectorAll('button')];
    const index = options.indexOf(document.activeElement);
    if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault();
      const next = event.key === 'ArrowDown' ? Math.min(index + 1, options.length - 1) : index - 1;
      (next < 0 ? $('#knowledge-search') : options[next])?.focus();
    }
    if (event.key === 'Enter' && document.activeElement === $('#knowledge-search')) {
      event.preventDefault();
      const match = $('#knowledge-search').value.trim()
        ? options.find((button) => button.dataset.knowledge) || options[0]
        : options.find((button) => button.classList.contains('selected')) || options[0];
      match?.click();
    }
  });
  $('#search').value = state.q;
  $('#search').addEventListener('input', (event) => {
    state.q = event.target.value;
    state.searchEpoch++;
    state.matchNames = null;
    renderLibrary();
    saveUrl();
    clearTimeout(search.timer);
    search.timer = setTimeout(search, 180);
  });
  for (const field of ['termKind', 'viewpoint'])
    $('#' + field).addEventListener('change', (event) => {
      state[field] = event.target.value;
      saveUrl();
      renderLibrary();
    });
  $('#refresh').addEventListener('click', async () => {
    if (!state.offline) await refresh();
  });
  $('#diagnostics-button').addEventListener('click', renderDiagnostics);
  for (const button of document.querySelectorAll('[data-page]'))
    button.addEventListener('click', () => {
      state.page = button.dataset.page;
      saveUrl(true);
      if (state.page === 'graphql') renderQueries();
      else void renderTerm();
    });
  document.addEventListener('click', async (event) => {
    const resource = event.target.closest('[data-read-knowledge],[data-read-viewpoint]');
    if (resource) {
      event.preventDefault();
      termPreview.close();
      const type = resource.hasAttribute('data-read-knowledge') ? 'knowledge' : 'viewpoint';
      await modelReference.show(
        type,
        resource.dataset[type === 'knowledge' ? 'readKnowledge' : 'readViewpoint'],
      );
      return;
    }
    const knowledge = event.target.closest('[data-knowledge]');
    if (knowledge) {
      await chooseKnowledge(knowledge.dataset.knowledge);
      return;
    }
    if (event.target.closest('#clear-library-filters')) {
      state.q = '';
      state.termKind = '';
      state.viewpoint = '';
      state.matchNames = null;
      state.searchEpoch++;
      $('#search').value = '';
      saveUrl();
      renderFilters();
      renderLibrary();
      return;
    }
    if (event.target.closest('.brand')) {
      event.preventDefault();
      state.knowledge = '';
      state.q = '';
      state.termKind = '';
      state.viewpoint = '';
      state.matchNames = null;
      $('#search').value = '';
      renderFilters();
      const first = state.termDeclarations.some(
        (termDeclaration) => termDeclaration.id === '_aterm:Term_',
      )
        ? '_aterm:Term_'
        : state.termDeclarations[0]?.id;
      workingSet.replace(first ? [first] : []);
      await renderTerm();
      return;
    }
    const term = event.target.closest('[data-term]');
    if (term && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      if (term.closest('#term-list')) {
        workingSet.replace([term.dataset.term]);
        await renderTerm();
      } else await selectTerm(term.dataset.term);
      return;
    }
    const tab = event.target.closest('[data-tab]');
    if (tab) {
      await selectTab(tab.dataset.tab);
      return;
    }
    const reference = event.target.closest('[data-reference]');
    if ((reference || event.target.closest('[data-context-references]')) && state.detail) {
      $('#context-content .context-references')?.remove();
      $('#context-content').insertAdjacentHTML(
        'beforeend',
        `<section class="context-references">${renderReferences(state)}</section>`,
      );
      const block = [...$('#context-content').querySelectorAll('[data-source]')].find(
        (node) => node.dataset.source === reference?.dataset.reference,
      );
      (block || $('#context-content .context-references')).scrollIntoView({ block: 'start' });
      return;
    }
    if (event.target.closest('#copy-term')) {
      try {
        await navigator.clipboard.writeText(workingSet.terms.join('\n'));
        toast('Working Set copied');
      } catch {
        toast('Select the Term name to copy it.');
      }
    }
    if (event.target.closest('#open-diagnostics')) renderDiagnostics();
    if (event.target.closest('#back-term')) {
      await renderTerm();
      saveUrl(true);
    }
  });
  document.addEventListener('keydown', (event) => {
    if ($('#knowledge-dialog').open || modelReference.open) return;
    if (
      event.key.toLowerCase() === 't' &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) &&
      !document.activeElement.isContentEditable
    ) {
      event.preventDefault();
      showPane('context', !pane.open || pane.tab !== 'context');
    }
    if (event.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) {
      event.preventDefault();
      navigation.show();
      $('#search').focus();
    }
    if (
      ['ArrowLeft', 'ArrowRight'].includes(event.key) &&
      document.activeElement.matches('[data-tab]')
    ) {
      event.preventDefault();
      const tabs = ['term-declarations', 'references', 'graph'];
      const next = tabs[(tabs.indexOf(state.tab) + (event.key === 'ArrowRight' ? 1 : 2)) % 3];
      void selectTab(next).then(() => $(`[data-tab=${state.tab}]`)?.focus());
    }
    if (event.key === 'Escape') {
      if (!navigation.docked && !navigation.collapsed) navigation.close();
      else document.activeElement.blur();
    }
    if (event.key === 'ArrowDown' && document.activeElement === $('#search')) {
      event.preventDefault();
      $('.term-button')?.focus();
    }
  });
  async function applyRoute(location) {
    const epoch = ++routeEpoch;
    const next = readRoute(location);
    const current = routeUrl({ ...state, terms: workingSet.terms, mode: graph.mode });
    if (
      current === routeUrl(next) &&
      !location.hash &&
      (!next.terms || JSON.stringify(next.terms) === JSON.stringify(workingSet.terms))
    )
      return;
    routeApplying++;
    if (session) session.active = true;
    try {
      Object.assign(state, next);
      if (next.terms && state.home)
        workingSet.replace(
          next.terms.filter((id) =>
            state.termDeclarations.some((termDeclaration) => termDeclaration.id === id),
          ),
        );
      $('#search').value = state.q;
      renderFilters();
      await search();
      if (!state.home || epoch !== routeEpoch) return;
      if (state.page === 'diagnostics') return renderDiagnostics();
      if (state.page === 'graphql') return renderQueries();
      await renderTerm();
      if (state.selected)
        await selectTerm(state.selected, {
          push: false,
          open: pane.open && pane.tab === 'context',
        });
      if (state.tab === 'graph' && epoch === routeEpoch) await graph.setMode(next.mode);
    } finally {
      routeApplying--;
      session?.reportSoon();
    }
  }
  const unsubscribe = router.subscribe(({ location, navigation }) => {
    if (navigation.state === 'idle')
      void applyRoute(location).catch((error) => notice(error.message));
  });
  const markdownObserver = observeMarkdown(document.body);
  graph.mode = initialRoute.mode;
  function isBusy() {
    return !!(
      commandRunning ||
      queries.busy ||
      routeApplying ||
      state.refreshing ||
      state.reading ||
      state.offline ||
      state.refreshError ||
      state.diagnostics.length ||
      graph.busy ||
      graph.gestureActive ||
      graph.popup ||
      navigation.resizing ||
      resizingContext ||
      draggingTerm ||
      $('#knowledge-dialog').open ||
      modelReference.open
    );
  }
  function sessionState() {
    const canonical = (term) =>
      state.termDeclarations.some((termDeclaration) => termDeclaration.id === term) ? term : '';
    return {
      location: routeUrl({ ...state, terms: workingSet.terms, mode: graph.mode }),
      view: state.page === 'term' ? state.tab : state.page,
      term: canonical(state.selected),
      mode: graph.mode,
      terms: [...workingSet.terms],
      selection: [...(graph.model?.selection || [])].sort(),
      corpusRevision: state.revision,
      busy: isBusy(),
      visible: document.visibilityState === 'visible',
      notes: notes.state(),
    };
  }
  async function applyCommand(command) {
    const fail = (code, message) => {
      throw Object.assign(new Error(message), { code });
    };
    if (isBusy())
      fail(
        'ui.busy',
        'Finish the current dialog, gesture or refresh before controlling this Session.',
      );
    if (
      ![
        'open',
        'explore-set',
        'explore-add',
        'explore-remove',
        'explore-clear',
        'note-send',
      ].includes(command.operation)
    )
      fail('ui.operation', 'Unknown UI operation.');
    const ids = new Set(state.termDeclarations.map((termDeclaration) => termDeclaration.id));
    if ((command.terms || []).some((term) => !ids.has(term)))
      fail('ui.term', 'A requested Term is no longer available in this browser revision.');
    commandRunning = true;
    session?.report(true);
    try {
      if (command.operation === 'note-send') {
        const current = sessionState();
        notes.receive(command, { location: current.location, terms: current.terms });
      } else if (command.operation === 'open') {
        state.tab = 'term-declarations';
        workingSet.replace(command.terms);
        await renderTerm();
        await selectTerm(command.terms[0], { push: true });
        if (
          !state.detail?.termDeclarations.some(
            (termDeclaration) => termDeclaration.id === command.terms[0],
          )
        )
          fail('ui.read', 'Term could not be opened.');
      } else {
        state.page = 'term';
        state.tab = 'graph';
        state.detail ||= { termDeclarations: [] };
        await renderTerm(true);
        await graph.setMode('explore');
        await graph.applyExploreCommand(
          command.operation.slice('explore-'.length),
          command.terms || [],
        );
        if (graph.error) fail('ui.graph', graph.error);
        const included = new Set(graph.sessions.explore.model.nodes.keys());
        const terms = new Set(command.terms || []);
        const valid =
          command.operation === 'explore-set'
            ? included.size === terms.size && [...terms].every((id) => included.has(id))
            : command.operation === 'explore-add'
              ? [...terms].every((id) => included.has(id))
              : command.operation === 'explore-remove'
                ? [...terms].every((id) => !included.has(id))
                : included.size === 0;
        if (graph.mode !== 'explore' || !valid)
          fail('ui.superseded', 'Another action changed the view before this command completed.');
        saveUrl(true);
      }
      // Commit the browser frame before reporting applied.
      await new Promise((resolve) => setTimeout(resolve, 0));
      toast(`${command.operation} applied`);
    } finally {
      commandRunning = false;
      session?.reportSoon();
    }
  }
  session = new UISessionConnection({
    protocol: serverProtocol,
    state: sessionState,
    apply: applyCommand,
    health: acceptHealth,
    connected: () => {
      if (!state.refreshError && !state.diagnostics.length) connection('Connected');
    },
    disconnected: (message) => {
      state.offline = true;
      connection('Disconnected', 'offline');
      notice(message);
    },
    identity: (id, shortId) => {
      $('#ui-session').textContent = `Session ${shortId}`;
      $('#ui-session').title = `Copy Session UUID: ${id}`;
    },
  });
  $('#ui-session').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(session.id);
      toast('Session UUID copied');
    } catch {
      toast(session.id || 'Session not connected');
    }
  });
  return {
    dispose() {
      unsubscribe();
      unsubscribeWorkingSet();
      disposeDrag();
      termPreview.dispose();
      session.close();
      notes.dispose();
      queries.dispose();
      modelReference.dispose();
      navigation.dispose();
      markdownObserver.disconnect();
      graph.stop();
    },
  };
}
