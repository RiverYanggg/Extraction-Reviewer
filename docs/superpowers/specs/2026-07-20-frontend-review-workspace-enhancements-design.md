# Frontend Review Workspace Enhancements Design

## Goal

Improve the evidence-review workspace in three focused areas:

1. Render LaTeX formulas in evidence text while preserving access to the source.
2. Keep keyboard-selected JSON fields visible when navigating with `J/K`.
3. Replace the basic paper `<select>` with an informative, searchable paper picker.

The implementation will preserve the current vanilla HTML/CSS/ES-module architecture and existing backend API contracts.

## Confirmed Product Decisions

- LaTeX is rendered by default, with a pane-level switch to view the original source.
- `J/K` navigation uses minimal scrolling only when the selected field leaves the middle pane's visible area.
- The paper picker is a custom searchable menu.
- Paper colors encode task progress only:
  - green: 100% complete;
  - amber: 1–99% in progress;
  - gray: 0% not started;
  - red: submitted with less than 100% reviewed, indicating an inconsistent task state.

## Architecture and Component Boundaries

### LaTeX rendering

Add a focused frontend module, `app/static/js/latex.js`, responsible for:

- configuring safe KaTeX rendering;
- rendering supported math delimiters;
- preserving the original evidence source;
- switching between rendered and source modes;
- falling back to visible source text when a formula cannot be parsed.

`source.js` remains responsible for evidence-block DOM construction and delegates formula rendering to `latex.js`. KaTeX assets are stored under the application's static directory so formula rendering works without runtime internet access.

Supported delimiters are:

- `$...$` for inline math;
- `$$...$$` for display math;
- `\(...\)` for inline math;
- `\[...\]` for display math.

The display mode is transient UI state and remains unchanged when the user switches papers during the same browser session.

### Keyboard field visibility

The existing bug occurs because `moveSelection()` stores row elements, calls `selectField()`, and then attempts to scroll a row that was detached when the field tree re-rendered.

Selection and scrolling will be separated:

1. determine the next field ID from the currently rendered rows;
2. select the field and allow the tree to re-render;
3. query the newly rendered row by field ID;
4. compare the row rectangle with the middle pane scroll-container rectangle;
5. call `scrollIntoView({block: "nearest"})` only if the row is outside the visible region.

The helper that determines whether scrolling is required will be isolated and unit-tested. The browser page itself must not scroll, and the left and right panes must remain unaffected.

### Paper picker

Add `app/static/js/paper-picker.js` as an accessible custom combobox/listbox component. It receives the paper summaries returned by `/api/papers` and invokes the existing paper-loading callback.

The closed trigger displays:

- two-digit assignment sequence number;
- progress-status dot;
- truncated paper title;
- review percentage.

The open menu displays:

- two-digit sequence number;
- progress-status dot;
- title;
- DOI/paper ID;
- reviewed and total field counts;
- percentage;
- textual state.

Users can filter by title or DOI. Supported interactions are mouse selection, arrow-key movement, Enter to select, Escape to close, outside-click dismissal, and `Ctrl/Command + P` to open the picker and focus its search input.

The paper list is cached in frontend state. When the current paper's annotation progress changes, its cached summary and rendered menu item are updated so the picker remains current without a page reload.

## Data Flow

The backend `/api/papers` response already includes the required metadata and progress information, including `progress.task_status`; no API schema change is required.

At workspace startup:

1. fetch paper summaries;
2. initialize the paper picker with stable assignment order;
3. load the first assigned paper using the existing `loadPaper()` flow.

During annotation:

1. the store mutation triggers the existing render loop;
2. progress is recalculated from the current annotation document;
3. the cached current-paper summary is updated;
4. the picker trigger and matching menu item refresh.

Switching papers still flushes pending annotation changes before requesting the next workspace payload.

## Interaction Details

### Evidence source mode

The evidence-pane header includes one compact toggle labeled according to the available action, such as “查看源码” or “渲染公式”. Rendered mode is the default.

Plain text, headings, tables, images, evidence IDs, click selection, and evidence highlighting retain their current behavior. Only recognized formula fragments are transformed.

KaTeX is configured not to trust unsafe commands. A malformed formula remains readable as source and receives a lightweight error marker; failure in one formula does not prevent other formulas or evidence blocks from rendering.

### Field navigation

Mouse selection does not force middle-pane scrolling. The visibility-follow behavior is specifically applied to keyboard `J/K` navigation.

A row counts as visible when its top and bottom fit inside the scroll container's viewport. If it crosses either boundary, the new row is scrolled the minimum distance necessary using `block: "nearest"`.

### Paper task states

State derivation is deterministic:

- `submitted` and percentage below 100: inconsistent/error, red;
- percentage equal to 100: complete, green;
- percentage greater than 0 and below 100: in progress, amber;
- percentage equal to 0: not started, gray.

This color dimension is limited to paper-level progress and does not reuse the field review-status meaning inside the JSON tree.

## Error Handling and Accessibility

- If KaTeX assets fail to load, evidence remains available as original text and the toggle indicates source mode.
- Invalid formulas fall back individually rather than blanking an evidence block.
- Empty paper searches show a clear no-results message.
- The paper picker trigger and list use combobox/listbox semantics, visible focus styles, and keyboard navigation.
- A paper-load failure keeps the picker usable and presents the existing workspace error treatment.
- Long titles and DOI values truncate visually while retaining full text in a title attribute.

## Testing and Acceptance

### Automated tests

Use Node's built-in test runner for dependency-free frontend unit tests covering:

- paper state/color derivation for not started, in progress, complete, and inconsistent submitted states;
- title and DOI filtering;
- two-digit sequence formatting;
- field visibility calculations for fully visible, above-viewport, and below-viewport rows;
- LaTeX rendering configuration and invalid-formula fallback behavior.

Run the existing Python test suite to detect backend and authentication regressions.

### Browser acceptance

Verify:

- inline math, display math, mixed prose, and malformed formulas;
- source/rendered mode switching and persistence across paper changes;
- repeated `J/K` navigation keeps the selected row visible in the middle pane;
- the left evidence pane and right inspector do not move because of field-list scrolling;
- paper search, mouse selection, arrow navigation, Enter, Escape, outside click, and `Ctrl/Command + P`;
- live current-paper progress updates in the picker;
- responsive title truncation without displacing top-bar actions.

## Scope Limits

This change does not introduce a frontend framework or bundler, change annotation semantics, redesign bucket navigation, alter backend paper discovery, or add new task states. It is limited to the three confirmed frontend improvements and the small modules/tests required to implement them cleanly.
