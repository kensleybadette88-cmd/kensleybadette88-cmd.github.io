const STORAGE_KEY = 'kes-mwen-mobile-v1';
const baseCategories = ['Alimentation', 'Transport', 'Logement', 'Études', 'Santé', 'Loisirs', 'Travail', 'Épargne', 'Autre'];
const emptyData = { transactions: [], budgetCents: 0, rateScaled: 0, goals: [], categories: [], pin: null };
let data = loadData();
let transactionType = 'expense';
let activeFilter = 'all';
let editingId = null;
let deferredInstallPrompt = null;
let lastSaveFailed = false;

function loadData() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    const result = { ...emptyData, ...saved };
    if (!Array.isArray(result.transactions)) result.transactions = [];
    if (!Array.isArray(result.goals)) result.goals = result.goalCents > 0 ? [{ id: 'legacy-goal', name: 'Mon objectif', targetCents: result.goalCents }] : [];
    if (!Array.isArray(result.categories)) result.categories = [];
    return result;
  } catch { return { ...emptyData }; }
}
function setSaveStatus(message) { document.querySelectorAll('.save-status').forEach(node => { node.textContent = message; }); }
function saveData() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); lastSaveFailed = false;
    const time = new Intl.DateTimeFormat('fr-HT', { hour: '2-digit', minute: '2-digit' }).format(new Date());
    setSaveStatus(`✓ Enregistré automatiquement sur cet appareil · ${time}`); render(); return true;
  } catch {
    lastSaveFailed = true; setSaveStatus('⚠️ Sauvegarde impossible. Libère de l’espace dans le navigateur.');
    showToast('Les changements n’ont pas pu être sauvegardés.'); render(); return false;
  }
}
function parseDecimal(value) {
  const normalized = String(value ?? '').trim().replace(/\s/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,4})?$/.test(normalized)) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}
