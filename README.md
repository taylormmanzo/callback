# Callback

**Rehearse the call. Run it live. Earn the callback.**

Callback is a live meeting hub for customer-facing teams. Prepare before the call, rehearse against a mock buyer, get coaching on what happened, and turn the conversation into follow-through, all in one place.

> Synthetic demo. All customers, people and quotes are fictional. There are no calendar, CRM, transcript or messaging integrations, and nothing can be sent externally.

<!-- Add screenshots or a short GIF here: Prep, Dress Rehearsal and Callback are the most telling. -->

## Why

Call prep, practice, and follow-up usually live in different tools, or nowhere. Reps walk into calls under-prepared, practice only on real customers, and lose commitments afterward. Callback treats the whole call as one loop, using theater terms for each stage.

## The loop

| Stage | What it does | Status |
|---|---|---|
| **Green Room** (prep) | Matches the meeting to a customer, flags stale, conflicting or missing context, proposes an agenda and three open-ended discovery questions | Built |
| **Playbill** (customer context) | Paste an account brief (contract, usage, tickets, last call) and it is parsed into a structured summary. Stands in for future integrations | Built |
| **Dress Rehearsal** (practice) | Practice against a mock stakeholder whose mood (skeptical, rushed, friendly, ...) shapes the response. Each turn offers three branching replies, then feedback with branch coverage | Built |
| **Sound Check** (pre-call check) | Two-minute readiness check: customer and attendees confirmed, agenda ready, consent to record obtained | Built |
| **Showtime** (live call) | Call sheet (agenda, discovery questions, cast, key facts), a call timer, your notes, and one-click capture of learnings, commitments, concerns and next steps. Owners and dates are only filled in if you type them. No recording or transcription | Built (transcript and notes agent not built) |
| **Notes** (post-call coaching) | Post-call coaching from the transcript, with sentiment shown only when the transcript supports it | Built |
| **Callback** (follow-up) | Follow-through draft: commitments, owners, due dates, and suggestions to review before anything is sent | Built |

## Try it

- Open `index.html` in a browser, or serve the folder with any static server. There is no build step and no dependencies.
- Logic tests (headless, macOS): `./tests/run.sh`. In a browser: open `tests/index.html`.

## How it's built

- **Static and dependency-free.** Plain HTML, CSS and JavaScript. No network calls.
- **Logic is separate from the UI.** `logic.js` holds pure functions (matching, prep, questions, rehearsal, coaching, follow-through) that never mutate the data. `app.js` only renders.
- **Synthetic data with hard cases.** `data.js` has fictional customers, contacts and four meetings covering matched, ambiguous, unmatched, stale, conflicting, incomplete-transcript and prompt-injection scenarios.
- **Tested against acceptance criteria.** 32 logic tests in `tests/`, mapped to the criteria they verify.

## Design decisions

- **Commitment is not completion.** A follow-up item is only marked complete when there is a record of it. "Captured", "met" and "completed" are distinct states.
- **Uncertainty is stated, not hidden.** If the customer match is unconfirmed, evidence is withheld. If a transcript is unavailable or the speaker is uncertain, the app says it cannot verify instead of guessing.
- **Untrusted text stays untrusted.** Instruction-like text in a transcript or account brief is flagged and excluded, and never reaches a draft.
- **No invented details.** Rehearsal replies are grounded in the brief or explicitly generic, and drafts only use facts that were supplied.
- **Human in the loop.** Everything is a suggestion that can be edited. The logic has no ability to send anything.

## Roadmap

- Transcript source and notes agent for Showtime (needs a real, authorized connection first)
- A standalone customer record page (customers currently appear as a filter and association on each meeting)
- Real integrations (calendar, CRM, transcripts) replacing the pasted account brief

## Files

- `data.js`: synthetic customers, contacts and meetings
- `logic.js`: pure logic functions
- `app.js`, `styles.css`, `index.html`: UI
- `tests/`: logic tests and runners

## Status and known gaps

- The UI was not exercised in a browser during the build session, because static file previews do not run scripts and a local server was not permitted. `app.js` passes a syntax check only. Open `index.html` and walk the flows before relying on it.
- Showtime has no transcript or notes agent. Captures live in this browser only and are not added to the Callback draft automatically.
- All data is synthetic.
