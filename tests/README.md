# Daymark tests

The repository includes two small, dependency-free Node.js checks. They are not
loaded by any application page and do not require a build step.

| Check | Command | Needs a browser |
| --- | --- | --- |
| Static release audit | `node tests/static-audit.js` | No |
| Browser acceptance suite | `node tests/acceptance.js` | Yes, Chromium-based |

Run both from the project root. They also work from any directory because paths
are resolved relative to the project folder.

## Prerequisites

- **Node.js 22.4 or newer.** The browser suite uses the built-in global
  `fetch` and `WebSocket`; development and release validation used Node 24.14.1.
- **Microsoft Edge or Google Chrome.** The suite drives the browser over the
  Chrome DevTools Protocol (CDP), so Firefox and Safari are not supported by the
  runner. Microsoft Edge is auto-detected on Windows, macOS, and common Linux
  locations; Chrome is auto-detected on Windows, macOS, and common Linux
  locations.

No `npm install` is required. There are no third-party packages.

## Static audit

```text
node tests/static-audit.js
```

The audit is read-only and prints JSON:

```json
{
  "problems": [],
  "notes": ["..."]
}
```

It checks all four pages and both stylesheets for:

- A valid doctype, `lang`, charset, viewport meta, and title.
- Broken local `src`, `href`, and CSS `url()` references, including filename
  casing on case-insensitive filesystems.
- Duplicate IDs and `aria-labelledby`, `aria-describedby`, `aria-controls`, and
  `label[for]` references that point to missing IDs.
- Required script presence and dependency order on every page.
- Inline event handlers and external resource references.
- External URLs in HTML, CSS, and JavaScript, excluding the SVG namespace URLs.
- Network APIs (`fetch`, `XMLHttpRequest`, `WebSocket`, and similar) in the
  application JavaScript.
- Storage keys referenced by the application.

Exit code `0` means no problems were found; exit code `1` means at least one
entry was reported in `problems`.

## Browser acceptance suite

```text
node tests/acceptance.js
```

The suite launches a headless Chromium browser with an **isolated temporary
profile**, opens the app via a `file://` URL, and runs 77 checks:

| Group | Count | Covers |
| --- | --- | --- |
| Functional | 17 | Daily Focus selection, the three-task limit, intention save/cancel/clear, live progress, completion, removal, deleted-task cleanup, local-day rollover, corrupt-data recovery, failed writes, and retention. |
| Regression | 10 | Dashboard metrics, task toggles, deadlines, task CRUD, task schema/order and focus separation, export, theme persistence, clear-data behaviour, keyboard navigation and focus return, and mobile navigation and target sizes. |
| Accessibility | 1 | Reduced motion disables Daily Focus transitions. |
| Release | 1 | No external `http:` or `https:` network requests are made while visiting the pages. |
| Matrix | 48 | 4 pages × 4 viewports × 3 themes: horizontal overflow, required content visibility, and console errors. |

Viewports: mobile 390×844, tablet 768×1024, laptop 1024×900, and desktop
1440×1100. Themes: light, dark, and system.

The count is one higher than the earlier 76-check baseline because the release
group adds `N1`, which fails the run if any external network request is
observed. No existing check was removed or weakened.

The suite prints `PASS`/`FAIL` lines and a final summary, for example:

```text
SUMMARY {"functional":{"pass":17},"regression":{"pass":10},"accessibility":{"pass":1},"release":{"pass":1},"matrix":{"pass":48}}
```

Exit code `0` means every executed check passed; exit code `1` means at least
one check failed. A skipped check is omitted from the counts, so the totals will
be lower when using the skip options below.

### Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `DAYMARK_BROWSER` | auto-detect | Browser executable path or command, for example `C:\Program Files\Google\Chrome\Application\chrome.exe`. |
| `DAYMARK_CDP_PORT` | `9417` | DevTools port. Change it if another process is using the default. |
| `DAYMARK_SKIP` | none | Comma-separated test IDs to skip, for example `DAYMARK_SKIP=F16,R10`. |
| `DAYMARK_NO_MATRIX` | unset | Set to `1` to skip the 48-cell matrix and run only the 29 functional, regression, accessibility, and release checks. |

Examples (PowerShell):

```text
$env:DAYMARK_NO_MATRIX = "1"; node tests/acceptance.js
$env:DAYMARK_BROWSER = "C:\Program Files\Google\Chrome\Application\chrome.exe"; node tests/acceptance.js
```

### Artifacts

All artifacts are written to a temporary directory outside the repository:

- Windows: `%TEMP%\daymark-acceptance`
- macOS/Linux: `$TMPDIR/daymark-acceptance` (typically `/tmp/daymark-acceptance`)

Contents include `acceptance-results.json`, screenshot files named
`acceptance-*.png`, the isolated `browser-profile/`, and `downloads/` for the
export check. The suite removes and recreates the profile and downloads folder
at the start of each run. Do not copy these artifacts into the repository.

### What the checks do and do not prove

- The matrix verifies that each page renders, key content is visible, and there
  is no horizontal overflow at the four viewports. Screenshots are produced for
  manual inspection; there is no pixel-diff baseline.
- The suite records console errors and failed network loads in
  `acceptance-results.json`. Matrix cells fail when console errors occur during
  that cell; review the JSON for per-test console errors.
- The zero-request check observes requests made through the browser's network
  stack. It covers the application pages and their assets, not the test runner's
  local CDP connection.
- Only Chromium-based browsers are exercised. Firefox, Safari, and physical
  devices require separate manual testing.
