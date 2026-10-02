import { NoteStore } from './note-store.js';

/** Persistent shell reader; opening Notes never navigates or changes the Graph model. */
export class NotesReader {
  constructor({ root, toggle, markdown, changed, onOpen }) {
    Object.assign(this, { root, toggle, markdown, changed, onOpen });
    this.notes = [];
    this.open = false;
    this.active = null;
    this.handlers = new AbortController();
    const signal = this.handlers.signal;
    this.select = root.querySelector('[data-note-history]');
    this.body = root.querySelector('[data-note-body]');
    this.select.addEventListener(
      'change',
      () => {
        this.active = this.select.value;
        this.render();
      },
      { signal },
    );
    window.addEventListener(
      'storage',
      (event) => {
        if (!event.key || event.key.startsWith(this.store?.prefix)) this.refresh();
      },
      { signal },
    );
    this.render();
  }
  setHome(home) {
    if (home === this.home) return;
    this.home = home;
    this.store = new NoteStore(home);
    this.active = null;
    this.open = false;
    this.refresh();
  }
  refresh() {
    try {
      this.notes = this.store?.list() || [];
      this.error = '';
    } catch (error) {
      this.error = error.message;
    }
    if (!this.notes.some((note) => note.id === this.active))
      this.active = this.notes[0]?.id || null;
    this.render();
  }
  receive(command, context) {
    if (!this.store) throw new Error('Note storage is not ready.');
    const note = this.store.receive(command, context);
    this.active = note.id;
    this.open = true;
    this.refresh();
    this.onOpen();
  }
  show(open) {
    this.open = open;
    this.refresh();
  }
  state() {
    return { active: this.active, count: this.notes.length, open: this.open };
  }
  render() {
    this.root.hidden = !this.open;
    this.toggle.querySelector('[data-note-count]').textContent = this.notes.length || '';
    this.select.replaceChildren(...this.notes.map((note) => new Option(note.title, note.id)));
    this.select.value = this.active || '';
    this.select.disabled = !this.notes.length;
    const note = this.notes.find((item) => item.id === this.active);
    const fingerprint = JSON.stringify([note, this.error]);
    if (fingerprint !== this.rendered) {
      this.rendered = fingerprint;
      const meta = this.root.querySelector('[data-note-meta]');
      const context = this.root.querySelector('[data-note-context]');
      meta.textContent = note
        ? new Date(note.receivedAt).toLocaleString()
        : 'Notes from your Agent';
      context.textContent = note
        ? `Received in ${note.context.location.split('?')[0]} · ${note.context.terms.length} Working Set Terms`
        : '';
      context.title = note?.context.terms.join('\n') || '';
      this.root.querySelector('[data-note-title]').textContent =
        note?.title || 'Explain what you see';
      if (this.error || !note) {
        this.body.replaceChildren(
          Object.assign(document.createElement('p'), {
            textContent:
              this.error ||
              'Ask your Agent to send a Markdown Note. Your latest ten Notes will be saved here.',
          }),
        );
      } else this.body.innerHTML = this.markdown(note.markdown);
      this.root.querySelector('.note-content').scrollTop = 0;
    }
    this.changed();
  }
  dispose() {
    this.handlers.abort();
  }
}
