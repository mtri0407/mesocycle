// Two advisors for a hard choice. When work must give way, one model instance
// argues for deadlines and commitments, another for sleep, health and people.
// They run at the same time and see only candidates that code has already
// checked, with no tools, so neither can break a rule or change the plan.
// If they agree, the app says so: they are never made to disagree.
import { noDashes } from './agent.js';

const SHARED = `A day no longer fits and something must move to debt: it is kept and
done later, not lost. Choose the one option you would defend. Only choose
from the options given. Give one short reason, spoken to the person as "you",
naming what it protects. No blame, no guilt, no advice about health or
training. Never use em dashes or en dashes.`;

export const GUARDIANS = {
  deadline: `You are the Deadline Guardian in a planning app. You protect exams, due dates and commitments to other people.\n\n${SHARED}`,
  life: `You are the Life Guardian in a planning app. You protect sleep, health, family and friends, the things people sacrifice first.\n\n${SHARED}`,
};

export const COUNCIL_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'pick',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: { option: { type: 'integer' }, why: { type: 'string' } },
      required: ['option', 'why'],
    },
  },
};

const LANGUAGE = { vi: 'Vietnamese', en: 'English' };

function brief(candidates, deadlines) {
  return JSON.stringify({
    deadlinesAhead: (deadlines || []).map((d) => ({ title: d.title, date: d.date, safe: d.ok })),
    options: candidates.map((c, i) => ({
      option: i + 1,
      movesToDebt: c.titles,
      minutes: c.minutes,
      minutesFromLifeRoles: c.lifeMin,
      minutesFromWork: c.workMin,
    })),
  });
}

// ask(system, user) -> the model's text. Injected so tests never spend credits.
export async function runCouncil({ candidates, deadlines = [], lang = 'en', ask, onPick = () => {} }) {
  if (!candidates.length) return null;
  const user = `Answer in ${LANGUAGE[lang] || 'English'}.\n${brief(candidates, deadlines)}`;
  const pick = async (by) => {
    try {
      const { option, why } = JSON.parse(await ask(GUARDIANS[by], user));
      const chosen = candidates[option - 1];
      if (!chosen || typeof why !== 'string' || !why.trim()) return null; // invented option: ignored
      const out = { by, chosen, why: noDashes(why.trim()) };
      onPick(out);
      return out;
    } catch { return null; }
  };
  const [deadline, life] = await Promise.all([pick('deadline'), pick('life')]);
  const picks = [deadline, life].filter(Boolean);
  if (!picks.length) return null;

  const card = (p, by = p.by, why = p.why) => ({ ids: p.chosen.ids, by, why });
  // Someone else's alternative, so the person always has a real second option.
  const otherThan = (c) => candidates.find((x) => x !== c);
  const codeCard = (c) => (c ? { ids: c.ids, by: 'code', why: '' } : null);

  if (picks.length === 2 && deadline.chosen === life.chosen) {
    const options = [{ ids: deadline.chosen.ids, by: 'both', why: `${deadline.why} ${life.why}`, suggested: true }, codeCard(otherThan(deadline.chosen))].filter(Boolean);
    return { agreed: true, options };
  }
  if (picks.length === 1) {
    const options = [{ ...card(picks[0]), suggested: true }, codeCard(otherThan(picks[0].chosen))].filter(Boolean);
    return { agreed: false, options };
  }
  // A real disagreement: the gentler one on people goes first, as the suggestion.
  const lifeFirst = life.chosen.lifeMin <= deadline.chosen.lifeMin;
  const [a, b] = lifeFirst ? [life, deadline] : [deadline, life];
  return { agreed: false, options: [{ ...card(a), suggested: true }, card(b)] };
}
