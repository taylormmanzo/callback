# Customer Meeting Workspace (synthetic demo)

Static, dependency-free app. No build step, no network calls, no integrations.

- Run: open `index.html` in a browser (or serve the folder with any static server).
- Logic tests (headless, macOS): `./tests/run.sh`. In a browser: open `tests/index.html`.

## Files
- `data.js`: synthetic customers, contacts and 4 meetings, covering matched, ambiguous, unmatched, stale, conflicting, incomplete-transcript and prompt-injection cases.
- `logic.js`: pure functions (matching, prep, questions, rehearsal, coaching, follow-through). Never mutates data.
- `app.js`, `styles.css`, `index.html`: UI.
- `tests/`: 23 logic tests mapped to the acceptance criteria.

## Not verified
- The UI was not exercised in a browser in the build session (static file previews do not run scripts and a local server was not permitted). `app.js` passes a syntax check only. Open `index.html` and walk the flows before relying on it.
- No separate customer record page exists; customers appear as a filter and association on each meeting.
