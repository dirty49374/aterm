# Model Explorer

A browser reader for the Aterm server, with one Working Set shared across views
and a CLI interface for presenting Terms and Markdown Notes in a selected tab.

```sh
pnpm build
pnpm aterm server run
```

Open http://localhost:43127/ (or the configured `server.port`). For remote access,
set `server.host: 0.0.0.0`, restart the server, and open `http://SERVER_IP:PORT/`.
The UI and API share that origin; no separate API address or CORS setting is needed.

## Working Set and readers

**Term Declarations | References | Graph** share one ordered Working Set. **Context | Note**
control a separate reader on the right. Tab changes preserve membership and the
common Navigation. The title shows the first Term, followed by `N more` when
needed; its Copy action copies the qualified Working Set identities.

| Interaction                    | Effect                                                   |
| ------------------------------ | -------------------------------------------------------- |
| Navigation Term-name click     | Replace the Working Set with that Term                   |
| Term checkbox                  | Add or remove the Term                                   |
| Knowledge or Group checkbox    | Add or remove all matching descendant Terms              |
| Knowledge or Group name        | Expand or collapse its branch                            |
| Reader Term link or Graph Read | Read Context without changing membership                 |
| Drag a Term into the Main View | Add it without duplicates                                |
| Graph Node click               | Change Graph Selection, independently of the Working Set |

Term Declarations and References use one collapsible card per Term; only the first newly
displayed card opens initially. A closed card retains its name, Knowledge, Term Kinds
and Definitions. Term Declaration content, Relations and exact source references remain
available when opened. Dragging works from Navigation, the Main View, Context,
Notes and Graph Term labels; the Graph Move handle changes position instead.

Context follows Term links without changing the Main View or Graph camera.
Use Add to Working Set to include its Term. Note shows an Agent's Markdown
explanation beside the current view. Context and Note retain separate reading
targets and share one resizable pane; **×** closes it and either tab reopens it.
Press **T** in the Graph to toggle Context. Pane changes retain Graph geometry;
use Fit explicitly when the new Canvas width needs reframing.

Hover a Term for 450 ms to see its qualified name, Copy button and Definition
preview for each Term Kind. The preview stays open while moving into it to copy.
Keyboard focus also opens it; Tab reaches Copy and Escape dismisses it. Previews
use the current corpus snapshot and do not change membership or the reading target.
Literal code remains literal. Hovering a truncated Term Kind reveals its full name.

## Navigation

Search sits above one filter group containing Knowledge, Viewpoint and Term Kind.
The Knowledge chooser shows ID, Description, file path and Term count, including
empty Knowledges. All Knowledge groups the tree by Knowledge. Viewpoint and Term Kind
choices follow that scope; changing Knowledge resets these filters while retaining
Search, the Working Set and Context. Cross-Knowledge links and neighbors remain
available. Use Up/Down and Enter in the chooser; Escape closes it.

Tree branches start closed. Knowledge has a book icon and Group a folder icon.
Expanding a branch never changes membership. Search opens matching branches
temporarily without erasing remembered expansion. A parent checkbox is checked
when all matching descendants are included, mixed when some are, and empty when
none are. Bulk changes include collapsed descendants, deduplicate repeated Term occurrences
and preserve members outside the filtered subtree. Term rows keep the Term Kind on the right.

Pin Navigation to keep it docked. Unpin it to collapse when the pointer leaves;
hover or activate the header chevron to reopen it as an overlay. Drag its divider
or focus it and press Left/Right to resize. Width and pin preference are retained.
Temporary overlays do not resize the Graph; narrow screens also use an overlay.
Press `/` outside the Graph to focus Search; inside the Graph it opens Find Term.

React Router owns `/term-declarations`, `/references` and `/graph/structure` or `/graph/explore`.
Routes retain Knowledge, filters, the ordered Working Set and independent Context
target across browser history and reload; large Working Sets use history state.
A missing Knowledge stays explicit instead of silently expanding to all Knowledges.
Server revisions refresh all views from one published corpus snapshot.

