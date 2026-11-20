(function () {
  'use strict';
  const D = window.MW_DATA, L = window.MW_LOGIC;

  /* All per-meeting user state lives here. The dataset is never mutated. */
  const state = {
    search: '', phase: 'all', customer: 'all',
    conf: {},        // meetingId -> { customer, participants, history }
    agenda: {},      // meetingId -> string
    rehearsal: {},   // meetingId -> { roleId, active, log, feedback }
    draft: {},       // meetingId -> editable follow-through draft
    briefs: {},      // customerId or meetingId -> { text, summary, loadedAt }
    briefDraft: {}   // unsaved brief text
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
  const TAB_KEYS = ['prep', 'context', 'rehearsal', 'coaching', 'follow'];
  function renderWork() {
    const { id, section } = route();
    renderList();
    const m = id && meetingById(id);
    if (!m) { workPane.replaceChildren(h('div', { class: 'card empty' }, h('div', { class: 'big' }, '🗓️'), h('h2', {}, 'Pick a meeting to get started'), h('p', {}, 'Open any synthetic meeting on the left to prepare, rehearse, review and follow up.'))); return; }
    const sections = { prep: renderPrep, context: renderContext, rehearsal: renderRehearsal, coaching: renderCoaching, follow: renderFollow };
    const sec = sections[section] ? section : 'prep';
    const tabs = h('div', { class: 'tabs', role: 'tablist' }, [['prep', 'Prep'], ['context', 'Customer Context'], ['rehearsal', 'Rehearsal'], ['coaching', 'Coaching'], ['follow', 'Follow-through']].map(([k, t]) =>
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

  /* ---------- Customer Context (account brief stands in for future integrations) ---------- */
  const INTEGRATIONS = [
    ['CRM', 'journey stage, contract and renewal'],
    ['Call recording and transcription', 'last call and action items'],
    ['Slack', 'account conversations'],
    ['Product data (BigQuery)', 'credit utilization and create-to-PR throughput'],
    ['Support tickets', 'open and recent issues'],
    ['Company content (Notion)', 'what each persona cares about']
  ];
  const briefKey = (m) => L.customerView(m, state.conf[m.id]).customerId || m.id;
  const getBrief = (m) => state.briefs[briefKey(m)] || null;
  const tile = (k, v, kind) => h('div', { class: 'stat ' + (kind || 'plain') }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v));
  const HEALTH_KIND = { healthy: 'ok', moderate: 'warn', low: 'bad', unknown: 'plain' };

  function renderContext(m) {
    const key = briefKey(m), cur = state.briefs[key], conf = state.conf[m.id];
    const sampleText = D.sampleBriefs[L.customerView(m, conf).customerId];
    const draft = state.briefDraft[key] != null ? state.briefDraft[key] : (cur ? cur.text : '');
    const msg = h('div', { class: 'muted', role: 'status' });
    const ta = h('textarea', { rows: 12, 'aria-label': 'Account brief text', placeholder: 'Paste or upload an account brief (markdown with ## headings). Try "Insert blank template" to see the format.', oninput: (e) => { state.briefDraft[key] = e.target.value; } }, draft);
    const setText = (t) => { ta.value = t; state.briefDraft[key] = t; };
    const file = h('input', { type: 'file', accept: '.md,.txt,text/plain,text/markdown', 'aria-label': 'Upload brief file', onchange: (e) => {
      const f = e.target.files[0]; if (!f) return;
      if (f.size > 200000) { msg.textContent = 'File is larger than 200 KB. Trim it and try again.'; return; }
      const rd = new FileReader(); rd.onload = () => { setText(String(rd.result)); msg.textContent = `Loaded ${f.name}. Review it, then click "Use this brief".`; }; rd.readAsText(f);
    } });
    const intake = h('div', { class: 'card stack' }, h('h2', {}, 'Account brief'),
      h('div', { class: 'row' }, badge('Prototype stand-in for integrations', 'sim'), badge('Processed locally in your browser, never uploaded', 'plain')),
      h('p', { class: 'muted' }, 'Everything below is only as accurate as the text you provide. It is treated as untrusted, and any instructions inside it are ignored.'),
      ta, h('div', { class: 'row' }, file,
        sampleText ? h('button', { class: 'secondary', onclick: () => { setText(sampleText); msg.textContent = 'Loaded a synthetic sample. Click "Use this brief".'; } }, 'Load synthetic sample') : null,
        h('button', { class: 'secondary', onclick: () => { setText(D.briefTemplate); msg.textContent = 'Inserted a blank template.'; } }, 'Insert blank template'),
        h('button', { onclick: () => {
          if (!ta.value.trim()) { msg.textContent = 'Add some text first.'; return; }
          state.briefs[key] = { text: ta.value, summary: L.summarizeBrief(L.parseBrief(ta.value)), loadedAt: new Date().toISOString() };
          renderWork();
        } }, 'Use this brief'),
        cur ? h('button', { class: 'secondary', onclick: () => { delete state.briefs[key]; delete state.briefDraft[key]; renderWork(); } }, 'Clear') : null),
      msg);

    const integ = h('details', { class: 'details-card' }, h('summary', {}, 'Planned connections (none connected)'),
      h('ul', { class: 'plain', style: 'padding-bottom:12px' }, INTEGRATIONS.map(([n, what]) => h('li', {}, h('strong', {}, n), `: ${what}. `, badge('Not connected', 'plain')))),
      h('p', { class: 'muted' }, 'The uploaded brief stands in for these sources until real, authorized connections exist.'));

    if (!cur) return h('div', { class: 'stack' }, intake, integ, h('div', { class: 'card empty' }, h('div', { class: 'big' }, '📋'), h('h2', {}, 'No brief yet'), h('p', {}, 'Add an account brief above to see a summary of the account, the last call, support and what each attendee cares about.')));

    const s = cur.summary, days = s.contract.days;
    const renewal = days == null ? 'Unknown' : days >= 0 ? `In ${days} days` : `${-days} days ago`;
    const oh = s.tickets.openHigh.length;
    const attendees = m.participants.filter((p) => !p.internal).map((p) => {
      const role = L.participantRole(p, conf), pers = L.personasFor(s, role);
      return h('div', { class: 'ev cust' }, h('strong', {}, p.name), ' ', role ? h('span', { class: 'muted' }, role) : badge('Role unconfirmed', 'warn'),
        pers.length ? h('ul', { class: 'plain' }, pers[0].priorities.map((x) => h('li', {}, x))) : h('div', { class: 'muted' }, role ? 'The brief has no priorities for this role.' : 'Confirm this person\'s contact match on Prep to see their priorities.'));
    });
    const mood = s.sentiment;

    return h('div', { class: 'stack' }, intake, integ,
      h('div', { class: 'hero' }, h('div', { class: 'row' }, badge('From your uploaded brief, unverified', 'sim'), h('span', { class: 'muted' }, `Loaded ${fmt(cur.loadedAt)}`)),
        h('div', { class: 'strip' },
          tile('Stage', s.journey.stage || 'Not provided'),
          tile('Renewal', renewal, s.contract.window ? 'warn' : 'plain'),
          tile('Credit utilization', s.usage.util || 'Not provided', HEALTH_KIND[s.usage.health]),
          tile('Create to PR', s.usage.throughput == null ? 'Not provided' : `${Math.round(s.usage.throughput * 100)}%`, HEALTH_KIND[s.usage.health]),
          tile('Open tickets', `${s.tickets.open.length}${oh ? ` (${oh} high)` : ''}`, oh ? 'bad' : s.tickets.open.length ? 'warn' : 'ok'),
          tile('Likely sentiment', L.MOODS[mood.mood].label, mood.mood === 'friendly' ? 'ok' : 'warn')),
        h('p', { class: 'muted' }, `Usage health: ${s.usage.health} (demo thresholds: utilization 40% and 70%, create-to-PR 25% and 50%).`)),
      s.missing.length || s.flagged.length || s.warnings.length ? h('div', { class: 'attention' }, h('h2', {}, '⚠️ About this brief'),
        h('ul', {}, s.missing.length ? h('li', {}, `Sections missing or empty: ${s.missing.join(', ')}.`) : null,
          s.flagged.length ? h('li', {}, `${s.flagged.length} line(s) looked like instructions and were ignored.`) : null,
          s.warnings.map((w) => h('li', {}, w)))) : null,
      h('div', { class: 'two-col' },
        h('div', { class: 'stack' },
          h('div', { class: 'card' }, h('h2', {}, 'Last call and next steps'), h('div', { class: 'muted' }, s.lastCall.date ? `Call date: ${s.lastCall.date}` : 'Call date not provided'),
            s.lastCall.points.length ? h('ul', { class: 'plain' }, s.lastCall.points.map((x) => h('li', {}, x))) : h('p', { class: 'muted' }, 'No call notes provided.'),
            h('h3', {}, 'Open next steps'), s.nextSteps.open.length ? h('ul', { class: 'plain' }, s.nextSteps.open.map((x) => h('li', {}, x.text, x.owner ? h('span', { class: 'muted' }, ` (owner: ${x.owner})`) : h('span', { class: 'muted' }, ' (owner not stated)')))) : h('p', { class: 'muted' }, 'None listed.'),
            s.nextSteps.done.length ? [h('h3', {}, 'Marked done in the brief'), h('ul', { class: 'plain' }, s.nextSteps.done.map((x) => h('li', {}, x.text)))] : null,
            h('p', { class: 'muted' }, '"Done" is as reported in the brief, not verified.')),
          h('div', { class: 'card' }, h('h2', {}, 'Support'), s.tickets.open.length || s.tickets.closed.length
            ? h('ul', { class: 'plain' }, [...s.tickets.open, ...s.tickets.closed].map((t) => h('li', {}, `${t.id}: ${t.title} `, badge(t.open ? `Open, ${t.priority}` : 'Closed', t.open ? (t.priority === 'high' ? 'bad' : 'warn') : 'plain'))))
            : h('p', { class: 'muted' }, 'No tickets provided.'))),
        h('div', { class: 'stack' },
          h('div', { class: 'card' }, h('h2', {}, 'Likely sentiment'), badge(`${L.MOODS[mood.mood].label} (inference)`, 'sim'),
            h('ul', { class: 'plain' }, mood.reasons.map((x) => h('li', {}, x))), h('p', { class: 'muted' }, mood.note + ' Defaults to skeptical.')),
          h('div', { class: 'card' }, h('h2', {}, 'What attendees care about'), h('p', { class: 'muted' }, 'Matched by confirmed role, from the brief\'s persona section.'), attendees),
          h('div', { class: 'card' }, h('h2', {}, 'Open questions'), s.openQuestions.length ? h('ul', { class: 'plain' }, s.openQuestions.map((x) => h('li', {}, x))) : h('p', { class: 'muted' }, 'None listed.')))));
  }

  /* ---------- Rehearsal ---------- */
  function renderRehearsal(m) {
    const conf = state.conf[m.id];
    const r = (state.rehearsal[m.id] = state.rehearsal[m.id] || { roleId: null, mood: null, active: false, log: [], pending: null, explored: [], feedback: null });
    const sum = (getBrief(m) || {}).summary || null;
    const likely = sum ? sum.sentiment : { mood: 'skeptical', reasons: ['No account brief uploaded, so this defaults to skeptical.'] };
    const externals = m.participants.filter((p) => !p.internal);
    const wrap = h('div', { class: 'card stack' }, h('h2', {}, 'Rehearsal'),
      h('div', { class: 'sim-banner' }, 'SIMULATION. Replies are scripted from the meeting and your brief, not the real person. Nothing here is saved as a customer fact.'),
      h('p', { class: 'muted' }, 'Text only. Voice interaction is not available in this demo.'));
    if (!r.active) {
      const roleSel = h('select', { 'aria-label': 'Participant to simulate' }, [h('option', { value: '' }, 'General attendee (no specific person)'), ...externals.map((p) => h('option', { value: p.id, selected: p.id === r.roleId }, p.name))]);
      const moodSel = h('select', { 'aria-label': 'Customer mood' }, Object.entries(L.MOODS).map(([k, v]) => h('option', { value: k, selected: k === (r.mood || likely.mood) }, v.label + (k === likely.mood ? ' (likely)' : ''))));
      wrap.append(
        h('p', { class: 'muted' }, `Likely sentiment: ${L.MOODS[likely.mood].label}. ${likely.reasons.join(' ')} This is an inference, not knowledge of a real person.`),
        sum ? null : h('p', { class: 'muted' }, 'Add an account brief on the Customer Context tab for responses grounded in contract, usage, tickets and last call.'),
        h('div', { class: 'row' }, roleSel, moodSel, h('button', { onclick: () => { r.roleId = roleSel.value || null; r.mood = moodSel.value; r.active = true; r.log = []; r.pending = null; r.explored = []; r.feedback = null; renderWork(); } }, 'Begin Role Play')));
      if (r.feedback) wrap.append(renderFeedback(r.feedback));
      return wrap;
    }
    const person = r.roleId ? L.participantName(m, r.roleId) : 'General attendee';
    const roleStr = r.roleId ? L.participantRole(m.participants.find((p) => p.id === r.roleId), conf) : null;
    const input = h('textarea', { 'aria-label': 'Your message', rows: 2, placeholder: 'Ask an open-ended question or set the agenda…' });
    const send = () => {
      const text = input.value.trim(); if (!text) return;
      r.log.push({ from: 'user', text });
      r.pending = { branches: L.rehearsalBranches(L.rehearsalContext(m, r.roleId, sum, r.mood, roleStr), text) };
      renderWork();
    };
    const KIND = { engaged: 'ok', unsure: 'warn', pushback: 'bad' };
    const pick = (b) => { r.log.push({ from: 'sim', text: b.text, basis: b.basis, generic: b.generic }); if (!r.explored.includes(b.type)) r.explored.push(b.type); r.pending = null; renderWork(); };
    wrap.append(h('div', { class: 'row' }, 'Simulating: ', badge(person, 'sim'), badge(`Mood: ${L.MOODS[r.mood].label}`, 'sim'), badge(`Explored ${r.explored.length} of 3 response types`, 'plain')),
      h('div', { class: 'chat', 'aria-live': 'polite' }, r.log.length ? r.log.map((x) => h('div', { class: 'msg ' + x.from },
        h('div', { class: 'avatar', 'aria-hidden': 'true' }, x.from === 'user' ? 'You' : 'SIM'),
        h('div', { class: 'bubble ' + x.from },
          h('div', { class: 'muted' }, x.from === 'user' ? 'You' : `Simulated ${person}`),
          x.text,
          x.from === 'sim' ? h('div', { class: 'muted' }, x.generic ? 'Generic scripted reply, no supporting evidence.' : 'Grounded in: ' + x.basis.join(', ')) : null))) : h('div', { class: 'muted' }, 'Ask a question or set the agenda. You will see three ways the customer might answer.')),
      r.pending ? h('div', { class: 'stack' }, h('h3', {}, 'How might they respond? Pick a branch to continue'),
        h('div', { class: 'branches' }, r.pending.branches.map((b) => h('div', { class: 'branch ' + b.type },
          h('div', { class: 'row' }, badge(b.label, KIND[b.type]), b.likely ? badge('Most likely for this mood', 'plain') : null),
          h('div', {}, b.text),
          h('div', { class: 'muted' }, b.generic ? 'Generic simulated reply.' : 'Grounded in: ' + b.basis.join(', ')),
          h('div', { class: 'hint' }, '💡 ' + b.hint),
          h('button', { class: 'secondary', onclick: () => pick(b) }, 'Continue with this response'))))) : null,
      input, h('div', { class: 'row' }, h('button', { onclick: send }, 'Send'),
        h('button', { class: 'secondary', onclick: () => { r.feedback = L.rolePlayFeedback(r.log.filter((x) => x.from === 'user').map((x) => x.text), { explored: r.explored }); r.active = false; r.pending = null; renderWork(); } }, 'End rehearsal and get feedback')));
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
    if (!r.id || e.metaKey || e.ctrlKey || e.altKey || !(i >= 0 && i < 5)) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName)) return;
    go(r.id, TAB_KEYS[i]);
  });
  renderWork();
})();
