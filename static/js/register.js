// User Onboarding Registration & Sync Logic
// Apple Glassmorphism Biometric Attendance

let mediaStream = null;
let capturedPhotoBase64 = null;
let registrationSessionId = null;
let registrationPollInterval = null;
let registerRedirectUrl = null;

let isSyncModeMobile = false; // true if mobile phone scanned QR and is performing the enrollment
let syncUserDetails = null;

const video = document.getElementById('video-stream');
const canvas = document.getElementById('photo-canvas');
const preview = document.getElementById('photo-preview');
const cameraFrame = document.getElementById('camera-frame');
const cameraSection = document.getElementById('camera-section');

const snapBtn = document.getElementById('snap-btn');
const retakeBtn = document.getElementById('retake-btn');
const roleSelect = document.getElementById('role-select');
const securityCodeContainer = document.getElementById('security-code-container');
const securityCodeInput = document.getElementById('security-code-input');
const enrollBtn = document.getElementById('enroll-btn');

const formContainer = document.getElementById('onboarding-form-container');
const qrContainer = document.getElementById('onboarding-qr-container');
const qrElement = document.getElementById('onboarding-qr-element');
const syncStatusText = document.getElementById('onboarding-sync-status-text');

document.addEventListener('DOMContentLoaded', () => {
    // 1. Detect Mode: Check if URL has ?session=...
    const urlParams = new URLSearchParams(window.location.search);
    registrationSessionId = urlParams.get('session');
    
    if (registrationSessionId) {
        // MOBILE SYNC MODE (Scanned QR)
        isSyncModeMobile = true;
        setupMobileSyncUI();
    } else {
        // STANDARD MODE (Desktop or Direct Mobile)
        setupStandardUI();
    }
    
    // 2. Setup Camera Buttons
    snapBtn.onclick = capturePhoto;
    retakeBtn.onclick = retakePhoto;
    
    // 3. Setup Role change checking
    roleSelect.onchange = toggleSecurityCodeField;
    toggleSecurityCodeField();
    
    // Make QR Element clickable for local testing
    qrElement.style.cursor = 'pointer';
    qrElement.title = "Click to open mobile enrollment link in new tab";
    qrElement.onclick = () => {
        if (registerRedirectUrl) {
            window.open(registerRedirectUrl, '_blank');
        }
    };
    
    // 4. Setup File Upload fallback trigger
    const fileInput = document.getElementById('fallback-file-input');
    cameraFrame.onclick = () => {
        const overlay = document.getElementById('camera-fallback-overlay');
        if (overlay && overlay.style.display === 'flex') {
            fileInput.click();
        }
    };
    fileInput.onchange = handleFallbackFileSelect;
});

// Camera activation with File Upload fallback for HTTP/non-localhost origins
async function startCamera() {
    document.getElementById('camera-fallback-overlay').style.display = 'none';
    
    try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error("Camera API not supported on this browser/origin");
        }
        
        mediaStream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: 300,
                height: 300,
                facingMode: 'user'
            },
            audio: false
        });
        video.srcObject = mediaStream;
        video.style.display = 'block';
        preview.style.display = 'none';
        snapBtn.style.display = 'inline-flex';
    } catch (e) {
        console.warn("Camera access failed, activating file upload fallback:", e);
        video.style.display = 'none';
        preview.style.display = 'none';
        snapBtn.style.display = 'none';
        document.getElementById('camera-fallback-overlay').style.display = 'flex';
        showToast("Camera restricted on HTTP. Tap circle to upload photo", "info");
    }
}

function handleFallbackFileSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = function(event) {
        const img = new Image();
        img.onload = function() {
            // Draw image on canvas to resize it to 300x300 squares
            const ctx = canvas.getContext('2d');
            const minDim = Math.min(img.width, img.height);
            const sx = (img.width - minDim) / 2;
            const sy = (img.height - minDim) / 2;
            
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, canvas.width, canvas.height);
            
            capturedPhotoBase64 = canvas.toDataURL('image/jpeg', 0.82);
            
            preview.src = capturedPhotoBase64;
            preview.style.display = 'block';
            document.getElementById('camera-fallback-overlay').style.display = 'none';
            cameraFrame.classList.add('photo-captured');
            
            snapBtn.style.display = 'none';
            retakeBtn.style.display = 'inline-flex';
            retakeBtn.textContent = "Change Photo";
        };
        img.src = event.target.result;
    };
    reader.readAsDataURL(file);
}

