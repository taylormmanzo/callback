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

  function rolePlayFeedback(userMessages) {
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

  root.MW_LOGIC = {
    NOW, STALE_DAYS, LIMITS, isStale, isInstructionLike, isOpenEnded, reliable,
    customerView, participantView, participantRole, participantName, speakerName,
    buildDiscoveryQuestions, buildPrepBrief, rolePlayReply, rolePlayFeedback,
    assessOutcomes, buildFollowThrough
  };
})(typeof window !== 'undefined' ? window : globalThis);
