/* Pure logic: no DOM, no network, never mutates the dataset. */
(function (root) {
  'use strict';
  const DATA = root.MW_DATA;
  const NOW = new Date('2026-11-19T12:00:00Z'); // fixed "today" for the synthetic demo
  const STALE_DAYS = 90;
  const LIMITS = { learnings: 3, sentiment: 1, nextSteps: 3 };

  /* ---------- helpers ---------- */
  const isStale = (date, now) => Math.floor(((now || NOW) - new Date(date)) / 86400000) > STALE_DAYS;

  const INSTRUCTION_RE = /(ignore (all |any |the )?(previous|prior|above) instructions|system note|disregard (the )?(above|previous|prior)|(send|forward|email) [^.]*@|you must now)/i;
  const isInstructionLike = (t) => INSTRUCTION_RE.test(String(t || ''));

  const OPEN_START = /^(how|what|why|where|which|who|when|walk me|tell me|describe|help me understand|talk me through|(could|would|can) you (walk|describe|share|tell|help))\b/i;
  function isOpenEnded(q) {
    const sentences = String(q).trim().split(/(?<=[.?!])\s+/);
    const last = sentences[sentences.length - 1];
    if (OPEN_START.test(last)) return true;
    const afterComma = last.indexOf(',') >= 0 ? last.slice(last.indexOf(',') + 1).trim() : '';
    return OPEN_START.test(afterComma);
  }

  const find = (arr, id) => arr.find((x) => x.id === id);
  const reliable = (s) => s === 'matched' || s === 'confirmed' || s === 'internal';

  /* ---------- associations (user confirmation overrides source match) ---------- */
  function customerView(m, conf) {
    const c = conf && conf.customer;
    if (c) return { status: c.id ? 'confirmed' : 'user_unmatched', customerId: c.id || null, byUser: true, candidates: m.customer.candidates, evidence: 'Set by you.' };
    const st = m.customer.matchStatus;
    return { status: st, customerId: st === 'ambiguous' || st === 'unmatched' ? null : m.customer.suggested, byUser: false, candidates: m.customer.candidates, evidence: m.customer.evidence };
  }

  function participantView(p, conf) {
    if (p.internal) return { status: 'internal', contactId: null, byUser: false, candidates: [], evidence: 'Internal attendee.' };
    const c = conf && conf.participants && conf.participants[p.id];
    if (c) return { status: c.contactId ? 'confirmed' : 'user_unmatched', contactId: c.contactId || null, byUser: true, candidates: p.match.candidates, evidence: 'Set by you.' };
    const st = p.match.status;
    return { status: st, contactId: st === 'ambiguous' || st === 'unmatched' ? null : p.match.suggested, byUser: false, candidates: p.match.candidates, evidence: p.match.evidence };
  }

  function participantRole(p, conf) {
    if (p.internal) return p.role || null;
    const v = participantView(p, conf);
    return v.contactId && reliable(v.status) ? DATA.contacts[v.contactId].role : null;
  }

  const participantName = (m, id) => (find(m.participants, id) || {}).name || null;
  const speakerName = (m, line) => participantName(m, line.speaker) || line.speakerLabel || 'Unidentified speaker';

  /* ---------- Prep ---------- */
  function buildDiscoveryQuestions(m, conf) {
    const cust = customerView(m, conf);
    const trusted = reliable(cust.status);
    const stmts = trusted ? m.evidence.filter((e) => e.kind === 'customer_statement') : [];
    const initiative = (stmts.find((e) => e.initiative) || {}).initiative;
    const blocker = (stmts.find((e) => e.blocker) || {}).blocker;
    const roles = m.participants.filter((p) => !p.internal).map((p) => participantRole(p, conf)).filter(Boolean);

    const q1 = initiative
      ? `Previously, ${initiative} came up as a priority. How is that progressing from your team's perspective, and what would success look like by the end of next quarter?`
      : "How would you describe your team's most important priorities over the next quarter, and how do they shape what you're hoping to get from this conversation?";
    const q2 = roles.length
      ? `As ${roles[0]}, what does a typical week look like for your team, and where does the current process feel slowest or most manual?`
      : 'Who else is involved in decisions like this on your side, and what does each of them care about most?';
    const q3 = blocker
      ? `Earlier, ${blocker} was raised as a blocker. What would need to be true for it to be resolved, and what could we do to help you move forward?`
      : "What, if anything, is getting in the way of making progress on your goals right now, and what would help you move forward?";

    const questions = [q1, q2, q3];
    const basis = initiative || blocker || roles.length ? 'evidence' : 'general';
    return {
      questions, basis,
      limitation: basis === 'general'
        ? 'Little confirmed customer context is available, so these are general questions.'
        : (initiative && blocker && roles.length ? null : 'Some questions are general because the related evidence is missing or unconfirmed.')
    };
  }

  function buildPrepBrief(m, conf) {
    const cust = customerView(m, conf);
    const trusted = reliable(cust.status);
    const evidence = trusted ? m.evidence : [];
    const items = evidence.map((e) => ({ ...e, stale: isStale(e.date), conflict: !!e.conflictsWith }));
    const missing = [...m.missingContext];
    if (!trusted) missing.unshift(cust.status === 'user_unmatched'
      ? 'You marked the customer as not matched, so no customer evidence is shown.'
      : 'Customer match is not confirmed, so customer evidence is withheld until you confirm it.');
    m.participants.filter((p) => !p.internal).forEach((p) => {
      const v = participantView(p, conf);
      if (!reliable(v.status)) missing.push(`${p.name}: contact match is ${v.status.replace('_', ' ')}; role unknown.`);
    });
    const staleN = items.filter((i) => i.stale).length;
    if (staleN) missing.push(`${staleN} evidence item(s) are older than ${STALE_DAYS} days and may be out of date.`);
    const conflicts = items.filter((i) => i.conflict);
    if (conflicts.length) missing.push(`${conflicts.length} evidence item(s) conflict with each other; see the flagged items.`);
    if (m.evidence.length === 0) missing.push('No prior evidence is available for this meeting. This brief is not a complete picture.');

    const agenda = ['Confirm purpose and time available'];
    items.filter((i) => i.open).forEach((i) => agenda.push(`Check status of an open item from ${i.date} (see evidence ${i.id})`));
    m.intendedOutcomes.forEach((o) => agenda.push(o.text));
    agenda.push('Discovery questions', 'Agree on owners and next steps');

    return {
      items, missing, agenda, cust,
      interpretations: trusted ? m.interpretations : [],
      questions: buildDiscoveryQuestions(m, conf),
      coverage: `Built from ${items.length} evidence item(s) in the synthetic dataset. It is not comprehensive.`
    };
  }

  /* ---------- Rehearsal (simulation only; no data is written) ---------- */
  const GENERIC_CONCERNS = [
    'I only have a few minutes. What exactly do you need from me?',
    "We have a lot on our plate this quarter. Why should this be a priority now?",
    "I'd need to check with others on my team before committing to anything."
  ];

  function personaEvidence(m, participantId) {
    return m.evidence.filter((e) => e.kind === 'customer_statement' && e.speakerId === participantId);
  }

  function rolePlayReply(m, participantId, userText, turnIndex) {
    const own = personaEvidence(m, participantId);
    const concerns = own.filter((e) => e.concern);
    if (isOpenEnded(userText) || /\?\s*$/.test(userText)) {
      if (isOpenEnded(userText) && own.length) {
        const e = own[turnIndex % own.length];
        return { text: `(Based on notes) ${e.text}`, basis: [e.id], generic: false };
      }
      return { text: "That's a fair question. I'd need to think about it. What did you have in mind?", basis: [], generic: true };
    }
    if (/\b(agenda|goal|purpose|plan to cover|today)\b/i.test(userText)) {
      return { text: "Sounds fine, as long as we keep to the time we have.", basis: [], generic: true };
    }
    if (concerns.length) {
      const e = concerns[turnIndex % concerns.length];
      return { text: e.concern, basis: [e.id], generic: false };
    }
    return { text: GENERIC_CONCERNS[turnIndex % GENERIC_CONCERNS.length], basis: [], generic: true };
  }

  function rolePlayFeedback(userMessages, opts) {
    const msgs = userMessages.map((s) => s.trim()).filter(Boolean);
    if (!msgs.length) return { empty: true, strengths: [], improvements: ['You ended before sending any message, so there is nothing to assess. Try opening with a purpose statement and one open question.'], metrics: { turns: 0 } };
    const questions = msgs.filter((s) => /\?/.test(s));
    const open = questions.filter(isOpenEnded);
    const closed = questions.filter((s) => !isOpenEnded(s));
    const agenda = msgs.some((s) => /\b(agenda|goal|purpose|plan to cover|today)\b/i.test(s));
    const ack = msgs.some((s) => /\b(understand|makes sense|fair|hear you|appreciate)\b/i.test(s));
    const close = msgs.some((s) => /\b(next step|follow up|follow-up|by (monday|tuesday|wednesday|thursday|friday)|i'll send|we'll send)\b/i.test(s));
    const strengths = [], improvements = [];
    (agenda ? strengths : improvements).push(agenda ? 'You stated a purpose or agenda early, which sets expectations.' : 'You did not state a goal or agenda. Open with one sentence on the purpose and how long you need.');
    if (open.length) strengths.push(`You asked ${open.length} open-ended question(s), e.g. "${open[0]}".`);
    else improvements.push('You asked no open-ended questions. Try one starting with "What" or "How".');
    if (closed.length) improvements.push(`"${closed[0]}" can be answered yes or no. Rephrase it to start with "What" or "How".`);
    (ack ? strengths : improvements).push(ack ? 'You acknowledged the concern before moving on.' : 'You did not acknowledge any concern. Reflect it back ("That makes sense, because...") before responding.');
    (close ? strengths : improvements).push(close ? 'You moved toward concrete next steps.' : 'You did not propose a next step. End by naming an owner and date.');
    const explored = opts && opts.explored;
    if (explored) {
      const missing = ['engaged', 'unsure', 'pushback'].filter((x) => !explored.includes(x));
      if (missing.length) improvements.push(`You practiced ${explored.length} of 3 customer response types. Replay and pick the ${missing.join(' and ')} branch to be ready for it.`);
      else strengths.push('You practiced all three response types: engaged, unsure and pushback.');
    }
    return { empty: false, strengths, improvements, metrics: { turns: msgs.length, open: open.length, closed: closed.length, agenda, ack, close } };
  }

  /* ---------- Coaching ---------- */
  function usableLines(m) {
    const flagged = [];
    const lines = m.transcript.lines.filter((l) => {
      if (isInstructionLike(l.text)) { flagged.push(l); return false; }
      return true;
    });
    return { lines, flagged };
  }

  function assessOutcomes(m) {
    const status = m.transcript.status;
    const { lines, flagged } = usableLines(m);
    const limitations = [];
    if (status === 'unavailable') limitations.push(m.transcript.note + ' Nothing below can be verified from a conversation.');
    if (status === 'incomplete') limitations.push('Transcript is incomplete: ' + m.transcript.note + ' Missing parts are unknown, not proof that something was not said.');
    if (status === 'ambiguous') limitations.push('Speaker attribution is ambiguous: ' + m.transcript.note);
    if (lines.some((l) => l.conf === 'low') && status !== 'unavailable') limitations.push('Some lines have uncertain speaker attribution; those are not counted as confirmed.');
    if (flagged.length) limitations.push(`${flagged.length} line(s) contain instruction-like text; they were treated as untrusted data and ignored.`);

    const assessments = m.intendedOutcomes.map((o) => {
      const rec = m.completionRecords.find((r) => r.outcomeId === o.id);
      if (status === 'unavailable') {
        return { outcome: o, captured: 'unknown', met: 'unknown', completed: rec && rec.status === 'done' ? 'yes' : 'unknown', evidence: [], notes: ['No transcript, so this cannot be verified.'] };
      }
      const ev = (m.outcomeEvidence[o.id] || []).map((x) => ({ ...x, line: lines.find((l) => l.id === x.line) })).filter((x) => x.line);
      const notes = [];
      const captured = ev.length ? 'yes' : (status === 'available' ? 'no' : 'unknown');
      if (!ev.length && status !== 'available') notes.push('No supporting line found, but the transcript is incomplete or ambiguous.');
      const achieved = ev.filter((x) => x.kind === 'achieved');
      let met;
      if (achieved.some((x) => x.line.conf === 'high')) met = 'yes';
      else if (achieved.length) { met = 'unknown'; notes.push('The supporting line has an unidentified speaker, so "met" cannot be confirmed.'); }
      else if (captured === 'yes') { met = 'no'; notes.push('Discussed or promised, but the transcript does not show the outcome was substantively reached.'); }
      else met = captured === 'unknown' ? 'unknown' : 'no';
      let completed;
      if (rec && rec.status === 'done') completed = 'yes';
      else if (rec) completed = 'no';
      else {
        completed = 'unknown';
        const committed = ev.some((x) => x.kind === 'committed');
        notes.push(committed ? 'A commitment was made, but no record shows the work was finished. A promise is not completion.' : 'No completion record is available.');
      }
      return { outcome: o, captured, met, completed, evidence: ev, completion: rec || null, notes };
    });

    const suggestions = [];
    if (status === 'unavailable') {
      suggestions.push({ text: 'General suggestion, not drawn from a conversation: before the meeting, write down the one outcome you most need and how you will recognise it was reached.', evidenceBased: false });
    } else {
      assessments.forEach((a) => {
        const committed = a.evidence.find((x) => x.kind === 'committed');
        if (committed && a.completed !== 'yes') {
          const l = committed.line;
          suggestions.push({ text: `For "${a.outcome.text}", restate the owner and an exact date before closing. The line at ${l.t} ("${l.text}") has ${l.due ? 'only a vague date: ' + l.due : 'no date'}.`, evidenceBased: true, lineId: l.id });
        } else if (a.captured === 'yes' && a.met === 'no') {
          const l = a.evidence[0].line;
          suggestions.push({ text: `On "${a.outcome.text}", the answer at ${l.t} was conditional or partial. Ask a direct follow-up, such as "What would you need to see to confirm this?"`, evidenceBased: true, lineId: l.id });
        }
      });
      if (!suggestions.length) suggestions.push({ text: 'Summarise agreed next steps aloud, with owners and dates, before ending the call.', evidenceBased: false });
    }
    return { status, limitations, assessments, suggestions, flagged, lines };
  }

  /* ---------- Follow-through ---------- */
  function buildFollowThrough(m) {
    const status = m.transcript.status;
    const empty = { available: false, learnings: [], sentiment: null, nextSteps: [], notes: [] };
    if (status === 'unavailable') return { ...empty, notes: ['No transcript is available, so no learnings, sentiment or next steps can be drafted.'] };
    const { lines, flagged } = usableLines(m);
    const notes = [];
    if (flagged.length) notes.push(`${flagged.length} instruction-like line(s) were excluded from the draft.`);
    if (status !== 'available') notes.push('The transcript is incomplete or ambiguous. Review every bullet before using it.');

    const learnings = lines.filter((l) => (l.tags || []).includes('learning')).slice(0, LIMITS.learnings).map((l) => ({
      text: l.summary, source: `${speakerName(m, l)}, ${l.t}`, needsReview: l.conf === 'low'
    }));
    const sl = lines.find((l) => (l.tags || []).includes('sentiment') && l.conf === 'high');
    const sentiment = sl ? { text: sl.sentimentSummary, source: `${speakerName(m, sl)}, ${sl.t}`, needsReview: false } : null;
    if (!sentiment) notes.push('No evidence supports a sentiment bullet, so none was drafted.');

    const nextSteps = lines.filter((l) => (l.tags || []).includes('next_step')).slice(0, LIMITS.nextSteps).map((l) => {
      const ownerOk = l.owner && l.conf === 'high';
      return {
        text: l.summary,
        owner: ownerOk ? participantName(m, l.owner) : null,
        due: l.due || null,
        source: `${speakerName(m, l)}, ${l.t}`,
        needsReview: !ownerOk || !/^\d{4}-\d{2}-\d{2}$/.test(l.due || '')
      };
    });
    return { available: true, learnings, sentiment, nextSteps, notes };
  }

  /* ---------- Account brief (user-uploaded stand-in for future integrations) ---------- */
  const BRIEF_MAX = 200000;
  const lc = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

  function parseBrief(text) {
    const warnings = [], flagged = [], sections = {};
    let src = String(text || '');
    if (src.length > BRIEF_MAX) { src = src.slice(0, BRIEF_MAX); warnings.push('Brief was longer than 200,000 characters and was truncated.'); }
    let cur = null;
    src.split(/\r?\n/).forEach((raw) => {
      const line = raw.trim();
      if (!line) return;
      const hm = line.match(/^#{2,3}\s+(.+)$/);
      if (hm) { cur = hm[1].trim().toLowerCase(); sections[cur] = sections[cur] || []; return; }
      if (/^#\s/.test(line) || !cur) return;
      if (isInstructionLike(line)) { flagged.push(line); return; }
      sections[cur].push(line);
    });
    return { sections, flagged, warnings };
  }

  const kvOf = (lines) => {
    const o = {};
    (lines || []).forEach((l) => { const m = l.match(/^([A-Za-z][A-Za-z ]*?):\s*(.+)$/); if (m && !/^[-*]/.test(l)) o[m[1].toLowerCase()] = m[2].trim(); });
    return o;
  };
  const bulletsOf = (lines) => (lines || []).map((l) => (l.match(/^[-*]\s+(.*)$/) || [])[1]).filter(Boolean);
  const toNum = (s) => { const n = parseFloat(String(s || '').replace(/[^0-9.]/g, '')); return Number.isFinite(n) ? n : null; };
  const rank = (v, lo, hi) => (v == null ? null : v < lo ? 0 : v < hi ? 1 : 2);
  const RANKS = ['low', 'moderate', 'healthy'];

  function summarizeBrief(parsed, now) {
    const S = parsed.sections, today = now || NOW;
    const journey = kvOf(S.journey), contract = kvOf(S.contract), usage = kvOf(S.usage), call = kvOf(S['last call']);
    const days = contract['renewal date'] ? Math.ceil((new Date(contract['renewal date']) - today) / 86400000) : null;
    const utilNum = toNum(usage['credit utilization']);
    const created = toNum(usage.created), pr = toNum(usage['pr submitted']);
    const throughput = created ? pr / created : null;
    const ranks = [rank(utilNum, 40, 70), rank(throughput, 0.25, 0.5)].filter((x) => x != null);
    const health = ranks.length ? RANKS[Math.min(...ranks)] : 'unknown';

    const steps = bulletsOf(S['next steps']).map((b) => {
      const m = b.match(/^\[( |x)\]\s*(.*)$/i);
      const body = m ? m[2] : b, own = body.match(/\(owner:\s*([^)]+)\)/i);
      return { text: body.replace(/\s*\(owner:[^)]+\)/i, ''), owner: own ? own[1].trim() : null, done: !!m && m[1].toLowerCase() === 'x' };
    });
    const tickets = bulletsOf(S['support tickets']).map((b) => {
      const m = b.match(/^(\S+)\s*\((open|closed)(?:\s*,\s*(high|normal|low))?\)\s*(.*)$/i);
      return m ? { id: m[1], open: m[2].toLowerCase() === 'open', priority: (m[3] || 'normal').toLowerCase(), title: m[4] } : null;
    }).filter(Boolean);
    const personas = bulletsOf(S['persona priorities']).map((b) => {
      const i = b.indexOf(':');
      return i < 0 ? null : { role: b.slice(0, i).trim(), priorities: b.slice(i + 1).split(';').map((x) => x.trim()).filter(Boolean) };
    }).filter(Boolean);
    const openTickets = tickets.filter((t) => t.open);
    const openHigh = openTickets.filter((t) => t.priority === 'high');
    const inWindow = days != null && days >= 0 && days <= 90;

    // Likely sentiment: default skeptical; friendly only when risk signals are absent and positives are present.
    const risk = [], pos = [];
    if (utilNum != null && utilNum < 40) risk.push(`Credit utilization is low (${utilNum}%).`);
    if (throughput != null && throughput < 0.25) risk.push(`Few runs reach a submitted PR (${Math.round(throughput * 100)}%).`);
    if (openHigh.length) risk.push(`${openHigh.length} high-priority support ticket(s) are open.`);
    if (inWindow) risk.push(`Renewal is ${days} days away (inside the 90-day window).`);
    if (utilNum != null && utilNum >= 70) pos.push(`Credit utilization is strong (${utilNum}%).`);
    if (throughput != null && throughput >= 0.5) pos.push(`Most runs reach a submitted PR (${Math.round(throughput * 100)}%).`);
    if (tickets.length && !openTickets.length) pos.push('No open support tickets.');
    const friendly = !risk.length && pos.length >= 2;
    const sentiment = {
      mood: friendly ? 'friendly' : 'skeptical',
      reasons: friendly ? pos : (risk.length ? risk : ['Not enough signals to move off the skeptical default.']),
      note: 'Inference from the uploaded brief, not knowledge of how any person feels.'
    };

    const names = { journey: 'Journey', contract: 'Contract', usage: 'Usage', 'last call': 'Last call', 'next steps': 'Next steps', 'support tickets': 'Support tickets', 'persona priorities': 'Persona priorities', 'open questions': 'Open questions' };
    const missing = Object.keys(names).filter((k) => !(S[k] && S[k].length)).map((k) => names[k]);
    return {
      journey: { stage: journey.stage || null, since: journey['customer since'] || null },
      contract: { plan: contract.plan || null, renewalDate: contract['renewal date'] || null, days, window: inWindow },
      usage: { period: usage.period || null, util: usage['credit utilization'] || null, utilNum, activeUsers: usage['active users'] || null, created, pr, throughput, health },
      lastCall: { date: call.date || null, points: bulletsOf(S['last call']) },
      nextSteps: { open: steps.filter((s) => !s.done), done: steps.filter((s) => s.done) },
      tickets: { open: openTickets, closed: tickets.filter((t) => !t.open), openHigh },
      personas, openQuestions: bulletsOf(S['open questions']),
      sentiment, missing, flagged: parsed.flagged, warnings: parsed.warnings
    };
  }

  const personasFor = (summary, role) => (summary && role ? summary.personas.filter((p) => p.role.toLowerCase() === role.toLowerCase()) : []);

  /* ---------- Branching rehearsal ---------- */
  const MOODS = {
    skeptical: { label: 'Skeptical', order: ['pushback', 'unsure', 'engaged'], lead: { pushback: 'Let me be direct. ', engaged: "Cautiously, I'm open to it. ", unsure: 'Honestly? ' } },
    rushed: { label: 'Rushed', order: ['pushback', 'engaged', 'unsure'], lead: { pushback: 'I only have a few minutes. ', engaged: 'Quick answer. ', unsure: 'No time to dig in. ' } },
    friendly: { label: 'Friendly', order: ['engaged', 'unsure', 'pushback'], lead: { pushback: 'Small thing, though. ', engaged: 'Great question. ', unsure: 'Good one. ' } },
    frustrated: { label: 'Frustrated', order: ['pushback', 'unsure', 'engaged'], lead: { pushback: 'Frankly, this has been frustrating. ', engaged: 'Fine. ', unsure: "Frankly, I don't know. " } }
  };
  const HINTS = {
    engaged: 'Go deeper: ask what success looks like and who else needs to be involved.',
    unsure: "Don't push for an answer. Offer a smaller first step, e.g. \"What would you need to see to commit to one use case?\"",
    pushback: 'Acknowledge it, then ask "What would resolving that look like for you?" and return to the goal.'
  };

  function classifyTopic(text) {
    const t = String(text).toLowerCase();
    if (/\b(ai|initiative|roadmap|90 days|next quarter|priorit)/.test(t)) return 'initiatives';
    if (/\b(block|getting in the way|stuck|challenge|barrier)/.test(t)) return 'blockers';
    if (/\b(usage|credit|adoption|using|utiliz|workflow)/.test(t)) return 'usage';
    if (/\b(renew|contract|budget|pricing|price|cost|term)/.test(t)) return 'contract';
    if (/\b(ticket|support|issue|bug|outage)/.test(t)) return 'support';
    if (/\b(next step|follow.?up|action item|last call|last time)/.test(t)) return 'followup';
    return 'general';
  }

  function rehearsalContext(m, participantId, summary, mood, role) {
    const own = participantId ? personaEvidence(m, participantId).find((e) => e.concern) : null;
    const pri = (personasFor(summary, role)[0] || {}).priorities || [];
    let concern;
    if (own) concern = { text: own.concern, basis: [own.id] };
    else if (summary && summary.tickets.openHigh.length) concern = { text: `We still have an open high-priority ticket: ${summary.tickets.openHigh[0].title}. That needs fixing first.`, basis: ['brief: support tickets'] };
    else if (summary && summary.usage.utilNum != null && summary.usage.utilNum < 40) concern = { text: `We've used only ${summary.usage.util} of our credits, so I'm not convinced we're getting value yet.`, basis: ['brief: usage'] };
    else if (summary && summary.nextSteps.open.length) concern = { text: `We're still waiting on: ${lc(summary.nextSteps.open[0].text)}.`, basis: ['brief: next steps'] };
    else concern = { text: 'Why should this be a priority for us right now?', basis: [] };
    return { mood: MOODS[mood] ? mood : 'skeptical', role: role || null, summary: summary || null, concern,
      focus: pri[0] || null, unknown: summary && summary.openQuestions[0] ? summary.openQuestions[0] : null };
  }

  function rehearsalBranches(ctx, userText) {
    const topic = classifyTopic(userText), S = ctx.summary, mood = MOODS[ctx.mood];
    const BR = 'brief: ';
    const tickets = S ? S.tickets : null;
    const engaged = {
      initiatives: ctx.focus ? [`Over the next 90 days we're focused on ${ctx.focus}.`, [BR + 'persona priorities']] : ['We have a couple of priorities for the next 90 days and I can walk you through them.', []],
      blockers: tickets && tickets.openHigh.length ? [`The main blocker is: ${tickets.openHigh[0].title}.`, [BR + 'support tickets']] : ['Mostly internal approvals and time. I can go into detail.', []],
      usage: S && S.usage.util ? [`We're at ${S.usage.util} credit utilization and want to grow it.`, [BR + 'usage']] : ['Usage is growing and we want to extend it to more teams.', []],
      contract: S && S.contract.renewalDate ? [`Our renewal is on ${S.contract.renewalDate}. We'll decide closer to then.`, [BR + 'contract']] : ["We'd need to look at budget before talking terms.", []],
      support: tickets && tickets.open.length ? [`We have ${tickets.open.length} open ticket(s) and are waiting on fixes.`, [BR + 'support tickets']] : ["Support has been fine. Nothing big is open.", []],
      followup: S && S.nextSteps.open.length ? [`From last time, we're still waiting on: ${lc(S.nextSteps.open[0].text)}.`, [BR + 'next steps']] : ['From our side, the follow-ups are in hand.', []],
      general: ['That works for me. Go ahead.', []]
    }[topic];
    const unsure = ctx.unknown
      ? [`We haven't worked this out yet: ${lc(ctx.unknown)}.`, [BR + 'open questions']]
      : [topic === 'general' ? "I'm not sure that's the right focus. What are you hoping to get out of this?" : "I don't have a clear answer to that yet.", []];
    const pushback = topic === 'general' ? ['I have limited time. What do you need from me?', []] : [ctx.concern.text, ctx.concern.basis];
    const parts = { engaged, unsure, pushback };
    const labels = { engaged: 'Engaged', unsure: 'Unsure', pushback: 'Pushback' };
    return mood.order.map((type, i) => ({
      type, label: labels[type], topic, likely: i === 0,
      text: mood.lead[type] + parts[type][0], basis: parts[type][1], generic: parts[type][1].length === 0, hint: HINTS[type]
    }));
  }

  /* ---------- Sound Check: quick pre-call readiness ---------- */
  function soundCheck(m, conf, ctx) {
    const cust = customerView(m, conf);
    const open = m.participants.filter((p) => !p.internal).filter((p) => { const v = participantView(p, conf); return !(reliable(v.status) || v.byUser); });
    const lines = String((ctx && ctx.agendaText) || '').split('\n').map((s) => s.trim()).filter(Boolean);
    const custOk = reliable(cust.status) || cust.byUser;
    const items = [
      { id: 'customer', label: 'Customer match confirmed', ok: custOk, detail: custOk ? 'Done.' : 'Confirm or correct the customer in the meeting header.' },
      { id: 'attendees', label: 'Attendees matched to contacts', ok: open.length === 0, detail: open.length ? `Still to confirm: ${open.map((p) => p.name).join(', ')}.` : 'Done.' },
      { id: 'agenda', label: 'Agenda ready', ok: lines.length > 0, detail: lines.length ? `${lines.length} item(s).` : 'Add at least one agenda item in Green Room.' },
      { id: 'brief', label: 'Account brief loaded', ok: !!(ctx && ctx.hasBrief), optional: true, detail: ctx && ctx.hasBrief ? 'Loaded.' : 'Optional, but it grounds the call sheet and rehearsal.' }
    ];
    return {
      items,
      blocking: items.filter((i) => !i.ok && !i.optional).length,
      manual: [
        { id: 'consent', label: 'Customer consent to record or transcribe obtained (or recording stays off)' },
        { id: 'notes', label: 'Call sheet and notes box open' }
      ]
    };
  }

  /* ---------- Showtime: call sheet and live capture (nothing is recorded) ---------- */
  const CAPTURE_KINDS = ['learning', 'commitment', 'concern', 'next_step'];

  // A capture is exactly what the user typed. Owner and due stay null unless the user supplies them.
  function makeCapture(kind, text, opts) {
    const t = String(text || '').trim();
    if (!CAPTURE_KINDS.includes(kind) || !t) return null;
    const o = opts || {};
    return { kind, text: t, owner: String(o.owner || '').trim() || null, due: String(o.due || '').trim() || null, at: typeof o.atMs === 'number' ? o.atMs : null };
  }

  function callSheet(m, conf, summary, agendaText) {
    const agenda = String(agendaText || '').split('\n').map((s) => s.trim()).filter(Boolean);
    const attendees = m.participants.filter((p) => !p.internal).map((p) => ({ name: p.name, role: participantRole(p, conf) }));
    const facts = [];
    if (summary) {
      const d = summary.contract.days;
      if (d != null) facts.push(['Renewal', d >= 0 ? `In ${d} days` : `${-d} days ago`]);
      if (summary.usage.util) facts.push(['Credit use', summary.usage.util]);
      if (summary.tickets.openHigh.length) facts.push(['Open ticket', `${summary.tickets.openHigh[0].id}, ${summary.tickets.openHigh[0].title} (high)`]);
      else if (summary.tickets.open.length) facts.push(['Open tickets', String(summary.tickets.open.length)]);
      facts.push(['Likely mood', `${MOODS[summary.sentiment.mood].label} (inference)`]);
    }
    return { agenda, questions: buildDiscoveryQuestions(m, conf).questions, attendees, facts, hasBrief: !!summary };
  }

  root.MW_LOGIC = {
    CAPTURE_KINDS, makeCapture, callSheet, soundCheck, parseBrief, summarizeBrief, personasFor, MOODS, classifyTopic, rehearsalContext, rehearsalBranches,
    NOW, STALE_DAYS, LIMITS, isStale, isInstructionLike, isOpenEnded, reliable,
    customerView, participantView, participantRole, participantName, speakerName,
    buildDiscoveryQuestions, buildPrepBrief, rolePlayReply, rolePlayFeedback,
    assessOutcomes, buildFollowThrough
  };
})(typeof window !== 'undefined' ? window : globalThis);
