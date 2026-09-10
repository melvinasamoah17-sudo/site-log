const loginCard = document.getElementById('loginCard');
const dashboard = document.getElementById('dashboard');
const nameInput = document.getElementById('nameInput');
const pinInput = document.getElementById('pinInput');
const viewBtn = document.getElementById('viewBtn');
const loginError = document.getElementById('loginError');
const switchBtn = document.getElementById('switchBtn');
const historyWrap = document.getElementById('historyWrap');
const statCurrent = document.getElementById('statCurrent');
const statWeek = document.getElementById('statWeek');
const statTotal = document.getElementById('statTotal');
const lightbox = document.getElementById('lightbox');
const lightboxInner = document.getElementById('lightboxInner');
const lightboxClose = document.getElementById('lightboxClose');
const toastEl = document.getElementById('toast');

const checklistGate = document.getElementById('checklistGate');
const checklistForm = document.getElementById('checklistForm');
const lightBalanceInput = document.getElementById('lightBalanceInput');
const fuelCameraBox = document.getElementById('fuelCameraBox');
const fuelCameraVideo = document.getElementById('fuelCameraVideo');
const fuelCaptureCanvas = document.getElementById('fuelCaptureCanvas');
const fuelCameraError = document.getElementById('fuelCameraError');
const fuelPhotoThumbs = document.getElementById('fuelPhotoThumbs');
const fuelTakePhotoBtn = document.getElementById('fuelTakePhotoBtn');
const submitChecklistBtn = document.getElementById('submitChecklistBtn');
const checklistError = document.getElementById('checklistError');

let currentName = '';
let currentPin = '';
let fuelStream = null;
let fuelPhotos = []; // [{ blob, previewUrl }]

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

nameInput.value = localStorage.getItem('siteLogLastName') || '';

viewBtn.addEventListener('click', async ()=>{
  loginError.textContent = '';
  const name = nameInput.value.trim();
  const pin = pinInput.value.trim();
  if(!name){ loginError.textContent = 'Enter your name.'; return; }
  if(!/^\d{4,6}$/.test(pin)){ loginError.textContent = 'Enter your 4–6 digit PIN.'; return; }

  viewBtn.disabled = true;
  viewBtn.innerHTML = '<span class="spinner"></span>Loading…';
  try{
    const { data, error } = await supabaseClient.rpc('get_worker_history', { p_name: name, p_pin: pin });
    if(error) throw error;
    localStorage.setItem('siteLogLastName', name);
    currentName = name;
    currentPin = pin;
    loginCard.style.display = 'none';
    dashboard.style.display = 'block';
    renderDashboard(data || []);
    setupChecklistGate(data || []);
  }catch(e){
    loginError.textContent = e.message || 'Could not load your history.';
  }finally{
    viewBtn.disabled = false;
    viewBtn.textContent = 'View my activity';
  }
});

switchBtn.addEventListener('click', ()=>{
  stopFuelCamera();
  dashboard.style.display = 'none';
  loginCard.style.display = 'block';
  pinInput.value = '';
});

function renderDashboard(entries){
  // Stats
  const last = entries[0];
  if(!last){
    statCurrent.textContent = 'No entries';
  } else if(last.entry_type === 'in'){
    statCurrent.textContent = 'Signed In';
  } else {
    statCurrent.textContent = 'Signed Out';
  }

  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const weekCount = entries.filter(e => e.entry_type === 'in' && new Date(e.entry_created_at).getTime() >= weekAgo).length;
  statWeek.textContent = weekCount;
  statTotal.textContent = entries.length;

  // History list
  if(entries.length === 0){
    historyWrap.innerHTML = '<div class="empty">No entries logged yet.</div>';
    return;
  }
  const rows = entries.map(e => {
    const urls = (e.entry_photo_urls || []).filter(url => typeof url === 'string' && url.startsWith('http'));
    return `
    <tr>
      <td>${photoCellHtml(urls, e.entry_id)}</td>
      <td><span class="entry-type ${e.entry_type}">${e.entry_type === 'in' ? 'IN' : 'OUT'}</span></td>
      <td>${fmtDate(e.entry_created_at)}</td>
      <td>${fmtTimeOnly(e.entry_created_at)}</td>
      <td>${e.entry_distance_meters != null ? Math.round(e.entry_distance_meters) + ' m' : '—'}</td>
    </tr>
  `;
  }).join('');
  historyWrap.innerHTML = `
    <div class="table-scroll">
    <table>
      <thead><tr><th>Photos</th><th>Type</th><th>Date</th><th>Time</th><th>Distance</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    </div>
  `;
  historyWrap.querySelectorAll('.photo-cell-btn').forEach(btn => {
    const row = entries.find(r => String(r.entry_id) === btn.dataset.galleryId);
    if(!row) return;
    const urls = (row.entry_photo_urls || []).filter(url => typeof url === 'string' && url.startsWith('http'));
    btn.addEventListener('click', () => openGallery(urls));
  });
}

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

lightbox.addEventListener('click', (e)=>{
  if(e.target === lightbox) lightbox.classList.remove('open');
});
lightboxClose.addEventListener('click', ()=> lightbox.classList.remove('open'));

