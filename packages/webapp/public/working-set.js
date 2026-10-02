/** Ordered canonical Term identities shared by every Main View. */
export class WorkingSet {
  constructor(terms = []) {
    this.terms = [...new Set(terms)];
    this.listeners = new Set();
  }
  has(id) {
    return this.terms.includes(id);
  }
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  replace(terms, source) {
    const next = [...new Set(terms)];
    if (next.length === this.terms.length && next.every((id, i) => id === this.terms[i]))
      return false;
    const previous = this.terms;
    this.terms = next;
    for (const listener of this.listeners) listener({ terms: next, previous, source });
    return true;
  }
  apply(changes, source) {
    const next = new Set(this.terms);
    for (const [id, included] of changes) included ? next.add(id) : next.delete(id);
    return this.replace([...next], source);
  }
}
