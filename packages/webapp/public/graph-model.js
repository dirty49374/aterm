import {
  GraphInteraction,
  addProjectedEdge,
  matchesEdge,
  recordConnections,
  unshownConnections,
} from './graph-state.js';
import { termDeclarationKey, groupTree } from './library-model.js';

export const knowledgeNode = (id) => 'knowledge:' + id;
export const authoredGroupNode = (knowledge, path) =>
  'authored:' + JSON.stringify([knowledge, path]);
export const groupNode = (path) => 'group:' + JSON.stringify(path);
export const termNode = (path) => 'term:' + JSON.stringify(path);
export const hiddenGroupNode = (parent) => 'hidden:' + JSON.stringify(parent);
export const edgeKey = (e) => JSON.stringify([e.source, e.phrase, e.target, e.origin]);
const byId = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Rendering Groups and their display instances are distinct from canonical Terms. */
export class GraphModel extends GraphInteraction {
  constructor(termDeclarations = [], knowledges = [], edges = []) {
    super();
    this.mode = 'structure';
    this.nodes = new Map();
    this.expanded = new Set();
    this.selection = new Set();
    this.hidden = new Set();
    this.hiddenGroups = new Map();
    this.history = [];
    this.focus = null;
    this.reconcile(termDeclarations, knowledges, edges);
  }
  checkpoint() {
    this.history.push(
      structuredClone({
        expanded: this.expanded,
        selection: this.selection,
        focus: this.focus,
        hidden: this.hidden,
      }),
    );
    if (this.history.length > 30) this.history.shift();
  }
  undo() {
    const old = this.history.pop();
    if (old) Object.assign(this, old);
    this.sync();
  }
  reconcile(termDeclarations, knowledges, edges = []) {
    this.termDeclarations = termDeclarations;
    this.knowledges = knowledges;
    this.edges = edges;
    this.terms = new Map();
    for (const e of termDeclarations) {
      if (!this.terms.has(e.id)) this.terms.set(e.id, []);
      this.terms.get(e.id).push(e);
    }
    this.termDeclarationMap = new Map(termDeclarations.map((e) => [termDeclarationKey(e), e]));
    this.authored = new Map();
    const register = (node) => {
      const id = node.group
        ? authoredGroupNode(node.knowledge, node.group)
        : knowledgeNode(node.knowledge);
      this.authored.set(id, node);
      node.children.forEach(register);
    };
    groupTree(termDeclarations).forEach(register);
    for (const knowledge of knowledges)
      if (!this.authored.has(knowledgeNode(knowledge.id)))
        register({ knowledge: knowledge.id, group: '', termDeclarations: [], children: [] });
    this.parts = new Map([...this.termDeclarationMap.keys()].sort(byId).map((id) => [id, []]));
    for (const edge of edges) {
      if (
        edge.origin !== 'relation' ||
        edge.type !== 'parthood' ||
        edge.source === edge.target ||
        !this.terms.has(edge.target) ||
        this.knowledge(edge.source) !== this.knowledge(edge.target)
      )
        continue;
      for (const source of this.sourceTermDeclarations(edge)) {
        const parts = this.parts.get(source);
        for (const target of this.terms.get(edge.target))
          if (!parts.includes(termDeclarationKey(target))) parts.push(termDeclarationKey(target));
      }
    }
    for (const parts of this.parts.values()) parts.sort(byId);
    this.memberCache = new Map();
    this.hiddenGroups.clear();
    this.hidden = new Set([...this.hidden].filter((id) => this.describe(id)));
    this.rebuildHiddenGroups();
    const valid = (id) => !!this.describe(id);
    this.expanded = new Set([...this.expanded].filter((id) => valid(id) && this.isCollection(id)));
    this.selection = new Set([...this.selection].filter(valid));
    if (this.focus && !valid(this.focus)) this.focus = null;
    this.history = [];
    this.sync();
  }
  knowledge(id) {
    return this.terms.get(id)?.[0].knowledge;
  }
  container(id) {
    return this.knowledges.find((d) => knowledgeNode(d.id) === id);
  }
  sourceTermDeclarations(edge) {
    return (this.terms.get(edge.source) || [])
      .filter((termDeclaration) =>
        edge.locations.some(
          (location) =>
            location.file === termDeclaration.file &&
            location.line >= termDeclaration.line &&
            location.line <= termDeclaration.endLine,
        ),
      )
      .map(termDeclarationKey);
  }
  describe(id) {
    if (this.hiddenGroups.has(id)) return this.hiddenGroups.get(id);
    const authored = this.authored.get(id);
    if (authored)
      return {
        id,
        type: authored.group ? 'group' : 'knowledge',
        origin: 'authored',
        knowledge: authored.knowledge,
        group: authored.group,
        path: [],
      };
    if (typeof id !== 'string' || !/^(group|term):/.test(id)) return undefined;
    let path;
    try {
      path = JSON.parse(id.slice(id.indexOf(':') + 1));
    } catch {
      return undefined;
    }
    if (
      !Array.isArray(path) ||
      !path.length ||
      path.some((key) => !this.termDeclarationMap.has(key))
    )
      return undefined;
    for (let i = 1; i < path.length; i++)
      if (
        !this.parts.get(path[i - 1]).includes(path[i]) ||
        path.slice(0, i - 1).includes(path[i - 1])
      )
        return undefined;
    const key = path.at(-1),
      termDeclaration = this.termDeclarationMap.get(key),
      type = id.startsWith('group:') ? 'group' : 'term';
    if (type === 'group' && (!this.parts.get(key).length || path.slice(0, -1).includes(key)))
      return undefined;
    return {
      id,
      type,
      origin: 'derived',
      knowledge: termDeclaration.knowledge,
      term: termDeclaration.id,
      termDeclaration: key,
      path,
    };
  }
  display(path) {
    return this.parts.get(path.at(-1))?.length && !path.slice(0, -1).includes(path.at(-1))
      ? groupNode(path)
      : termNode(path);
  }
  isCollection(id) {
    return this.childIds(id).length > 0;
  }
  childIds(id) {
    if (id === null) return this.knowledges.map((d) => knowledgeNode(d.id));
    if (this.hiddenGroups.has(id)) return this.hiddenGroups.get(id).roots;
    const authored = this.authored.get(id);
    if (authored)
      return [
        ...authored.children.map((child) => authoredGroupNode(child.knowledge, child.group)),
        ...authored.termDeclarations.map((termDeclaration) =>
          this.display([termDeclarationKey(termDeclaration)]),
        ),
      ];
    const node = this.describe(id);
    if (node?.type === 'group')
      return [
        termNode(node.path),
        ...this.parts.get(node.termDeclaration).map((key) => this.display([...node.path, key])),
      ];
    return [];
  }
  path(id) {
    const node = this.describe(id);
    if (!node) return [];
    if (node.origin === 'hidden') return [...this.path(node.originalParent), id];
    const path = [knowledgeNode(node.knowledge)];
    const group =
      node.origin === 'authored' ? node.group : this.termDeclarationMap.get(node.path[0]).group;
    const segments = group ? group.split('.') : [];
    for (let i = 1; i <= segments.length; i++)
      path.push(authoredGroupNode(node.knowledge, segments.slice(0, i).join('.')));
    for (let i = 1; i <= node.path.length; i++) {
      const display = this.display(node.path.slice(0, i));
      if (display.startsWith('group:')) path.push(display);
    }
    if (path.at(-1) !== id) path.push(id);
    return path;
  }
  memberTermDeclarations(id) {
    if (this.hiddenGroups.has(id))
      return [
        ...new Map(
          this.childIds(id)
            .flatMap((root) => this.memberTermDeclarations(root))
            .map((termDeclaration) => [termDeclarationKey(termDeclaration), termDeclaration]),
        ).values(),
      ];
    if (this.memberCache.has(id)) return this.memberCache.get(id);
    const authored = this.authored.get(id),
      found = new Set();
    if (authored) {
      const visit = (group) => {
        group.termDeclarations.forEach((termDeclaration) =>
          found.add(termDeclarationKey(termDeclaration)),
        );
        group.children.forEach(visit);
      };
      visit(authored);
    } else {
      const node = this.describe(id);
      if (!node) return [];
      const pending = [node.termDeclaration],
        stops = node.path.slice(0, -1);
      while (pending.length) {
        const key = pending.pop();
        if (found.has(key)) continue;
        found.add(key);
        if (node.type === 'group' && !stops.includes(key)) pending.push(...this.parts.get(key));
      }
    }
    const result = [...found].sort(byId).map((key) => this.termDeclarationMap.get(key));
    this.memberCache.set(id, result);
    return result;
  }
  members(id) {
    return [...new Set(this.memberTermDeclarations(id).map((e) => e.id))].sort(byId);
  }
  owners(term, keys = (this.terms.get(term) || []).map(termDeclarationKey)) {
    return [...new Set(keys.flatMap((key) => this.representatives.get(key) || []))];
  }
  owner(term) {
    return this.owners(term)[0];
  }
  represented(term) {
    return this.owners(term).length > 0;
  }
  rebuildHiddenGroups() {
    this.hiddenGroups.clear();
    for (const root of this.hidden) {
      const path = this.path(root);
      if (!path.length || path.slice(0, -1).some((id) => this.hidden.has(id))) {
        this.hidden.delete(root);
        continue;
      }
      const parent = path.at(-2) || null,
        id = hiddenGroupNode(parent);
      if (!this.hiddenGroups.has(id))
        this.hiddenGroups.set(id, {
          id,
          type: 'group',
          origin: 'hidden',
          originalParent: parent,
          roots: [],
        });
      this.hiddenGroups.get(id).roots.push(root);
    }
    for (const node of this.hiddenGroups.values()) node.roots.sort(byId);
    for (const id of this.expanded)
      if (id.startsWith('hidden:') && !this.hiddenGroups.has(id)) this.expanded.delete(id);
    for (const id of this.selection)
      if (id.startsWith('hidden:') && !this.hiddenGroups.has(id)) this.selection.delete(id);
  }
  projectedChildren(parent, ids) {
    const visible = ids.filter((id) => !this.hidden.has(id));
    if (visible.length !== ids.length) visible.push(hiddenGroupNode(parent));
    return visible;
  }
  sync({ ignoreHidden = false } = {}) {
    this.rebuildHiddenGroups();
    const previous = this.nodes;
    this.nodes = new Map();
    this.children = new Map();
    this.representatives = new Map();
    const visit = (id, parent = null, hiddenBy = null) => {
      const descriptor = this.describe(id);
      if (!descriptor) return;
      hiddenBy = descriptor.origin === 'hidden' ? id : hiddenBy;
      const originalChildren = this.childIds(id);
      const children =
          ignoreHidden || hiddenBy
            ? originalChildren
            : this.projectedChildren(id, originalChildren),
        open = this.expanded.has(id) && children.length > 0;
      this.children.set(id, children);
      this.nodes.set(id, {
        x: 0,
        y: 0,
        ...previous.get(id),
        ...descriptor,
        parent,
        hiddenBy,
        open,
        expandable: children.length > 0,
        width: open ? previous.get(id)?.width || 320 : 320,
        height: open ? previous.get(id)?.height || 124 : 124,
      });
      if (open) for (const child of children) visit(child, id, hiddenBy);
      else
        for (const termDeclaration of this.memberTermDeclarations(id)) {
          const key = termDeclarationKey(termDeclaration);
          if (!this.representatives.has(key)) this.representatives.set(key, []);
          this.representatives.get(key).push(id);
        }
    };
    const roots = this.focus ? [this.focus] : this.childIds(null);
    for (const root of ignoreHidden || this.focus ? roots : this.projectedChildren(null, roots))
      visit(root);
  }
  selectedNodes() {
    return new Set(
      [...this.selection]
        .filter((id) => this.nodes.has(id))
        .flatMap((id) => (this.hiddenGroups.has(id) ? this.childIds(id) : [id])),
    );
  }
  hiddenRoot(id) {
    return this.path(id).find((ancestor) => this.hidden.has(ancestor));
  }
  partition(ids, retained) {
    for (const id of ids) {
      if (!retained.has(id)) this.hidden.add(id);
      else this.partition(this.childIds(id), retained);
    }
  }
  hideOthers(mode = 'selected', filters = {}) {
    if (!['selected', 'neighbors'].includes(mode)) return;
    const selected = this.selectedNodes();
    if (!selected.size) return;
    this.checkpoint();
    this.sync({ ignoreHidden: true });
    const keep = new Set(selected);
    if (mode === 'neighbors')
      for (const edge of this.project(this.edges, filters).edges) {
        if (selected.has(edge.from)) keep.add(edge.to);
        if (selected.has(edge.to)) keep.add(edge.from);
      }
    const roots = this.focus ? [this.focus] : this.childIds(null);
    const retained = new Set([...keep].flatMap((id) => this.path(id)));
    if (this.focus) retained.add(this.focus);
    // Replacing the current scope leaves hiding outside that boundary intact.
    for (const id of this.hidden)
      if (!this.focus || this.path(id).includes(this.focus)) this.hidden.delete(id);
    this.partition(roots, retained);
    this.selection = selected;
    this.sync();
  }
  expose(ids) {
    const paths = ids.map((id) => this.path(id));
    const retained = new Set(paths.flat());
    const affected = [...this.hidden].filter((id) => retained.has(id));
    for (const id of affected) this.hidden.delete(id);
    this.partition(affected, retained);
    for (const path of paths) for (const id of path.slice(0, -1)) this.expanded.add(id);
  }
  unhideSelected() {
    const selected = this.selectedNodes();
    const hidden = [...selected].filter((id) => this.hiddenRoot(id));
    if (!hidden.length) return;
    this.checkpoint();
    this.expose(hidden);
    this.selection = selected;
    this.sync();
  }
  showAll() {
    if (!this.hidden.size) return;
    this.checkpoint();
    this.hidden.clear();
    this.sync();
  }
  expand(id) {
    if (!this.isCollection(id)) return;
    this.checkpoint();
    this.expanded.add(id);
    this.sync();
  }
  collapse(id) {
    if (!this.isCollection(id)) return;
    this.checkpoint();
    this.expanded.delete(id);
    this.sync();
  }
  shortestPath(term, start, termDeclaration) {
    const pending = start
      ? [start]
      : [...this.termDeclarationMap]
          .filter(([, termDeclaration]) => termDeclaration.knowledge === this.knowledge(term))
          .sort(([a], [b]) => byId(a, b))
          .map(([key]) => [key]);
    const seen = new Set();
    for (let i = 0; i < pending.length; i++) {
      const path = pending[i],
        id = path.at(-1);
      if (
        this.termDeclarationMap.get(id).id === term &&
        (!termDeclaration || id === termDeclaration)
      )
        return path;
      if (path.slice(0, -1).includes(id)) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const child of this.parts.get(id)) pending.push([...path, child]);
    }
    return undefined;
  }
  reveal(term, termDeclaration) {
    if (
      !this.terms.has(term) ||
      (termDeclaration && this.termDeclarationMap.get(termDeclaration)?.id !== term)
    )
      return;
    this.checkpoint();
    const existing = [...this.nodes.values()]
      .filter((n) => n.term === term && (!termDeclaration || n.termDeclaration === termDeclaration))
      .sort((a, b) => this.path(a.id).length - this.path(b.id).length || byId(a.id, b.id));
    const focus = this.describe(this.focus);
    const authoredTermDeclaration =
      focus?.origin === 'authored'
        ? this.memberTermDeclarations(this.focus).find(
            (candidate) =>
              candidate.id === term &&
              (!termDeclaration || termDeclarationKey(candidate) === termDeclaration),
          )
        : undefined;
    const focusedPath = authoredTermDeclaration
      ? [termDeclarationKey(authoredTermDeclaration)]
      : focus?.origin === 'derived' && this.members(this.focus).includes(term)
        ? this.shortestPath(term, focus.path, termDeclaration)
        : undefined;
    const termPath =
      existing[0]?.path || focusedPath || this.shortestPath(term, undefined, termDeclaration);
    const id = termNode(termPath),
      path = this.path(id);
    if (this.focus && !path.includes(this.focus)) this.focus = path[0];
    for (const ancestor of path.slice(0, -1)) this.expanded.add(ancestor);
    this.selection = new Set([id]);
    this.expose([id]);
    this.sync();
  }
  setFocus(id) {
    if (id && (!this.describe(id) || this.describe(id).origin === 'hidden')) return;
    this.checkpoint();
    this.focus = id;
    if (id) this.expose([id]);
    this.sync();
  }
  reset() {
    this.checkpoint();
    this.expanded.clear();
    this.focus = null;
    this.selection.clear();
    this.hidden.clear();
    this.sync();
  }
  project(edges, filters = {}) {
    const grouped = new Map(),
      connections = new Map(),
      internal = new Map();
    const paths = new Map([...this.nodes.keys()].map((id) => [id, this.path(id)]));
    const distance = (a, b) => {
      const left = paths.get(a),
        right = paths.get(b);
      let common = 0;
      while (common < left.length && common < right.length && left[common] === right[common])
        common++;
      return left.length + right.length - 2 * common;
    };
    const nearest = (id, candidates) =>
      candidates.reduce(
        (best, candidate) =>
          !best ||
          distance(id, candidate) < distance(id, best) ||
          (distance(id, candidate) === distance(id, best) && byId(candidate, best) < 0)
            ? candidate
            : best,
        undefined,
      );
    for (const edge of edges) {
      if (!matchesEdge(edge, filters)) continue;
      const sources = this.owners(edge.source, this.sourceTermDeclarations(edge)),
        targets = this.owners(edge.target);
      recordConnections(connections, edge, sources, targets);
      if (!sources.length || !targets.length) continue;
      const pairs = new Map();
      const add = (from, to) => pairs.set(JSON.stringify([from, to]), { from, to });
      for (const from of sources) {
        const to = nearest(from, targets);
        if (nearest(to, sources) === from) add(from, to);
      }
      for (const { from, to } of pairs.values()) {
        if (from === to && this.isCollection(from)) {
          internal.set(from, (internal.get(from) || 0) + 1);
          continue;
        }
        const bundle = this.nodes.get(from).type !== 'term' || this.nodes.get(to).type !== 'term';
        const a = this.nodes.get(from).hiddenBy,
          b = this.nodes.get(to).hiddenBy;
        addProjectedEdge(grouped, edge, from, to, {
          bundle,
          concealedBy: a === b ? [] : [a, b].filter(Boolean),
        });
      }
    }
    const projected = [...grouped.values()];
    return { edges: projected, internal, unshown: unshownConnections(connections, projected) };
  }
}
