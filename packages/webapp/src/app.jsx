import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider, Outlet } from 'react-router';
import { createExplorer } from './explorer.js';

// React owns the persistent shell. Reader/library/Graph adapters own their DOM hosts.
function AppShell() {
  useEffect(() => {
    const explorer = createExplorer(router);
    return () => explorer.dispose();
  }, []);
  return (
    <>
      <div className="workspace">
        <aside className="library" id="library" aria-label="Term library">
          <div className="library-header">
            <a className="brand" href="#">
              <span className="brand-mark">
                a<span>_</span>
              </span>
              <span>
                aterm<small>Model Explorer</small>
              </span>
            </a>
            <button
              id="navigation-pin"
              className="icon-button navigation-pin"
              aria-label="Unpin navigation"
              aria-pressed="true"
              title="Unpin navigation"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M8 3h8l-1 6 4 4v2H5v-2l4-4-1-6ZM12 15v6" />
              </svg>
            </button>
          </div>
          <nav className="application-menu" aria-label="Application">
            <button data-page="term" aria-current="page">
              Explorer
            </button>
            <button data-page="graphql">GraphQL</button>
          </nav>
          <div className="library-tools">
            <label className="searchbox">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="10.5" cy="10.5" r="6.5" />
                <path d="m16 16 4.5 4.5" />
              </svg>
              <input
                id="search"
                type="search"
                placeholder="Find a Term…"
                aria-label="Search Terms"
              />
              <kbd>/</kbd>
            </label>
            <div className="library-filters" role="group" aria-label="Filter Terms">
              <button
                id="knowledge-picker"
                className="knowledge-picker"
                aria-haspopup="dialog"
                aria-controls="knowledge-dialog"
              >
                <span className="knowledge-mark" aria-hidden="true">
                  ◫
                </span>
                <span className="knowledge-picker-copy">
                  <span className="control-label">Knowledge</span>
                  <strong id="knowledge-label">All Knowledge</strong>
                  <small id="knowledge-summary">Reading Knowledges…</small>
                </span>
                <span aria-hidden="true">⌄</span>
              </button>
              <div className="filters">
                <label>
                  <span>Viewpoint</span>
                  <select id="viewpoint">
                    <option value="">All viewpoints</option>
                  </select>
                </label>
                <label>
                  <span>Term Kind</span>
                  <select id="termKind">
                    <option value="">All Term Kinds</option>
                  </select>
                </label>
              </div>
            </div>
          </div>
          <div id="reading-context" className="reading-context" hidden></div>
          <div className="library-label">
            <span>Terms</span>
            <span id="term-count">—</span>
          </div>
          <nav id="term-list" className="term-list" aria-label="Terms">
            <div className="library-empty">Connecting to your model…</div>
          </nav>
          <button
            id="model-reference-open"
            className="model-reference-open"
            aria-haspopup="dialog"
            aria-controls="model-reference"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 5v16M12 5C9 3 6 3 3 4v15c3-1 6-1 9 2 3-3 6-3 9-2V4c-3-1-6-1-9 1Z" />
            </svg>
            Knowledge &amp; Viewpoints
          </button>
          <div className="library-bottom">
            <span className="workspace-icon">⌂</span>
            <div>
              <strong id="workspace-name">Workspace</strong>
              <span id="workspace-path">Local model</span>
            </div>
            <span className="readonly">Read only</span>
          </div>
        </aside>
        <div
          id="library-divider"
          className="library-divider"
          role="separator"
          tabIndex="0"
          aria-label="Resize navigation"
          aria-orientation="vertical"
          aria-valuemin="220"
          aria-valuemax="480"
          aria-valuenow="282"
        ></div>
        <button className="scrim" id="scrim" aria-label="Close Term library" hidden></button>
        <div className="main-shell">
          <header className="topbar">
            <div className="header-identity">
              <div className="navigation-controls" role="group" aria-label="Navigation">
                <button
                  id="menu"
                  className="icon-button navigation-chevron"
                  aria-label="Show navigation"
                  aria-controls="library"
                  aria-expanded="true"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="m9 6 6 6-6 6" />
                  </svg>
                </button>
              </div>
              <div className="header-term">
                <div className="header-title-row">
                  <button
                    id="active-knowledge"
                    className="knowledge-tag"
                    title="Choose Knowledge"
                    aria-haspopup="dialog"
                    aria-controls="knowledge-dialog"
                  >
                    All Knowledge
                  </button>
                  <span className="identity-separator" aria-hidden="true">
                    /
                  </span>
                  <h1 id="active-term">Aterm</h1>
                  <span id="working-more" className="working-more" hidden></span>
                  <button
                    className="icon-button"
                    id="copy-term"
                    title="Copy Term"
                    aria-label="Copy Term"
                  >
                    ⧉
                  </button>
                </div>
                <div className="header-summary">
                  <div id="term-status" className="term-subtitle">
                    Model Explorer
                  </div>
                  <button
                    id="library-scope"
                    className="scope-indicator"
                    aria-haspopup="dialog"
                    aria-controls="knowledge-dialog"
                    hidden
                  ></button>
                </div>
              </div>
            </div>
            <div className="top-actions">
              <button id="diagnostics-button" className="health-button" title="View diagnostics">
                <span className="check-symbol">✓</span>
                <span id="diagnostics-label">Checking model</span>
              </button>
              <span className="top-divider"></span>
              <span className="connection" id="connection" role="status">
                <i></i>
                <span>Connecting</span>
              </span>
              <button
                id="refresh"
                className="icon-button"
                title="Refresh model"
                aria-label="Refresh model"
              >
                ↻
              </button>
            </div>
          </header>
          <div id="notice" className="notice" role="status" hidden></div>
          <div className="view-tabs">
            <div className="tabs" role="tablist" aria-label="Main Views">
              {['term-declarations', 'references', 'graph'].map((tab) => (
                <button
                  key={tab}
                  className="tab"
                  data-tab={tab}
                  role="tab"
                  aria-controls="main"
                  aria-selected={tab === 'term-declarations'}
                >
                  {tab === 'term-declarations'
                    ? 'Term Declarations'
                    : tab[0].toUpperCase() + tab.slice(1)}
                </button>
              ))}
            </div>
            <div className="tabs reader-tabs" role="tablist" aria-label="Reader">
              <button
                id="context-toggle"
                className="tab"
                data-pane="context"
                role="tab"
                aria-controls="context-pane"
                aria-selected="false"
              >
                Context
              </button>
              <button
                id="notes-toggle"
                className="tab"
                data-pane="note"
                role="tab"
                aria-controls="context-pane"
                aria-selected="false"
              >
                Note <span data-note-count />
              </button>
            </div>
          </div>
          <div className="shell-body">
            <main id="main" className="main" tabIndex="-1" />
            <section
              id="graphql-main"
              className="main graphql-main"
              aria-label="GraphQL workspace"
              hidden
            />
            <div
              id="context-divider"
              role="separator"
              tabIndex="0"
              aria-label="Resize Context pane"
              aria-orientation="vertical"
              aria-valuemin="280"
              aria-valuemax="680"
              aria-valuenow="380"
              hidden
            />
            <aside id="context-pane" className="context-pane" aria-label="Context and Note" hidden>
              <header className="context-header">
                <strong id="context-heading">Context</strong>
                <button
                  id="context-close"
                  className="icon-button"
                  aria-label="Close reader"
                  title="Close reader"
                >
                  ×
                </button>
              </header>
              <div id="context-content" className="context-content">
                <p className="empty-panel">
                  Click a Term to read it here. Drag it into the Main View to add it to your Working
                  Set.
                </p>
              </div>
              <div id="notes-pane" className="notes-pane" aria-label="Markdown Notes" hidden>
                <label className="note-history">
                  <span>Recent Notes</span>
                  <select data-note-history aria-label="Recent Notes" />
                </label>
                <div className="note-content">
                  <div className="note-meta" data-note-meta />
                  <h2 className="note-title" data-note-title />
                  <div className="note-context" data-note-context />
                  <article className="prose" data-note-body />
                </div>
              </div>
            </aside>
          </div>
          <footer className="statusbar">
            <button id="ui-session" className="ui-session" title="Copy Session UUID">
              Session · connecting
            </button>
            <span id="model-summary">Reading workspace</span>
            <span>
              <span className="live-indicator"></span>
              <span id="revision">Live filesystem</span>
            </span>
          </footer>
        </div>
      </div>
      <dialog id="knowledge-dialog" className="knowledge-dialog" aria-labelledby="knowledge-title">
        <header>
          <div>
            <h2 id="knowledge-title">Choose Knowledge</h2>
            <p>Set the scope of your Term library.</p>
          </div>
          <button id="close-knowledge" className="icon-button" aria-label="Close Knowledge chooser">
            ×
          </button>
        </header>
        <label className="searchbox">
          <input
            id="knowledge-search"
            type="search"
            placeholder="Find by ID or source file path…"
            aria-label="Search Knowledge"
          />
        </label>
        <div id="knowledge-options" className="knowledge-options" aria-label="Knowledges"></div>
        <footer>
          <span>↑ ↓ Navigate</span>
          <span>Enter Select</span>
          <span>Esc Close</span>
        </footer>
      </dialog>
      <dialog
        id="model-reference"
        className="model-reference"
        aria-labelledby="model-reference-title"
      >
        <header className="model-reference-header">
          <h2 id="model-reference-title">Knowledge &amp; Viewpoints</h2>
          <button
            data-reference-close
            className="icon-button"
            aria-label="Close model reference"
            title="Close"
          >
            ×
          </button>
        </header>
        <div className="model-reference-body">
          <aside className="reference-catalog" aria-label="Model reference catalog">
            <div className="tabs" role="tablist" aria-label="Reference type">
              <button
                id="reference-knowledge-tab"
                className="tab"
                role="tab"
                data-reference-tab="knowledge"
                aria-selected="true"
                aria-controls="reference-results"
              >
                Knowledge
              </button>
              <button
                id="reference-viewpoint-tab"
                className="tab"
                role="tab"
                data-reference-tab="viewpoint"
                aria-selected="false"
                aria-controls="reference-results"
                tabIndex="-1"
              >
                Viewpoints
              </button>
            </div>
            <label className="searchbox">
              <input
                data-reference-search
                type="search"
                aria-label="Search model reference"
                placeholder="Find by name or description…"
              />
            </label>
            <div className="reference-catalog-count" data-reference-count role="status" />
            <nav id="reference-results" data-reference-list aria-label="Reference results" />
          </aside>
          <article
            data-reference-detail
            className="reference-document"
            aria-label="Reference document"
            tabIndex="0"
          />
        </div>
      </dialog>
      <aside
        id="term-preview"
        className="term-preview"
        role="dialog"
        aria-label="Term preview"
        hidden
      ></aside>
      <div className="toast" id="toast" role="status" hidden></div>
      <Outlet />
    </>
  );
}
const RouteSurface = () => null;
const router = createBrowserRouter([
  {
    Component: AppShell,
    children: [
      { index: true, Component: RouteSurface },
      { path: 'term-declarations', Component: RouteSurface },
      { path: 'references', Component: RouteSurface },
      { path: 'terms/:knowledge/:term', Component: RouteSurface },
      { path: 'terms/:knowledge/:term/references', Component: RouteSurface },
      { path: 'graph/structure', Component: RouteSurface },
      { path: 'graph/explore', Component: RouteSurface },
      { path: 'diagnostics', Component: RouteSurface },
      { path: 'queries', Component: RouteSurface },
    ],
  },
]);
createRoot(document.getElementById('root')).render(<RouterProvider router={router} />);
