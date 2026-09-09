const nameInput = document.getElementById('nameInput');
const pinInput = document.getElementById('pinInput');
const statusPill = document.getElementById('statusPill');
const locationPill = document.getElementById('locationPill');
const signInBtn = document.getElementById('signInBtn');
const signOutBtn = document.getElementById('signOutBtn');
const capturePanel = document.getElementById('capturePanel');
const captureTitle = document.getElementById('captureTitle');
const cameraBox = document.getElementById('cameraBox');
const cameraVideo = document.getElementById('cameraVideo');
const photoPreview = document.getElementById('photoPreview');
const captureCanvas = document.getElementById('captureCanvas');
const cameraError = document.getElementById('cameraError');
const cameraActions = document.getElementById('cameraActions');
const confirmActions = document.getElementById('confirmActions');
const takePhotoBtn = document.getElementById('takePhotoBtn');
const retakeBtn = document.getElementById('retakeBtn');
const confirmBtn = document.getElementById('confirmBtn');
const cancelBtn = document.getElementById('cancelBtn');
const captureError = document.getElementById('captureError');
const mainError = document.getElementById('mainError');
const toastEl = document.getElementById('toast');

let pendingType = null;
let pendingBlob = null;
let cameraStream = null;
let workplaceSettings = null; // { workplace_lat, workplace_lng, radius_meters }

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

nameInput.value = localStorage.getItem('siteLogLastName') || '';

// ── Live "distance to site" badge ────────────────────────────────────────

async function initLocationBadge(){
  try{
    const { data, error } = await supabaseClient.rpc('get_workplace_settings');
    if(error) throw error;
    workplaceSettings = (data && data[0]) || null;

    if(!workplaceSettings || workplaceSettings.workplace_lat == null){
      locationPill.textContent = 'Not restricted';
      locationPill.className = 'status-pill none';
      return;
    }
    const coords = await getPosition();
    const dist = haversineMeters(coords.latitude, coords.longitude, workplaceSettings.workplace_lat, workplaceSettings.workplace_lng);
    if(dist <= workplaceSettings.radius_meters){
      locationPill.textContent = `At site (${Math.round(dist)} m)`;
      locationPill.className = 'status-pill in';
    } else {
      locationPill.textContent = `Too far (${Math.round(dist)} m away)`;
      locationPill.className = 'status-pill out';
    }
  }catch(e){
    locationPill.textContent = e.message && e.message.includes('denied') ? 'Location denied' : 'Location unavailable';
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

// ── Camera capture ──────────────────────────────────────────────────────

async function startCamera(){
  cameraError.textContent = '';
  try{
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 960 } },
      audio: false
    });
    cameraVideo.srcObject = cameraStream;
    cameraBox.style.display = 'block';
    photoPreview.style.display = 'none';
    cameraActions.style.display = 'flex';
    confirmActions.style.display = 'none';
  }catch(e){
    cameraError.textContent = 'Camera access is required to sign in/out — enable camera permission for this site and try again.';
  }
}

function stopCamera(){
  if(cameraStream){
    cameraStream.getTracks().forEach(t => t.stop());
    cameraStream = null;
  }
}

function openCapture(type){
  const name = nameInput.value.trim();
  const pin = pinInput.value.trim();
  mainError.textContent = '';
  if(!name){ mainError.textContent = 'Enter your name first.'; nameInput.focus(); return; }
  if(!/^\d{4,6}$/.test(pin)){ mainError.textContent = 'Enter a 4–6 digit PIN.'; pinInput.focus(); return; }

  pendingType = type;
  pendingBlob = null;
  captureTitle.textContent = (type === 'in' ? 'Sign in' : 'Sign out') + ' — take a photo';
  captureError.textContent = '';
  capturePanel.classList.add('open');
  capturePanel.scrollIntoView({behavior:'smooth', block:'nearest'});
  startCamera();
}

