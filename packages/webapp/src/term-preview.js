/** One delayed, non-modal preview for HTML and SVG Term labels. */
export class TermPreview {
  constructor({ root, termDeclarations, render, copy, blocked }) {
    Object.assign(this, { root, termDeclarations, render, copy, blocked });
    this.events = new AbortController();
    const on = (node, type, handler, capture = false) =>
      node.addEventListener(type, handler, { capture, signal: this.events.signal });
    on(document, 'pointerover', (event) => {
      if (event.pointerType !== 'mouse' || event.buttons) return;
      if (root.contains(event.target)) return clearTimeout(this.hideTimer);
      const target = this.target(event.target);
      if (target) this.enter(target);
      else if (event.target.closest('.term-kind')) this.close();
    });
    on(document, 'pointerout', (event) => {
      if (!this.anchor) return;
      if (!root.contains(event.target) && !this.anchor.contains(event.target)) return;
      if (root.contains(event.relatedTarget) || this.anchor.contains(event.relatedTarget)) return;
      this.scheduleHide();
    });
    on(document, 'focusin', (event) => {
      if (this.returningFocus || root.contains(event.target)) return;
      const target = this.target(event.target);
      if (target?.matches(':focus-visible')) this.enter(target);
    });
    on(document, 'focusout', (event) => {
      if (root.contains(event.relatedTarget) || this.anchor?.contains(event.relatedTarget)) return;
      if (root.contains(event.target) || this.anchor?.contains(event.target)) this.scheduleHide();
    });
    on(
      document,
      'pointerdown',
      (event) => {
        if (!root.contains(event.target)) this.close();
      },
      true,
    );
    on(
      document,
      'pointermove',
      (event) => {
        if (root.contains(event.target)) return;
        if (event.buttons) return this.close();
        if (event.pointerType !== 'mouse') return;
        const target = this.target(event.target);
        if (target && target !== this.anchor) this.enter(target);
        else if (event.target.closest('.term-kind')) this.close();
      },
      true,
    );
    on(
      document,
      'keydown',
      (event) => {
        if (!this.anchor) return;
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopImmediatePropagation();
          this.close(true);
        } else if (
          event.key === 'Tab' &&
          !event.shiftKey &&
          this.open &&
          document.activeElement === this.anchor
        ) {
          event.preventDefault();
          root.querySelector('[data-copy-preview]').focus();
        }
      },
      true,
    );
    on(
      document,
      'scroll',
      (event) => {
        if (!root.contains(event.target)) this.close();
      },
      true,
    );
    on(window, 'resize', () => this.close());
    on(window, 'blur', () => this.close());
    on(root, 'click', async (event) => {
      const button = event.target.closest('[data-copy-preview]');
      if (!button) {
        if (event.target.closest('[data-term]')) queueMicrotask(() => this.close());
        return;
      }
      const term = this.term;
      try {
        await this.copy(term);
        if (this.term === term) button.textContent = 'Copied';
      } catch {
        if (this.term === term)
          root.querySelector('[data-preview-status]').textContent =
            `Copy unavailable. Select this text: ${term}`;
      }
    });
    this.observer = new MutationObserver(() => {
      if (this.anchor && (!this.anchor.isConnected || !this.anchor.getClientRects().length))
        this.close();
    });
    this.observer.observe(document.body, { childList: true, subtree: true });
  }
  get open() {
    return !this.root.hidden;
  }
  target(element) {
    if (element.closest('.term-kind')) return null;
    return element.closest('[data-term],[data-drag-term]');
  }
  enter(anchor) {
    clearTimeout(this.hideTimer);
    if (this.anchor === anchor || this.blocked()) return;
    this.close();
    const term = anchor.dataset.term || anchor.dataset.dragTerm;
    if (!this.termDeclarations(term).length) return;
    this.anchor = anchor;
    this.term = term;
    this.nativeTitle = anchor.getAttribute('title');
    anchor.removeAttribute('title');
    this.showTimer = setTimeout(() => {
      if (!anchor.isConnected || !anchor.getClientRects().length || this.blocked())
        return this.close();
      const termDeclarations = this.termDeclarations(term);
      if (!termDeclarations.length) return this.close();
      this.root.innerHTML = this.render(term, termDeclarations);
      this.root.hidden = false;
      this.position();
    }, 450);
  }
  position() {
    const anchor = this.anchor.getBoundingClientRect();
    const panel = this.root.getBoundingClientRect();
    const margin = 12,
      gap = 10;
    let left = anchor.left,
      top = anchor.bottom + gap;
    if (
      this.anchor.closest('#library') &&
      anchor.right + gap + panel.width <= innerWidth - margin
    ) {
      left = anchor.right + gap;
      top = anchor.top - 8;
    } else if (top + panel.height > innerHeight - margin) {
      top = anchor.top - gap - panel.height;
    }
    this.root.style.left =
      Math.max(margin, Math.min(left, innerWidth - panel.width - margin)) + 'px';
    this.root.style.top =
      Math.max(margin, Math.min(top, innerHeight - panel.height - margin)) + 'px';
  }
  scheduleHide() {
    clearTimeout(this.showTimer);
    clearTimeout(this.hideTimer);
    if (!this.open) return this.close();
    this.hideTimer = setTimeout(() => {
      if (
        this.root.matches(':hover') ||
        (this.root.contains(document.activeElement) &&
          document.activeElement.matches(':focus-visible')) ||
        this.anchor?.matches(':hover,:focus-visible')
      )
        return;
      this.close();
    }, 220);
  }
  close(returnFocus = false) {
    clearTimeout(this.showTimer);
    clearTimeout(this.hideTimer);
    const anchor = this.anchor;
    const focus = returnFocus && this.root.contains(document.activeElement) && anchor?.isConnected;
    if (anchor && this.nativeTitle !== null) anchor.setAttribute('title', this.nativeTitle);
    this.anchor = null;
    this.term = null;
    this.root.hidden = true;
    this.root.innerHTML = '';
    if (focus) {
      this.returningFocus = true;
      anchor.focus({ preventScroll: true });
      this.returningFocus = false;
    }
  }
  dispose() {
    this.close();
    this.events.abort();
    this.observer.disconnect();
  }
}
