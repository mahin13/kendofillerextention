# Kendo Filler

A Chrome extension (Manifest V3) that detects Kendo UI and native form controls on the
current page and fills them with valid test data immediately — no Selenium, no Playwright,
no coordinate clicking, no application-specific selectors.

Built from `Kendo_Filler_Chrome_Extension_Specification.docx`.

---

## Install (Chrome Developer Mode)

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked**.
4. Select this `kendo-filler` folder (the one containing `manifest.json`).
5. Pin **Kendo Filler** to the toolbar.

Requires Chrome 111+ (the extension injects its engine into the page world, which needs
`world: "MAIN"` support).

To test on pages opened from disk (`file://…`), open `chrome://extensions` → Kendo Filler →
**Details** → enable **Allow access to file URLs**.

## Use

1. Open the form you want to fill.
2. Click the Kendo Filler icon. The popup opens on its home view: the scope of the run, a
   one-card summary of what the next run will do, and the large **AUTOFILL** button pinned to
   the bottom so it is always in reach.
3. Click **AUTOFILL**. The result line reports
   `Detected 24 fields • Filled 22 • Skipped 2`, and **Show diagnostics** lists every field
   with the value it received or the reason it was skipped or failed.
4. **Scan** counts supported fields without changing anything.
5. Everything configurable lives behind the **Settings** button in the header:
   * **Appearance** — Light, Dark or Auto (Auto follows the operating system). The choice is
     stored with the rest of the configuration and applied before the popup's first paint, so
     it never flashes the wrong theme.
   * **Fill mode** — All Fields or Required Fields Only.
   * **Control categories** — one card per category (dropdowns, TreeView, checkboxes,
     toggles, radios, numeric, decimal, free-form, conditional) with its switch and its
     options: Checked/Unchecked, Yes/No defaults, numeric and decimal ranges, decimal places.
   * **Fill only empty fields** / **Highlight filled fields**, and **Reset configuration**.

Kendo Filler never clicks Save/Submit, never navigates, and never calls your application's
APIs itself.

---

## What it fills

| Category | Behaviour |
| --- | --- |
| Kendo DropDownList / ComboBox / DropDownTree / native `select` | Selects the first valid selectable record; placeholders (`Select…`, `-- Select --`, blanks) and disabled options are ignored; retries the next record if validation rejects the first |
| Dropdowns **with a search box** (filterable / `serverFiltering`) | Handled explicitly: a search result left in `dataSource.view()` no longer reads as "no records", and a list that loads nothing until something is typed is searched — through `widget.search()`, or by typing into the popup's search box when the widget API is out of reach |
| Kendo TreeView | Selects the first genuinely selectable node in DOM order (disabled and structural nodes skipped) |
| Checkbox | Set to Checked / Unchecked (configurable); never toggled if already in the wanted state |
| Toggle / Switch (Kendo Switch, ARIA switch) | Configurable default: **Yes** or **No** |
| Radio buttons | Configurable default: **Yes** or **No**; one member per group; falls back to the first safe option when the group has no Yes/No, and refuses destructive-looking options (`Delete existing rows`) |
| Numeric fields | Random integer honouring `min` / `max` / `step` and Kendo configuration; falls back to the configured range (default 1–999) |
| Kendo decimal fields | Random decimal honouring `min` / `max` / `step` and the field's decimal precision (default 2 dp when none is discoverable) |
| Free-form text / textarea | Label + random number — `Portfolio Name` → `Portfolio Name 58321`, trimmed to `maxlength`, padded to `minlength` |
| Email / URL / tel | Syntactically valid values (`email58321@example.com`), never the label |
| Date / DateTime / Time / month / week (Kendo pickers and native inputs) | Valid date/time values inside any discovered min/max window |
| Kendo MaskedTextBox | A value that satisfies the widget's mask |
| Kendo Editor (the rich-text “HTML box”) | An HTML snippet built from the label — `<p>Portfolio Objective 58321</p>…`. Written to the visible editing surface (iframe body in classic mode, contenteditable div inline) **and** the hidden textarea the form posts. Honours a live character counter such as `0/2000`, which counts text rather than markup |
| Conditional / dependent fields | Fields revealed by another value are detected and filled in the same session |

### Required-field detection

`Required Fields Only` mode uses, in order:

1. the visible `*` marker belonging to **that field's own** label (marker element inside the
   label, `*` in the label text, or a `*` element next to the label),
2. `required`, `aria-required="true"`, `data-val-required` / `data-required-msg` (Kendo /
   MVC unobtrusive validation), `k-required` / `required` classes.

