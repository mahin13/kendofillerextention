# Tests

Node-based tests that load the real content-script modules into a jsdom document and run
actual fill sessions. No Chrome required.

```bash
cd kendo-filler
npm install jsdom          # once (value-generator.test.cjs needs nothing)
node test/value-generator.test.cjs   # spec §11–§13 value rules
node test/engine.test.cjs            # native controls, required detection, safety rules,
                                     # dependent/AJAX fields, Required-Only mode
node test/kendo-markup.test.cjs      # Kendo markup with NO reachable widget API:
                                     # hidden originals, click-to-open dropdowns,
                                     # NumericTextBox precision, Switch, DatePicker format
node test/shell-exclusion.test.cjs   # the real RiskMonitor shell: navbar, universal-search
                                     # DropDownTree, left menu, right theme panel, footer,
                                     # widget popups vs a Kendo Window form
node test/editor-and-toggle.test.cjs # Kendo Editor ("HTML box") in inline and iframe mode,
                                     # character-counter limits, and the switch timing fix
node test/popup-ui.test.cjs        # the popup shell: Settings view, Light/Dark/Auto theme,
                                     # the home summary, reset — loaded against a stubbed
                                     # chrome API so a dead handler cannot slip through
node test/searchable-dropdown.test.cjs
                                     # dropdowns with a search box: a stale filter hiding
                                     # loaded records, a list that only loads what is typed
                                     # (widget API and markup-only), and a Kendo widget
                                     # built on <input type="hidden">
```

Note: jsdom has no layout engine, so the harnesses stub `getBoundingClientRect`. Visibility
through `display:none` (the case that matters for Kendo's hidden originals) is still
exercised for real via `getComputedStyle`.

The real Kendo widget APIs need a browser — use `demo/demo.html` served over http for that.
