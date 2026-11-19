(function () {
  'use strict';
  const D = window.MW_DATA, L = window.MW_LOGIC;

  /* All per-meeting user state lives here. The dataset is never mutated. */
  const state = {
    search: '', phase: 'all', customer: 'all',
    conf: {},        // meetingId -> { customer, participants, history }
    agenda: {},      // meetingId -> string
    rehearsal: {},   // meetingId -> { roleId, active, log, feedback }
    draft: {}        // meetingId -> editable follow-through draft
  };

  /* ---------- tiny DOM helper (text only; never innerHTML) ---------- */
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }
  const badge = (text, kind) => h('span', { class: 'badge ' + (kind || '') }, text);
  const fmt = (iso) => new Date(iso).toLocaleString('en-US', { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'short' }) + ' UTC';
  const meetingById = (id) => D.meetings.find((m) => m.id === id);
  const confOf = (id) => (state.conf[id] = state.conf[id] || { participants: {}, history: [] });
  const STATUS_KIND = { matched: 'ok', confirmed: 'ok', internal: 'plain', suggested: 'warn', ambiguous: 'bad', unmatched: 'bad', user_unmatched: 'warn' };
  const STATUS_TEXT = { matched: 'Matched by evidence', confirmed: 'Confirmed by you', internal: 'Internal', suggested: 'Suggested, needs confirmation', ambiguous: 'Ambiguous, needs confirmation', unmatched: 'Unmatched', user_unmatched: 'You marked: no match' };

  /* ---------- routing ---------- */
  function route() {
    const m = location.hash.match(/^#\/m\/([\w-]+)(?:\/(\w+))?/);
    return m ? { id: m[1], section: m[2] || 'prep' } : { id: null, section: 'prep' };
  }
  const go = (id, section) => { location.hash = `#/m/${id}/${section}`; };

  /* ---------- shell ---------- */
  const app = document.getElementById('app');
  const listResults = h('div', { id: 'results', 'aria-live': 'polite' });
  const workPane = h('section', { id: 'workspace', 'aria-label': 'Meeting workspace' });

  function buildShell() {
    const search = h('input', { type: 'search', placeholder: 'Search meetings or people', 'aria-label': 'Search meetings', oninput: (e) => { state.search = e.target.value; renderList(); } });
    const phase = h('select', { 'aria-label': 'Filter by time', onchange: (e) => { state.phase = e.target.value; renderList(); } },
      [['all', 'All meetings'], ['upcoming', 'Upcoming'], ['recent', 'Recent']].map(([v, t]) => h('option', { value: v }, t)));
    const cust = h('select', { 'aria-label': 'Filter by customer', onchange: (e) => { state.customer = e.target.value; renderList(); } },
      [h('option', { value: 'all' }, 'All customers'), ...Object.values(D.customers).map((c) => h('option', { value: c.id }, c.name))]);
    app.append(h('aside', {}, h('h2', {}, 'Meetings'), h('div', { class: 'list-controls' }, search, h('div', { class: 'row' }, phase, cust)), listResults), workPane);
  }

  function matchesFilters(m) {
    if (state.phase !== 'all' && m.phase !== state.phase) return false;
    const cv = L.customerView(m, state.conf[m.id]);
    if (state.customer !== 'all' && !(cv.customerId === state.customer || (!cv.customerId && m.customer.candidates.includes(state.customer)))) return false;
    const q = state.search.trim().toLowerCase();
    if (!q) return true;
    return (m.title + ' ' + m.participants.map((p) => p.name).join(' ')).toLowerCase().includes(q);
  }

  function renderList() {
    const sel = route().id;
    const items = D.meetings.filter(matchesFilters).sort((a, b) => new Date(a.start) - new Date(b.start));
    listResults.replaceChildren(...(items.length ? items.map((m) => {
      const cv = L.customerView(m, state.conf[m.id]);
      return h('button', { class: 'meeting-item ' + (m.phase === 'upcoming' ? 'up' : 'past') + (m.id === sel ? ' sel' : ''), onclick: () => go(m.id, route().id === m.id ? route().section : 'prep'), 'aria-current': m.id === sel ? 'true' : null },
        h('div', {}, h('strong', {}, m.title)),
        h('div', { class: 'when' }, fmt(m.start)),
        h('div', { class: 'row' }, badge(m.phase === 'upcoming' ? 'Upcoming' : 'Recent', 'plain'), badge(STATUS_TEXT[cv.status], STATUS_KIND[cv.status])));
    }) : [h('p', { class: 'muted' }, 'No meetings match these filters.')]));
  }

  /* ---------- workspace ---------- */
  const TAB_KEYS = ['prep', 'rehearsal', 'coaching', 'follow'];
  function renderWork() {
    const { id, section } = route();
    renderList();
    const m = id && meetingById(id);
    if (!m) { workPane.replaceChildren(h('div', { class: 'card empty' }, h('div', { class: 'big' }, '🗓️'), h('h2', {}, 'Pick a meeting to get started'), h('p', {}, 'Open any synthetic meeting on the left to prepare, rehearse, review and follow up.'))); return; }
    const sections = { prep: renderPrep, rehearsal: renderRehearsal, coaching: renderCoaching, follow: renderFollow };
    const sec = sections[section] ? section : 'prep';
    const tabs = h('div', { class: 'tabs', role: 'tablist' }, [['prep', 'Prep'], ['rehearsal', 'Rehearsal'], ['coaching', 'Coaching'], ['follow', 'Follow-through']].map(([k, t]) =>
      h('button', { class: 'tab', role: 'tab', 'aria-selected': k === sec ? 'true' : 'false', onclick: () => go(m.id, k) }, t, h('kbd', {}, TAB_KEYS.indexOf(k) + 1))));
    workPane.replaceChildren(renderHeader(m), tabs, sections[sec](m));
  }

  function renderHeader(m) {
    const conf = confOf(m.id);
    const cv = L.customerView(m, conf);
    const cname = cv.customerId ? D.customers[cv.customerId].name : null;
    const custSel = h('select', { id: 'cust-sel', 'aria-label': 'Customer association' },
      [...m.customer.candidates.map((c) => h('option', { value: c, selected: c === cv.customerId }, D.customers[c].name)),
        h('option', { value: '', selected: !cv.customerId && cv.byUser }, 'None of these / not a customer match')]);
    if (!cv.customerId && !cv.byUser) custSel.prepend(h('option', { value: '__none', selected: true, disabled: true }, 'Choose…'));
    const confirmCust = h('button', { class: 'secondary', onclick: () => {
      if (custSel.value === '__none') return;
      conf.customer = { id: custSel.value || null };
      conf.history.push(`${new Date().toISOString()}: you set customer to ${custSel.value ? D.customers[custSel.value].name : 'no match'}`);
      renderWork();
    } }, cv.byUser ? 'Change' : 'Confirm');

    const rows = m.participants.map((p) => {
      const v = L.participantView(p, conf);
      const contact = v.contactId ? D.contacts[v.contactId] : null;
      let control = null;
      if (!p.internal) {
        const sel = h('select', { 'aria-label': `Contact match for ${p.name}` },
          [!v.contactId && !v.byUser ? h('option', { value: '__none', selected: true, disabled: true }, 'Choose…') : null,
            ...p.match.candidates.map((c) => h('option', { value: c, selected: c === v.contactId }, `${D.contacts[c].name} · ${D.contacts[c].role} · ${D.customers[D.contacts[c].customerId].name}`)),
            h('option', { value: '', selected: !v.contactId && v.byUser }, 'No matching contact')]);
        control = h('div', { class: 'row' }, sel, h('button', { class: 'secondary', onclick: () => {
          if (sel.value === '__none') return;
          conf.participants[p.id] = { contactId: sel.value || null };
          conf.history.push(`${new Date().toISOString()}: you set ${p.name} to ${sel.value ? D.contacts[sel.value].role : 'no contact'}`);
          renderWork();
        } }, v.byUser ? 'Change' : 'Confirm'));
      }
      return h('tr', {}, h('td', {}, p.name), h('td', {}, contact ? contact.role : (p.internal ? p.role : 'Unknown')),
        h('td', {}, badge(STATUS_TEXT[v.status], STATUS_KIND[v.status]), h('div', { class: 'muted' }, v.evidence)), h('td', {}, control));
    });

    const t = m.transcript.status;
    const stat = (k, v, kind) => h('div', { class: 'stat ' + kind }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v));
    const unsure = m.participants.filter((p) => !L.reliable(L.participantView(p, conf).status)).length;
    const hero = h('div', { class: 'hero' },
      h('div', { class: 'row' }, badge('Synthetic data', 'sim'), badge(m.phase === 'upcoming' ? 'Upcoming' : 'Recent', 'plain')),
      h('h1', { style: 'margin-top:8px' }, m.title),
      h('div', { class: 'muted' }, `${fmt(m.start)} – ${new Date(m.end).toLocaleTimeString('en-US', { timeZone: 'UTC', timeStyle: 'short' })} UTC · Source: ${m.source.label}, retrieved ${fmt(m.source.retrievedAt)}`),
      h('div', { class: 'strip' },
        stat('Customer', cname || 'Not matched', STATUS_KIND[cv.status] === 'plain' ? 'plain' : STATUS_KIND[cv.status]),
        stat('Participants', unsure ? `${unsure} need confirmation` : 'All matched', unsure ? 'warn' : 'ok'),
        stat('Transcript', t, t === 'available' ? 'ok' : t === 'unavailable' ? 'plain' : 'warn'),
        stat('Evidence', `${m.evidence.length} item(s)`, m.evidence.length ? 'ok' : 'warn')));
    return h('div', {}, hero, h('details', { class: 'details-card', open: !L.reliable(cv.status) || unsure ? true : null }, h('summary', {}, 'Customer and participant matching'), h('div', { class: 'stack', style: 'padding-bottom:14px' },
      h('h3', {}, 'Customer association'),
      h('div', { class: 'row' }, h('strong', {}, cname || 'Not matched'), badge(STATUS_TEXT[cv.status], STATUS_KIND[cv.status])),
      h('div', { class: 'muted' }, cv.evidence),
      h('div', { class: 'row', style: 'margin:6px 0 10px' }, custSel, confirmCust),
      conf.history.length ? h('details', {}, h('summary', {}, 'Confirmation history'), h('ul', { class: 'plain muted' }, conf.history.map((x) => h('li', {}, x)))) : null,
      h('h3', {}, 'Participants'),
      h('table', {}, h('thead', {}, h('tr', {}, ['Name', 'Role', 'Match status', 'Confirm or correct'].map((x) => h('th', {}, x)))), h('tbody', {}, rows)),
      h('p', { class: 'muted' }, 'Confirming only records your choice in this demo. No source calendar record is changed.'))));
  }

  /* ---------- Prep ---------- */
  const KIND_LABEL = { customer_statement: ['Customer said', 'ok'], internal_note: ['Internal note', 'plain'], record: ['Record', 'plain'] };

  function renderPrep(m) {
    const conf = state.conf[m.id];
    const b = L.buildPrepBrief(m, conf);
    if (state.agenda[m.id] == null) state.agenda[m.id] = b.agenda.join('\n');
    const ICON = { customer_statement: '💬', internal_note: '📝', record: '📄' };
    const KCLS = { customer_statement: ' cust', internal_note: ' note', record: ' rec' };
    const evItem = (e) => h('div', { class: 'ev' + KCLS[e.kind] + (e.stale ? ' stale' : '') + (e.conflict ? ' conflict' : '') },
      h('div', { class: 'row' }, h('span', { class: 'ico', 'aria-hidden': 'true' }, ICON[e.kind]), badge(...KIND_LABEL[e.kind]), e.open ? badge('Open item', 'warn') : null, e.stale ? badge('Stale (' + L.STALE_DAYS + '+ days)', 'warn') : null, e.conflict ? badge(`Conflicts with ${e.conflictsWith}`, 'bad') : null, h('span', { class: 'muted' }, `${e.id}`)),
      h('div', {}, e.text),
      h('div', { class: 'muted' }, `${e.source} · ${e.date}`),
      h('details', {}, h('summary', {}, 'Inspect source'), h('div', { class: 'quote' }, e.excerpt)));
    const statements = b.items.filter((e) => e.kind === 'customer_statement');
    const internal = b.items.filter((e) => e.kind !== 'customer_statement');

    const attention = h('div', { class: 'attention' + (b.missing.length ? '' : ' clear') },
      h('h2', {}, b.missing.length ? `⚠️ Needs your attention (${b.missing.length})` : '✅ Nothing flagged'),
      h('ul', {}, b.missing.map((x) => h('li', {}, x))));
    return h('div', { class: 'two-col' },
      h('div', { class: 'stack' },
        h('div', { class: 'card' }, h('h2', {}, 'Evidence'), h('p', { class: 'muted' }, b.coverage),
          h('h3', {}, 'What the customer said'), statements.length ? statements.map(evItem) : h('p', { class: 'muted' }, 'Unavailable: no customer statements on record.'),
          h('h3', {}, 'Internal notes and records'), internal.length ? internal.map(evItem) : h('p', { class: 'muted' }, 'Unavailable: no internal notes or records.'))),
      h('div', { class: 'stack' },
        attention,
        h('div', { class: 'card' }, h('h2', {}, 'Discovery'), badge('Generated suggestion', 'plain'),
          h('ol', { class: 'questions' }, b.questions.questions.map((q) => h('li', {}, q))),
          b.questions.limitation ? h('p', { class: 'muted' }, b.questions.limitation) : null),
        h('div', { class: 'card' }, h('h2', {}, 'Suggested agenda'), badge('Suggestion, editable', 'plain'),
          h('textarea', { 'aria-label': 'Suggested agenda, one item per line', rows: 6, oninput: (e) => { state.agenda[m.id] = e.target.value; } }, state.agenda[m.id])),
        h('div', { class: 'card' }, h('h2', {}, 'Interpretation'), h('p', { class: 'muted' }, 'Generated inferences. These are not facts.'),
          b.interpretations.length ? b.interpretations.map((i) => h('div', { class: 'ev interp' }, badge('Inference', 'sim'), h('div', {}, i.text), h('div', { class: 'muted' }, 'Based on: ' + i.basis.join(', ')))) : h('p', { class: 'muted' }, 'No interpretation offered: not enough evidence.'))));
  }

  /* ---------- Rehearsal ---------- */
  function renderRehearsal(m) {
    const r = (state.rehearsal[m.id] = state.rehearsal[m.id] || { roleId: null, active: false, log: [], feedback: null });
    const externals = m.participants.filter((p) => !p.internal);
    const wrap = h('div', { class: 'card stack' }, h('h2', {}, 'Rehearsal'),
      h('div', { class: 'sim-banner' }, 'SIMULATION. Replies are scripted from meeting context, not the real person. Nothing here is saved as a customer fact.'),
      h('p', { class: 'muted' }, 'Text only. Voice interaction is not available in this demo.'));
    if (!r.active) {
      const roleSel = h('select', { 'aria-label': 'Participant role to simulate' }, [h('option', { value: '' }, 'General attendee (no specific person)'), ...externals.map((p) => h('option', { value: p.id, selected: p.id === r.roleId }, p.name))]);
      wrap.append(h('div', { class: 'row' }, roleSel, h('button', { onclick: () => { r.roleId = roleSel.value || null; r.active = true; r.log = []; r.feedback = null; renderWork(); } }, 'Begin Role Play')));
      if (r.feedback) wrap.append(renderFeedback(r.feedback));
      return wrap;
    }
    const role = r.roleId ? L.participantName(m, r.roleId) : 'General attendee';
    const input = h('textarea', { 'aria-label': 'Your message', rows: 2, placeholder: 'Type what you would say…' });
    const send = () => {
      const text = input.value.trim(); if (!text) return;
      const turn = r.log.filter((x) => x.from === 'sim').length;
      r.log.push({ from: 'user', text });
      r.log.push({ from: 'sim', ...L.rolePlayReply(m, r.roleId, text, turn) });
      renderWork();
    };
    wrap.append(h('div', {}, 'Simulating: ', badge(role, 'sim')),
      h('div', { class: 'chat', 'aria-live': 'polite' }, r.log.length ? r.log.map((x) => h('div', { class: 'msg ' + x.from },
        h('div', { class: 'avatar', 'aria-hidden': 'true' }, x.from === 'user' ? 'You' : 'SIM'),
        h('div', { class: 'bubble ' + x.from },
          h('div', { class: 'muted' }, x.from === 'user' ? 'You' : `Simulated ${role}`),
          x.text,
          x.from === 'sim' ? h('div', { class: 'muted' }, x.generic ? 'Generic scripted reply, no supporting evidence.' : 'Grounded in evidence: ' + x.basis.join(', ')) : null))) : h('div', { class: 'muted' }, 'Say hello and set the agenda to start the simulation.')),
      input, h('div', { class: 'row' }, h('button', { onclick: send }, 'Send'),
        h('button', { class: 'secondary', onclick: () => { r.feedback = L.rolePlayFeedback(r.log.filter((x) => x.from === 'user').map((x) => x.text)); r.active = false; renderWork(); } }, 'End rehearsal and get feedback')));
    return wrap;
  }

  function renderFeedback(f) {
    return h('div', { class: 'stack' }, h('h3', {}, 'Feedback on your rehearsal'),
      f.strengths.length ? h('div', {}, h('strong', {}, 'What worked'), h('ul', { class: 'plain' }, f.strengths.map((s) => h('li', {}, s)))) : null,
      h('div', {}, h('strong', {}, 'To improve'), h('ul', { class: 'plain' }, f.improvements.map((s) => h('li', {}, s)))),
      h('p', { class: 'muted' }, 'This feedback assesses only your simulated practice.'));
  }

  /* ---------- Coaching ---------- */
  const YN = { yes: ['Yes', 'ok'], no: ['No', 'bad'], unknown: ['Cannot verify', 'warn'] };
  function renderCoaching(m) {
    const a = L.assessOutcomes(m);
    const t = m.transcript;
    const step = (label, v) => h('div', { class: 'step ' + v }, h('span', { class: 'dot', 'aria-hidden': 'true' }, v === 'yes' ? '✓' : v === 'no' ? '–' : '?'), h('span', { class: 'lbl' }, label), h('span', { class: 'val' }, YN[v][0]));
    return h('div', { class: 'stack' },
      h('div', { class: 'card' }, h('h2', {}, 'Source status'),
        h('div', { class: 'row' }, badge(`${t.label}: ${a.status}`, a.status === 'available' ? 'ok' : a.status === 'unavailable' ? 'plain' : 'warn'), badge('Synthetic', 'sim')),
        h('p', { class: 'muted' }, t.note),
        a.limitations.length ? h('ul', { class: 'plain' }, a.limitations.map((x) => h('li', {}, x))) : null,
        h('p', { class: 'muted' }, 'Captured = discussed in the conversation. Met = substantively achieved, per evidence. Completed = the work was actually finished, not just promised.')),
      h('div', { class: 'card' }, h('h2', {}, 'Intended outcomes'),
        a.assessments.length ? a.assessments.map((x) => h('div', { class: 'ev' },
          h('strong', {}, x.outcome.text), h('div', { class: 'muted' }, 'Outcome source: ' + x.outcome.source),
          h('div', { class: 'track', role: 'group', 'aria-label': 'Captured, met, completed' }, step('Captured', x.captured), step('Met', x.met), step('Completed', x.completed)),
          x.evidence.map((e) => h('div', { class: 'quote' }, `${e.kind} · ${L.speakerName(m, e.line)} at ${e.line.t}${e.line.conf === 'low' ? ' (speaker uncertain)' : ''}: "${e.line.text}"`)),
          x.completion ? h('div', { class: 'muted' }, `Completion record: ${x.completion.source} (${x.completion.date})`) : null,
          x.notes.map((n) => h('div', { class: 'muted' }, n)))) : h('p', { class: 'muted' }, 'No intended outcomes were recorded for this meeting.')),
      h('div', { class: 'card' }, h('h2', {}, 'Suggestions to improve'),
        a.suggestions.map((s) => h('div', { class: 'ev sugg' }, badge(s.evidenceBased ? 'From transcript' : 'General', 'plain'), h('div', {}, s.text)))),
      a.flagged.length ? h('div', { class: 'card' }, h('h2', {}, 'Ignored instruction-like content'),
        h('p', { class: 'muted' }, 'Transcripts are untrusted. These lines were shown as text only and no action was taken.'),
        a.flagged.map((l) => h('div', { class: 'quote' }, `${l.t}: "${l.text}"`))) : null,
      t.lines.length ? h('details', { class: 'card' }, h('summary', {}, 'View synthetic transcript'),
        t.lines.map((l) => h('p', {}, h('span', { class: 'muted' }, `${l.t} · ${L.speakerName(m, l)}${l.conf === 'low' ? ' (uncertain)' : ''}: `), l.text))) : null);
  }

  /* ---------- Follow-through ---------- */
  function getDraft(m) {
    if (!state.draft[m.id]) {
      const d = L.buildFollowThrough(m);
      state.draft[m.id] = { gen: d, learnings: d.learnings.map((x) => ({ ...x })), sentiment: d.sentiment ? { ...d.sentiment } : null, nextSteps: d.nextSteps.map((x) => ({ ...x, owner: x.owner || '', due: x.due || '' })), status: 'draft', snapshot: null };
    }
    return state.draft[m.id];
  }

  function renderFollow(m) {
    const d = getDraft(m), lim = L.LIMITS, locked = d.status !== 'draft';
    const field = (obj, key, label, tag) => h(tag || 'input', { 'aria-label': label, value: obj[key], disabled: locked, oninput: (e) => { obj[key] = e.target.value; } });
    const rm = (arr, i) => h('button', { class: 'secondary', disabled: locked, onclick: () => { arr.splice(i, 1); renderWork(); } }, 'Remove');
    const card = h('div', { class: 'card stack' }, h('h2', {}, 'Follow-through draft'),
      h('div', { class: 'row' }, badge(d.status === 'draft' ? 'Draft: not approved' : d.status === 'confirming' ? 'Awaiting your approval' : 'Approved: local preview only', d.status === 'approved' ? 'ok' : 'warn'), badge('Destination: local preview (nothing is sent)', 'plain')),
      d.gen.notes.map((n) => h('p', { class: 'muted' }, n)));

    if (!d.gen.available) return card;
    card.append(
      h('h3', {}, `New information learned (up to ${lim.learnings})`),
      d.learnings.map((x, i) => h('div', { class: 'row' }, h('div', { style: 'flex:1' }, field(x, 'text', 'Learning ' + (i + 1)), h('div', { class: 'muted' }, 'Source: ' + x.source + (x.needsReview ? ' · needs review' : ''))), rm(d.learnings, i))),
      h('h3', {}, 'Customer sentiment (1, only if supported)'),
      d.sentiment ? h('div', { class: 'row' }, h('div', { style: 'flex:1' }, field(d.sentiment, 'text', 'Sentiment'), h('div', { class: 'muted' }, 'Source: ' + d.sentiment.source)), rm({ splice: () => { d.sentiment = null; } }, 0)) : h('p', { class: 'muted' }, 'None. No evidence supports a sentiment statement.'),
      h('h3', {}, `Next steps (up to ${lim.nextSteps})`),
      d.nextSteps.map((x, i) => h('div', { class: 'stack' }, h('div', { class: 'row' }, h('div', { style: 'flex:1' }, field(x, 'text', 'Next step ' + (i + 1))), rm(d.nextSteps, i)),
        h('div', { class: 'row' }, h('label', { class: 'muted' }, 'Owner ', field(x, 'owner', 'Owner for step ' + (i + 1))), h('label', { class: 'muted' }, 'Due ', field(x, 'due', 'Due for step ' + (i + 1))),
          x.needsReview || !x.owner || !x.due ? badge('Unclear: review owner and date', 'warn') : null), h('div', { class: 'muted' }, 'Source: ' + x.source))),
      h('button', { class: 'secondary', disabled: locked || d.nextSteps.length >= lim.nextSteps, onclick: () => { d.nextSteps.push({ text: '', owner: '', due: '', source: 'Added by you', needsReview: true }); renderWork(); } }, 'Add next step'));

    const empty = !d.learnings.length && !d.sentiment && !d.nextSteps.length;
    const actions = h('div', { class: 'row' });
    if (d.status === 'draft') actions.append(h('button', { disabled: empty, onclick: () => { d.status = 'confirming'; renderWork(); } }, 'Review and approve…'));
    if (d.status === 'confirming') {
      card.append(h('div', { class: 'card' }, h('strong', {}, 'Approve this exact action?'), h('p', {}, 'Create a local preview of the draft below. No message is posted anywhere.'), renderDraftText(d)));
      actions.append(h('button', { onclick: () => { d.snapshot = renderDraftText(d); d.status = 'approved'; renderWork(); } }, 'Approve local preview'), h('button', { class: 'secondary', onclick: () => { d.status = 'draft'; renderWork(); } }, 'Back to editing'));
    }
    if (d.status === 'approved') {
      card.append(h('div', { class: 'preview' }, h('strong', {}, 'Local preview (not posted)'), d.snapshot.cloneNode(true)), h('p', { class: 'badge ok' }, 'Verified: preview rendered locally. No external request was made.'));
      actions.append(h('button', { class: 'secondary', onclick: () => { d.status = 'draft'; d.snapshot = null; renderWork(); } }, 'Edit as new draft'));
    }
    actions.append(h('button', { disabled: true, title: 'No messaging integration is connected' }, 'Post externally (unavailable)'));
    card.append(actions);
    return card;
  }

  function renderDraftText(d) {
    const own = (x) => (x.owner ? `Owner: ${x.owner}` : 'Owner: unclear') + (x.due ? `, due: ${x.due}` : ', due: unclear');
    return h('div', {},
      d.learnings.length ? h('div', {}, h('strong', {}, 'Learned'), h('ul', { class: 'plain' }, d.learnings.map((x) => h('li', {}, x.text)))) : null,
      d.sentiment ? h('div', {}, h('strong', {}, 'Sentiment'), h('ul', { class: 'plain' }, h('li', {}, d.sentiment.text))) : null,
      d.nextSteps.length ? h('div', {}, h('strong', {}, 'Next steps'), h('ul', { class: 'plain' }, d.nextSteps.map((x) => h('li', {}, `${x.text} (${own(x)})`)))) : null);
  }

  /* ---------- init ---------- */
  buildShell();
  window.addEventListener('hashchange', renderWork);
  window.addEventListener('keydown', (e) => {
    const r = route(); const i = Number(e.key) - 1;
    if (!r.id || e.metaKey || e.ctrlKey || e.altKey || !(i >= 0 && i < 4)) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName)) return;
    go(r.id, TAB_KEYS[i]);
  });
  renderWork();
})();
