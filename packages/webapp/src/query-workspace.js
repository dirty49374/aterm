import { QueryStore } from './query-store.js';
import {
  queryParameters,
  parseVariables,
  queryResultTerms,
  incompleteQueryResults,
  queryExamples,
} from './query-model.js';

/** _aterm:GraphQL_Workspace_: persistent editor host, independent of the Working Set. */
export class QueryWorkspace {
  constructor({ root, escape, termLink, codeBlock, terms, openTerms, changed }) {
    Object.assign(this, { root, escape, termLink, codeBlock, terms, openTerms, changed });
    this.epoch = 0;
    this.result = null;
    this.root.innerHTML = `
      <aside class="query-library" aria-label="Saved queries">
        <header><h2>Saved queries</h2><button data-query-new class="text-button">+ New</button></header>
        <label class="searchbox"><input data-query-filter type="search" placeholder="Find a query…" aria-label="Find saved query"></label>
        <nav data-query-list aria-label="Saved queries"></nav>
        <div class="query-examples"><h3>Start from an example</h3>${queryExamples.map((x, i) => `<button class="text-button" data-query-example="${i}">${escape(x.name)}</button>`).join('')}</div>
        <p class="query-storage-hint">Saved in this browser for this Home.</p>
      </aside>
      <section class="query-workbench" aria-label="GraphQL query editor">
        <header class="query-actions">
          <input data-query-name aria-label="Query name" placeholder="Untitled query" maxlength="120">
          <span data-query-dirty class="muted"></span>
          <button data-query-save class="text-button">Save</button>
          <button data-query-copy class="text-button">Save a copy</button>
          <button data-query-delete class="icon-button" title="Delete saved query" aria-label="Delete saved query">×</button>
          <button data-query-run class="query-run" title="Run query (Ctrl/⌘ Enter)">Run query <kbd>⌘ ↵</kbd></button>
          <button data-query-cancel class="text-button" hidden>Cancel</button>
        </header>
        <div class="query-message" data-query-message role="status"></div>
        <div class="query-columns">
          <div class="query-editor-column">
            <div class="query-editor-title"><label for="graphql-document">Query</label><label>Operation <input data-query-operation placeholder="Auto" aria-label="Operation name"></label></div>
            <textarea id="graphql-document" data-query-document spellcheck="false" aria-label="GraphQL document" autocapitalize="off"></textarea>
            <section class="query-parameters"><header><h3>Parameters</h3><small>Values are passed as GraphQL variables.</small></header><div data-query-params></div></section>
            <details class="query-variables"><summary>Variables JSON</summary><textarea data-query-variables aria-label="Variables JSON" spellcheck="false" autocapitalize="off"></textarea></details>
          </div>
          <section class="query-result-column" aria-label="Query results">
            <header class="query-result-actions"><strong data-query-count>Results</strong><button data-query-view class="text-button" disabled>View Terms</button><button data-query-explore class="text-button" disabled>Explore</button></header>
            <div data-query-result class="query-result"><p class="empty-panel">Run a query to read its results.<br>Include Term <code>id</code> fields to open them in the Explorer.</p></div>
          </section>
        </div>
      </section>`;
    this.$ = (selector) => root.querySelector(selector);
    this.abort = new AbortController();
    const on = (target, type, fn) =>
      target.addEventListener(type, fn, { signal: this.abort.signal });
    on(root, 'click', (event) => {
      void this.click(event).catch((error) => this.message(error.message, true));
    });
    on(root, 'input', (event) => {
      if (event.target.matches('[data-query-filter]')) return this.renderList();
      if (event.target.matches('[data-param]')) {
        this.setParameter(event.target);
        return;
      }
      if (
        event.target.matches(
          '[data-query-document],[data-query-variables],[data-query-operation],[data-query-name]',
        )
      ) {
        this.inputError = null;
        this.invalidate();
        clearTimeout(this.paramTimer);
        this.paramTimer = setTimeout(() => this.renderParameters(), 250);
      }
    });
    on(root, 'change', (event) => {
      const toggle = event.target.closest('[data-param-toggle]');
      if (!toggle) return;
      try {
        const values = parseVariables(this.$('[data-query-variables]').value);
        if (toggle.checked) {
          const p = this.parameters.find((p) => p.name === toggle.dataset.paramToggle);
          values[p.name] =
            p.defaultValue ??
            (p.scalar === 'Boolean'
              ? false
              : ['Int', 'Float'].includes(p.scalar)
                ? 0
                : p.scalar
                  ? ''
                  : null);
        } else delete values[toggle.dataset.paramToggle];
        this.$('[data-query-variables]').value = JSON.stringify(values, null, 2);
        this.inputError = null;
        this.invalidate();
        this.renderParameters();
      } catch (error) {
        this.message(error.message, true);
      }
    });
    on(root, 'keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        void this.run();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void this.save(false).catch((e) => this.message(e.message, true));
      }
    });
    on(window, 'storage', (event) => {
      if (event.key?.startsWith(this.store?.prefix)) this.renderList();
    });
    on(window, 'beforeunload', (event) => {
      if (this.dirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    });
    this.loadDraft(queryExamples[0]);
  }
  setHome(home) {
    if (home === this.home) return;
    this.home = home;
    this.store = new QueryStore(home);
    this.loadDraft(queryExamples[0]);
    this.renderList();
  }
  message(text, error = false) {
    this.$('[data-query-message]').textContent = text;
    this.$('[data-query-message]').classList.toggle('error', error);
  }
  values() {
    return {
      name: this.$('[data-query-name]').value.trim(),
      query: this.$('[data-query-document]').value,
      variables: this.$('[data-query-variables]').value,
      operationName: this.$('[data-query-operation]').value.trim(),
    };
  }
  loadDraft(value, record = null) {
    this.cancel();
    this.record = record;
    this.$('[data-query-name]').value = value.name || '';
    this.$('[data-query-document]').value = value.query || '';
    this.$('[data-query-variables]').value =
      typeof value.variables === 'string'
        ? value.variables
        : JSON.stringify(value.variables || {}, null, 2);
    this.$('[data-query-operation]').value = value.operationName || '';
    this.baseline = JSON.stringify(this.values());
    this.dirty = false;
    this.result = null;
    this.inputError = null;
    this.message(
      record ? 'Loaded saved query.' : 'Edit the query or parameters, then run. Save to keep it.',
    );
    this.renderParameters();
    this.renderResult();
    this.renderDirty();
    this.renderList();
  }
  renderDirty() {
    this.$('[data-query-dirty]').textContent = this.dirty
      ? 'Unsaved'
      : this.record
        ? 'Saved'
        : 'Draft';
    this.$('[data-query-delete]').disabled = !this.record;
  }
  invalidate() {
    this.cancel();
    this.result = null;
    this.dirty = JSON.stringify(this.values()) !== this.baseline;
    this.renderDirty();
    this.renderResult();
    this.changed();
  }
  renderList() {
    if (!this.store) return;
    try {
      const filter = this.$('[data-query-filter]').value.toLowerCase();
      this.saved = this.store.list();
      const items = this.saved.filter((x) => x.name.toLowerCase().includes(filter));
      this.$('[data-query-list]').innerHTML =
        items
          .map(
            (x) =>
              `<button data-query-load="${this.escape(x.id)}" class="query-saved-item" aria-current="${this.record?.id === x.id}"><strong>${this.escape(x.name)}</strong><small>${this.escape(new Date(x.updatedAt).toLocaleString())}</small></button>`,
          )
          .join('') || '<p class="query-empty">No saved queries.</p>';
    } catch (error) {
      this.message(error.message, true);
    }
  }
  renderParameters() {
    try {
      const input = this.values(),
        values = parseVariables(input.variables);
      this.parameters = queryParameters(input.query, input.operationName);
      this.paramError = null;
      this.$('[data-query-params]').innerHTML =
        this.parameters
          .map((p) => {
            const present = Object.hasOwn(values, p.name),
              value = present ? values[p.name] : p.defaultValue;
            const string = ['String', 'ID'].includes(p.scalar);
            const numeric = ['Int', 'Float'].includes(p.scalar);
            const plain = string || numeric || p.scalar === 'Boolean';
            const rendered =
              plain && value !== null
                ? (value ?? '')
                : value === undefined
                  ? ''
                  : JSON.stringify(value);
            const field =
              p.scalar === 'Boolean' && value !== null
                ? `<select aria-label="$${p.name} value" data-param="${p.name}" ${present ? '' : 'disabled'}><option value="false" ${value === false ? 'selected' : ''}>false</option><option value="true" ${value === true ? 'selected' : ''}>true</option></select>`
                : `<input aria-label="$${p.name} value" data-param="${p.name}" type="${numeric && value !== null ? 'number' : 'text'}" ${numeric ? `step="${p.scalar === 'Int' ? '1' : 'any'}"` : ''} value="${this.escape(rendered)}" ${present ? '' : 'disabled'} placeholder="${p.required ? 'Required' : p.defaultValue !== undefined ? 'Query default' : 'Omitted'}">`;
            return `<label class="query-parameter"><span><input type="checkbox" data-param-toggle="${p.name}" aria-label="Provide $${p.name}" ${present ? 'checked' : ''}> $${p.name} <small>${this.escape(p.type)}</small></span>${field}</label>`;
          })
          .join('') ||
        '<p class="query-empty">No variables declared. Add a variable such as <code>$date: String!</code> to the query.</p>';
    } catch (error) {
      this.paramError = error.message;
      this.$('[data-query-params]').textContent = error.message;
    }
  }
  setParameter(target) {
    try {
      const p = this.parameters.find((p) => p.name === target.dataset.param);
      const values = parseVariables(this.$('[data-query-variables]').value);
      let value = target.value;
      if (p.scalar === 'Boolean') value = JSON.parse(value);
      else if (['Int', 'Float'].includes(p.scalar)) {
        if (
          !value.trim() ||
          !Number.isFinite(Number(value)) ||
          (p.scalar === 'Int' && !Number.isInteger(Number(value)))
        )
          throw new Error(`$${p.name} needs a valid ${p.scalar}.`);
        value = Number(value);
      } else if (!['String', 'ID'].includes(p.scalar)) value = JSON.parse(value);
      values[p.name] = value;
      this.$('[data-query-variables]').value = JSON.stringify(values, null, 2);
      this.inputError = null;
      this.invalidate();
      this.message('Parameters updated. Run the query to refresh results.');
    } catch (error) {
      this.cancel();
      this.inputError = error.message;
      this.dirty = true;
      this.renderDirty();
      this.changed();
      this.result = null;
      this.renderResult();
      this.message(error.message, true);
    }
  }
  async save(copy) {
    if (!this.store) throw new Error('Wait for the Home connection before saving.');
    const input = this.values();
    if (this.inputError) throw new Error(this.inputError);
    if (!input.name) throw new Error('Name this query before saving.');
    parseVariables(input.variables);
    // Draft query text may be incomplete; saving is not execution or validation.
    const record = this.store.save(
      {
        ...input,
        id: !copy && this.record ? this.record.id : crypto.randomUUID(),
        updatedAt: new Date().toISOString(),
      },
      !copy ? this.record?.updatedAt : undefined,
    );
    this.record = record;
    this.baseline = JSON.stringify(input);
    this.dirty = false;
    this.renderDirty();
    this.renderList();
    this.message(copy ? 'Query copy saved.' : 'Query saved.');
  }
  cancel() {
    ++this.epoch;
    this.controller?.abort();
    this.controller = null;
    this.busy = false;
    this.$('[data-query-run]').disabled = false;
    this.$('[data-query-cancel]').hidden = true;
  }
  async run() {
    this.cancel();
    const epoch = this.epoch;
    try {
      if (this.inputError) throw new Error(this.inputError);
      const { query, variables, operationName } = this.values();
      queryParameters(query, operationName);
      const input = {
        query,
        variables: parseVariables(variables),
        ...(operationName ? { operationName } : {}),
      };
      this.controller = new AbortController();
      this.busy = true;
      this.changed();
      this.result = null;
      this.renderResult();
      this.$('[data-query-run]').disabled = true;
      this.$('[data-query-cancel]').hidden = false;
      this.message('Running query…');
      const started = performance.now();
      const response = await fetch('/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
        signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(30000)]),
      });
      const result = await response.json();
      if (epoch !== this.epoch) return;
      if (!response.ok)
        throw new Error(
          result.errors?.map((e) => e.message).join('; ') || `Query failed (${response.status}).`,
        );
      this.result = result;
      this.renderResult();
      this.message(
        result.errors?.length
          ? 'Query returned errors. Any displayed data is partial.'
          : `Completed in ${Math.round(performance.now() - started)} ms.`,
        !!result.errors?.length,
      );
    } catch (error) {
      if (epoch === this.epoch) this.message(error.message, true);
    } finally {
      if (epoch === this.epoch) {
        this.busy = false;
        this.controller = null;
        this.$('[data-query-run]').disabled = false;
        this.$('[data-query-cancel]').hidden = true;
        this.changed();
      }
    }
  }
  renderResult() {
    const terms = this.terms(),
      available = new Map(terms.map((t) => [t.id, t]));
    this.ids = queryResultTerms(this.result?.data, new Set(available.keys()));
    this.$('[data-query-count]').textContent = this.result
      ? `${this.ids.length} returned Terms`
      : 'Results';
    for (const action of ['view', 'explore'])
      this.$(`[data-query-${action}]`).disabled = !this.ids.length;
    if (!this.result) {
      this.$('[data-query-result]').innerHTML =
        '<p class="empty-panel">Run a query to read its results.<br>Include Term <code>id</code> fields to open them in the Explorer.</p>';
      return;
    }
    const pages = incompleteQueryResults(this.result.data);
    this.$('[data-query-result]').innerHTML =
      `${this.result.errors?.map((e) => `<p class="query-error">${this.escape(e.message)}${e.path ? `<small>${this.escape(e.path.join('.'))}</small>` : ''}</p>`).join('') || ''}
      ${pages ? `<p class="query-warning">${pages} collection${pages === 1 ? ' has' : 's have'} more results. Set the corresponding cursor parameter from pageInfo.endCursor and run again. These Terms are only the returned page.</p>` : ''}
      <div class="query-term-results">${
        this.ids
          .map((id) => {
            const term = available.get(id);
            return `<article><h3>${this.termLink(id)}</h3><p>${this.escape(term.definition || '')}</p></article>`;
          })
          .join('') ||
        '<p class="query-empty">No recognized Term IDs in this response. The JSON result is available below.</p>'
      }</div>
      <details class="query-json" ${this.ids.length ? '' : 'open'}><summary>JSON response</summary>${this.codeBlock(JSON.stringify(this.result, null, 2), 'json')}</details>`;
  }
  async click(event) {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.hasAttribute('data-query-run')) return this.run();
    if (button.hasAttribute('data-query-cancel')) {
      this.cancel();
      this.message('Query cancelled.');
      this.changed();
      return;
    }
    if (button.hasAttribute('data-query-save')) return this.save(false);
    if (button.hasAttribute('data-query-copy')) return this.save(true);
    if (button.hasAttribute('data-query-view'))
      return this.openTerms(this.ids, 'term-declarations');
    if (button.hasAttribute('data-query-explore')) return this.openTerms(this.ids, 'graph');
    if (button.hasAttribute('data-query-delete')) {
      if (!this.record || !confirm(`Delete saved query “${this.record.name}”?`)) return;
      this.store.remove(this.record.id, this.record.updatedAt);
      this.loadDraft({ name: '', query: '', variables: {} });
      return;
    }
    if (
      button.hasAttribute('data-query-new') ||
      button.hasAttribute('data-query-example') ||
      button.hasAttribute('data-query-load')
    ) {
      if (this.dirty && !confirm('Discard unsaved query changes?')) return;
      if (button.hasAttribute('data-query-load')) {
        const record = this.store.list().find((x) => x.id === button.dataset.queryLoad);
        if (!record) throw new Error('This query is no longer saved.');
        this.loadDraft(record, record);
      } else
        this.loadDraft(
          button.hasAttribute('data-query-example')
            ? queryExamples[Number(button.dataset.queryExample)]
            : {
                name: '',
                query: 'query {\n  knowledges { nodes { id description } }\n}',
                variables: {},
              },
        );
    }
  }
  dispose() {
    this.cancel();
    this.abort.abort();
    clearTimeout(this.paramTimer);
  }
}
