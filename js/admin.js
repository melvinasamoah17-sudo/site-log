const loginCard = document.getElementById('loginCard');
const dashboard = document.getElementById('dashboard');
const userInput = document.getElementById('userInput');
const passInput = document.getElementById('passInput');
const loginBtn = document.getElementById('loginBtn');
const loginError = document.getElementById('loginError');
const tableWrap = document.getElementById('tableWrap');
const filterName = document.getElementById('filterName');
const filterFrom = document.getElementById('filterFrom');
const filterTo = document.getElementById('filterTo');
const applyFilters = document.getElementById('applyFilters');
const exportBtn = document.getElementById('exportBtn');
const logoutBtn = document.getElementById('logoutBtn');
const newPass = document.getElementById('newPass');
const changePassBtn = document.getElementById('changePassBtn');
const passMsg = document.getElementById('passMsg');
const lightbox = document.getElementById('lightbox');
const lightboxInner = document.getElementById('lightboxInner');
const lightboxClose = document.getElementById('lightboxClose');
const toastEl = document.getElementById('toast');

const settingLat = document.getElementById('settingLat');
const settingLng = document.getElementById('settingLng');
const settingRadius = document.getElementById('settingRadius');
const useMyLocationBtn = document.getElementById('useMyLocationBtn');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');
const settingsMsg = document.getElementById('settingsMsg');
const settingsCurrent = document.getElementById('settingsCurrent');

let lastEntries = [];

function showToast(msg, isError){
  toastEl.textContent = msg;
  toastEl.className = 'toast show' + (isError ? ' error' : '');
  setTimeout(()=>{ toastEl.className = 'toast'; }, 2800);
}

function fmtDate(iso){
  return new Date(iso).toLocaleDateString(undefined, { year:'numeric', month:'short', day:'numeric' });
}
function fmtTimeOnly(iso){
  return new Date(iso).toLocaleTimeString(undefined, { hour:'numeric', minute:'2-digit' });
}

