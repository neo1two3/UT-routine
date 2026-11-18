// Everything the input page does. All data is saved in the visitor's own browser.

const config = CONFIG;
const STORAGE_KEY = "universalTutorial.routineMaker.v1";

let state = { teachers: [], nextId: 1, routine: null, routineOld: false };
let editingId = null;        // id of the teacher being edited, or null
const selected = new Set();  // free periods picked in the table, e.g. "Sunday|0"

const el = (id) => document.getElementById(id);
const slotKey = (day, period) => `${day}|${period}`;

function esc(text) {
  return String(text).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

// "13:20" -> "1:20"
function fmt(time) {
  const [h, m] = time.split(":");
  const hour = Number(h) > 12 ? Number(h) - 12 : Number(h);
  return `${hour}:${m}`;
}

// =====================================================
// SAVING IN THE BROWSER
// =====================================================
function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && Array.isArray(saved.teachers)) {
      state.teachers = saved.teachers;
      state.routine = saved.routine || null;
      state.routineOld = Boolean(saved.routineOld);
      const biggest = state.teachers.reduce((m, t) => Math.max(m, t.id || 0), 0);
      state.nextId = Math.max(saved.nextId || 1, biggest + 1);
    }
  } catch (err) {
    // nothing saved yet, or the browser blocks saving: start empty
  }
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    el("list-msg").textContent = "";
    return true;
  } catch (err) {
    el("list-msg").textContent =
      "Your browser is not letting this page save. Click Download backup so you don't lose your teachers.";
    return false;
  }
}

function addTeacher(values) {
  state.teachers.push({ id: state.nextId++, ...values });
}

function teachersChanged() {
  if (state.routine) state.routineOld = true;
  persist();
  renderTeachers();
  renderRoutine();
}

// =====================================================
// FREE PERIODS TABLE
// =====================================================
function renderGrid() {
  let html = '<table class="avail"><thead><tr><th></th>';
  html += config.days.map((d) => `<th class="pick" data-day="${d}">${d.slice(0, 3)}</th>`).join("");
  html += "</tr></thead><tbody>";

  config.periods.forEach((p, i) => {
    if (i === config.breakAfterPeriod) {
      html += `<tr class="break-row"><th>${fmt(config.break[0])} - ${fmt(config.break[1])}</th>
               <td colspan="${config.days.length}">Tiffin break</td></tr>`;
    }
    html += `<tr><th class="pick" data-period="${i}">Period ${i + 1}<small>${fmt(p[0])} - ${fmt(p[1])}</small></th>`;
    config.days.forEach((day) => {
      const on = selected.has(slotKey(day, i));
      html += `<td><button type="button" class="cell${on ? " on" : ""}" data-day="${day}" data-period="${i}"
               aria-pressed="${on}" aria-label="${day} period ${i + 1}"></button></td>`;
    });
    html += "</tr>";
  });

  el("availability-grid").innerHTML = html + "</tbody></table>";
}

function toggleGroup(keys) {
  const allOn = keys.every((k) => selected.has(k));
  keys.forEach((k) => (allOn ? selected.delete(k) : selected.add(k)));
}

function onGridClick(event) {
  const cell = event.target.closest(".cell");
  const head = event.target.closest(".pick");
  if (cell) {
    toggleGroup([slotKey(cell.dataset.day, Number(cell.dataset.period))]);
  } else if (head && head.dataset.day) {
    toggleGroup(config.periods.map((_, i) => slotKey(head.dataset.day, i)));
  } else if (head) {
    toggleGroup(config.days.map((d) => slotKey(d, Number(head.dataset.period))));
  } else {
    return;
  }
  renderGrid();
  updateSummary();
}

function selectAll(on) {
  selected.clear();
  if (on) config.days.forEach((d) => config.periods.forEach((_, i) => selected.add(slotKey(d, i))));
  renderGrid();
  updateSummary();
}