An asterisk in arbitrary page text (a footnote like `* all times are UTC`) never marks a
field required, and a field whose required status cannot be established confidently is
treated as **not required**.

### Always skipped

* **The application shell**, decided two ways so that naming conventions cannot defeat it:
  1. *Structurally* — when the page has an identifiable content region (`main`,
     `[role=main]`, `.page-content-wrapper`, `.page-content`, `#page-body-content`,
     `.main-content`, `.content-wrapper`, `#content`), **anything outside it is shell**,
     whatever it is called. Dialogs are exempt, because Kendo renders a Window or a modal at
     `<body>` level, outside every content wrapper — those forms are still filled.
  2. *By container* — nav bars, side menus, headers, footers, breadcrumbs, tab strips,
     dropdown menus and quick-settings panels (`nav`, `aside`, `header`, `footer`,
     `[role=navigation]`, `.navbar`, `.nav`, `.sidebar`, `.side-menu`, `.dropdown-menu`,
     `.k-menu`, `.k-toolbar`, `.k-drawer`, plus the admin-layout names
     `.page-header`, `.top-menu`, `.sidebar-container`, `.sidemenu-container`,
     `.left-sidemenu`, `.chat-sidebar-container`, `.quick-setting`, `.page-footer`, …).

  Shell controls are ignored entirely — not filled, and not even counted as detected. This
  matters beyond tidiness: a global-search DropDownTree would *navigate* the application if a
  record were selected in it, and a theme/settings side panel is full of real radios and
  checkboxes that would silently change the user's preferences. If a genuine form does live
  inside such a container, mark it `data-kf-fill` to opt back in.
* **Search / filter boxes** — `type="search"`, a placeholder or aria-label that is just
  “Search”/“Search…”/“Filter”, or a whole identifier like `txtSearch`, `globalSearch`,
  `gridFilter`, `searchTerm`. A genuine field merely *named* `FilterName` or
  `SearchCriteria` is still filled.
* Hidden, disabled and readonly fields; submit / reset / button / file inputs; password and
  sensitive fields (token, API key, secret, CVV, SSN, security answer, PIN…); widget chrome
  (dropdown popups, calendars, grid filter/column menus, pagers); cross-origin iframes.
  Same-origin iframes **are** filled.

### Nothing happens until you click

Opening the popup does not touch the page: no script is injected and nothing is read or
written. The extension acts only on **Autofill** (which fills) or **Scan** (which only
counts) — so landing on a page, or opening the popup to change a setting, can never change a
field. A running session also stops itself if the application navigates, so it can never
bleed into the next page you land on.

MultiSelect, AutoComplete, Upload, Editor, ColorPicker, Slider and grid inline editors are
reported as skipped with a reason — they are planned for a later release.

---

## Two ways a Kendo control is driven

Kendo Filler always prefers the widget API, and falls back to real DOM interaction — never
coordinate clicking, never hard-coded selectors.

| | Widget API reachable | API not reachable (jQuery/Kendo not on `window`) |
| --- | --- | --- |
| Dropdown | opens the widget (so remote/cascading lists load), then selects the first record by data-item value | clicks the widget open, waits for the popup, clicks the first valid `<li>`, verifies the display changed |
| Numeric / decimal | `widget.value()` + change | writes into the **visible** input (where a user types) *and* the hidden original |
| Switch | `widget.check()` | clicks the switch, then falls back to the checkbox |
| Date/time | `widget.value(Date)` | writes text in the format the control already displays (`07/11/2039` → `dd/MM/yyyy`) |

