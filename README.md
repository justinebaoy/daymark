# Daymark

Daymark is a small, local-first productivity app built around one question: what
matters most today? It combines a task list, a three-priority Daily Focus, and a
weekly progress view in a calm, warm interface.

The application is plain HTML, CSS, and JavaScript. There is no build step, no
package manager, no framework, and no server-side component. Every asset is
bundled locally, so the application pages make no external network requests and
work offline.

## Pages

| Page | File | What it does |
| --- | --- | --- |
| Dashboard | `index.html` | Greeting and date, task summary cards, Daily Focus, today's tasks, upcoming deadlines, and a weekly completion chart. |
| My Tasks | `tasks.html` | Add, edit, complete, and delete tasks. Search by title and filter by status, priority, or category; sort by due date, priority, or creation date. |
| Weekly Overview | `overview.html` | Read-only statistics for the current week (Monday through Sunday): completed, remaining, completion rate, and a daily breakdown. |
| Settings | `settings.html` | Light, dark, or system appearance; export tasks as JSON; clear all saved tasks. |

## Technology

- Semantic HTML with native `<dialog>` elements, templates, and ARIA labels.
- CSS custom properties for light and dark themes and a responsive layout.
- Vanilla JavaScript modules exposed as small globals (`DaymarkStorage`,
  `DaymarkTaskStore`, `DaymarkFocusStore`, `DaymarkTheme`).
- `localStorage` for persistence. No cookies, analytics, accounts, or network
  APIs.
- No dependencies, bundler, transpiler, or generated output.

## Running Daymark

Open `index.html` directly in a browser. All links and assets are relative, so
the whole folder can be moved or copied freely. No install or build command is
required.

If you prefer to serve the folder over local HTTP, any static file server works.
For example, with Python 3, from the project folder:

```text
python -m http.server 8000
```

Then open `http://localhost:8000/`.

Serving over HTTP is optional. Keep in mind that `localStorage` is scoped to an
origin: data saved while using `file://` will not appear at
`http://localhost:8000`, and vice versa. Pick one way of opening the app and use
it consistently if you want your existing tasks to remain visible.

## Browser compatibility

Tested:

- Microsoft Edge 156 (headless) on Windows, using the automated acceptance suite
  in `tests/`. This is the only browser and environment exercised for this
  release.

Expected to work but **not tested**:

- Current versions of Google Chrome, Firefox, and Safari on desktop, and mobile
  Safari and Chrome on recent iOS and Android versions.

The app uses widely supported platform features (CSS custom properties,
`<dialog>`, `localStorage`, `Intl.DateTimeFormat`, `matchMedia`, and
`crypto.randomUUID` with a fallback). No browser-specific branches are intended,
but no compatibility claim beyond the tested Edge configuration is verified.
The bundled automated suite only drives Chromium-based browsers.

## Data and persistence

Tasks, focus plans, and theme preference are stored separately in the current
browser's `localStorage`. Data is scoped to the browser and origin and does not
sync between browsers, profiles, or devices.

| Key | Contents |
| --- | --- |
| `daymark.tasks.v1` | JSON array of task records: `id`, `title`, `description`, `dueDate`, `priority`, `category`, `completed`, `createdAt`, `completedAt`. |
| `daymark.focus.v1` | JSON object containing `version` and a `plans` map keyed by local date (`YYYY-MM-DD`). Each plan holds up to three `taskIds` and an optional `intention`. |
| `daymark.theme.v1` | Appearance preference: `light`, `dark`, or `system`. |

On a first visit with no saved task data, Daymark seeds six sample tasks so the
dashboard has something to show. They are ordinary tasks and can be edited or
deleted. Deleting every task does not re-seed them on reload.

If stored task or focus data cannot be parsed, Daymark preserves the original
value under `daymark.tasks.v1.unreadable` or `daymark.focus.v1.unreadable`
before replacing it. These backup keys are only created when unreadable data is
encountered.

### Daily Focus

Daily Focus is a plan for the current local calendar day. It stores references
to existing tasks; it does not copy task data or add focus fields to tasks.

