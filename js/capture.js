// Shared by signin.html and signout.html. Which one it's running on is
// read from <body data-mode="in|out">, so this one file drives both pages.
const MODE = document.body.dataset.mode; // 'in' or 'out'
const MODE_LABEL = MODE === 'in' ? 'Sign In' : 'Sign Out';

const nameInput = document.getElementById('nameInput');
const pinInput = document.getElementById('pinInput');
const statusPill = document.getElementById('statusPill');
const locationPill = document.getElementById('locationPill');
const continueBtn = document.getElementById('continueBtn');
const capturePanel = document.getElementById('capturePanel');
const cameraBox = document.getElementById('cameraBox');
const cameraVideo = document.getElementById('cameraVideo');
const captureCanvas = document.getElementById('captureCanvas');
const cameraError = document.getElementById('cameraError');
const photoThumbs = document.getElementById('photoThumbs');
const takePhotoBtn = document.getElementById('takePhotoBtn');
const confirmBtn = document.getElementById('confirmBtn');
const cancelBtn = document.getElementById('cancelBtn');
const captureError = document.getElementById('captureError');
const mainError = document.getElementById('mainError');
const toastEl = document.getElementById('toast');
const successOverlay = document.getElementById('successOverlay');
const successTitle = document.getElementById('successTitle');
const successMessage = document.getElementById('successMessage');
const successCloseBtn = document.getElementById('successCloseBtn');

let capturedPhotos = []; // [{ blob, previewUrl }]
let cameraStream = null;
let workplaceSettings = null;

function showToast(msg, isError){
  toastEl.textContent = msg;
  toastEl.className = 'toast show' + (isError ? ' error' : '');
  setTimeout(()=>{ toastEl.className = 'toast'; }, 2800);
}

function fmtTime(iso){
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' });
}

function haversineMeters(lat1, lng1, lat2, lng2){
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dphi = toRad(lat2 - lat1);
  const dlambda = toRad(lng2 - lng1);
  const a = Math.sin(dphi/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dlambda/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function getPosition(){
  return new Promise((resolve, reject) => {
    if(!navigator.geolocation){ reject(new Error('Location is not supported on this device.')); return; }
    navigator.geolocation.getCurrentPosition(
      pos => resolve(pos.coords),
      err => reject(new Error(err.code === 1 ? 'Location permission denied. Enable it in your browser settings to sign in/out.' : 'Could not get your location. Try again.')),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );
  });
}

function getApproxPosition(){
  return new Promise((resolve, reject) => {
    if(!navigator.geolocation){ reject(new Error('Location is not supported on this device.')); return; }
    navigator.geolocation.getCurrentPosition(
      pos => resolve(pos.coords),
      err => reject(new Error(err.code === 1 ? 'Location denied' : 'Location unavailable')),
      { enableHighAccuracy: false, timeout: 6000, maximumAge: 30000 }
    );
  });
}

function withTimeout(promise, ms, timeoutMessage){
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(timeoutMessage)), ms))
  ]);
}

nameInput.value = localStorage.getItem('siteLogLastName') || '';

// ── Live "distance to site" badge ────────────────────────────────────────

async function initLocationBadge(){
  locationPill.textContent = 'Checking…';
  locationPill.className = 'status-pill none';
  try{
    const { data, error } = await withTimeout(supabaseClient.rpc('get_workplace_settings'), 8000, 'Location unavailable');
    if(error) throw error;
    workplaceSettings = (data && data[0]) || null;

    if(!workplaceSettings || workplaceSettings.workplace_lat == null){
      locationPill.textContent = 'Not restricted';
      locationPill.className = 'status-pill none';
      return;
    }
    const coords = await withTimeout(getApproxPosition(), 7000, 'Location unavailable');
    const dist = haversineMeters(coords.latitude, coords.longitude, workplaceSettings.workplace_lat, workplaceSettings.workplace_lng);
    if(dist <= workplaceSettings.radius_meters){
      locationPill.textContent = `At site (${Math.round(dist)} m)`;
      locationPill.className = 'status-pill in';
    } else {
      locationPill.textContent = `Too far (${Math.round(dist)} m away)`;
      locationPill.className = 'status-pill out';
    }
  }catch(e){
    locationPill.textContent = (e.message && e.message.includes('denied')) ? 'Location denied' : 'Location unavailable';
    locationPill.className = 'status-pill out';
  }
}