`src/` contains the React shell, router and interaction controllers; `public/`
contains shared browser modules and CSS. The build bundles assets and packaged
layout Workers into `packages/core/webapp/` for both server and standalone use.
Core owns query semantics through `/api/query` and `/api/health`; a same-origin
WebSocket registers the UI Session and receives commands from `/api/ui`.

## Markdown

Term Declarations, Context, Notes, Knowledge Description and Scope share the Markdown reader.
It supports heading levels, nested lists, read-only task lists, blockquotes,
tables, strikethrough, images, links and code blocks. Declare a code fence language
such as `typescript`, `json`, `yaml`, `bash`, `sql`, `python` or `trm` for syntax
highlighting; unknown languages remain literal. Copy preserves the source text.
`trm` and its `aterm` alias use one Aterm grammar: directives, Term Kind, Term, Group,
section, Relation, section reference, dagger, delimiters and comments have distinct
syntax roles. Samples remain literal code; they are never expanded or executed.

Use a `mermaid` fence for diagrams, including flowcharts, sequence and ER diagrams.
Diagrams fit the pane; Actual size lets you scroll a large diagram at its original
size. Mermaid source expands below each diagram with its own syntax highlighting
for keywords, arrows, cardinalities, labels, comments and configuration, and can
be copied. Source highlighting is also available for invalid diagrams. Invalid syntax
shows an error beside its source, leaving the rest of the reader available.
Markdown and highlighting ship in `markdown.js`; `mermaid.js` loads only when a
diagram is present. All dependencies are packaged, with no runtime CDN.
Authored HTML stays literal. HTTP(S) links open separately, images accept HTTP(S)
and embedded raster data, and Mermaid renders in strict mode as an isolated image.
The reserved `.relations` section renders one declaration per row with clickable
Targets in both Term Declarations and Context.
It has no write controls. The shared app specification is
`_aterm:Explorer_` in `packages/core/docs/aterm.trm`.
Graph behavior starts at `_aterm:Graph_View_` in
`packages/core/docs/aterm.trm`.

## Graph Explorer

**Explore** is the Working Set as a flat graph: one Node per Term, with all its
qualified Term Kinds, name and two-line Definition preview. **Structure** shows the
whole corpus hierarchy; its layout and Selection remain independent of Explore.
Both use the same compact Term card styling. The floating toolbar lives inside
the Canvas; blank gaps pass pointer gestures through to the Canvas.

### Explore

An empty Working Set gives an empty Canvas. Check or drag Terms from Navigation,
use Find Term, or use Add to Working Set in Context to include them. Eligible
Relations appear when both endpoints are included; neighbors and ancestors are
never included automatically.

Hover or focus a Node to reveal Add neighbors, Move and Remove. Add neighbors
opens one searchable dialog with Incoming and Outgoing columns. Both appearances
of the same neighbor share one checkbox state. The footer contains **Select all
matching | Cancel | Apply**; Select all toggles matches across both columns, and
each column also has a matching toggle. Apply changes membership once; Cancel
discards choices.

Use Select mode to drag a box on blank Canvas. Shift or Ctrl/Command adds to the
Selection. Drag a selected card to move selected Nodes together, or use Move to
move one unselected Node. Arrow keys on Move shift it by 10 units, or 50 with
Shift. Pan mode, Space-drag or middle-button drag pans; Escape cancels a gesture.
Wheel zoom retains the point under the pointer; zoom buttons and +/− use the
Canvas center. Both Graph modes share the same zoom bounds.

Delete/Backspace removes selected Terms from the Working Set; a Node's Remove
marker removes only that Term. Clear empties membership. These changes are
visible in Term Declarations and References too. Effective moves and membership changes
support Undo; adding or removing Terms retains surviving positions and camera.
Arrange recomputes placement; Fit changes only the camera.

### Structure

Term Declaration openers accept an optional authored Group path:

```trm
procedure _Run_Test_ in test.procedures = {
  Runs the test suite.
}
```

