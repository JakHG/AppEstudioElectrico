/* Estudio Eléctrico — lógica de la app (JS puro, sin dependencias) */
'use strict';

const APP_VERSION = '0.3.0';
const META_RACHA = 2;   // aciertos seguidos para sacar una tarjeta de "No sé"
const KEY_PROGRESS = 'aee.progress.v1';
const KEY_SETTINGS = 'aee.settings.v1';
const KEY_REPORTS = 'aee.reports.v1';

/* ---------- Almacenamiento seguro ---------- */
const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.warn('No se pudo guardar en localStorage', e);
    }
  }
};

/* ---------- Estado ---------- */
const state = {
  exams: [],
  examId: null,
  temaId: null,
  cards: [],          // tarjetas del tema actual
  deck: [],           // tarjetas filtradas y barajadas
  pos: 0,
  flipped: false,
  view: 'tarjetas',
  settings: store.get(KEY_SETTINGS, { examId: 'denko2', lectura: false, categoria: '', modo: 'todas' }),
  progress: store.get(KEY_PROGRESS, {}),
  reports: store.get(KEY_REPORTS, [])
};

const $ = (sel) => document.querySelector(sel);
const el = (tag, attrs = {}, text) => {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
  if (text !== undefined) node.textContent = text;
  return node;
};

/* ---------- Progreso ---------- */
function temaProgress(examId, temaId) {
  state.progress[examId] ??= {};
  state.progress[examId][temaId] ??= {};
  return state.progress[examId][temaId];
}

/* Registra la respuesta y devuelve el registro actualizado.
 * - "No sé": la tarjeta queda "por aprender" (estado nose) y su racha vuelve a 0.
 * - "Sé": suma racha. Si la tarjeta estaba por aprender, solo pasa a "sé"
 *   después de META_RACHA aciertos seguidos. Una tarjeta nueva que ya sabes pasa directo. */
function marcar(card, respuesta) {
  const p = temaProgress(state.examId, state.temaId);
  const prev = p[card.id] || { veces: 0, racha: 0, fallos: 0 };
  const racha = respuesta === 'se' ? (prev.racha || 0) + 1 : 0;
  let estado;
  if (respuesta === 'nose') estado = 'nose';
  else if (prev.estado === 'nose' && racha < META_RACHA) estado = 'nose';
  else estado = 'se';
  p[card.id] = {
    estado,
    racha,
    veces: (prev.veces || 0) + 1,
    fallos: (prev.fallos || 0) + (respuesta === 'nose' ? 1 : 0),
    ultima: new Date().toISOString().slice(0, 10)
  };
  store.set(KEY_PROGRESS, state.progress);
  return p[card.id];
}

/* ---------- Carga de datos ---------- */
async function loadJSON(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`No se pudo cargar ${path} (${res.status})`);
  return res.json();
}

async function init() {
  $('#app-version').textContent = 'v' + APP_VERSION;
  updateNetStatus();
  window.addEventListener('online', updateNetStatus);
  window.addEventListener('offline', updateNetStatus);

  try {
    const data = await loadJSON('data/exams.json');
    state.exams = data.examenes;
  } catch (e) {
    $('#exam-info').textContent = 'Error al cargar los datos. Revisa la conexión y recarga.';
    console.error(e);
    return;
  }

  renderExamSelector();
  bindUI();
  const saved = state.exams.find((x) => x.id === state.settings.examId);
  await selectExam(saved ? saved.id : state.exams[0].id);

  registerSW();
}

function updateNetStatus() {
  $('#net-status').textContent = navigator.onLine ? '' : 'Sin conexión · modo offline';
}

/* ---------- Selector de examen ---------- */
function renderExamSelector() {
  const nav = $('#exam-selector');
  nav.innerHTML = '';
  state.exams.forEach((ex) => {
    const b = el('button', { type: 'button', class: 'exam-btn', 'data-exam': ex.id, 'aria-pressed': 'false' }, ex.corto);
    b.addEventListener('click', () => selectExam(ex.id));
    nav.appendChild(b);
  });
}

