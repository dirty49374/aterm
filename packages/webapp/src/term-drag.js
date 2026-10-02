/** One pointer gesture for HTML and SVG Term labels; Graph movement keeps its own handles. */
export function installTermDrag({ main, accepts, drop, changed }) {
  const controller = new AbortController();
  const options = { signal: controller.signal, capture: true };
  let gesture,
    ghost,
    suppressUntil = 0;
  const finish = () => {
    ghost?.remove();
    ghost = null;
    gesture = null;
    document.body.classList.remove('term-dragging');
    main.classList.remove('term-drop-active');
    changed(false);
  };
  document.addEventListener(
    'dragstart',
    (event) => {
      if (event.target.closest('[data-term],[data-drag-term]')) event.preventDefault();
    },
    options,
  );
  document.addEventListener(
    'pointerdown',
    (event) => {
      const target = event.target.closest('[data-term],[data-drag-term]');
      if (!target || !event.isPrimary || event.button !== 0) return;
      const term = target.dataset.term || target.dataset.dragTerm;
      if (!accepts(term)) return;
      gesture = { term, x: event.clientX, y: event.clientY, pointer: event.pointerId };
    },
    options,
  );
  document.addEventListener(
    'pointermove',
    (event) => {
      if (!gesture || gesture.pointer !== event.pointerId) return;
      if (!ghost && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) < 6) return;
      event.preventDefault();
      if (!ghost) {
        ghost = Object.assign(document.createElement('div'), {
          className: 'term-drag-ghost',
          textContent: gesture.term,
        });
        document.body.append(ghost);
        document.body.classList.add('term-dragging');
        getSelection()?.removeAllRanges();
        changed(true);
      }
      ghost.style.transform = `translate(${event.clientX + 14}px,${event.clientY + 14}px)`;
      main.classList.toggle(
        'term-drop-active',
        main.contains(document.elementFromPoint(event.clientX, event.clientY)),
      );
    },
    options,
  );
  document.addEventListener(
    'pointerup',
    (event) => {
      if (!gesture) return;
      const term = gesture.term;
      const moved = !!ghost;
      const inside =
        moved && main.contains(document.elementFromPoint(event.clientX, event.clientY));
      finish();
      if (!moved) return;
      suppressUntil = performance.now() + 400;
      setTimeout(() => {
        suppressUntil = 0;
      }, 0);
      event.preventDefault();
      event.stopImmediatePropagation();
      if (inside) drop(term);
    },
    options,
  );
  document.addEventListener(
    'click',
    (event) => {
      if (performance.now() < suppressUntil) {
        suppressUntil = 0;
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    options,
  );
  document.addEventListener('pointercancel', finish, options);
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape' && gesture) {
        event.preventDefault();
        finish();
      }
    },
    options,
  );
  window.addEventListener(
    'blur',
    (event) => {
      if (event.target === window) finish();
    },
    options,
  );
  return () => {
    finish();
    controller.abort();
  };
}
