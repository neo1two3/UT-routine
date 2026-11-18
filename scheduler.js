// The "brain": checks the form and places every lesson into a free period.
//
// Rules it follows:
//   1. A teacher only teaches in the periods they marked as free.
//   2. A teacher is never in two places at once.
//   3. A class never has two lessons in the same period.
//   4. It spreads lessons over different days where it can.

const MAX_PER_WEEK = 10;
const ATTEMPTS = 400; // it tries many times and keeps the best result

// ---------- checking the teacher form ----------
function cleanClasses(value) {
  const parts = Array.isArray(value) ? value : String(value || "").split(",");
  const result = [];
  for (const item of parts) {
    const name = String(item).trim().replace(/^class\s*/i, "").trim();
    if (name && !result.includes(name)) result.push(name);
  }
  return result;
}

// Returns { name, assignments, availability } or { error: "..." }
function readTeacher(data) {
  const name = String(data.name || "").trim();
  if (!name) return { error: "Please enter the teacher's name." };

  const assignments = [];
  for (const row of data.assignments || []) {
    const subject = String(row.subject || "").trim();
    const classes = cleanClasses(row.classes);
    if (!subject && classes.length === 0) continue; // empty row, ignore it
    if (!subject) return { error: "Every row needs a subject." };
    if (classes.length === 0) return { error: `Please enter the classes for ${subject}, e.g. 7, 8.` };
    const perWeek = parseInt(row.periods_per_week, 10);
    if (!(perWeek >= 1 && perWeek <= MAX_PER_WEEK)) {
      return { error: `Periods per week for ${subject} must be between 1 and ${MAX_PER_WEEK}.` };
    }
    assignments.push({ subject, classes, periods_per_week: perWeek });
  }
  if (assignments.length === 0) return { error: "Please add at least one subject with its classes." };

  const availability = [];
  const seen = new Set();
  for (const slot of data.availability || []) {
    const valid =
      CONFIG.days.includes(slot.day) &&
      Number.isInteger(slot.period) &&
      slot.period >= 0 &&
      slot.period < CONFIG.periods.length;
    if (!valid) return { error: "Something is wrong with the selected free periods." };
    const key = `${slot.day}|${slot.period}`;
    if (!seen.has(key)) {
      seen.add(key);
      availability.push({ day: slot.day, period: slot.period });
    }
  }
  if (availability.length === 0) return { error: "Please click at least one free period in the table." };

  return { name, assignments, availability };
}

// ---------- making the routine ----------
const DAY_INDEX = Object.fromEntries(CONFIG.days.map((d, i) => [d, i]));
const joinKey = (...parts) => parts.join("\u0001");

// small random number generator (same numbers every time for the same seed)
function seededRandom(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// One lesson for every period a teacher must teach each class per week
function makeLessons(teachers) {
  const lessons = [];
  for (const teacher of teachers) {
    const slots = teacher.availability
      .map((a) => ({ day: a.day, period: a.period }))
      .sort((x, y) => DAY_INDEX[x.day] - DAY_INDEX[y.day] || x.period - y.period);
    const start = lessons.length;
    for (const assignment of teacher.assignments) {
      for (const className of assignment.classes) {
        for (let n = 0; n < assignment.periods_per_week; n++) {
          lessons.push({ teacher, subject: assignment.subject, class: className, slots });
        }
      }
    }
    const total = lessons.length - start;
    for (let i = start; i < lessons.length; i++) lessons[i].teacherTotal = total;
  }
  return lessons;
}

function oneAttempt(lessons, rng) {
  // Teachers with the tightest timetable go first
  const order = lessons
    .map((l) => ({ l, tie: rng() }))
    .sort(
      (a, b) =>
        a.l.slots.length - a.l.teacherTotal - (b.l.slots.length - b.l.teacherTotal) || a.tie - b.tie
    )
    .map((o) => o.l);

  const teacherBusy = new Set();
  const classBusy = new Set();
  const subjectDay = new Map();
  const teacherDay = new Map();
  const classDay = new Map();
  const count = (map, key) => map.get(key) || 0;
  const bump = (map, key) => map.set(key, count(map, key) + 1);
  const placed = [];
  const unplaced = [];

  for (const lesson of order) {
    const { teacher, subject } = lesson;
    const className = lesson.class;

    const choices = lesson.slots.filter(
      (s) =>
        !teacherBusy.has(joinKey(teacher.id, s.day, s.period)) &&
        !classBusy.has(joinKey(className, s.day, s.period))
    );
    if (choices.length === 0) {
      unplaced.push(lesson);
      continue;
    }

    let best = null;
    let bestScore = Infinity;
    for (const s of choices) {
      const score =
        count(subjectDay, joinKey(className, subject, s.day)) * 10 +
        count(teacherDay, joinKey(teacher.id, s.day)) * 2 +
        count(classDay, joinKey(className, s.day)) +
        rng();
      if (score < bestScore) {
        bestScore = score;
        best = s;
      }
    }

    teacherBusy.add(joinKey(teacher.id, best.day, best.period));
    classBusy.add(joinKey(className, best.day, best.period));
    bump(subjectDay, joinKey(className, subject, best.day));
    bump(teacherDay, joinKey(teacher.id, best.day));
    bump(classDay, joinKey(className, best.day));
    placed.push({
      day: best.day,
      period: best.period,
      class: className,
      subject,
      teacher: teacher.name,
    });
  }
  return { placed, unplaced };
}

// Plain-English messages about what could not be placed and why
function explainProblems(teachers, lessons, unplaced) {
  const messages = [];

  for (const teacher of teachers) {
    const total = lessons.filter((l) => l.teacher.id === teacher.id).length;
    const free = teacher.availability.length;
    if (total > free) {
      messages.push(`${teacher.name} has ${total} periods to teach but marked only ${free} free periods.`);
    }
  }

  const maxSlots = CONFIG.days.length * CONFIG.periods.length;
  const classTotals = {};
  for (const l of lessons) classTotals[l.class] = (classTotals[l.class] || 0) + 1;
  Object.keys(classTotals)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .forEach((c) => {
      if (classTotals[c] > maxSlots) {
        messages.push(`Class ${c} has ${classTotals[c]} periods but a week only has ${maxSlots}.`);
      }
    });

  const groups = new Map();
  for (const l of unplaced) {
    const key = joinKey(l.teacher.name, l.subject, l.class);
    groups.set(key, (groups.get(key) || 0) + 1);
  }
  for (const [key, n] of groups) {
    const [name, subject, className] = key.split("\u0001");
    messages.push(
      `${name}, ${subject}, Class ${className}: ${n} period(s) could not be placed ` +
        "(no free period left that does not clash with other lessons). Add more free periods or reduce the lessons."
    );
  }
  return messages;
}

function generateRoutine(teachers) {
  const lessons = makeLessons(teachers);
  let best = { placed: [], unplaced: lessons };

  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const result = oneAttempt(lessons, seededRandom(attempt + 1));
    if (attempt === 0 || result.unplaced.length < best.unplaced.length) best = result;
    if (best.unplaced.length === 0) break;
  }

  return {
    entries: best.placed,
    unplaced: best.unplaced.length ? explainProblems(teachers, lessons, best.unplaced) : [],
    total: lessons.length,
    placed: best.placed.length,
  };
}