// =====================================================
// SUBJECT ROWS
// =====================================================
function addAssignmentRow(data = {}) {
  const row = document.createElement("div");
  row.className = "assign-row";
  const options = Array.from({ length: 10 }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join("");
  row.innerHTML = `
    <label>Subject<input class="a-subject" type="text" placeholder="Biology"></label>
    <label>Classes<input class="a-classes" type="text" placeholder="7, 8, 9"></label>
    <label>Periods per week<span class="sub">for each class</span><select class="a-per">${options}</select></label>
    <button type="button" class="icon-btn" title="Remove this subject">✕</button>`;

  row.querySelector(".a-subject").value = data.subject || "";
  row.querySelector(".a-classes").value = (data.classes || []).join(", ");
  row.querySelector(".a-per").value = data.periods_per_week || 2;

  row.querySelector(".icon-btn").onclick = () => {
    row.remove();
    if (!document.querySelector(".assign-row")) addAssignmentRow();
    updateSummary();
  };
  row.addEventListener("input", updateSummary);
  el("assignment-rows").appendChild(row);
  updateSummary();
}

function totalPeriodsInForm() {
  let total = 0;
  document.querySelectorAll(".assign-row").forEach((row) => {
    total += cleanClasses(row.querySelector(".a-classes").value).length * Number(row.querySelector(".a-per").value);
  });
  return total;
}

function updateSummary() {
  const total = totalPeriodsInForm();
  const free = selected.size;
  const box = el("summary");
  box.classList.toggle("bad", total > free);
  box.textContent = total > free
    ? `Periods to teach: ${total}. Free periods picked: ${free}. Pick more free periods or reduce the lessons.`
    : `Periods to teach: ${total}. Free periods picked: ${free}.`;
}

// =====================================================
// SAVE / EDIT TEACHER
// =====================================================
function collectForm() {
  const assignments = [...document.querySelectorAll(".assign-row")].map((row) => ({
    subject: row.querySelector(".a-subject").value.trim(),
    classes: row.querySelector(".a-classes").value,
    periods_per_week: Number(row.querySelector(".a-per").value),
  }));
  const availability = [...selected].map((k) => {
    const [day, period] = k.split("|");
    return { day, period: Number(period) };
  });
  return { name: el("name").value, assignments, availability };
}

function resetForm() {
  editingId = null;
  el("name").value = "";
  el("assignment-rows").innerHTML = "";
  addAssignmentRow();
  selected.clear();
  renderGrid();
  updateSummary();
  el("form-msg").textContent = "";
  el("form-title").textContent = "1. Add a teacher";
  el("save-teacher").textContent = "Save teacher";
  el("cancel-edit").hidden = true;
}

function saveTeacher() {
  el("form-msg").textContent = "";
  const result = readTeacher(collectForm());
  if (result.error) {
    el("form-msg").textContent = result.error;
    return;
  }
  const index = editingId ? state.teachers.findIndex((t) => t.id === editingId) : -1;
  if (index >= 0) {
    state.teachers[index] = { id: editingId, ...result };
  } else {
    addTeacher(result);
  }
  teachersChanged();
  resetForm();
}

function startEdit(id) {
  const teacher = state.teachers.find((t) => t.id === id);
  if (!teacher) return;
  editingId = id;
  el("name").value = teacher.name;
  el("assignment-rows").innerHTML = "";
  teacher.assignments.forEach((a) => addAssignmentRow(a));
  selected.clear();
  teacher.availability.forEach((a) => selected.add(slotKey(a.day, a.period)));
  renderGrid();
  updateSummary();
  el("form-msg").textContent = "";
  el("form-title").textContent = `Edit ${teacher.name}`;
  el("save-teacher").textContent = "Save changes";
  el("cancel-edit").hidden = false;
  el("name").scrollIntoView({ behavior: "smooth", block: "center" });
}

// =====================================================
// SAMPLE DATA (so people can try the site quickly)
// =====================================================
function loadSample() {
  if (state.teachers.length && !confirm("This adds 3 sample teachers to your list. Continue?")) return;
  const slots = (days, periods) => days.flatMap((day) => periods.map((period) => ({ day, period })));
  const d = config.days;
  const samples = [
    {
      name: "Ms Fareen",
      assignments: [
        { subject: "Biology", classes: "7, 8, 9", periods_per_week: 2 },
        { subject: "Science", classes: "6", periods_per_week: 3 },
      ],
      availability: [...slots([d[0], d[1]], [0, 1, 2]), ...slots([d[2], d[3]], [3, 4])],
    },
    {
      name: "Mr Rahim",
      assignments: [{ subject: "Math", classes: "6, 7, 8, 9", periods_per_week: 3 }],
      availability: slots(d, [0, 1, 2]),
    },
    {
      name: "Ms Nusrat",
      assignments: [{ subject: "English", classes: "6, 7, 8, 9", periods_per_week: 4 }],
      availability: slots(d, [0, 1, 2, 3, 4]),
    },
  ];
  samples.forEach((s) => addTeacher(readTeacher(s)));
  teachersChanged();
}

// =====================================================
// BACKUP
// =====================================================
function downloadBackup() {
  const data = {
    app: "universal-tutorial-routine-maker",
    version: 1,
    teachers: state.teachers.map(({ id, ...rest }) => rest),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "routine-teachers-backup.json";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function restoreBackup(file) {
  const msg = el("list-msg");
  msg.textContent = "";
  try {
    const data = JSON.parse(await file.text());
    const list = Array.isArray(data) ? data : data.teachers;
    if (!Array.isArray(list)) throw new Error("This is not a backup file from this website.");
    const cleaned = list.map((t) => {
      const result = readTeacher(t);
      if (result.error) throw new Error(result.error);
      return result;
    });
    if (state.teachers.length &&
        !confirm(`Replace the ${state.teachers.length} teacher(s) on this page with the ${cleaned.length} from the backup?`)) {
      return;
    }
    state.teachers = [];
    state.nextId = 1;
    cleaned.forEach(addTeacher);
    if (editingId) resetForm();
    teachersChanged();
  } catch (err) {
    msg.textContent = "Could not restore that file. " + (err.message || "");
  }
}

function deleteAll() {
  if (!state.teachers.length) return;
  if (!confirm("Delete all teachers and the routine? This cannot be undone.")) return;
  state.teachers = [];
  state.routine = null;
  state.routineOld = false;
  if (editingId) resetForm();
  persist();
  renderTeachers();
  renderRoutine();
}

// =====================================================
// TEACHER LIST
// =====================================================
function freeText(teacher) {
  return config.days.map((day) => {
    const periods = teacher.availability.filter((a) => a.day === day).map((a) => a.period).sort((x, y) => x - y);
    if (periods.length === 0) return null;
    const text = periods.length === config.periods.length ? "all" : periods.map((p) => p + 1).join(", ");
    return `${day.slice(0, 3)}: ${text}`;
  }).filter(Boolean).join(" · ");
}

function renderTeachers() {
  if (state.teachers.length === 0) {
    el("teacher-list").innerHTML =
      "<p class='muted'>No teachers yet. Fill in the form and click Save teacher, or click Try sample data.</p>";
    return;
  }
  el("teacher-list").innerHTML = state.teachers.map((t) => {
    const lines = t.assignments.map((a) =>
      `<li><b>${esc(a.subject)}</b>: Class ${esc(a.classes.join(", "))}
       <span class="muted">(${a.periods_per_week} per week each)</span></li>`).join("");
    return `
      <div class="teacher">
        <div>
          <h4>${esc(t.name)}</h4>
          <ul>${lines}</ul>
          <p class="free">Free periods: ${esc(freeText(t))}</p>
        </div>
        <div class="t-actions">
          <button type="button" class="small secondary" data-edit="${t.id}">Edit</button>
          <button type="button" class="small danger" data-del="${t.id}">Delete</button>
        </div>
      </div>`;
  }).join("");

  document.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.onclick = () => startEdit(Number(btn.dataset.edit));
  });
  document.querySelectorAll("[data-del]").forEach((btn) => {
    btn.onclick = () => {
      const id = Number(btn.dataset.del);
      const teacher = state.teachers.find((t) => t.id === id);
      if (!teacher || !confirm(`Delete ${teacher.name}?`)) return;
      state.teachers = state.teachers.filter((t) => t.id !== id);
      if (editingId === id) resetForm();
      teachersChanged();
    };
  });
}

// =====================================================
// ROUTINE
// =====================================================
function generate() {
  if (state.teachers.length === 0) {
    el("warnings").innerHTML = '<div class="notice warn">Add at least one teacher first.</div>';
    return;
  }
  state.routine = generateRoutine(state.teachers);
  state.routineOld = false;
  persist();
  renderRoutine();
}

// each subject gets its own soft color
function subjectStyle(subject) {
  let hue = 0;
  for (const ch of subject.toLowerCase()) hue = (hue * 31 + ch.charCodeAt(0)) % 360;
  return `background:hsl(${hue} 70% 93%);border-left:4px solid hsl(${hue} 55% 55%)`;
}

function renderRoutine() {
  const routine = state.routine;
  if (!routine || !routine.entries) {
    el("routine").innerHTML = "<p class='muted'>No routine yet. Add teachers, then click Generate routine.</p>";
    el("warnings").innerHTML = "";
    return;
  }

  let notes = "";
  if (state.routineOld) {
    notes += `<div class="notice info">Teachers have changed since this routine was made. Click Generate routine to update it.</div>`;
  }
  notes += routine.unplaced.length
    ? `<div class="notice warn"><b>Placed ${routine.placed} of ${routine.total} periods. These need attention:</b>
       <ul>${routine.unplaced.map((m) => `<li>${esc(m)}</li>`).join("")}</ul></div>`
    : `<div class="notice ok">All ${routine.total} periods placed ✔</div>`;
  el("warnings").innerHTML = notes;

  const mode = el("view-mode").value;
  const keyOf = (e) => (mode === "class" ? e.class : e.teacher);
  const keys = [...new Set(routine.entries.map(keyOf))]
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  el("routine").innerHTML = keys
    .map((k) => buildTable(k, routine.entries.filter((e) => keyOf(e) === k), mode))
    .join("");
}

function buildTable(key, entries, mode) {
  const title = mode === "class" ? `Class ${key}` : key;
  let html = `<div class="routine-block"><h3>${esc(title)}</h3><div class="routine-scroll">
    <table class="routine"><thead><tr><th>Period</th>`;
  html += config.days.map((d) => `<th>${d}</th>`).join("") + "</tr></thead><tbody>";

  config.periods.forEach((period, i) => {
    if (i === config.breakAfterPeriod) {
      html += `<tr class="break"><td>${fmt(config.break[0])} - ${fmt(config.break[1])}</td>
               <td colspan="${config.days.length}">Tiffin break</td></tr>`;
    }
    html += `<tr><th>Period ${i + 1}<small>${fmt(period[0])} - ${fmt(period[1])}</small></th>`;
    config.days.forEach((day) => {
      const e = entries.find((x) => x.day === day && x.period === i);
      let cell = "";
      if (e) {
        cell = mode === "class"
          ? `<div class="lesson" style="${subjectStyle(e.subject)}"><b>${esc(e.subject)}</b><span>${esc(e.teacher)}</span></div>`
          : `<div class="lesson" style="${subjectStyle(e.subject)}"><b>${esc(e.subject)}</b><span>Class ${esc(e.class)}</span></div>`;
      }
      html += `<td>${cell}</td>`;
    });
    html += "</tr>";
  });

  return html + "</tbody></table></div></div>";
}

// =====================================================
// START
// =====================================================
function start() {
  loadState();
  el("availability-grid").addEventListener("click", onGridClick);
  el("add-assignment").onclick = () => addAssignmentRow();
  el("select-all").onclick = () => selectAll(true);
  el("clear-all").onclick = () => selectAll(false);
  el("save-teacher").onclick = saveTeacher;
  el("cancel-edit").onclick = resetForm;
  el("load-sample").onclick = loadSample;
  el("generate").onclick = generate;
  el("view-mode").onchange = renderRoutine;
  el("print").onclick = () => window.print();
  el("download-backup").onclick = downloadBackup;
  el("restore-backup").onclick = () => el("backup-file").click();
  el("backup-file").onchange = (e) => {
    if (e.target.files[0]) restoreBackup(e.target.files[0]);
    e.target.value = "";
  };
  el("delete-all").onclick = deleteAll;

  resetForm();
  renderTeachers();
  renderRoutine();
}

start();