// Stop camera tracks
function stopCamera() {
    if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
        mediaStream = null;
    }
}

// Snapshot photo
function capturePhoto() {
    if (!mediaStream) return;
    
    const ctx = canvas.getContext('2d');
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    ctx.setTransform(1, 0, 0, 1, 0, 0); // reset
    
    capturedPhotoBase64 = canvas.toDataURL('image/jpeg', 0.82);
    
    preview.src = capturedPhotoBase64;
    preview.style.display = 'block';
    video.style.display = 'none';
    cameraFrame.classList.add('photo-captured');
    
    snapBtn.style.display = 'none';
    retakeBtn.style.display = 'inline-flex';
    
    stopCamera();
}

function retakePhoto() {
    capturedPhotoBase64 = null;
    cameraFrame.classList.remove('photo-captured');
    preview.src = '';
    preview.style.display = 'none';
    snapBtn.style.display = 'inline-flex';
    retakeBtn.style.display = 'none';
    
    startCamera();
}

// Role visibility checks
function toggleSecurityCodeField() {
    if (isSyncModeMobile) return;
    
    const role = roleSelect.value;
    if (role === 'Admin' || role === 'Teacher') {
        securityCodeContainer.style.display = 'block';
        securityCodeInput.required = true;
    } else {
        securityCodeContainer.style.display = 'none';
        securityCodeInput.required = false;
        securityCodeInput.value = '';
    }
    
    // Toggle Department selection for students
    const deptContainer = document.getElementById('department-container');
    const deptSelect = document.getElementById('department-select');
    if (role === 'Student') {
        deptContainer.style.display = 'block';
        deptSelect.required = true;
    } else {
        deptContainer.style.display = 'none';
        deptSelect.required = false;
        deptSelect.value = '';
    }
    
    // Toggle Username Input Label and Placeholder based on Role
    const usernameLabel = document.querySelector('label[for="username-input"]');
    const usernameInput = document.getElementById('username-input');
    if (usernameLabel && usernameInput) {
        if (role === 'Student') {
            usernameLabel.innerHTML = 'Roll No <span style="color: var(--system-red);">*</span>';
            usernameInput.placeholder = "e.g. 2026/CSE/01";
        } else {
            usernameLabel.innerHTML = 'Employee ID <span style="color: var(--system-red);">*</span>';
            usernameInput.placeholder = "e.g. EMP1001";
        }
    }
}

// Shared helper for successful registrations
function handleRegistrationSuccess(name, role, isRemoteSync) {
    let successMsg = `Successfully registered ${name} as ${role}!`;
    if (role !== 'Admin') {
        successMsg += " Approval is pending. Please contact the administrator.";
    }
    showToast(successMsg, 'success');
    playChime(true);
    
    if (isRemoteSync) {
        enrollBtn.textContent = "Synced. Waiting for admin approval.";
        const syncText = document.getElementById('onboarding-sync-status-text');
        if (syncText) {
            syncText.textContent = "Enrollment synced successfully! Approval is pending from admin. Please contact the administrator.";
            syncText.style.color = "var(--system-amber)";
        }
    } else {
        setTimeout(() => window.location.href = '/', 3500); // Give user enough time to read the toast
    }
}

// --- STANDARD REGISTRATION FLOW (On-device capture/enroll) ---

function setupStandardUI() {
    startCamera();
    
    // Enroll via mobile QR button trigger
    document.getElementById('enroll-qr-btn').onclick = startMobileRegistrationSync;
    
    // On-device submit handler
    document.getElementById('register-form').onsubmit = handleOnDeviceRegistration;
}

