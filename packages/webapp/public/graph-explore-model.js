import { termDeclarationKey, matchesTermKind } from './library-model.js';
import {
  GraphInteraction,
  addProjectedEdge,
  matchesEdge,
  recordConnections,
  unshownConnections,
} from './graph-state.js';

const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** A flat, explicitly included Term set. Reading, Selection and library scope do not own it. */
export class ExploreGraphModel extends GraphInteraction {
  constructor(termDeclarations = [], knowledges = [], edges = [], workingSet) {
    super();
    this.mode = 'explore';
    this.nodes = new Map();
    this.selection = new Set();
    this.history = [];
    this.children = new Map();
    this.reconcile(termDeclarations, knowledges, edges);
    this.workingSet = workingSet;
    const sync = ({ terms, previous, source }) => {
      if (source === this) return;
      this.syncing = true;
      this.previousTerms = previous;
      try {
        this.applyMembership(
          new Map([
            ...[...this.nodes.keys()].map((id) => [id, false]),
            ...terms.map((id) => [id, true]),
          ]),
          this.placement?.(),
        );
      } finally {
        this.syncing = false;
        this.previousTerms = undefined;
      }
    };
    workingSet?.subscribe(sync);
    if (workingSet) sync({ terms: workingSet.terms });
  }
  reconcile(termDeclarations, knowledges, edges = []) {
    this.termDeclarations = termDeclarations;
    this.knowledges = knowledges;
    this.edges = edges;
    this.terms = new Map();
    this.termDeclarationMap = new Map(termDeclarations.map((e) => [termDeclarationKey(e), e]));
    for (const termDeclaration of termDeclarations) {
      if (!this.terms.has(termDeclaration.id)) this.terms.set(termDeclaration.id, []);
      this.terms.get(termDeclaration.id).push(termDeclaration);
    }
    this.adjacency = { incoming: new Map(), outgoing: new Map() };
    for (const edge of edges) {
      if (!this.terms.has(edge.source) || !this.terms.has(edge.target)) continue;
      for (const [direction, id] of [
        ['incoming', edge.target],
        ['outgoing', edge.source],
      ]) {
        if (!this.adjacency[direction].has(id)) this.adjacency[direction].set(id, []);
        this.adjacency[direction].get(id).push(edge);
      }
    }
    for (const [id, node] of this.nodes) {
      if (!this.terms.has(id)) this.nodes.delete(id);
      else Object.assign(node, this.descriptor(id));
    }
    this.selection = new Set([...this.selection].filter((id) => this.nodes.has(id)));
    this.history = [];
  }
  descriptor(id) {
    const termDeclarations = this.terms.get(id);
    return {
      id,
      type: 'term',
      origin: 'explore',
      term: id,
      knowledge: termDeclarations[0].knowledge,
      termDeclarations,
      parent: null,
      open: false,
      expandable: false,
    };
  }
  describe(id) {
    return this.nodes.get(id);
  }
  container() {
    return undefined;
  }
  memberTermDeclarations(id) {
    return this.terms.get(id) || [];
  }
  selectedNodes() {
    return new Set(this.selection);
  }
  snapshot() {
    return structuredClone({
      nodes: this.nodes,
      selection: this.selection,
      terms: this.previousTerms || this.workingSet?.terms,
    });
  }
  checkpoint(snapshot = this.snapshot()) {
    this.history.push(snapshot);
    if (this.history.length > 30) this.history.shift();
  }
  undo() {
    const snapshot = this.history.pop();
    if (!snapshot) return;
    this.nodes = snapshot.nodes;
    this.selection = snapshot.selection;
    this.workingSet?.replace(snapshot.terms || [...this.nodes.keys()], this);
  }
  startMove(id) {
    if (!this.nodes.has(id)) return null;
    const before = this.snapshot();
    if (!this.selection.has(id)) this.select(id);
    return {
      before,
      positions: new Map(
        [...this.selection].map((key) => {
          const { x, y } = this.nodes.get(key);
          return [key, { x, y }];
        }),
      ),
    };
  }
  previewMove(move, dx, dy) {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    for (const [id, position] of move.positions) {
      const node = this.nodes.get(id);
      if (node) Object.assign(node, { x: position.x + dx, y: position.y + dy });
    }
  }
  finishMove(move, commit = true) {
    if (!commit) {
      this.nodes = move.before.nodes;
      this.selection = move.before.selection;
      return;
    }
    if (
      [...move.positions].some(([id, start]) => {
        const node = this.nodes.get(id);
        return node && (node.x !== start.x || node.y !== start.y);
      })
    )
      this.checkpoint(move.before);
  }
  /** One transaction, even when a popup includes and removes several neighbors. */
  applyMembership(changes, { origin, direction, center = { x: 0, y: 0 }, filters = {} } = {}) {
    const effective = [...changes].filter(
      ([id, included]) => this.terms.has(id) && this.nodes.has(id) !== included,
    );
    if (!effective.length) return [];
    this.checkpoint();
    const anchor = this.nodes.get(origin);
    const incoming = new Set(this.candidates(origin, 'incoming', filters).map((row) => row.id));
    const outgoing = new Set(this.candidates(origin, 'outgoing', filters).map((row) => row.id));
    for (const [id, included] of effective)
      if (!included) {
        this.nodes.delete(id);
        this.selection.delete(id);
      }
    const added = [];
    for (const [id, included] of effective) {
      if (!included) continue;
      const node = this.createMember(id, {
        anchor,
        direction,
        incoming,
        outgoing,
        center,
        filters,
      });
      this.nodes.set(id, node);
      added.push(id);
    }
    if (!this.syncing) this.workingSet?.apply(effective, this);
    return added;
  }
  createMember(id, { anchor, direction, incoming, outgoing, center, filters }) {
    const width = Math.max(320, Math.min(440, id.split(':').at(-1).length * 8.4 + 40));
    const node = { ...this.descriptor(id), width, height: 124, laidOut: true };
    const neighbor = anchor || this.placementNeighbor(id, filters);
    const base = anchor || neighbor?.node;
    const side = this.placementSide(id, direction, anchor, incoming, outgoing, neighbor);
    const x = base
      ? side < 0
        ? base.x - width - 130
        : base.x + base.width + 130
      : center.x - width / 2;
    const y = base ? base.y + (base.height - node.height) / 2 : center.y - node.height / 2;
    this.placeNode(node, x, y, side);
    return node;
  }
  placementNeighbor(id, filters) {
    return this.edges
      .filter((edge) => matchesEdge(edge, filters))
      .map((edge) => {
        if (edge.source === id && this.nodes.has(edge.target))
          return { node: this.nodes.get(edge.target), side: -1 };
        if (edge.target === id && this.nodes.has(edge.source))
          return { node: this.nodes.get(edge.source), side: 1 };
      })
      .find(Boolean);
  }
  placementSide(id, direction, anchor, incoming, outgoing, neighbor) {
    return direction === 'incoming'
      ? -1
      : direction === 'outgoing'
        ? 1
        : anchor
          ? incoming.has(id) && !outgoing.has(id)
            ? -1
            : 1
          : neighbor?.side || 1;
  }
  placeNode(node, x, y, side) {
    const { width } = node;
    const occupied = [...this.nodes.values()];
    const collides = (x, y) =>
      occupied.some(
        (n) =>
          x < n.x + n.width + 36 &&
          x + width + 36 > n.x &&
          y < n.y + n.height + 36 &&
          y + node.height + 36 > n.y,
      );
    // Existing Nodes never move. Search alternating rows, then a new column.
    let placed = false;
    for (let column = 0; !placed; column++) {
      for (let row = 0; row < 13; row++) {
        const xx = x + side * column * (width + 130);
        const yy = y + (row % 2 ? -Math.ceil(row / 2) : row / 2) * (node.height + 56);
        if (!collides(xx, yy)) {
          Object.assign(node, { x: xx, y: yy });
          placed = true;
          break;
        }
      }
    }
  }
  removeSelected() {
    return this.applyMembership(new Map([...this.selection].map((id) => [id, false])));
  }
  replaceMembership(ids, context = {}) {
    const included = new Set(ids.filter((id) => this.terms.has(id)));
    if (!included.size) return false;
    const membershipChanged =
      included.size !== this.nodes.size || [...included].some((id) => !this.nodes.has(id));
    const selectionChanged =
      included.size !== this.selection.size || [...included].some((id) => !this.selection.has(id));
    const orderChanged =
      this.workingSet && [...included].some((id, index) => this.workingSet.terms[index] !== id);
    if (!membershipChanged && !selectionChanged && !orderChanged) return false;
    // applyMembership records membership changes; Selection-only replacement needs the same snapshot.
    if (!membershipChanged) this.checkpoint();
    this.applyMembership(
      new Map([
        ...[...this.nodes.keys()].map((id) => [id, false]),
        ...[...included].map((id) => [id, true]),
      ]),
      context,
    );
    this.selection = included;
    this.workingSet?.replace([...included], this);
    return true;
  }
  candidates(origin, direction, filters = {}) {
    const grouped = new Map();
    for (const edge of this.adjacency[direction]?.get(origin) || []) {
      if (!matchesEdge(edge, filters)) continue;
      const id = direction === 'incoming' ? edge.source : edge.target;
      if (!grouped.has(id))
        grouped.set(id, { id, termDeclarations: this.terms.get(id), edges: [] });
      grouped.get(id).edges.push(edge);
    }
    return [...grouped.values()].sort((a, b) => byText(a.id, b.id));
  }
  findCandidates({
    origin,
    direction,
    search = '',
    termKind = '',
    viewpoint = '',
    phrase = '',
    filters = {},
  } = {}) {
    const candidates = origin
      ? this.candidates(origin, direction, filters)
      : [...this.terms].map(([id, termDeclarations]) => ({ id, termDeclarations, edges: [] }));
    return candidates
      .filter(
        (row) =>
          row.id.toLowerCase().includes(search.toLowerCase()) &&
          row.termDeclarations.some(
            (termDeclaration) =>
              (!viewpoint || termDeclaration.viewpoint === viewpoint) &&
              (!termKind ||
                matchesTermKind(termKind, termDeclaration.termKind, termDeclaration.viewpoint)),
          ) &&
          (!phrase || row.edges.some((edge) => edge.phrase === phrase)),
      )
      .sort((a, b) => byText(a.id, b.id));
  }
  candidateColumns(options = {}) {
    return Object.fromEntries(
      (options.origin ? ['incoming', 'outgoing'] : ['all']).map((direction) => [
        direction,
        this.findCandidates({ ...options, direction }),
      ]),
    );
  }
  includedAfter(changes, id) {
    return changes.get(id) ?? this.nodes.has(id);
  }
  stageMembership(changes, id, included) {
    if (!this.terms.has(id)) return;
    if (this.nodes.has(id) === included) changes.delete(id);
    else changes.set(id, included);
  }
  toggleMembership(changes, rows) {
    const ids = [...new Set(rows.map((row) => row.id))];
    const included = !ids.every((id) => this.includedAfter(changes, id));
    for (const id of ids) this.stageMembership(changes, id, included);
  }
  project(edges, filters = {}) {
    const grouped = new Map(),
      connections = new Map();
    for (const edge of edges) {
      if (!matchesEdge(edge, filters)) continue;
      const sources = this.nodes.has(edge.source) ? [edge.source] : [];
      const targets = this.nodes.has(edge.target) ? [edge.target] : [];
      recordConnections(connections, edge, sources, targets);
      if (sources.length && targets.length)
        addProjectedEdge(grouped, edge, edge.source, edge.target);
    }
    const projected = [...grouped.values()];
    return {
      edges: projected,
      internal: new Map(),
      unshown: unshownConnections(connections, projected),
    };
  }
}