Group paths use dot-separated lowercase_snake_case segments. Prefixes are
implicit; `test.procedures` creates `test` and its `procedures` subgroup. Omission
places the Term Declaration directly under Knowledge. Each Term has one Term Declaration and at most one authored Group. Moving a Term Declaration does not change its Term reference.
Use a complete-Term Declaration `aterm term edit` to change its path. Show/view preserve the clause;
structured Term Declaration results carry it as the optional `group` field.

Structure and Navigation use the same authored hierarchy. Navigation can
collapse each Group independently; state persists across tabs and corpus refresh. Search
opens matching branches without erasing that remembered state. Term detail shows
each Term Declaration's path. Graph displays each Term's single Term Declaration and starts with collapsed Knowledge cards and Groups.

`has_part` derives additional rendering Groups from the source Term Declaration's declarations.
A derived **Machine group** contains the Machine Term Declaration itself and the single Term Declaration of each
part Term. Those appearances preserve the parts' original authored placement.
`has_member`, `has_state`, `is_a` and other Relations stay edges without creating enclosure.
Collapsed and expanded Group cards keep their identity; internal has_part edges
remain visible after expansion. Repeated ancestor Term Declarations stop as leaves, keeping
cycles finite. Cross-Knowledge parts remain edges. No Group instance becomes a
corpus Term, Term Kind or new Relation.

The Vending Machine Sample uses machine, inventory and payment prefixes, each
with concepts and procedures subgroups. Its Machine derived Group still reveals
Vending_Machine, Inventory_System and Payment_System. Aterm's Graph guidance uses
graph.layout, graph.rendering.structure, graph.rendering.nodes, graph.rendering.edges,
graph.operations, graph.state and graph.views.
Read on a Group shows member Term Kinds and Term links; Read on a Term Declaration shows
its canonical Term's single Term Declaration. Find Term offers individual Terms with Group paths
and reveals the selected Term Declaration. Authored membership and derived part structure remain
independent of the temporary visibility controls below.

Click a Node header to select that display instance. Shift-click or Ctrl/Command-click
toggles its Selection membership; a blank Canvas click clears Selection, while panning
preserves it. Selected Nodes and their incident Edges stay bright. Hover or keyboard
focus adds the directional animation. Selection does not arrange, fit, expand or read.
Use the separate Chevron to expand/collapse, and Read to open detail without replacing
Selection. Different appearances of the same Term can be selected independently.

In Structure, **Explore selected** (E) starts a flat Explore graph from the selected
Nodes. Knowledge and Group selections include their member Terms, even while
collapsed; repeated display occurrences become one Node per Term. This replaces
the Working Set, selects the imported Terms, and arranges and fits them in Explore.
Undo restores the previous Explore graph. Switching back to Structure preserves
its Selection and layout; the ordinary mode buttons only resume each mode.

Read opens the shared Context pane. Its tab reopens the retained reading target
after closing with **×**. Read and reader links preserve Node positions and the
camera in both modes.

A small **+N** on a Node reports connections not currently shown. Its tooltip
separates Incoming and Outgoing; Relation categories turned off in the selector
do not count. N counts assertions, including connections omitted by focus, collapsed
containers or Hidden Groups, rather than neighbor Terms or bundled Edge labels.
An internal assertion counts once in the total even when incident in both directions.
No indicator means all eligible connections for that display occurrence are shown.

The Keep selector controls **Hide others**:

- **Selected only** keeps selected Nodes and their ancestor paths.
- **Selected + neighbors** also keeps directly connected incoming/outgoing neighbors.
  It uses the current Relation filter and pre-hide expansion, ignoring an earlier hide
  mask. It adds only one hop from the original Selection.

From the current root downward, each remaining sibling subtree goes into a temporary
**Hidden Group** under its original parent. No deeper Hidden Groups are created within
a wholly hidden branch. Selecting an ordinary Group does not keep its children.
Hidden Groups start closed; opening one lets you select items and **Unhide selected**.
A nested item returns with its ancestor path; remaining siblings stay hidden. Selection
alone never changes hiding. Selecting a Hidden Group makes its direct hidden members
the command inputs. Empty Hidden Groups disappear. **Show all** clears hiding while
preserving the original expansion and membership. Hide, Unhide and Show all support Undo.