Why this matters: Kendo renders its widgets as a visible wrapper plus a **hidden original**
`<input>`/`<select>` (`display:none`). Anything that judges the original element on its own
layout concludes that every Kendo control on the page is hidden, and skips the whole form.
Visibility, disabled and readonly state are therefore evaluated against the element that
actually represents the field on screen (the widget's own wrapper), while a control inside a
genuinely hidden container — a closed tab, a collapsed panel — is still correctly skipped.

For the same reason, a Kendo DropDownList built on a `<select>` is **not** filled by setting
that select: the posted value would change while the widget still displayed
`- Select -`. The popup is opened and a record clicked instead, with the raw select used only
as a last resort (and reported as such in the diagnostics).

## Architecture

```
kendo-filler/
  manifest.json                      Manifest V3, permissions: activeTab, scripting, storage
  src/
    popup/     popup.html|css|js     Home view + Settings view, Autofill, diagnostics
               theme-boot.js         Stamps Light/Dark/Auto before the first paint
    options/   options.html|js       Advanced settings (max passes, time budget)
    background/service-worker.js     Lifecycle, on-demand injection, storage, messaging
    content/
      bridge.js                      ISOLATED world: relays chrome.runtime <-> page world
      utils.js                       Visibility, labels, logical ids, iframes, validation state
      required-detector.js           The '*' / metadata rules
      value-generator.js             All generated values (crypto-backed)
      kendo-adapter.js               Kendo widget APIs (dropdown incl. search box, tree,
                                     numeric, switch, date)
      native-adapter.js              Framework-safe native DOM fallback
      classifier.js                  Normalised field model + safety rules
      scanner.js                     Detection, widget de-duplication, radio grouping
      dependency-watcher.js          MutationObserver, bounded quiet-period waits
      filler.js                      The multi-pass fill session
      content.js                     MAIN world entry point / message listener
  demo/demo.html                     Test page covering every supported control
  test/                              Node + jsdom tests (see test/README.md)
  assets/                            Icons and popup logo
```

### Two JavaScript worlds (the important design point)

Kendo widget instances live in jQuery's data cache **inside the page's own JavaScript
realm**. A normal content script runs in an isolated world with a different `window` and can
never reach them — which is why so many autofill tools resort to faking clicks.

Kendo Filler therefore injects its engine with `world: "MAIN"`, so it can call
`widget.value()`, `widget.select()`, `widget.check()` directly, and uses a small
isolated-world `bridge.js` for `chrome.runtime` messaging, which the page world cannot do.
Injection happens on demand under `activeTab`, so the extension holds **no standing access
to any site** and needs no host permissions.

### Kendo integration points worth knowing

* `widget.value(x)` does **not** raise the change event, so nothing downstream reacts —
  the adapter raises it.
* Cascading DropDownLists listen to `cascade`, not `change`. Kendo raises both from its
  internal `_change()`, **but** it suppresses that by writing the new value into
  `widget._old` during a programmatic `value()` call. The adapter resets `_old` before
  calling `_change()` so Kendo treats the write as a genuine user change.
* `widget.select(index)` is popup-index based: with an `optionLabel` configured, index 0 is
  the placeholder — so records are selected by data-item value, with index selection only
  as a fallback.
* A **filterable** DropDownList keeps its search result in `dataSource.view()`, so after any
  search — including one a user left behind — `view()` can be empty while every record is
  still in `data()`. Reading only `view()` reported a dropdown that visibly had records as
  "Dropdown has no selectable options"; the adapter now falls back to `data()`.
* A `serverFiltering` list with `minLength` loads **nothing** on open — only what is typed.
  Opening it is not enough, so the adapter drives `widget.search()` (Kendo's own entry point
  for the search box) with an empty term first, then a few common letters, and picks from the
  result. Without the widget API it types into the popup's `.k-list-filter` / `.k-searchbox`
  input instead. That search box is still never treated as a form field.
* A Kendo widget can be built on `<input type="hidden">` (MVC `DropDownListFor`, cascading and
  searchable pickers). The widget is on screen, so the field is filled instead of being
  reported "Field is hidden" — `utils.isKendoOriginal()` requires visible Kendo chrome, so
  antiforgery tokens and row ids stay skipped.
* A remote-bound DropDownList has an empty dataSource until first opened; the adapter opens
  the widget (exactly what a user does), waits for `dataBound`, then closes it.
* Kendo hides the original input behind a wrapper, so visibility/disabled/readonly tests
  consult the wrapper — and a single widget exposes 2–3 elements, so the scanner keeps only
  the element that owns the widget instance.
* For React/Angular/Vue-hosted inputs the native adapter writes through the prototype's
  native `value` setter (and resets React's `_valueTracker`), then dispatches the full
  keyboard/input/change/blur sequence. Prototypes are taken from the element's own window so
  same-origin iframe fields work too.

### Fill algorithm (multi-pass)

1. Scan the page (and same-origin iframes) for supported controls.
2. Classify each one; determine required status and eligibility.
3. Fill in DOM order. After each driver change (dropdown, tree, radio, toggle, checkbox),
   wait for the UI to settle — including while a Kendo loading mask is visible.
4. Re-scan **only the containers that mutated**, not the whole document.
5. Repeat until nothing new appears, or the pass limit (default 10) or time budget
   (default 60 s) is reached.

A `Set` of logical field ids guarantees no field is processed twice, which is what keeps
mutually-triggering fields from looping. One field failing never stops the session: the
reason is recorded and the run continues.

### What makes it fast

The naive version of step 3 waits a fixed settle delay after every field. On a form with 60
controls that is where all the time goes, so the session is adaptive instead:

* after a driver field, the observer is **probed** for ~130 ms and a full quiet-period wait
  happens only if something actually changed — and only if it changed **outside that field**.
  This is what makes switches quick: toggling a Kendo Switch mutates its own markup (class
  flip, `aria-checked`, an animating handle), which a naive "did anything change?" test reads
  as "a dependency may be rendering", so every switch paid a full wait and an animating one
  could hold it open until the timeout. Recording *where* each mutation happened cuts the
  measured cost from **~430 ms to ~85 ms per switch** while a switch that genuinely reveals a
  field is still waited for;
* checkboxes and switches use a shorter probe than dropdowns/trees/radios, whose whole purpose
  is often to drive a cascade;
* the end-of-pass wait is long only when a driver was filled during that pass;
* dropdowns are opened only when their list is genuinely not loaded yet (`autoBind:false`,
  `serverFiltering`, cascade child, remote transport) — an already-populated list is selected
  from directly, with no popup flicker;
* the waits around a selection are polled, not fixed: the popup is tested before each 25 ms
  tick instead of after a flat 70 ms, the confirmation after a click polls for up to 320 ms
  and leaves as soon as the widget's face changes, and the post-selection validation check
  looks immediately and then once more 30 ms later instead of always waiting 80 ms. A
  searchable list also gets only ~700 ms to load on open before the adapter starts typing,
  rather than sitting out the full remote-read budget it was never going to use;
* visibility uses `Element.checkVisibility()` — one native call instead of walking every
  ancestor with `getComputedStyle`, which was the scanner's biggest cost;
* fields are re-classified before filling only if the DOM has mutated since the scan;
* the loading-spinner check inside wait loops is memoised, and re-scans stay scoped to the
  containers that changed.

Measured on the bundled test suites (which include deliberate 300 ms/250 ms simulated server
round trips): the 27-field form went from 5.5 s to ~2.5 s, and the Kendo-markup form from
1.9 s to ~1.4 s.

---

## Test page

`demo/demo.html` (open it directly — the popup deliberately has no page-opening action)
contains every supported
control type: required-marker variants (plus a footnote asterisk that must be ignored),
cascading dropdowns, an empty-datasource dropdown, a TreeView with a disabled first node,
checkbox/switch/radio variants (including a group with no Yes/No and one with a destructive
option), numeric min/max/step, 3-dp decimals, long labels with `maxlength`, email/url/date
pickers, a masked textbox, two levels of AJAX-revealed conditional fields, a late-injected
field, all the skip cases, a same-origin iframe form, and a Save button that raises a red
banner if a submit ever fires.

**To exercise the real Kendo widget APIs**, serve the folder over http instead of opening
the extension page (Chrome does not allow extensions to inject into `chrome-extension://`
pages, and the extension CSP blocks the Telerik CDN there):

```bash
cd kendo-filler
npx http-server . -p 8080      # or: python -m http.server 8080
# then open http://localhost:8080/demo/demo.html
```

Suggested checks: All Fields vs Required Only; Yes and No for radios/toggles; repeated
Autofill runs; a page with no Kendo controls; a Kendo dropdown with no records; and confirm
the red submit banner never appears by itself.

---

## If fields are still skipped

Click **Show diagnostics** after a run. The first block, *Why fields were not filled*, groups
every skip/failure by reason with counts — that single list identifies the cause immediately:

* `Field is hidden` in bulk → the controls sit in a container the page hides (an unopened tab
  or accordion section). Open it and run Autofill again.
* `navigation / sidebar control` or `search / filter control` → intentionally ignored; add
  `data-kf-fill` to the container if such a field really is part of the form.
* `Not a required field (Required Only mode)` → switch to All Fields.
* `Dropdown has no selectable options` → the list is empty (a cascade whose parent has no
  value yet is retried automatically for up to 3 passes; a genuinely empty list is reported).
* `Dropdown did not open (no popup list found)` → the widget did not respond to a click;
  please report the control's markup.
* `… is planned for a later release` → MultiSelect / AutoComplete / Upload / Editor / Slider.

## Notes

* Preferences persist in `chrome.storage.sync` (falling back to `local`).
* `Fill only empty fields` exists and is **off** by default, so Autofill overwrites existing
  values when you click it, as specified.
* Icons and the popup logo are generated from the product artwork in
  `assets/logo-source.png`. To change it, replace that file and run
  `.\assets\make-icons.ps1 -Source .\assets\logo-source.png`, then reload the extension.
* Planned next: fill-only-empty per field, saved profiles (PRIIPs / Portfolio / Client test
  data), JSON import/export of profiles, preview mode, undo, grid and inline-editor support,
  MultiSelect / AutoComplete / upload controls, and Kendo for Angular/React adapters (the
  adapter layer is already separated for this).
