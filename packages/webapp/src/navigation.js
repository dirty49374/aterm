/** Shell navigation: a docked panel or a temporary overlay, independent of Main Views. */
export class LibraryNavigation {
  constructor({ changed, interacting }) {
    this.changed = changed;
    this.interacting = interacting;
    this.handlers = new AbortController();
    this.media = matchMedia('(max-width:760px)');
    this.library = document.querySelector('#library');
    this.divider = document.querySelector('#library-divider');
    this.menu = document.querySelector('#menu');
    this.pin = document.querySelector('#navigation-pin');
    this.scrim = document.querySelector('#scrim');
    this.width = 282;
    this.pinned = !this.media.matches;
    this.open = false;
    try {
      const saved = JSON.parse(localStorage.getItem('aterm.navigation') || 'null');
      if (typeof saved?.pinned === 'boolean') this.pinned = saved.pinned;
      else if (['pinned', 'hidden', 'auto-hide'].includes(saved?.mode))
        this.pinned = saved.mode === 'pinned';
      if (Number.isFinite(saved?.width)) this.width = Math.max(220, Math.min(480, saved.width));
    } catch {
      /* Optional preferences must not prevent opening the reader. */
    }
    const on = (node, event, handler) =>
      node.addEventListener(event, handler, { signal: this.handlers.signal });
    on(this.pin, 'click', () => this.togglePinned());
    on(this.menu, 'click', (event) => {
      if (!this.collapsed) return this.close();
      this.show();
      if (event.detail === 0) this.pin.focus({ preventScroll: true });
    });
    on(this.scrim, 'click', () => this.close());
    on(this.menu, 'pointerenter', (event) => {
      if (event.pointerType !== 'mouse' || this.blocked || this.pinned) return;
      clearTimeout(this.showTimer);
      this.showTimer = setTimeout(() => this.show(), 120);
    });
    on(this.menu, 'pointerleave', () => clearTimeout(this.showTimer));
    on(this.library, 'pointerenter', (event) => {
      this.inside = event.pointerType === 'mouse';
      clearTimeout(this.hideTimer);
    });
    on(this.library, 'pointerleave', () => {
      this.inside = false;
      this.scheduleHide();
    });
    on(this.library, 'focusout', () => this.scheduleHide());
    on(this.divider, 'pointerdown', (event) => {
      this.resizing = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    on(this.divider, 'pointermove', (event) => {
      if (this.resizing) this.resize(event.clientX);
    });
    for (const event of ['pointerup', 'pointercancel'])
      on(this.divider, event, () => {
        this.resizing = false;
        this.save();
        this.scheduleHide();
      });
    on(this.divider, 'keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      this.resize(this.width + (event.key === 'ArrowRight' ? 20 : -20));
      this.save();
    });
    on(document, 'pointerdown', (event) => {
      if (this.docked || this.collapsed || this.blocked || this.interacting()) return;
      if (event.target.closest('#library,#library-divider,.navigation-controls')) return;
      this.close();
    });
    on(this.media, 'change', () => this.render());
    on(window, 'resize', () => this.render());
    this.render();
  }
  get docked() {
    return this.pinned && !this.media.matches;
  }
  get collapsed() {
    return (!!this.blocked && !this.docked) || (!this.pinned && !this.open);
  }
  save() {
    try {
      localStorage.setItem(
        'aterm.navigation',
        JSON.stringify({ pinned: this.pinned, width: this.width }),
      );
    } catch {
      /* In-memory state remains usable. */
    }
  }
  togglePinned() {
    clearTimeout(this.showTimer);
    clearTimeout(this.hideTimer);
    this.pinned = !this.pinned;
    this.open = !this.pinned && !!this.inside;
    this.save();
    this.render();
    if (this.collapsed) this.menu.focus({ preventScroll: true });
  }
  show() {
    if (this.blocked) return;
    clearTimeout(this.hideTimer);
    this.open = true;
    this.render();
  }
  close() {
    clearTimeout(this.showTimer);
    clearTimeout(this.hideTimer);
    const returnFocus =
      this.library.contains(document.activeElement) || document.activeElement === this.divider;
    this.pinned = false;
    this.open = false;
    this.inside = false;
    this.save();
    this.render();
    if (returnFocus) this.menu.focus({ preventScroll: true });
  }
  scheduleHide() {
    clearTimeout(this.hideTimer);
    if (this.pinned || !this.open) return;
    this.hideTimer = setTimeout(() => {
      const focused = document.activeElement;
      if (
        this.inside ||
        (this.library.contains(focused) &&
          (focused.matches(':focus-visible,input,select,textarea') || focused.isContentEditable))
      )
        return;
      if (this.resizing || this.blocked || this.interacting()) return this.scheduleHide();
      this.close();
    }, 260);
  }
  resize(width) {
    this.width = Math.max(220, Math.min(480, innerWidth - 260, width));
    this.render();
  }
  render() {
    document.body.classList.toggle('navigation-collapsed', this.collapsed);
    document.body.classList.toggle('navigation-overlay', !this.docked);
    this.library.classList.toggle('open', !this.collapsed);
    this.library.inert = this.collapsed || !!this.blocked;
    this.scrim.hidden = !this.media.matches || this.collapsed;
    this.menu.setAttribute('aria-expanded', String(!this.collapsed));
    this.menu.setAttribute('aria-label', this.collapsed ? 'Show navigation' : 'Hide navigation');
    this.menu.title = this.collapsed ? 'Show navigation' : 'Hide navigation';
    document.querySelector('.navigation-controls').hidden = this.pinned;
    this.pin.setAttribute('aria-pressed', String(this.pinned));
    this.pin.setAttribute('aria-label', this.pinned ? 'Unpin navigation' : 'Pin navigation');
    this.pin.title = this.pinned ? 'Unpin navigation' : 'Pin navigation';
    document.querySelector('.workspace').style.setProperty('--navigation-width', this.width + 'px');
    this.divider.hidden = this.collapsed || this.media.matches;
    this.divider.setAttribute('aria-valuenow', String(Math.round(this.width)));
    this.changed();
  }
  dispose() {
    clearTimeout(this.showTimer);
    clearTimeout(this.hideTimer);
    this.handlers.abort();
  }
}