// ── Shift checklist: gated behind being currently signed in ──────────────

function setupChecklistGate(entries){
  const last = entries[0];
  const isSignedIn = last && last.entry_type === 'in';
  if(isSignedIn){
    checklistGate.textContent = '';
    checklistForm.style.display = 'block';
    fuelPhotos = [];
    renderFuelThumbs();
    startFuelCamera();
  } else {
    checklistGate.innerHTML = 'You must sign in first before submitting this check. <a href="/signin.html" style="color: var(--accent-2); font-weight:600;">Go to Sign In →</a>';
    checklistForm.style.display = 'none';
    stopFuelCamera();
  }
}

async function startFuelCamera(){
  fuelCameraError.textContent = '';
  try{
    fuelStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 960 } },
      audio: false
    });
    fuelCameraVideo.srcObject = fuelStream;
    fuelCameraBox.style.display = 'block';
  }catch(e){
    fuelCameraError.textContent = 'Camera access is required to photograph the fuel level — enable camera permission and try again.';
  }
}

function stopFuelCamera(){
  if(fuelStream){
    fuelStream.getTracks().forEach(t => t.stop());
    fuelStream = null;
  }
}

function renderFuelThumbs(){
  fuelPhotoThumbs.innerHTML = '';
  fuelPhotos.forEach((p, idx) => {
    const wrap = document.createElement('div');
    wrap.className = 'photo-thumb';
    wrap.innerHTML = `<img src="${p.previewUrl}" alt="Fuel photo ${idx+1}"><button type="button" class="photo-thumb-remove" aria-label="Remove photo">×</button>`;
    wrap.querySelector('button').addEventListener('click', () => {
      fuelPhotos.splice(idx, 1);
      renderFuelThumbs();
    });
    fuelPhotoThumbs.appendChild(wrap);
  });
  updateSubmitEnabled();
}

function updateSubmitEnabled(){
  submitChecklistBtn.disabled = fuelPhotos.length === 0 || lightBalanceInput.value.trim().length === 0;
}
lightBalanceInput.addEventListener('input', updateSubmitEnabled);

fuelTakePhotoBtn.addEventListener('click', ()=>{
  const w = fuelCameraVideo.videoWidth, h = fuelCameraVideo.videoHeight;
  if(!w || !h){ fuelCameraError.textContent = 'Camera not ready yet — wait a second and try again.'; return; }
  fuelCameraError.textContent = '';
  const maxDim = 1000;
  let outW = w, outH = h;
  if(w > h && w > maxDim){ outH = h * (maxDim/w); outW = maxDim; }
  else if(h > maxDim){ outW = w * (maxDim/h); outH = maxDim; }
  fuelCaptureCanvas.width = outW;
  fuelCaptureCanvas.height = outH;
  fuelCaptureCanvas.getContext('2d').drawImage(fuelCameraVideo, 0, 0, outW, outH);
  fuelCaptureCanvas.toBlob(blob => {
    fuelPhotos.push({ blob, previewUrl: fuelCaptureCanvas.toDataURL('image/jpeg', 0.75) });
    renderFuelThumbs();
    showToast(`Photo ${fuelPhotos.length} captured`);
  }, 'image/jpeg', 0.75);
});

submitChecklistBtn.addEventListener('click', async ()=>{
  if(fuelPhotos.length === 0) return;
  const lightBalance = lightBalanceInput.value.trim();
  if(!lightBalance){ checklistError.textContent = 'Enter the light prepaid balance.'; return; }

  submitChecklistBtn.disabled = true;
  fuelTakePhotoBtn.disabled = true;
  submitChecklistBtn.innerHTML = '<span class="spinner"></span>Uploading photos…';
  checklistError.textContent = '';
  try{
    const photoUrls = [];
    for(const p of fuelPhotos){
      const filename = `fuel-${Date.now()}-${Math.random().toString(36).slice(2,8)}.jpg`;
      const { error: uploadError } = await supabaseClient.storage
        .from('site-photos')
        .upload(filename, p.blob, { contentType: 'image/jpeg' });
      if(uploadError) throw new Error('Photo upload failed: ' + uploadError.message);
      const { data: urlData } = supabaseClient.storage.from('site-photos').getPublicUrl(filename);
      if(!urlData || !urlData.publicUrl) throw new Error('Could not get a link for the uploaded photo.');
      photoUrls.push(urlData.publicUrl);
    }

    submitChecklistBtn.innerHTML = '<span class="spinner"></span>Saving…';
    const { error: rpcError } = await supabaseClient.rpc('submit_shift_check', {
      p_name: currentName,
      p_pin: currentPin,
      p_light_balance: lightBalance,
      p_fuel_photo_urls: photoUrls
    });
    if(rpcError) throw new Error(rpcError.message.replace(/^.*?:\s*/, ''));

    showToast('Check submitted — thank you!');
    lightBalanceInput.value = '';
    fuelPhotos = [];
    renderFuelThumbs();
  }catch(e){
    checklistError.textContent = e.message || 'Something went wrong.';
  }finally{
    fuelTakePhotoBtn.disabled = false;
    submitChecklistBtn.textContent = 'Submit check';
    updateSubmitEnabled();
  }
});
