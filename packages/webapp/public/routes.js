import { localTerm, termKnowledge } from '../../core/src/syntax-module/identity.js';

/** Route state is independent of the library scope and retained Graph membership. */
const decode = (value) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};
export function readRoute(location) {
  const legacy = location.hash?.startsWith('#term=') || location.hash?.includes('view=');
  const params = new URLSearchParams(legacy ? location.hash.slice(1) : location.search);
  let tab = ['term-declarations', 'references', 'graph'].includes(params.get('view'))
    ? params.get('view')
    : 'term-declarations';
  let selected = params.get('term') || '';
  let mode = params.get('mode') === 'structure' ? 'structure' : 'explore';
  const term = location.pathname?.match(/^\/terms\/([^/]+)\/([^/]+)(\/references)?\/?$/);
  if (term) {
    selected = `_${decode(term[1])}:${decode(term[2])}_`;
    tab = term[3] ? 'references' : 'term-declarations';
  }
  const graph = location.pathname?.match(/^\/graph\/(structure|explore)\/?$/);
  if (location.pathname === '/term-declarations') tab = 'term-declarations';
  if (location.pathname === '/references') tab = 'references';
  if (graph) {
    tab = 'graph';
    mode = graph[1];
  }
  return {
    selected,
    terms:
      location.state?.terms ||
      (params.has('set')
        ? [...new Set(params.getAll('set').filter(Boolean))]
        : term
          ? [selected]
          : undefined),
    tab,
    mode,
    page:
      location.pathname === '/queries'
        ? 'graphql'
        : location.pathname === '/diagnostics'
          ? 'diagnostics'
          : 'term',
    q: params.get('q') || '',
    termKind: params.get('termKind') || '',
    viewpoint: params.get('viewpoint') || '',
    knowledge: params.get('knowledge') || '',
  };
}
export function routeUrl(state) {
  const p = new URLSearchParams();
  for (const field of ['q', 'termKind', 'viewpoint', 'knowledge'])
    if (state[field]) p.set(field, state[field]);
  let path = '/';
  if (state.page === 'graphql') path = '/queries';
  else if (state.page === 'diagnostics') path = '/diagnostics';
  else if (state.tab === 'graph') path = '/graph/' + (state.mode || 'explore');
  else if (state.terms) path = state.tab === 'references' ? '/references' : '/term-declarations';
  else if (state.selected && termKnowledge(state.selected)) {
    path = `/terms/${encodeURIComponent(termKnowledge(state.selected))}/${encodeURIComponent(localTerm(state.selected).slice(1, -1))}`;
    if (state.tab === 'references') path += '/references';
  }
  if (state.terms) {
    for (const term of state.terms.length ? state.terms : ['']) p.append('set', term);
  }
  if (
    state.selected &&
    (state.terms || state.tab === 'graph' || state.page === 'diagnostics' || path === '/')
  )
    p.set('term', state.selected);
  // Large sets live in the history entry instead of exceeding UI location limits.
  if ((path + '?' + p).length > 8000) p.delete('set');
  return path + (p.size ? '?' + p : '');
}