Hidden Group boundary Edges are normally concealed, even with a selected endpoint.
Hover or keyboard-focus the Group or a displayed member to preview those connections;
the revealed Edge remains visible while it is itself hovered/focused. Preview never
changes layout. Internal Edges display normally inside an expanded Hidden Group.
Hidden Groups have no Focus action; Focus and Reveal use original containment paths.

Opening Knowledge focuses the canvas there. The breadcrumb returns to ancestors
or All Knowledge, preserving expansion. Focus on an expanded header drills into
that subtree. Find Term opens the selected Term's ancestors and its own Group and crosses Knowledge
when necessary. Library scope remains independent. Read opens the passive detail
pane; links read Terms without changing graph focus. Use Find Term when you want
to reveal a Term Declaration's ancestor path in Structure.

### Layout and connections

The toolbar's Layout selector offers three placements:

- **Layered** (initial): ELK arranges leaves within each scope from top to bottom;
  independent containers are packed without using cross-scope connections.
- **fCoSE**: lays out the whole visible compound graph, including cross-scope connections.
- **CiSE**: arranges each scope's direct children on a circle, from inner scopes outward.
  Connections between descendants of different children contribute at their shared scope.

Changing layout preserves expansion, focus, filters and detail, then arranges and fits.
The selected algorithm persists across navigation, tab changes and data refresh in
the session. All engines run in packaged Workers. Switching away from a force layout
terminates its Worker; errors leave the graph available for retry or another layout.
`src/` contains the fCoSE/CiSE adapters and Worker entry, bundled by `pnpm build`.

Every edge is drawn as a direct cubic Bézier connection. Each Node offers twelve
Anchor candidates: 25%, 50% and 75% along each of its four sides. Each Edge selects
a source/target pair, first reducing card and Header penetration, then sharing
of attachments and curve length. Expanded Bodies remain traversable. Selection
is deterministic and recalculated after geometry or visible connections change;
pan, zoom and reading retain the existing geometry. It is a bounded heuristic,
not a guarantee of a crossing-free graph. `public/graph-geometry.js` owns this
selection and label placement; node placement remains in the layout modules.
ELK edge routes are discarded. No intermediate routing waypoints or shared
orthogonal trunks are used. Collinear endpoints can look straight. Original
edge endpoints and locations remain inspectable. The Relations checkbox selector
offers Reference, each structural built-in (is_a, has_part, has_member, has_state)
and Other relations; all start selected. Categories come from the shared Relation registry.
Reference includes authored `references` and raw corpus References available in the
Relations result, which still suppresses a raw Reference when its ordered Term pair
has an authored Relation. Other relations includes all remaining authored assertions.
Both modes filter before bundling and preserve containment, Selection, geometry,
camera and Undo history. Add neighbors and Hide others use the same categories.
Select all toggles the complete set; individual changes apply without closing the
selector. Escape returns focus to its trigger. Relation names
are shown along the actual edge route. All assertions between the same visible
source and target share one directed Edge, for both individual Term Declarations and containers;
opposite directions remain separate. Each label shows at most two distinct phrases,
ordered by case-sensitive code-unit order, followed by `+N` for additional phrases.
Repeated phrases carry a count such as `uses ×2`; that count is independent of `+N`.
Tooltip, accessible name and detail retain the complete information. Labels avoid cards and other
labels where space permits, and remain clickable even where routes overlap.
Click a line or label, or keyboard-activate
an edge, to inspect its original Relations.

Hover a line or its label to animate repeating dashes from source to target.
Hover a Term card to animate all its visible incoming and outgoing edges in their
own source-to-target directions. Keyboard focus provides the same feedback;
reduced-motion preferences keep a static highlight instead.

Expansion, collapse and focus arrange and fit the current scope. Arrange computes
geometry; Fit changes only the camera. Pane resizing leaves geometry intact.