function parseCents(value) { const n = parseDecimal(value); return n !== null && n > 0 ? Math.round(n * 100) : null; }
function currentMonth() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
function currentDate() { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
function formatMoney(cents, currency = 'HTG') {
  return new Intl.NumberFormat('fr-HT', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format((cents || 0) / 100) + ` ${currency}`;
}
function toHtgCents(tx) { return tx.currency === 'USD' ? Math.round(tx.amountCents * tx.exchangeRateScaled / 10000) : tx.amountCents; }
function monthTransactions() { return data.transactions.filter(tx => tx.date.startsWith(currentMonth())); }
function iconFor(category) { return ({ 'Alimentation': '🥑', 'Transport': '🚌', 'Logement': '🏠', 'Études': '📚', 'Santé': '💊', 'Loisirs': '🎧', 'Travail': '💼', 'Épargne': '🌱', 'Autre': '✦' })[category] || '✦'; }
function dateLabel(date) { return new Intl.DateTimeFormat('fr-HT', { day: 'numeric', month: 'short' }).format(new Date(`${date}T12:00:00`)); }
function availableCategories() { return [...new Set([...baseCategories, ...data.categories, ...data.transactions.map(tx => tx.category).filter(Boolean)])]; }
function updateCategoryOptions(selected) {
  const select = document.querySelector('#category-input');
  select.innerHTML = availableCategories().map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
  if (selected && availableCategories().includes(selected)) select.value = selected;
}
function transactionMarkup(tx) {
  const sign = tx.type === 'income' ? '+' : '−';
  const primary = formatMoney(tx.amountCents, tx.currency);
  const converted = tx.currency === 'USD' ? `<small>≈ ${formatMoney(toHtgCents(tx))}</small>` : '';
  return `<article class="transaction-row" data-row-id="${escapeHtml(tx.id)}"><span class="transaction-icon ${tx.type}">${iconFor(tx.category)}</span><div class="transaction-main"><strong>${escapeHtml(tx.description || tx.category || 'Opération')}</strong><small>${escapeHtml(tx.category)} · ${dateLabel(tx.date)}</small></div><div class="transaction-value ${tx.type}">${sign}${primary}${converted}</div><div class="transaction-actions"><button class="row-action" data-action="edit" data-id="${escapeHtml(tx.id)}" aria-label="Modifier cette opération" title="Modifier">✎</button><button class="row-action delete" data-action="delete" data-id="${escapeHtml(tx.id)}" aria-label="Supprimer cette opération" title="Supprimer">×</button></div></article>`;
}
function listMarkup(transactions, emptyText) { return transactions.length ? transactions.map(transactionMarkup).join('') : `<div class="empty-state"><span>🪙</span>${emptyText}</div>`; }
function renderCharts(month, balance) {
  const grouped = new Map();
  month.filter(tx => tx.type === 'expense').forEach(tx => grouped.set(tx.category || 'Autre', (grouped.get(tx.category || 'Autre') || 0) + toHtgCents(tx)));
  const groups = [...grouped].sort((a, b) => b[1] - a[1]);
  const maxCategory = groups[0]?.[1] || 1;
  document.querySelector('#category-chart').innerHTML = groups.length ? groups.map(([name, amount]) => `<div class="chart-item"><span>${iconFor(name)} ${escapeHtml(name)}</span><div class="chart-track"><i style="width:${Math.max(4, amount / maxCategory * 100)}%"></i></div><strong>${formatMoney(amount)}</strong></div>`).join('') : '<div class="chart-empty">Ajoute des dépenses pour voir leur répartition.</div>';
  const now = new Date();
  const months = Array.from({ length: 6 }, (_, i) => new Date(now.getFullYear(), now.getMonth() - 5 + i, 1));
  const sums = months.map(d => {
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    return data.transactions.filter(tx => tx.type === 'expense' && tx.date.startsWith(key)).reduce((sum, tx) => sum + toHtgCents(tx), 0);
  });
  const maxMonth = Math.max(...sums, 1);
  document.querySelector('#monthly-chart').innerHTML = months.map((d, i) => `<div class="month-bar ${i === 5 ? 'current' : ''}" title="${formatMoney(sums[i])}"><i style="--bar-height:${Math.max(3, sums[i] / maxMonth * 78)}px"></i><span>${new Intl.DateTimeFormat('fr-HT', { month: 'short' }).format(d)}</span></div>`).join('');
}
function renderGoals() {
  const host = document.querySelector('#goals-list');
  host.innerHTML = data.goals.length ? data.goals.map(goal => {
    const saved = goal.savedCents || 0;
    const pct = Math.min(100, Math.max(0, Math.round(saved / goal.targetCents * 100)));
    return `<div class="goal-row"><div class="goal-row-top"><strong>${escapeHtml(goal.name)}</strong><button class="goal-delete" data-delete-goal="${escapeHtml(goal.id)}">Supprimer</button></div><div class="progress-track"><div class="progress-fill green-fill" style="width:${pct}%"></div></div><div class="goal-row-bottom"><span>${formatMoney(saved)} économisés</span><span>${formatMoney(goal.targetCents)} · ${pct}%</span></div><div class="goal-save-form"><label class="sr-only" for="goal-saved-${escapeHtml(goal.id)}">Montant déjà économisé pour ${escapeHtml(goal.name)}</label><input id="goal-saved-${escapeHtml(goal.id)}" inputmode="decimal" placeholder="Déjà économisé HTG" value="${saved ? (saved / 100) : ''}"><button data-save-goal="${escapeHtml(goal.id)}">Mettre à jour</button></div></div>`;
  }).join('') : '<div class="chart-empty">Ajoute un objectif pour suivre ton épargne.</div>';
}
function render() {
  const month = monthTransactions();
  const income = month.filter(tx => tx.type === 'income').reduce((sum, tx) => sum + toHtgCents(tx), 0);
  const expenses = month.filter(tx => tx.type === 'expense').reduce((sum, tx) => sum + toHtgCents(tx), 0);
  const allBalance = data.transactions.reduce((sum, tx) => sum + (tx.type === 'income' ? toHtgCents(tx) : -toHtgCents(tx)), 0);
  document.querySelector('#balance-total').innerHTML = `${formatMoney(allBalance).replace(/\sHTG$/, '')} <small>HTG</small>`;
  document.querySelector('#income-total').textContent = formatMoney(income);
  document.querySelector('#expense-total').textContent = formatMoney(expenses);
  const budgetFill = document.querySelector('#budget-progress');
  if (data.budgetCents > 0) {
    const pct = expenses / data.budgetCents * 100;
    document.querySelector('#budget-label').textContent = `${formatMoney(expenses)} / ${formatMoney(data.budgetCents)}`;
    budgetFill.style.width = `${Math.min(pct, 100)}%`; budgetFill.classList.toggle('over', pct >= 90);
    document.querySelector('#budget-message').textContent = pct >= 100 ? 'Tu as dépassé ton budget. Regarde tes dépenses et ajuste si besoin.' : pct >= 80 ? `Attention, tu as utilisé ${Math.round(pct)} % de ton budget.` : `${formatMoney(Math.max(data.budgetCents - expenses, 0))} disponibles ce mois-ci.`;
  } else {
    document.querySelector('#budget-label').textContent = 'Aucun budget'; budgetFill.style.width = '0%'; budgetFill.classList.remove('over');
    document.querySelector('#budget-message').textContent = 'Ajoute un budget mensuel pour commencer.';
  }
  const sorted = [...data.transactions].sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0));
  document.querySelector('#recent-list').innerHTML = listMarkup(sorted.slice(0, 4), 'Tes opérations apparaîtront ici. Appuie sur + pour en ajouter une.');
  const filtered = activeFilter === 'all' ? sorted : sorted.filter(tx => tx.type === activeFilter);
  document.querySelector('#all-list').innerHTML = listMarkup(filtered, 'Aucune opération pour le moment. Appuie sur + pour commencer.');
  document.querySelector('#budget-input').value = data.budgetCents ? (data.budgetCents / 100).toString() : '';
  document.querySelector('#rate-input').value = data.rateScaled ? (data.rateScaled / 10000).toString() : '';
  document.querySelector('#pin-status').textContent = data.pin ? 'Code PIN activé sur cet appareil' : 'Aucun code configuré';
  document.querySelector('#pin-submit').textContent = data.pin ? 'Changer' : 'Activer';
  document.querySelector('#remove-pin').hidden = !data.pin;
  renderCharts(month, allBalance); renderGoals(); renderCategoryTags(); updateCategoryOptions();
}
function renderCategoryTags() {
  const host = document.querySelector('#custom-category-list');
  host.innerHTML = data.categories.map(name => `<span class="category-chip">${escapeHtml(name)}<button data-remove-category="${escapeHtml(name)}" aria-label="Retirer ${escapeHtml(name)}">×</button></span>`).join('');
}
function openModal(tx = null) {
  editingId = tx?.id || null;
  document.querySelector('#form-title').textContent = tx ? 'Modifier l’opération' : 'Ajouter un mouvement';
  document.querySelector('#transaction-form').reset();
  transactionType = tx?.type || 'expense';
  document.querySelectorAll('.type-option').forEach(option => option.classList.toggle('selected', option.dataset.type === transactionType));
  document.querySelector('#amount-input').value = tx ? (tx.amountCents / 100).toString() : '';
  document.querySelector('#currency-input').value = tx?.currency || 'HTG';
  document.querySelector('#description-input').value = tx?.description || '';
  document.querySelector('#date-input').value = tx?.date || currentDate();
  updateCategoryOptions(tx?.category); updateRateHint();
  document.querySelector('#modal').hidden = false; document.querySelector('#amount-input').focus();
}
function closeModal() { document.querySelector('#modal').hidden = true; editingId = null; }
function showToast(message) {
  if (lastSaveFailed && /enregistr|ajout|modifi|supprim|restaur|activé|retirée|mis à jour/i.test(message)) return;
  const toast = document.querySelector('#toast'); toast.textContent = message; toast.classList.add('show');
  window.setTimeout(() => toast.classList.remove('show'), 2500);
}
function updateRateHint() {
  const isUsd = document.querySelector('#currency-input').value === 'USD';
  const hint = document.querySelector('#rate-hint'); hint.hidden = !isUsd;
  hint.textContent = data.rateScaled ? `Taux utilisé : 1 USD = ${data.rateScaled / 10000} HTG.` : 'Ajoute d’abord un taux de change dans l’onglet Budget.';
}
function activateTab(tab) {
  document.querySelectorAll('.screen').forEach(el => el.classList.toggle('active', el.id === `screen-${tab}`));
  document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.tab === tab));
  document.querySelector('#add-button').hidden = false; window.scrollTo({ top: 0, behavior: 'smooth' });
}
function downloadFile(name, content, mime) {
  const link = document.createElement('a'); const url = URL.createObjectURL(new Blob([content], { type: mime }));
  link.href = url; link.download = name; link.click(); URL.revokeObjectURL(url);
}
function csvCell(value) { return `"${String(value ?? '').replace(/"/g, '""')}"`; }
function bytesToHex(bytes) { return [...new Uint8Array(bytes)].map(n => n.toString(16).padStart(2, '0')).join(''); }
async function hashPin(pin, saltHex) {
  if (!crypto.subtle) throw new Error('Le code PIN nécessite une connexion sécurisée HTTPS.');
  const salt = Uint8Array.from(saltHex.match(/.{2}/g), b => parseInt(b, 16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  return bytesToHex(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 120000, hash: 'SHA-256' }, key, 256));
}
async function lockApp() {
  if (!data.pin) return;
  document.querySelector('#lock-screen').hidden = false;
}