// Handler for local device enrollment
async function handleOnDeviceRegistration(e) {
    e.preventDefault();
    
    const username = document.getElementById('username-input').value.trim();
    const name = document.getElementById('name-input').value.trim();
    const role = roleSelect.value;
    const code = securityCodeInput.value.trim();
    const departmentSelect = document.getElementById('department-select');
    const department = role === 'Student' ? departmentSelect.value : null;
    
    if (role === 'Student' && !department) {
        showToast("Please select a Department & Semester", "error");
        return;
    }
    
    if (!capturedPhotoBase64) {
        showToast("Profile photo capture is required", "error");
        return;
    }
    
    enrollBtn.disabled = true;
    enrollBtn.textContent = "Requesting Registration options...";
    
    try {
        const optionsRes = await fetch('/api/webauthn/register/options', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, name, role, photo: capturedPhotoBase64, code, department })
        });
        
        if (!optionsRes.ok) {
            const err = await optionsRes.json();
            showToast(`Registration failed: ${err.detail}`, 'error');
            enrollBtn.disabled = false;
            enrollBtn.textContent = "Enroll Fingerprint & Save on this device";
            return;
        }
        
        const options = await optionsRes.json();
        await executeBiometricRegistration(username, name, role, options, capturedPhotoBase64, false);
        
    } catch (e) {
        console.error(e);
        showToast("Biometric enrollment failed", "error");
        enrollBtn.disabled = false;
        enrollBtn.textContent = "Enroll Fingerprint & Save on this device";
    }
}

// --- DESKTOP -> MOBILE REGISTRATION REDIRECT FLOW ---