function escapeHtml(s){
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function showDashboard(){
  loginCard.style.display = 'none';
  dashboard.style.display = 'block';
  loadStats();
  loadSettings();
  loadEntries();
  loadShiftChecks();
}
function showLogin(){
  loginCard.style.display = 'flex';
  dashboard.style.display = 'none';
}

async function loadStats(){
  try{
    const { data, error } = await supabaseClient.rpc('admin_dashboard_stats');
    if(error) throw error;
    const stats = data && data[0];
    if(stats){
      document.getElementById('statTotalWorkers').textContent = stats.total_workers;
      document.getElementById('statSignedIn').textContent = stats.currently_signed_in;
      document.getElementById('statToday').textContent = stats.entries_today;
    }
  }catch(e){
    // Non-critical — leave the dashes in place if this fails.
  }
}

loginBtn.addEventListener('click', async ()=>{
  loginError.textContent = '';
  const email = userInput.value.trim();
  const password = passInput.value;
  if(!email || !password){ loginError.textContent = 'Enter email and password.'; return; }
  loginBtn.disabled = true;
  loginBtn.innerHTML = '<span class="spinner"></span>Signing in…';
  try{
    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if(error) throw error;
    passInput.value = '';
    showDashboard();
  }catch(e){
    loginError.textContent = e.message || 'Login failed.';
  }finally{
    loginBtn.disabled = false;
    loginBtn.textContent = 'Sign in';
  }
});

logoutBtn.addEventListener('click', async ()=>{
  await supabaseClient.auth.signOut();
  showLogin();
});

// ── Workplace location settings ──────────────────────────────────────────

async function loadSettings(){
  settingsMsg.textContent = '';
  try{
    const { data, error } = await supabaseClient.from('settings').select('*').eq('id', 1).single();
    if(error) throw error;
    if(data.workplace_lat != null){
      settingLat.value = data.workplace_lat;
      settingLng.value = data.workplace_lng;
      settingsCurrent.textContent = `Currently restricting sign-in/out to within ${data.radius_meters} m of the saved location.`;
    } else {
      settingsCurrent.textContent = 'No location set yet — sign-in/out is currently unrestricted.';
    }
    settingRadius.value = data.radius_meters;
  }catch(e){
    settingsMsg.textContent = 'Could not load location settings.';
  }
}

useMyLocationBtn.addEventListener('click', ()=>{
  settingsMsg.textContent = '';
  if(!navigator.geolocation){ settingsMsg.textContent = 'Location is not supported on this device.'; return; }
  useMyLocationBtn.disabled = true;
  useMyLocationBtn.innerHTML = '<span class="spinner"></span>Locating…';
  navigator.geolocation.getCurrentPosition(
    pos => {
      settingLat.value = pos.coords.latitude.toFixed(6);
      settingLng.value = pos.coords.longitude.toFixed(6);
      useMyLocationBtn.disabled = false;
      useMyLocationBtn.textContent = 'Use my current location';
    },
    err => {
      settingsMsg.textContent = 'Could not get your location — check permissions and try again.';
      useMyLocationBtn.disabled = false;
      useMyLocationBtn.textContent = 'Use my current location';
    },
    { enableHighAccuracy: true, timeout: 12000 }
  );
});

saveSettingsBtn.addEventListener('click', async ()=>{
  settingsMsg.textContent = '';
  const lat = parseFloat(settingLat.value);
  const lng = parseFloat(settingLng.value);
  const radius = parseInt(settingRadius.value, 10);
  if(isNaN(lat) || lat < -90 || lat > 90){ settingsMsg.textContent = 'Enter a valid latitude (-90 to 90).'; return; }
  if(isNaN(lng) || lng < -180 || lng > 180){ settingsMsg.textContent = 'Enter a valid longitude (-180 to 180).'; return; }
  if(isNaN(radius) || radius < 10){ settingsMsg.textContent = 'Radius must be at least 10 meters.'; return; }

  saveSettingsBtn.disabled = true;
  try{
    const { error } = await supabaseClient.from('settings')
      .update({ workplace_lat: lat, workplace_lng: lng, radius_meters: radius, updated_at: new Date().toISOString() })
      .eq('id', 1);
    if(error) throw error;
    showToast('Workplace location saved.');
    loadSettings();
  }catch(e){
    settingsMsg.textContent = e.message || 'Could not save settings.';
  }finally{
    saveSettingsBtn.disabled = false;
  }
});

// ── Entries table ─────────────────────────────────────────────────────────

async function loadEntries(){
  tableWrap.innerHTML = '<div class="empty">Loading…</div>';
  try{
    let query = supabaseClient.from('entries').select('*').order('created_at', { ascending: false });
    if(filterName.value.trim()) query = query.ilike('name', `%${filterName.value.trim()}%`);
    if(filterFrom.value) query = query.gte('created_at', new Date(filterFrom.value).toISOString());
    if(filterTo.value){
      const end = new Date(filterTo.value);
      end.setHours(23,59,59,999);
      query = query.lte('created_at', end.toISOString());
    }
    const { data, error } = await query;
    if(error) throw error;
    lastEntries = data || [];
    renderTable(lastEntries);
  }catch(e){
    if(e.message && /JWT|auth/i.test(e.message)){
      showLogin();
      return;
    }
    tableWrap.innerHTML = `<div class="empty">${escapeHtml(e.message || 'Could not load entries.')}</div>`;
  }
}

function renderTable(entries){
  if(entries.length === 0){
    tableWrap.innerHTML = '<div class="empty">No entries match those filters.</div>';
    return;
  }
  const rows = entries.map(e => {
    const hasLoc = e.lat != null && e.lng != null;
    const mapLink = hasLoc
      ? `<a href="https://www.google.com/maps?q=${e.lat},${e.lng}" target="_blank" rel="noopener">${e.distance_meters != null ? Math.round(e.distance_meters) + ' m' : 'View'}</a>`
      : '—';
    const urls = (e.photo_urls || []).filter(url => typeof url === 'string' && url.startsWith('http'));
    const photoCell = photoCellHtml(urls, e.id);
    return `
    <tr data-entry-id="${e.id}">
      <td>${photoCell}</td>
      <td>${escapeHtml(e.name)}</td>
      <td><span class="entry-type ${e.type}">${e.type === 'in' ? 'IN' : 'OUT'}</span></td>
      <td>${fmtDate(e.created_at)}</td>
      <td>${fmtTimeOnly(e.created_at)}</td>
      <td>${mapLink}</td>
      <td><button class="btn-danger-outline btn-small delete-entry-btn" data-id="${e.id}">Delete</button></td>
    </tr>
  `;
  }).join('');
  tableWrap.innerHTML = `
    <div class="table-scroll">
    <table>
      <thead><tr><th>Photos</th><th>Name</th><th>Type</th><th>Date</th><th>Time</th><th>Location</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    </div>
  `;
  wireGalleryButtons(tableWrap, entries, 'photo_urls');
  tableWrap.querySelectorAll('.delete-entry-btn').forEach(btn=>{
    btn.addEventListener('click', ()=> deleteEntry(btn.dataset.id, btn));
  });
}

// Renders a small photo stack + count for a table cell. Clicking it opens
// every photo for that row in the lightbox gallery (not just one).
function photoCellHtml(urls, rowId){
  if(urls.length === 0) return '<span class="photo-cell-empty">No photo</span>';
  const stackImgs = urls.slice(0, 3).map(url => `<img src="${url}" alt="">`).join('');
  return `
    <button type="button" class="photo-cell-btn" data-gallery-id="${rowId}">
      <span class="photo-cell-stack">${stackImgs}</span>
      <span class="photo-cell-count">${urls.length} photo${urls.length > 1 ? 's' : ''}</span>
    </button>
  `;
}

// Attaches click handlers to every photo-cell button in a container,
// opening the full set of photo URLs for that row in the lightbox.
function wireGalleryButtons(container, rows, urlField){
  container.querySelectorAll('.photo-cell-btn').forEach(btn => {
    const row = rows.find(r => String(r.id) === btn.dataset.galleryId);
    if(!row) return;
    const urls = (row[urlField] || []).filter(url => typeof url === 'string' && url.startsWith('http'));
    btn.addEventListener('click', () => openGallery(urls));
  });
}

function openGallery(urls){
  lightboxInner.querySelectorAll('img').forEach(img => img.remove());
  urls.forEach(url => {
    const img = document.createElement('img');
    img.src = url;
    img.alt = 'Site photo';
    lightboxInner.appendChild(img);
  });
  lightbox.classList.add('open');
}

async function deleteEntry(id, btn){
  const entry = lastEntries.find(e => e.id === id);
  if(!entry) return;
  if(!confirm(`Delete this ${entry.type === 'in' ? 'sign-in' : 'sign-out'} record for ${entry.name}? This also deletes its photo(s) and cannot be undone.`)) return;

  btn.disabled = true;
  btn.textContent = 'Deleting…';
  try{
    const paths = (entry.photo_urls || [])
      .map(url => url.split('/site-photos/')[1])
      .filter(Boolean);
    if(paths.length > 0){
      await supabaseClient.storage.from('site-photos').remove(paths);
    }
    const { error } = await supabaseClient.from('entries').delete().eq('id', id);
    if(error) throw error;
    lastEntries = lastEntries.filter(e => e.id !== id);
    renderTable(lastEntries);
    showToast('Entry deleted.');
  }catch(e){
    showToast(e.message || 'Could not delete entry.', true);
    btn.disabled = false;
    btn.textContent = 'Delete';
  }
}

applyFilters.addEventListener('click', loadEntries);

exportBtn.addEventListener('click', ()=>{
  if(lastEntries.length === 0){ showToast('Nothing to export.', true); return; }
  const escape = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const header = ['Name', 'Type', 'Date', 'Time', 'Distance (m)', 'Photo URLs'].join(',');
  const rows = lastEntries.map(e => [
    e.name, e.type, fmtDate(e.created_at), fmtTimeOnly(e.created_at),
    e.distance_meters != null ? Math.round(e.distance_meters) : '', (e.photo_urls || []).join('; ')
  ].map(escape).join(','));
  const csv = [header, ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `site-log-export-${Date.now()}.csv`;
  link.click();
});

changePassBtn.addEventListener('click', async ()=>{
  passMsg.textContent = '';
  if(!newPass.value || newPass.value.length < 6){ passMsg.textContent = 'Password must be at least 6 characters.'; return; }
  changePassBtn.disabled = true;
  try{
    const { error } = await supabaseClient.auth.updateUser({ password: newPass.value });
    if(error) throw error;
    newPass.value = '';
    showToast('Password updated.');
  }catch(e){
    passMsg.textContent = e.message || 'Could not update password.';
  }finally{
    changePassBtn.disabled = false;
  }
});

lightbox.addEventListener('click', (e)=>{
  if(e.target === lightbox) lightbox.classList.remove('open');
});
lightboxClose.addEventListener('click', ()=> lightbox.classList.remove('open'));

supabaseClient.auth.getSession().then(({ data }) => {
  if(data.session){ showDashboard(); } else { showLogin(); }
});
supabaseClient.auth.onAuthStateChange((event) => {
  if(event === 'SIGNED_OUT') showLogin();
});

// ── Generator fuel & light balance checks ─────────────────────────────────

let lastChecks = [];
const checksTableWrap = document.getElementById('checksTableWrap');

async function loadShiftChecks(){
  checksTableWrap.innerHTML = '<div class="empty">Loading…</div>';
  try{
    const { data, error } = await supabaseClient.from('shift_checks').select('*').order('created_at', { ascending: false }).limit(100);
    if(error) throw error;
    lastChecks = data || [];
    renderChecksTable(lastChecks);
  }catch(e){
    checksTableWrap.innerHTML = `<div class="empty">${escapeHtml(e.message || 'Could not load checks.')}</div>`;
  }
}

function renderChecksTable(checks){
  if(checks.length === 0){
    checksTableWrap.innerHTML = '<div class="empty">No checks submitted yet.</div>';
    return;
  }
  const rows = checks.map(c => {
    const urls = (c.fuel_photo_urls || []).filter(url => typeof url === 'string' && url.startsWith('http'));
    return `
    <tr>
      <td>${photoCellHtml(urls, c.id)}</td>
      <td>${escapeHtml(c.name)}</td>
      <td>${escapeHtml(c.light_balance)}</td>
      <td>${fmtDate(c.created_at)}</td>
      <td>${fmtTimeOnly(c.created_at)}</td>
      <td><button class="btn-danger-outline btn-small delete-check-btn" data-id="${c.id}">Delete</button></td>
    </tr>
  `;
  }).join('');
  checksTableWrap.innerHTML = `
    <div class="table-scroll">
    <table>
      <thead><tr><th>Fuel Photos</th><th>Name</th><th>Light Balance</th><th>Date</th><th>Time</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    </div>
  `;
  wireGalleryButtons(checksTableWrap, checks, 'fuel_photo_urls');
  checksTableWrap.querySelectorAll('.delete-check-btn').forEach(btn=>{
    btn.addEventListener('click', ()=> deleteCheck(btn.dataset.id, btn));
  });
}

async function deleteCheck(id, btn){
  const check = lastChecks.find(c => c.id === id);
  if(!check) return;
  if(!confirm(`Delete this check from ${check.name}? This cannot be undone.`)) return;

  btn.disabled = true;
  btn.textContent = 'Deleting…';
  try{
    const paths = (check.fuel_photo_urls || [])
      .map(url => url.split('/site-photos/')[1])
      .filter(Boolean);
    if(paths.length > 0){
      await supabaseClient.storage.from('site-photos').remove(paths);
    }
    const { error } = await supabaseClient.from('shift_checks').delete().eq('id', id);
    if(error) throw error;
    lastChecks = lastChecks.filter(c => c.id !== id);
    renderChecksTable(lastChecks);
    showToast('Check deleted.');
  }catch(e){
    showToast(e.message || 'Could not delete check.', true);
    btn.disabled = false;
    btn.textContent = 'Delete';
  }
}