| Shortcut                       | Action                                              |
| ------------------------------ | --------------------------------------------------- |
| /                              | Find Term                                           |
| C                              | Collapse all and return to overview (Structure)     |
| E                              | Explore selected Structure Nodes                    |
| A                              | Arrange                                             |
| F                              | Fit                                                 |
| T                              | Toggle Context                                      |
| H                              | Hide others using the current Keep mode (Structure) |
| U                              | Unhide selected (Structure)                         |
| Shift H                        | Show all (Structure)                                |
| Delete / Backspace             | Remove selected Terms (Explore)                     |
| Ctrl/Command Z                 | Undo                                                |
| + / −                          | Zoom                                                |
| Arrow keys on canvas           | Pan                                                 |
| Enter / Space on a card header | Select; Shift or Ctrl/Command toggles membership    |
| Enter / Space on a Chevron     | Expand or collapse                                  |
| Escape                         | Close search                                        |

Search traps focus and shortcuts do not run while typing. Expansion, focus, Selection,
hiding and camera are session state. Refresh preserves surviving state and clears Undo.
Collapse all clears hiding as well as expansion, focus and Selection.
Stale layout success/failure cannot overwrite a newer session.

## UI Sessions and Notes

Each open browser tab registers a UUID that survives reload and reconnection,
including a server restart. Duplicated live tabs get distinct UUIDs. The registry
reports status, visibility, location, reading target, Working Set, Graph Selection,
revisions, Note summary and timestamps. Lists sort by last active descending;
last seen also includes heartbeat contact and is not a measure of user activity.
Retaining a Session UUID does not persist Graph geometry or Selection across reload.

Use the same Home as the browser. Inspect available tabs before choosing a target;
full UUIDs and unique hexadecimal prefixes of at least six characters are accepted.
Replace `a1b2c3` below with the intended Session's inspected identifier.

```sh
pnpm aterm ui session list
pnpm aterm ui session view a1b2c3 --output json
pnpm aterm ui explore set _vending_machine:Vending_Machine_ _vending_machine:Inventory_System_ --session a1b2c3
pnpm aterm ui note send --session a1b2c3 --title 'Machine and inventory' <<'MARKDOWN'
# Machine and inventory
- _vending_machine:Vending_Machine_ coordinates the machine.
- _vending_machine:Inventory_System_ organizes product stock and restocking.
- Click a Term to read Context; drag it into the Main View to compare it.
MARKDOWN
pnpm aterm ui session view a1b2c3 --output json
```

`ui open TERM` replaces the Working Set with one Term and opens Term Declarations and Context.
`ui explore set`, `add`, `remove` and `clear` operate on the same membership and
activate Explore while retaining Context. Set selects, arranges and fits; the
incremental operations keep surviving positions and camera. Clear empties membership
and Graph Selection. These are the same undoable operations as direct interaction.
Use exact Term identities; globs and `--knowledge` are not accepted here.

`ui note send` reads Markdown from `--file`, or stdin when omitted or `-`.
Use qualified Term references because Notes have no implicit Knowledge. The Note
opens beside the current Main View without changing its route, membership or Graph.
The browser caches ten recent Notes in localStorage per origin and Home; history
survives reload, tab closure and server restart. Selecting an old Note does not
restore its captured Working Set or layout. Other tabs see updated history without
being navigated. Note bodies are limited to 65536 UTF-16 code units; titles to 160.

Only `applied` means the browser applied a command. A busy or disconnected tab
cannot accept a new instruction. For an `unknown` outcome, inspect the reported
UUID using `ui command view UUID` before retrying. Repeating the same payload with
`--command-id UUID` returns its record without another delivery. After expiration
or server restart, compare the current browser state before issuing another action.
UI commands require a live server and connected tab; they never fall back to
filesystem execution or launch a browser automatically.

For the complete Agent workflow, run `pnpm aterm term view _aterm:Explorer_Presentation_Procedure_ --output markdown`
or read it as part of `pnpm aterm skill view aterm`.

The preceding graph is backed up under
`trials/backups/graph-before-structure-20260921-121114/`.