async function startMobileRegistrationSync() {
    const username = document.getElementById('username-input').value.trim();
    const name = document.getElementById('name-input').value.trim();
    const role = roleSelect.value;
    const code = securityCodeInput.value.trim();
    const departmentSelect = document.getElementById('department-select');
    const department = role === 'Student' ? departmentSelect.value : null;
    
    if (!username || !name) {
        showToast("Please fill out Username and Full Name first", "error");
        return;
    }
    
    if (role === 'Student' && !department) {
        showToast("Please select a Department & Semester", "error");
        return;
    }
    
    if ((role === 'Admin' || role === 'Teacher') && !code) {
        showToast("Security Access Code is required for Admin/Teacher", "error");
        return;
    }
    
    try {
        // Create registration session
        const res = await fetch('/api/register-sessions/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, name, role, code, department })
        });
        
        if (!res.ok) {
            const err = await res.json();
            showToast(`Failed to initialize session: ${err.detail}`, 'error');
            return;
        }
        
        const data = await res.json();
        registrationSessionId = data.session_id;
        
        registerRedirectUrl = data.redirect_url;
        
        // Render QR using public API (eliminates qrcodejs library dependency)
        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&margin=10&data=${encodeURIComponent(registerRedirectUrl)}`;
        qrElement.innerHTML = `<img src="${qrUrl}" alt="Onboarding Link QR" style="max-width:100%; height:auto; border-radius:var(--radius-medium);">`;
        
        // Transition layouts
        formContainer.style.display = 'none';
        cameraSection.style.display = 'none';
        qrContainer.style.display = 'block';
        
        document.getElementById('register-title').textContent = "Desktop-Mobile Sync";
        document.getElementById('register-subtitle').textContent = "Scan the QR code to take photo & enroll fingerprint";
        
        // Start polling verification status
        registrationPollInterval = setInterval(checkRegistrationSessionStatus, 1500);
        
        // Setup Cancel button inside QR view
        document.getElementById('cancel-qr-enroll-btn').onclick = () => {
            clearInterval(registrationPollInterval);
            formContainer.style.display = 'block';
            cameraSection.style.display = 'flex';
            qrContainer.style.display = 'none';
            document.getElementById('register-title').textContent = "User Onboarding";
            document.getElementById('register-subtitle').textContent = "Register biometric credentials & capture photo";
            startCamera();
        };
        
        stopCamera();
        
    } catch (e) {
        console.error("Registration sync session error:", e);
        showToast(`Error creating registration session: ${e.message || e}`, "error");
    }
}

async function checkRegistrationSessionStatus() {
    if (!registrationSessionId) return;
    
    try {
        const res = await fetch(`/api/register-sessions/${registrationSessionId}/status`);
        if (!res.ok) {
            clearInterval(registrationPollInterval);
            showToast("Registration session expired", "error");
            location.reload();
            return;
        }
        
        const session = await res.json();
        if (session.status === 'verified') {
            clearInterval(registrationPollInterval);
            
            // Pop success overlay
            document.getElementById('register-success-user-photo').src = session.photo;
            document.getElementById('register-success-user-name').textContent = session.name;
            document.getElementById('register-success-user-detail').textContent = `Role: ${session.role} | Biometrics Synchronized`;
            
            playChime(true);
            document.getElementById('register-success-overlay').classList.add('active');
            
            setTimeout(() => {
                window.location.href = '/';
            }, 5000);
        }
    } catch (e) {
        console.error(e);
    }
}

// --- MOBILE SIDE ONBOARDING HANDLER (Camera + Fingerprint Sync) ---

async function setupMobileSyncUI() {
    // Hide the input fields and desktop button, but keep the submit button container active!
    document.getElementById('registration-inputs-group').style.display = 'none';
    document.getElementById('enroll-qr-btn').style.display = 'none';
    
    // Disable required validation for these inputs on mobile so the browser doesn't block submit!
    document.getElementById('username-input').required = false;
    document.getElementById('name-input').required = false;
    document.getElementById('role-select').required = false;
    document.getElementById('security-code-input').required = false;
    document.getElementById('department-select').required = false;
    
    // Fetch details
    try {
        const res = await fetch(`/api/register-sessions/${registrationSessionId}/status`);
        if (!res.ok) {
            showToast("Session expired or invalid", "error");
            setTimeout(() => window.location.href = '/', 2000);
            return;
        }
        
        syncUserDetails = await res.json();
        
        // Update Title to show user details
        document.getElementById('register-title').textContent = "Enroll details on Mobile";
        const deptInfo = syncUserDetails.department ? ` - ${syncUserDetails.department}` : '';
        document.getElementById('register-subtitle').textContent = `User: ${syncUserDetails.name} (${syncUserDetails.role}${deptInfo})`;
        
        // Activate camera
        startCamera();
        
        // Configure submit button
        enrollBtn.textContent = "Complete Enrollment & Register";
        
        // Add mobile-sync submit handler
        document.getElementById('register-form').onsubmit = handleMobileSyncEnrollment;
        
    } catch (e) {
        showToast("Network error getting session data", "error");
    }
}

async function handleMobileSyncEnrollment(e) {
    e.preventDefault();
    
    if (!capturedPhotoBase64) {
        showToast("Please capture a profile snapshot first", "error");
        return;
    }
    
    enrollBtn.disabled = true;
    enrollBtn.textContent = "Requesting challenge options...";
    
    try {
        // Fetch options mapping from session options API
        const optionsRes = await fetch(`/api/register-sessions/${registrationSessionId}/options`, {
            method: 'POST'
        });
        
        if (!optionsRes.ok) {
            const err = await optionsRes.json();
            showToast(`Enroll options failed: ${err.detail}`, 'error');
            enrollBtn.disabled = false;
            enrollBtn.textContent = "Complete Enrollment & Register";
            return;
        }
        
        const options = await optionsRes.json();
        
        await executeBiometricRegistration(
            syncUserDetails.username, 
            syncUserDetails.name, 
            syncUserDetails.role, 
            options, 
            capturedPhotoBase64, 
            true
        );
        
    } catch (e) {
        console.error(e);
        showToast("Enrollment process error", "error");
        enrollBtn.disabled = false;
        enrollBtn.textContent = "Complete Enrollment & Register";
    }
}

// --- BIOMETRIC CALLOUT & VERIFICATION ENGINE (Re-used by local/remote registration) ---

async function executeBiometricRegistration(username, name, role, options, photoBase64, isRemoteSync) {
    const verifyUrl = isRemoteSync 
        ? `/api/register-sessions/${registrationSessionId}/verify` 
        : '/api/webauthn/register/verify';
        
    // Query geolocation at the time of registration
    const location = await getUserLocation();
        
    if (options.is_mock) {
        // Simulator Fallback scan
        runFingerprintScanner(username, true, async (mockCred) => {
            enrollBtn.textContent = "Submitting registration data...";
            
            const payload = {
                photo: photoBase64,
                credential: mockCred,
                is_mock: true,
                challenge: options.challenge,
                latitude: location.latitude,
                longitude: location.longitude
            };
            // For standard registration, structure matches RegisterVerifyRequest
            const finalPayload = isRemoteSync ? payload : {
                challenge: options.challenge,
                credential: mockCred,
                is_mock: true,
                latitude: location.latitude,
                longitude: location.longitude
            };
            
            const verifyRes = await fetch(verifyUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(finalPayload)
            });
            
            if (verifyRes.ok) {
                handleRegistrationSuccess(name, role, isRemoteSync);
            } else {
                const err = await verifyRes.json();
                showToast(`Verification failed: ${err.detail}`, 'error');
                enrollBtn.disabled = false;
                enrollBtn.textContent = isRemoteSync ? "Complete Enrollment & Register" : "Enroll Fingerprint & Save on this device";
            }
        }, () => {
            showToast("Biometric scan cancelled", "info");
            enrollBtn.disabled = false;
            enrollBtn.textContent = isRemoteSync ? "Complete Enrollment & Register" : "Enroll Fingerprint & Save on this device";
        });
    } else {
        // Real WebAuthn assertion
        try {
            enrollBtn.textContent = "Waiting for Fingerprint...";
            
            const challengeBuffer = base64UrlToBuffer(options.challenge);
            const userBuffer = base64UrlToBuffer(options.user.id);
            
            const credentialCreationOptions = {
                publicKey: {
                    challenge: challengeBuffer,
                    rp: {
                        name: options.rp.name,
                        id: window.location.hostname
                    },
                    user: {
                        id: userBuffer,
                        name: options.user.name,
                        displayName: options.user.displayName
                    },
                    pubKeyCredParams: options.pubKeyCredParams.map(param => ({
                        type: param.type,
                        alg: param.alg
                    })),
                    authenticatorSelection: {
                        authenticatorAttachment: 'platform',
                        userVerification: 'required',
                        residentKey: 'preferred'
                    },
                    timeout: 60000
                }
            };
            
            showToast("Biometric prompt activated. Please tap your scanner", "info");
            const credential = await navigator.credentials.create(credentialCreationOptions);
            
            const clientDataJSON = bufferToBase64Url(credential.response.clientDataJSON);
            const attestationObject = bufferToBase64Url(credential.response.attestationObject);
            const transports = credential.response.getTransports ? credential.response.getTransports() : [];
            
            const realCredential = {
                id: credential.id,
                rawId: bufferToBase64Url(credential.rawId),
                type: credential.type,
                response: {
                    clientDataJSON,
                    attestationObject,
                    transports
                }
            };
            
            enrollBtn.textContent = "Verifying Credentials...";
            
            const payload = {
                photo: photoBase64,
                credential: realCredential,
                is_mock: false,
                challenge: options.challenge,
                latitude: location.latitude,
                longitude: location.longitude
            };
            const finalPayload = isRemoteSync ? payload : {
                challenge: options.challenge,
                credential: realCredential,
                is_mock: false,
                latitude: location.latitude,
                longitude: location.longitude
            };
            
            const verifyRes = await fetch(verifyUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(finalPayload)
            });
            
            if (verifyRes.ok) {
                handleRegistrationSuccess(name, role, isRemoteSync);
            } else {
                const err = await verifyRes.json();
                showToast(`Biometric verify error: ${err.detail}`, 'error');
                enrollBtn.disabled = false;
                enrollBtn.textContent = isRemoteSync ? "Complete Enrollment & Register" : "Enroll Fingerprint & Save on this device";
            }
        } catch (e) {
            console.error(e);
            showToast("Biometric scan cancelled or failed", "error");
            enrollBtn.disabled = false;
            enrollBtn.textContent = isRemoteSync ? "Complete Enrollment & Register" : "Enroll Fingerprint & Save on this device";
        }
    }
}

// Window safety
window.onbeforeunload = () => {
    stopCamera();
    if (registrationPollInterval) clearInterval(registrationPollInterval);
};

// Geolocation helper for enrollment location lock
function getUserLocation() {
    return new Promise((resolve) => {
        if (!navigator.geolocation) {
            resolve({ latitude: null, longitude: null });
            return;
        }
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                resolve({
                    latitude: pos.coords.latitude,
                    longitude: pos.coords.longitude
                });
            },
            (err) => {
                console.warn("Geolocation warning: ", err);
                resolve({ latitude: null, longitude: null });
            },
            { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
        );
    });
}