async function selectExam(examId) {
  state.examId = examId;
  state.settings.examId = examId;
  store.set(KEY_SETTINGS, state.settings);

  document.querySelectorAll('.exam-btn').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.exam === examId));
  });

  const ex = currentExam();
  const info = $('#exam-info');
  info.innerHTML = '';
  info.appendChild(el('h2', {}, ex.nombre));
  info.appendChild(el('p', { class: 'reading' }, ex.lectura + ' · objetivo ' + ex.objetivo));
  info.appendChild(el('p', { class: 'summary' }, ex.resumen));

  const tema = ex.temas[0];
  if (tema) {
    state.temaId = tema.id;
    try {
      const data = await loadJSON(tema.archivo);
      state.cards = data.tarjetas;
      fillCategoryFilter(data.categorias);
    } catch (e) {
      console.error(e);
      state.cards = [];
    }
  } else {
    state.temaId = null;
    state.cards = [];
  }

  $('#tarjetas-empty').hidden = state.cards.length > 0;
  $('#tarjetas-body').hidden = state.cards.length === 0;

  buildDeck();
  renderView();
}

function currentExam() {
  return state.exams.find((x) => x.id === state.examId);
}

/* ---------- Filtros y mazo ---------- */
function fillCategoryFilter(categorias = []) {
  const sel = $('#f-categoria');
  sel.innerHTML = '';
  sel.appendChild(el('option', { value: '' }, 'Todas'));
  categorias.forEach((c) => sel.appendChild(el('option', { value: c }, c)));
  if (!categorias.includes(state.settings.categoria)) state.settings.categoria = '';
  sel.value = state.settings.categoria;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildDeck() {
  const { categoria, modo } = state.settings;
  const p = state.temaId ? temaProgress(state.examId, state.temaId) : {};
  const filtered = state.cards.filter((c) => {
    if (categoria && c.categoria !== categoria) return false;
    if (modo === 'sinver') return !p[c.id];
    if (modo === 'nose') return p[c.id] && p[c.id].estado === 'nose';
    return true;
  });
  // Orden: primero las "por aprender" (las más falladas antes), luego las nuevas, al final las que ya sabes.
  const porAprender = shuffle(filtered.filter((c) => p[c.id] && p[c.id].estado === 'nose'))
    .sort((a, b) => (p[b.id].fallos || 0) - (p[a.id].fallos || 0));
  const nuevas = shuffle(filtered.filter((c) => !p[c.id]));
  const sabidas = shuffle(filtered.filter((c) => p[c.id] && p[c.id].estado === 'se'));
  state.deck = [...porAprender, ...nuevas, ...sabidas];
  state.pos = 0;
  state.flipped = false;
  state.revealing = false;
  renderCard();
}

/* Vuelve a meter la tarjeta en el mazo unas posiciones más adelante. */
function requeue(card, gap) {
  // Quitar una copia pendiente para no duplicarla
  for (let i = state.deck.length - 1; i > state.pos; i--) {
    if (state.deck[i].id === card.id) state.deck.splice(i, 1);
  }
  const at = Math.min(state.pos + 1 + gap, state.deck.length);
  state.deck.splice(at, 0, card);
}

/* ---------- Tarjeta ---------- */
function renderCard() {
  const done = state.pos >= state.deck.length;
  $('#card').hidden = done;
  document.querySelector('.answer-bar').hidden = done;
  $('#deck-done').hidden = !done || state.cards.length === 0;
  $('#deck-pos').textContent = `${Math.min(state.pos + 1, state.deck.length)} / ${state.deck.length}`;
  if (done) return;

  const c = state.deck[state.pos];
  const card = $('#card');
  card.classList.toggle('is-flipped', state.flipped);
  card.querySelector('.card-back').hidden = !state.flipped;

  $('#c-cat').textContent = c.categoria;
  $('#c-flag').hidden = !c.verificar;
  const reg = temaProgress(state.examId, state.temaId)[c.id];
  const repaso = $('#c-repaso');
  repaso.hidden = !(reg && reg.estado === 'nose');
  if (reg && reg.estado === 'nose') repaso.textContent = `Repaso · ${reg.racha || 0}/${META_RACHA}`;
  // Tarjeta con símbolo: el frente muestra solo el dibujo (práctica de reconocimiento);
  // el nombre aparece al girarla.
  const soloSimbolo = Boolean(c.imagen);
  $('#c-term').textContent = c.termino;
  $('#c-term').hidden = soloSimbolo;
  $('#c-term-back').textContent = c.termino;
  $('#c-term-back').hidden = !soloSimbolo;
  $('#c-hint').textContent = soloSimbolo ? '¿Qué símbolo es? Toca para ver la respuesta' : 'Toca para ver la respuesta';
  $('#c-reading-front').textContent = c.lectura;
  $('#c-reading-front').hidden = soloSimbolo || !state.settings.lectura || state.flipped;

  const img = $('#c-img');
  if (c.imagen) {
    img.src = c.imagen;
    img.alt = 'Símbolo de ' + c.termino;
    img.hidden = false;
  } else {
    img.removeAttribute('src');
    img.hidden = true;
  }

  $('#c-revela').hidden = !state.revealing;
  $('#c-es').textContent = c.es || '';
  $('#c-reading').textContent = c.lectura;
  $('#c-meaning').textContent = c.significado;
  // Si el significado solo repite el término en español, no mostrarlo dos veces
  const norm = (t) => (t || '').replace(/[.。]\s*$/, '').trim().toLowerCase();
  $('#c-meaning').hidden = norm(c.significado) === norm(c.es);
  $('#c-use').textContent = c.uso;
  $('#btn-se').hidden = state.revealing;
  $('#btn-nose').hidden = state.revealing;
  $('#btn-next').hidden = !state.revealing;

  // Verificación y fuentes
  const fuentes = c.fuentes || [];
  const status = $('#c-src-status');
  if (c.verificacion === 'fuente') {
    status.textContent = '✓ Verificado con fuente';
    status.className = 'src-status ok';
  } else if (c.verificacion === 'parcial') {
    status.textContent = '⚠ Verificación parcial';
    status.className = 'src-status warn';
  } else {
    status.textContent = '⚠ Sin verificar';
    status.className = 'src-status warn';
  }
  $('#c-src-summary').textContent = `Fuentes (${fuentes.length})`;
  $('#c-src-details').hidden = fuentes.length === 0;
  $('#c-src-details').open = false;
  const list = $('#c-src-list');
  list.innerHTML = '';
  fuentes.forEach((f) => {
    const li = el('li');
    if (f.url) li.appendChild(el('a', { href: f.url, target: '_blank', rel: 'noopener' }, f.texto));
    else li.textContent = f.texto;
    list.appendChild(li);
  });
  const ya = state.reports.some((r) => r.id === c.id);
  $('#btn-report').textContent = ya ? 'Error reportado ✓ (agregar otro)' : 'Reportar error';

  const note = $('#c-note');
  note.textContent = c.nota ? '⚠ ' + c.nota : '';
  note.hidden = !c.nota;
}

function flip() {
  if (state.revealing) return;
  state.flipped = !state.flipped;
  renderCard();
}

function answer(respuesta) {
  const c = state.deck[state.pos];
  if (!c || state.revealing) return;
  const reg = marcar(c, respuesta);

  if (respuesta === 'nose') {
    requeue(c, 4);                 // vuelve pronto
    if (!state.flipped) {          // mostrar qué es antes de seguir
      state.flipped = true;
      state.revealing = true;
      renderCard();
      $('#card').scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
  } else if (reg.estado === 'nose') {
    requeue(c, 8);                 // la estás aprendiendo: vuelve más tarde
  }
  next();
}

function next() {
  state.pos += 1;
  state.flipped = false;
  state.revealing = false;
  renderCard();
}

/* ---------- Reportes de error ---------- */
function reportar() {
  const c = state.deck[state.pos];
  if (!c) return;
  const texto = prompt(`¿Qué está mal en «${c.termino}»?\n(término, lectura, significado, uso o símbolo)`);
  if (!texto || !texto.trim()) return;
  state.reports.push({
    id: c.id,
    termino: c.termino,
    texto: texto.trim(),
    fecha: new Date().toISOString().slice(0, 10)
  });
  store.set(KEY_REPORTS, state.reports);
  renderCard();
}

function renderReports() {
  const list = $('#reports-list');
  list.innerHTML = '';
  $('#reports-count').textContent = String(state.reports.length);
  $('#reports-empty').hidden = state.reports.length > 0;
  $('#reports-actions').hidden = state.reports.length === 0;
  state.reports.forEach((r) => {
    const li = el('li');
    li.appendChild(el('b', {}, `${r.id} · ${r.termino}`));
    li.appendChild(el('span', {}, r.texto));
    list.appendChild(li);
  });
}

async function copiarReportes() {
  const txt = state.reports.map((r) => `- ${r.id} (${r.termino}) [${r.fecha}]: ${r.texto}`).join('\n');
  try {
    await navigator.clipboard.writeText('Errores reportados en la app:\n' + txt);
    $('#btn-reports-copy').textContent = 'Copiado ✓';
    setTimeout(() => { $('#btn-reports-copy').textContent = 'Copiar reportes'; }, 1500);
  } catch (e) {
    prompt('Copia este texto:', txt);
  }
}

/* ---------- Vistas ---------- */
function setView(view) {
  state.view = view;
  document.querySelectorAll('.tab').forEach((t) => {
    t.setAttribute('aria-selected', String(t.dataset.view === view));
  });
  renderView();
}

function renderView() {
  ['tarjetas', 'progreso', 'enlaces', 'pronto'].forEach((v) => {
    $('#view-' + v).hidden = v !== state.view;
  });
  if (state.view === 'progreso') { renderProgress(); renderReports(); }
  if (state.view === 'enlaces') renderLinks();
}

function renderProgress() {
  const body = $('#progreso-body');
  body.innerHTML = '';
  if (!state.cards.length) {
    body.appendChild(el('p', { class: 'empty' }, 'Todavía no hay contenido para este examen.'));
    $('#btn-reset').hidden = true;
    return;
  }
  $('#btn-reset').hidden = false;

  const p = temaProgress(state.examId, state.temaId);
  const count = (list) => {
    let se = 0, nose = 0;
    list.forEach((c) => {
      const r = p[c.id];
      if (r && r.estado === 'se') se++;
      else if (r && r.estado === 'nose') nose++;
    });
    return { se, nose, sin: list.length - se - nose, total: list.length };
  };

  const t = count(state.cards);
  const grid = el('div', { class: 'stat-grid' });
  [['se', t.se, 'Sé'], ['nose', t.nose, 'Por aprender'], ['', t.sin, 'Sin ver']].forEach(([cls, n, label]) => {
    const s = el('div', { class: 'stat ' + cls });
    s.appendChild(el('b', {}, String(n)));
    s.appendChild(el('span', {}, label));
    grid.appendChild(s);
  });
  body.appendChild(grid);
  body.appendChild(makeBar(t));
  body.appendChild(el('p', { class: 'prog-note' },
    `Una tarjeta que marcas No sé vuelve a salir hasta que aciertes ${META_RACHA} veces seguidas.`));

  const cats = [...new Set(state.cards.map((c) => c.categoria))];
  cats.forEach((cat) => {
    const r = count(state.cards.filter((c) => c.categoria === cat));
    const row = el('div', { class: 'cat-row' });
    row.appendChild(el('span', {}, cat));
    row.appendChild(el('span', {}, `${r.se}/${r.total}`));
    body.appendChild(row);
    body.appendChild(makeBar(r));
  });
}

function makeBar({ se, nose, total }) {
  const bar = el('div', { class: 'bar', role: 'img', 'aria-label': `${se} sé, ${nose} no sé de ${total}` });
  const a = el('i', { class: 'b-se' });
  a.style.width = (total ? (se / total) * 100 : 0) + '%';
  const b = el('i', { class: 'b-nose' });
  b.style.width = (total ? (nose / total) * 100 : 0) + '%';
  bar.append(a, b);
  return bar;
}

function renderLinks() {
  const body = $('#enlaces-body');
  body.innerHTML = '';
  const ex = currentExam();
  if (!ex.enlaces.length) {
    body.appendChild(el('p', { class: 'empty' }, 'Enlaces oficiales pendientes para este examen.'));
    return;
  }
  ex.enlaces.forEach((g) => {
    const box = el('div', { class: 'link-group' });
    box.appendChild(el('h3', {}, g.grupo));
    const ul = el('ul');
    g.items.forEach((it) => {
      const li = el('li');
      li.appendChild(el('a', { href: it.url, target: '_blank', rel: 'noopener' }, it.texto));
      ul.appendChild(li);
    });
    box.appendChild(ul);
    body.appendChild(box);
  });
}

/* ---------- Eventos ---------- */
function bindUI() {
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => setView(t.dataset.view)));

  $('#card').addEventListener('click', flip);
  $('#card').addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); flip(); }
  });
  $('#btn-se').addEventListener('click', () => answer('se'));
  $('#btn-nose').addEventListener('click', () => answer('nose'));
  $('#btn-next').addEventListener('click', next);
  // Dentro del reverso: no girar la tarjeta al tocar fuentes o reportar
  $('#c-src').addEventListener('click', (e) => e.stopPropagation());
  $('#btn-report').addEventListener('click', reportar);
  $('#btn-reports-copy').addEventListener('click', copiarReportes);
  $('#btn-reports-clear').addEventListener('click', () => {
    if (!confirm('¿Borrar todos los reportes?')) return;
    state.reports = [];
    store.set(KEY_REPORTS, state.reports);
    renderReports();
  });
  $('#btn-barajar').addEventListener('click', buildDeck);
  $('#btn-reiniciar').addEventListener('click', () => {
    state.settings.modo = 'todas';
    $('#f-modo').value = 'todas';
    store.set(KEY_SETTINGS, state.settings);
    buildDeck();
  });

  $('#f-categoria').addEventListener('change', (e) => {
    state.settings.categoria = e.target.value;
    store.set(KEY_SETTINGS, state.settings);
    buildDeck();
  });
  const modo = $('#f-modo');
  modo.value = state.settings.modo;
  modo.addEventListener('change', (e) => {
    state.settings.modo = e.target.value;
    store.set(KEY_SETTINGS, state.settings);
    buildDeck();
  });
  const lectura = $('#f-lectura');
  lectura.checked = state.settings.lectura;
  lectura.addEventListener('change', (e) => {
    state.settings.lectura = e.target.checked;
    store.set(KEY_SETTINGS, state.settings);
    renderCard();
  });

  $('#btn-reset').addEventListener('click', () => {
    if (!confirm('¿Borrar el progreso de este examen?')) return;
    delete state.progress[state.examId];
    store.set(KEY_PROGRESS, state.progress);
    buildDeck();
    renderProgress();
  });

  // Teclado en escritorio: ← no sé, → sé, espacio gira
  document.addEventListener('keydown', (e) => {
    if (state.view !== 'tarjetas' || e.target.tagName === 'SELECT') return;
    if (state.revealing && (e.key === 'Enter' || e.key === 'ArrowRight')) { next(); return; }
    if (e.key === 'ArrowLeft') answer('nose');
    if (e.key === 'ArrowRight') answer('se');
  });
}

/* ---------- Service worker ---------- */
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW no registrado', e));
}

init();