- Choose up to **three task IDs** per day. Incomplete tasks are listed before
  completed ones.
- An optional intention can be up to **160 characters**.
- Checking a priority updates the underlying task and the live progress bar.
- Removing a priority from the plan leaves the task itself untouched.
- A task deleted from My Tasks is hidden and cleaned from the plan safely.
- The plan resets on the next local day; it does not carry over.
- Saving keeps today plus the **30 prior calendar days** (31 date entries) and
  leaves future-dated plans alone.

### Theme

The appearance setting is applied before stylesheets load to avoid a flash of
the wrong theme. `system` follows `prefers-color-scheme` and updates when the
operating system theme changes. The preference is saved in
`daymark.theme.v1`; it is not tied to task data.

## Exporting tasks

1. Open **Settings**.
2. In **Your data**, select **Export JSON**.
3. The browser downloads `daymark-tasks-YYYY-MM-DD.json`.

The file is a pretty-printed JSON array of the current task records. Daily Focus
plans and theme preferences are not included. Export is disabled when storage
is unavailable, and an explanatory status message appears when there are no
tasks to export.

## Clearing data

**Settings → Your data → Clear all tasks** opens a confirmation dialog and then
permanently deletes every saved task from this browser. **This cannot be
undone.** Export a copy first if the data matters.

The clear action removes task data only. Theme preference and Daily Focus plans
are stored under separate keys and are not removed by that button; a focus plan
simply stops showing tasks that no longer exist. Clearing the browser's site
data or storage removes all three keys.

## Backing up and restoring

There are two separate things to back up:

- **Project source:** copy the entire project folder, or keep it in a Git
  repository. Restore by copying the files back or checking out the desired
  commit. Keep backups outside the working folder so they are not served or
  committed accidentally.
- **Task data:** use **Settings → Export JSON**. The export is a snapshot for
  safekeeping or use in another tool. Daymark has no in-app import feature, so
  an exported file cannot be loaded back through the interface. Backing up the
  project folder does **not** back up `localStorage`; that data lives in the
  browser profile, not in the project.

Avoid committing exported JSON files, browser profiles, or test artifacts.
The repository's `.gitignore` excludes generated exports and common temporary
artifacts, but the safest rule is to keep them outside the project.

## Known limitations

- **No hosted deployment has been verified.** The app has been exercised from
  the local filesystem only; behaviour behind a specific host, subpath, or
  cache configuration is untested.
- **Accessibility testing is incomplete.** The automated suite includes a
  reduced-motion check, but there has been no screen-reader testing and no
  testing on physical mobile or tablet devices. Keyboard flows were exercised
  during development but are not comprehensively covered by the retained suite.
- **Typography varies by operating system.** Daymark uses a system-font stack
  rather than a bundled web font. Windows renders Segoe UI, macOS renders San
  Francisco, and Android renders Roboto, so letter shapes and line breaks can
  differ slightly. Layout was visually checked on Windows with Edge only.
- **No cross-device sync.** Data is local to one browser profile and origin.
  Private browsing, clearing site data, or browser storage limits can remove it.
- **Export only.** There is no import or restore UI for exported JSON.
- **Automated browser coverage is Chromium-only.** Firefox and Safari are
  expected to work but are not covered by the bundled tests.

## Validation

Prerequisites: Node.js 22.4 or newer, and Microsoft Edge or Google Chrome
installed for the browser suite. No `npm install` is needed.

From the project folder:

```text
node tests/static-audit.js
node tests/acceptance.js
```

The static audit checks local references, document structure, IDs, ARIA targets,
script order, storage keys, and external URLs without launching a browser.

The acceptance suite runs **77 checks**: 17 Daily Focus functional tests, 10
regression tests, 1 reduced-motion accessibility check, 1 zero-external-request
release check, and a 48-cell page/viewport/theme matrix. It writes screenshots
and `acceptance-results.json` to the operating system temp directory, not into
the project.

See `tests/README.md` for prerequisites, environment variables, artifacts, and
how to interpret failures.

Deployment pipeline verified through Github and Netlify.