signInBtn.addEventListener('click', ()=> openCapture('in'));
signOutBtn.addEventListener('click', ()=> openCapture('out'));

cancelBtn.addEventListener('click', ()=>{
  stopCamera();
  capturePanel.classList.remove('open');
  pendingType = null; pendingBlob = null;
});

takePhotoBtn.addEventListener('click', ()=>{
  const w = cameraVideo.videoWidth, h = cameraVideo.videoHeight;
  if(!w || !h){ cameraError.textContent = 'Camera not ready yet — wait a second and try again.'; return; }
  const maxDim = 1000;
  let outW = w, outH = h;
  if(w > h && w > maxDim){ outH = h * (maxDim/w); outW = maxDim; }
  else if(h > maxDim){ outW = w * (maxDim/h); outH = maxDim; }
  captureCanvas.width = outW;
  captureCanvas.height = outH;
  captureCanvas.getContext('2d').drawImage(cameraVideo, 0, 0, outW, outH);
  captureCanvas.toBlob(blob => {
    pendingBlob = blob;
    photoPreview.src = captureCanvas.toDataURL('image/jpeg', 0.75);
    photoPreview.style.display = 'block';
    cameraBox.style.display = 'none';
    stopCamera();
    cameraActions.style.display = 'none';
    confirmActions.style.display = 'flex';
  }, 'image/jpeg', 0.75);
});

retakeBtn.addEventListener('click', ()=>{
  pendingBlob = null;
  photoPreview.style.display = 'none';
  confirmActions.style.display = 'none';
  startCamera();
});

confirmBtn.addEventListener('click', async ()=>{
  if(!pendingBlob || !pendingType) return;
  const name = nameInput.value.trim();
  const pin = pinInput.value.trim();
  confirmBtn.disabled = true;
  confirmBtn.innerHTML = '<span class="spinner"></span>Checking location…';
  captureError.textContent = '';
  try{
    // 1. Fresh location reading. Required if a workplace restriction is
    //    configured; otherwise we still attach it when available, but
    //    don't block the sign-in/out if it's not.
    const restricted = workplaceSettings && workplaceSettings.workplace_lat != null;
    let coords = { latitude: null, longitude: null };
    try{
      coords = await getPosition();
    }catch(locErr){
      if(restricted) throw locErr;
    }

    confirmBtn.innerHTML = '<span class="spinner"></span>Saving…';

    // 2. Upload the photo to Supabase Storage
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2,8)}.jpg`;
    const { error: uploadError } = await supabaseClient.storage
      .from('site-photos')
      .upload(filename, pendingBlob, { contentType: 'image/jpeg' });
    if(uploadError) throw new Error('Photo upload failed: ' + uploadError.message);

    const { data: urlData } = supabaseClient.storage.from('site-photos').getPublicUrl(filename);
    const photoUrl = urlData.publicUrl;

    // 3. Call the secure RPC function — PIN and geofence are both checked
    //    server-side, so this can't be spoofed from the browser.
    const fn = pendingType === 'in' ? 'site_check_in' : 'site_check_out';
    const { error: rpcError } = await supabaseClient.rpc(fn, {
      p_name: name,
      p_pin: pin,
      p_photo_url: photoUrl,
      p_lat: coords.latitude,
      p_lng: coords.longitude
    });
    if(rpcError) throw new Error(rpcError.message.replace(/^.*?:\s*/, ''));

    localStorage.setItem('siteLogLastName', name);
    capturePanel.classList.remove('open');
    showToast((pendingType === 'in' ? 'Signed in' : 'Signed out') + ' — logged with photo and location');
    refreshStatus();
    initLocationBadge();
  }catch(e){
    captureError.textContent = e.message || 'Something went wrong.';
  }finally{
    confirmBtn.disabled = false;
    confirmBtn.textContent = 'Confirm';
    pendingType = null; pendingBlob = null;
  }
});

refreshStatus();
initLocationBadge();