// ── Status ──────────────────────────────────────────────────────────────

async function refreshStatus(){
  const name = nameInput.value.trim();
  mainError.textContent = '';
  if(!name){
    statusPill.textContent = 'Not checked';
    statusPill.className = 'status-pill none';
    return;
  }
  try{
    const { data, error } = await supabaseClient.rpc('site_status', { p_name: name });
    if(error) throw error;
    const last = data && data[0];
    if(!last){
      statusPill.textContent = 'Not signed in yet';
      statusPill.className = 'status-pill none';
    } else if(last.type === 'in'){
      statusPill.textContent = 'Signed in — ' + fmtTime(last.created_at);
      statusPill.className = 'status-pill in';
    } else {
      statusPill.textContent = 'Signed out — ' + fmtTime(last.created_at);
      statusPill.className = 'status-pill out';
    }
  }catch(e){
    statusPill.textContent = 'Status unavailable';
    statusPill.className = 'status-pill none';
  }
}

let debounceTimer = null;
nameInput.addEventListener('input', ()=>{
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(refreshStatus, 350);
});

// ── Camera capture (multi-photo) ──────────────────────────────────────────

async function startCamera(){
  cameraError.textContent = '';
  try{
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 960 } },
      audio: false
    });
    cameraVideo.srcObject = cameraStream;
    cameraBox.style.display = 'block';
  }catch(e){
    cameraError.textContent = 'Camera access is required to ' + MODE_LABEL.toLowerCase() + ' — enable camera permission for this site and try again.';
  }
}

function stopCamera(){
  if(cameraStream){
    cameraStream.getTracks().forEach(t => t.stop());
    cameraStream = null;
  }
}

function renderThumbs(){
  photoThumbs.innerHTML = '';
  capturedPhotos.forEach((p, idx) => {
    const wrap = document.createElement('div');
    wrap.className = 'photo-thumb';
    wrap.innerHTML = `<img src="${p.previewUrl}" alt="Captured photo ${idx+1}"><button type="button" class="photo-thumb-remove" aria-label="Remove photo">×</button>`;
    wrap.querySelector('button').addEventListener('click', () => {
      capturedPhotos.splice(idx, 1);
      renderThumbs();
    });
    photoThumbs.appendChild(wrap);
  });
  confirmBtn.disabled = capturedPhotos.length === 0;
}

continueBtn.addEventListener('click', ()=>{
  const name = nameInput.value.trim();
  const pin = pinInput.value.trim();
  mainError.textContent = '';
  if(!name){ mainError.textContent = 'Enter your name first.'; nameInput.focus(); return; }
  if(!/^\d{4,6}$/.test(pin)){ mainError.textContent = 'Enter a 4–6 digit PIN.'; pinInput.focus(); return; }

  capturedPhotos = [];
  renderThumbs();
  captureError.textContent = '';
  capturePanel.classList.add('open');
  capturePanel.scrollIntoView({behavior:'smooth', block:'nearest'});
  startCamera();
});

cancelBtn.addEventListener('click', ()=>{
  stopCamera();
  capturePanel.classList.remove('open');
  capturedPhotos = [];
});