document.querySelectorAll('.nav-item').forEach(button => button.addEventListener('click', () => activateTab(button.dataset.tab)));
document.querySelectorAll('[data-go]').forEach(button => button.addEventListener('click', () => activateTab(button.dataset.go)));
document.querySelector('#add-button').addEventListener('click', () => openModal());
document.querySelector('#close-modal').addEventListener('click', closeModal);
document.querySelector('#modal').addEventListener('click', event => { if (event.target.id === 'modal') closeModal(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeModal(); });
document.querySelectorAll('.type-option').forEach(button => button.addEventListener('click', () => {
  transactionType = button.dataset.type; document.querySelectorAll('.type-option').forEach(option => option.classList.toggle('selected', option === button));
}));
document.querySelector('#currency-input').addEventListener('change', updateRateHint);
document.querySelector('#transaction-form').addEventListener('submit', event => {
  event.preventDefault();
  const amountCents = parseCents(document.querySelector('#amount-input').value);
  if (!amountCents) return showToast('Entre un montant valide.');
  const currency = document.querySelector('#currency-input').value;
  if (currency === 'USD' && !data.rateScaled) return showToast('Ajoute d’abord un taux de change dans Budget.');
  const date = document.querySelector('#date-input').value;
  if (!date) return showToast('Choisis une date pour cette opération.');
  const description = document.querySelector('#description-input').value.trim();
  const category = document.querySelector('#category-input').value;
  const existing = editingId ? data.transactions.find(tx => tx.id === editingId) : null;
  const transaction = { id: existing?.id || (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`), type: transactionType, amountCents, currency, exchangeRateScaled: currency === 'USD' ? (existing?.currency === 'USD' ? existing.exchangeRateScaled : data.rateScaled) : 10000, description, category, date, createdAt: existing?.createdAt || Date.now() };
  if (existing) data.transactions = data.transactions.map(tx => tx.id === editingId ? transaction : tx); else data.transactions.push(transaction);
  saveData(); closeModal(); showToast(existing ? 'Opération modifiée.' : 'Opération enregistrée.');
});
document.querySelectorAll('#recent-list, #all-list').forEach(host => host.addEventListener('click', event => {
  const button = event.target.closest('[data-action]'); if (!button) return;
  const tx = data.transactions.find(item => item.id === button.dataset.id); if (!tx) return;
  if (button.dataset.action === 'edit') openModal(tx);
  if (button.dataset.action === 'delete' && confirm('Supprimer cette opération ?')) { data.transactions = data.transactions.filter(item => item.id !== tx.id); saveData(); showToast('Opération supprimée.'); }
}));
document.querySelector('#budget-form').addEventListener('submit', event => {
  event.preventDefault(); const value = parseCents(document.querySelector('#budget-input').value);
  if (!value) return showToast('Entre un budget supérieur à zéro.'); data.budgetCents = value; saveData(); showToast('Budget enregistré.');
});
document.querySelector('#goal-form').addEventListener('submit', event => {
  event.preventDefault(); const value = parseCents(document.querySelector('#goal-input').value);
  if (!value) return showToast('Entre un objectif supérieur à zéro.');
  const name = document.querySelector('#goal-name-input').value.trim() || `Objectif ${data.goals.length + 1}`;
  data.goals.push({ id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`, name, targetCents: value, savedCents: 0 });
  document.querySelector('#goal-name-input').value = ''; document.querySelector('#goal-input').value = ''; saveData(); showToast('Objectif ajouté.');
});
document.querySelector('#goals-list').addEventListener('click', event => {
  const button = event.target.closest('[data-delete-goal]'); if (!button) return;
  data.goals = data.goals.filter(goal => goal.id !== button.dataset.deleteGoal); saveData(); showToast('Objectif supprimé.');
});
document.querySelector('#goals-list').addEventListener('click', event => {
  const button = event.target.closest('[data-save-goal]'); if (!button) return;
  const goal = data.goals.find(item => item.id === button.dataset.saveGoal);
  const amount = parseDecimal(document.querySelector(`#goal-saved-${CSS.escape(button.dataset.saveGoal)}`).value);
  if (!goal) return;
  if (amount === null) return showToast('Entre un montant épargné valide.');
  goal.savedCents = Math.round(amount * 100); saveData(); showToast('Épargne mise à jour.');
});
document.querySelector('#rate-form').addEventListener('submit', event => {
  event.preventDefault(); const value = parseDecimal(document.querySelector('#rate-input').value);
  if (value === null || value <= 0 || value > 100000) return showToast('Entre un taux valide.');
  data.rateScaled = Math.round(value * 10000); saveData(); updateRateHint(); showToast('Taux enregistré.');
});
document.querySelector('#category-form').addEventListener('submit', event => {
  event.preventDefault(); const input = document.querySelector('#category-new'); const name = input.value.trim();
  if (!name) return showToast('Entre un nom de catégorie.');
  if (availableCategories().some(item => item.toLocaleLowerCase() === name.toLocaleLowerCase())) return showToast('Cette catégorie existe déjà.');
  data.categories.push(name); input.value = ''; saveData(); showToast('Catégorie ajoutée.');
});
document.querySelector('#custom-category-list').addEventListener('click', event => {
  const button = event.target.closest('[data-remove-category]'); if (!button) return;
  data.categories = data.categories.filter(name => name !== button.dataset.removeCategory); saveData(); showToast('Catégorie retirée de la liste.');
});
document.querySelectorAll('.filter-chip').forEach(button => button.addEventListener('click', () => {
  activeFilter = button.dataset.filter; document.querySelectorAll('.filter-chip').forEach(chip => chip.classList.toggle('selected', chip === button)); render();
}));
document.querySelector('#export-csv').addEventListener('click', () => {
  const rows = [['Date', 'Type', 'Description', 'Catégorie', 'Montant', 'Devise', 'Taux HTG par USD', 'Équivalent HTG'], ...data.transactions.map(tx => [tx.date, tx.type === 'income' ? 'Revenu' : 'Dépense', tx.description, tx.category, (tx.amountCents / 100).toFixed(2), tx.currency, tx.currency === 'USD' ? tx.exchangeRateScaled / 10000 : '', (toHtgCents(tx) / 100).toFixed(2)])];
  downloadFile('kes-mwen-operations.csv', '\ufeff' + rows.map(row => row.map(csvCell).join(';')).join('\r\n'), 'text/csv;charset=utf-8'); showToast('Fichier CSV téléchargé.');
});
document.querySelector('#export-backup').addEventListener('click', () => {
  downloadFile('kes-mwen-sauvegarde.json', JSON.stringify({ app: 'kes-mwen', version: 2, exportedAt: new Date().toISOString(), data }, null, 2), 'application/json'); showToast('Copie de sauvegarde téléchargée.');
});
document.querySelector('#import-backup').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  try {
    const parsed = JSON.parse(await file.text()); const incoming = parsed.data || parsed;
    if (!Array.isArray(incoming.transactions) || !incoming.transactions.every(tx => tx && typeof tx.amountCents === 'number' && ['income', 'expense'].includes(tx.type))) throw new Error('Le fichier ne semble pas être une sauvegarde Kès mwen valide.');
    if (!confirm('Restaurer cette sauvegarde remplacera les données présentes dans l’application. Continuer ?')) return;
    data = { ...emptyData, ...incoming, goals: Array.isArray(incoming.goals) ? incoming.goals : [], categories: Array.isArray(incoming.categories) ? incoming.categories : [] };
    saveData(); showToast('Sauvegarde restaurée.');
  } catch (error) { showToast(error.message || 'Impossible de lire cette sauvegarde.'); }
  finally { event.target.value = ''; }
});
document.querySelector('#pin-form').addEventListener('submit', async event => {
  event.preventDefault(); const pin = document.querySelector('#pin-input').value;
  if (!/^\d{4,8}$/.test(pin)) return showToast('Choisis un code de 4 à 8 chiffres.');
  if (data.pin && !confirm('Remplacer le code PIN actuel ?')) return;
  try {
    const salt = crypto.getRandomValues(new Uint8Array(16)); const saltHex = bytesToHex(salt);
    data.pin = { salt: saltHex, hash: await hashPin(pin, saltHex) }; saveData();
    document.querySelector('#pin-input').value = ''; showToast('Code PIN activé.');
  } catch (error) { showToast(error.message); }
});
document.querySelector('#remove-pin').addEventListener('click', () => {
  if (!data.pin || !confirm('Retirer le code PIN ?')) return; data.pin = null; saveData(); showToast('Code PIN retiré.');
});
document.querySelector('#unlock-form').addEventListener('submit', async event => {
  event.preventDefault(); const field = document.querySelector('#unlock-pin');
  try {
    const guess = await hashPin(field.value, data.pin.salt);
    if (guess === data.pin.hash) { document.querySelector('#lock-screen').hidden = true; field.value = ''; }
    else { field.value = ''; document.querySelector('#unlock-message').textContent = 'Code incorrect. Réessaie.'; }
  } catch (error) { document.querySelector('#unlock-message').textContent = error.message; }
});
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); deferredInstallPrompt = event; document.querySelector('#install-button').hidden = false; });
document.querySelector('#install-button').addEventListener('click', async () => {
  if (!deferredInstallPrompt) return; deferredInstallPrompt.prompt(); await deferredInstallPrompt.userChoice; deferredInstallPrompt = null; document.querySelector('#install-button').hidden = true;
});
const isNativeWrapper = location.protocol === 'capacitor:' || location.hostname === 'localhost';
if ('serviceWorker' in navigator && !isNativeWrapper && location.protocol.startsWith('http')) navigator.serviceWorker.register('./service-worker.js').catch(() => {});
document.querySelector('#today-label').textContent = new Intl.DateTimeFormat('fr-HT', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date()).toLocaleUpperCase('fr-HT');
render(); updateRateHint();
setSaveStatus(data.transactions.length ? '✓ Opérations enregistrées automatiquement sur cet appareil.' : '✓ Enregistrement automatique activé sur cet appareil.');
if (data.pin) lockApp();