takePhotoBtn.addEventListener('click', ()=>{
  const w = cameraVideo.videoWidth, h = cameraVideo.videoHeight;
  if(!w || !h){ cameraError.textContent = 'Camera not ready yet — wait a second and try again.'; return; }
  cameraError.textContent = '';
  const maxDim = 1000;
  let outW = w, outH = h;
  if(w > h && w > maxDim){ outH = h * (maxDim/w); outW = maxDim; }
  else if(h > maxDim){ outW = w * (maxDim/h); outH = maxDim; }
  captureCanvas.width = outW;
  captureCanvas.height = outH;
  captureCanvas.getContext('2d').drawImage(cameraVideo, 0, 0, outW, outH);
  captureCanvas.toBlob(blob => {
    capturedPhotos.push({ blob, previewUrl: captureCanvas.toDataURL('image/jpeg', 0.75) });
    renderThumbs();
    showToast(`Photo ${capturedPhotos.length} captured`);
  }, 'image/jpeg', 0.75);
});

confirmBtn.addEventListener('click', async ()=>{
  if(capturedPhotos.length === 0) return;
  const name = nameInput.value.trim();
  const pin = pinInput.value.trim();
  confirmBtn.disabled = true;
  takePhotoBtn.disabled = true;
  confirmBtn.innerHTML = '<span class="spinner"></span>Checking location…';
  captureError.textContent = '';
  try{
    const restricted = workplaceSettings && workplaceSettings.workplace_lat != null;
    let coords = { latitude: null, longitude: null };
    try{
      coords = await getPosition();
    }catch(locErr){
      if(restricted) throw locErr;
    }

    confirmBtn.innerHTML = '<span class="spinner"></span>Uploading photos…';

    const photoUrls = [];
    for(const p of capturedPhotos){
      const filename = `${Date.now()}-${Math.random().toString(36).slice(2,8)}.jpg`;
      const { error: uploadError } = await supabaseClient.storage
        .from('site-photos')
        .upload(filename, p.blob, { contentType: 'image/jpeg' });
      if(uploadError) throw new Error('Photo upload failed: ' + uploadError.message);
      const { data: urlData } = supabaseClient.storage.from('site-photos').getPublicUrl(filename);
      if(!urlData || !urlData.publicUrl) throw new Error('Could not get a link for the uploaded photo.');
      photoUrls.push(urlData.publicUrl);
    }

    confirmBtn.innerHTML = '<span class="spinner"></span>Saving…';
    stopCamera();

    const fn = MODE === 'in' ? 'site_check_in' : 'site_check_out';
    const { error: rpcError } = await supabaseClient.rpc(fn, {
      p_name: name,
      p_pin: pin,
      p_photo_urls: photoUrls,
      p_lat: coords.latitude,
      p_lng: coords.longitude
    });
    if(rpcError) throw new Error(rpcError.message.replace(/^.*?:\s*/, ''));

    localStorage.setItem('siteLogLastName', name);
    capturePanel.classList.remove('open');
    showSuccessOverlay(photoUrls.length);
    refreshStatus();
    initLocationBadge();
  }catch(e){
    captureError.textContent = e.message || 'Something went wrong.';
  }finally{
    confirmBtn.disabled = capturedPhotos.length === 0;
    takePhotoBtn.disabled = false;
    confirmBtn.textContent = 'Confirm';
    capturedPhotos = [];
  }
});

// ── Success overlay ────────────────────────────────────────────────────

function showSuccessOverlay(photoCount){
  if(MODE === 'in'){
    successTitle.textContent = 'Sign In Successful';
    successMessage.textContent = `You're logged in with ${photoCount} photo${photoCount > 1 ? 's' : ''} and your location.`;
  } else {
    successTitle.textContent = 'Sign Out Successful';
    successMessage.textContent = `You're logged out with ${photoCount} photo${photoCount > 1 ? 's' : ''} and your location. Have a great rest of your day!`;
  }
  successOverlay.classList.add('open');
}

successCloseBtn.addEventListener('click', ()=>{
  successOverlay.classList.remove('open');
  window.location.href = '/index.html';
});

refreshStatus();
initLocationBadge();
