// Mobile Check-in Logic
// Apple Glassmorphism Biometric Attendance

let flowMode = 'direct'; // 'direct' or 'kiosk'
let sessionId = null;
let isScanningActive = false;

let mediaStream = null;
let capturedPhotoBase64 = null;

const badge = document.getElementById('sync-mode-badge');
const title = document.getElementById('portal-title');
const usernameField = document.getElementById('username-field');
const scanBtn = document.getElementById('trigger-scan-btn');
const statusLabel = document.getElementById('verification-status-label');

const bioStatus = document.getElementById('biometric-support-status');
const gpsStatus = document.getElementById('gps-support-status');
const successOverlay = document.getElementById('mobile-success-overlay');

const video = document.getElementById('video-stream');
const canvas = document.getElementById('photo-canvas');
const preview = document.getElementById('photo-preview');
const cameraFrame = document.getElementById('camera-frame');

document.addEventListener('DOMContentLoaded', () => {
    // 1. Detect Mode from URL
    const urlParams = new URLSearchParams(window.location.search);
    sessionId = urlParams.get('session');
    
    if (sessionId) {
        flowMode = 'kiosk';
        badge.style.display = 'block';
        title.textContent = "Kiosk Check-In / Out";
        statusLabel.textContent = "Tap fingerprint to verify Check-In / Out";
    }
    
    // 2. Verify Biometric Support
    checkBiometricSupport();
    
    // 3. Start Camera preview
    startCamera();
    
    // 4. Setup Scan Trigger
    scanBtn.onclick = startVerificationFlow;

    // 5. Setup File Upload fallback trigger
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
    const fallbackOverlay = document.getElementById('camera-fallback-overlay');
    if (fallbackOverlay) fallbackOverlay.style.display = 'none';
    
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
    } catch (e) {
        console.warn("Camera access failed, activating file upload fallback:", e);
        video.style.display = 'none';
        preview.style.display = 'none';
        if (fallbackOverlay) fallbackOverlay.style.display = 'flex';
        showToast("Camera blocked. Tap camera box to upload a selfie photo", "info");
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
            const fallbackOverlay = document.getElementById('camera-fallback-overlay');
            if (fallbackOverlay) fallbackOverlay.style.display = 'none';
            cameraFrame.classList.add('photo-captured');
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
    // If a fallback photo was already uploaded, do not overwrite it
    if (cameraFrame.classList.contains('photo-captured') && capturedPhotoBase64) {
        return;
    }

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
}

function checkBiometricSupport() {
    const isSecure = window.isSecureContext;
    const hasWebauthn = !!navigator.credentials;
    const isIP = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(window.location.hostname);
    
    if (!isSecure || !hasWebauthn || isIP) {
        bioStatus.textContent = "Simulation Mode (HTTP/IP)";
        bioStatus.style.color = 'var(--system-amber)';
    } else {
        bioStatus.textContent = "Native Fingerprint Ready";
        bioStatus.style.color = 'var(--system-green)';
    }
}

async function startVerificationFlow() {
    if (isScanningActive) return;
    
    const username = usernameField.value.trim();
    if (!username) {
        showToast("Please enter your Username / ID first", "error");
        usernameField.focus();
        return;
    }

    // Capture the photo before executing the check!
    capturePhoto();
    
    if (!capturedPhotoBase64) {
        showToast("Selfie verification photo is required to check in/out", "error");
        return;
    }
    
    isScanningActive = true;
    scanBtn.classList.add('scanning');
    statusLabel.textContent = "Requesting GPS coordinates...";
    gpsStatus.textContent = "Requesting access...";
    gpsStatus.style.color = 'var(--system-blue)';
    
    // Step 1: Geolocation Capture
    navigator.geolocation.getCurrentPosition(
        async (position) => {
            const lat = position.coords.latitude;
            const lon = position.coords.longitude;
            
            gpsStatus.textContent = `Locked (${lat.toFixed(4)}, ${lon.toFixed(4)})`;
            gpsStatus.style.color = 'var(--system-green)';
            
            // Proceed to Step 2: Biometric check
            await executeBiometricCheck(username, lat, lon);
        },
        (error) => {
            console.error("GPS Error:", error);
            let errMsg = "GPS coordinates required for verification";
            if (error.code === error.PERMISSION_DENIED) {
                errMsg = "Location access denied. Please enable GPS.";
            }
            showToast(errMsg, "error");
            
            gpsStatus.textContent = "Location Denied";
            gpsStatus.style.color = 'var(--system-red)';
            resetVerificationState();
        },
        { enableHighAccuracy: true, timeout: 8000 }
    );
}

function resetVerificationState() {
    isScanningActive = false;
    scanBtn.className = "fingerprint-container";
    statusLabel.textContent = "Tap fingerprint to start Check-In / Out";
    
    // Reset camera preview only if not a fallback uploaded photo
    const fallbackOverlay = document.getElementById('camera-fallback-overlay');
    if (mediaStream && !(fallbackOverlay && fallbackOverlay.style.display === 'flex')) {
        preview.style.display = 'none';
        video.style.display = 'block';
        cameraFrame.classList.remove('photo-captured');
        capturedPhotoBase64 = null;
    }
}

async function executeBiometricCheck(username, lat, lon) {
    statusLabel.textContent = "Requesting server challenge...";
    
    try {
        const optionsRes = await fetch('/api/webauthn/login/options', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username })
        });
        
        if (!optionsRes.ok) {
            const err = await optionsRes.json();
            showToast(`User verification failed: ${err.detail}`, 'error');
            resetVerificationState();
            return;
        }
        
        const options = await optionsRes.json();
        
        if (options.is_mock) {
            // Trigger simulated fingerprint prompt
            runFingerprintScanner(username, false, async (mockCred) => {
                statusLabel.textContent = "Submitting verification log...";
                await submitCheckInData(username, lat, lon, options.challenge, mockCred, true);
            }, () => {
                showToast("Verification cancelled", "info");
                resetVerificationState();
            });
        } else {
            // Real WebAuthn assertion
            statusLabel.textContent = "Awaiting native biometric scan...";
            
            const challengeBuffer = base64UrlToBuffer(options.challenge);
            const allowCreds = options.allowCredentials.map(cred => ({
                id: base64UrlToBuffer(cred.id),
                type: cred.type
            }));
            
            const credentialGetOptions = {
                publicKey: {
                    challenge: challengeBuffer,
                    allowCredentials: allowCreds,
                    userVerification: 'required',
                    rpId: window.location.hostname
                }
            };
            
            showToast("Fingerprint requested. Tap biometric sensor...", "info");
            const assertion = await navigator.credentials.get(credentialGetOptions);
            
            const clientDataJSON = bufferToBase64Url(assertion.response.clientDataJSON);
            const authenticatorData = bufferToBase64Url(assertion.response.authenticatorData);
            const signature = bufferToBase64Url(assertion.response.signature);
            const userHandle = assertion.response.userHandle ? bufferToBase64Url(assertion.response.userHandle) : null;
            
            const realCredential = {
                id: assertion.id,
                rawId: bufferToBase64Url(assertion.rawId),
                type: assertion.type,
                response: {
                    clientDataJSON,
                    authenticatorData,
                    signature,
                    userHandle
                }
            };
            
            statusLabel.textContent = "Submitting verification log...";
            await submitCheckInData(username, lat, lon, options.challenge, realCredential, false);
        }
    } catch (e) {
        console.error(e);
        showToast("Biometric verification cancelled or failed", "error");
        resetVerificationState();
    }
}

async function submitCheckInData(username, lat, lon, challenge, credential, isMock) {
    try {
        let res;
        
        if (flowMode === 'kiosk') {
            // Sync with Desktop session
            res = await fetch(`/api/sessions/${sessionId}/verify`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username,
                    latitude: lat,
                    longitude: lon,
                    challenge,
                    credential,
                    is_mock: isMock,
                    photo: capturedPhotoBase64
                })
            });
        } else {
            // Direct Mobile Check-in
            res = await fetch('/api/webauthn/login/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    challenge,
                    credential,
                    is_mock: isMock,
                    latitude: lat,
                    longitude: lon,
                    photo: capturedPhotoBase64
                })
            });
        }
        
        if (res.ok) {
            // Display success
            scanBtn.className = "fingerprint-container success";
            statusLabel.textContent = "Check-In / Out Complete!";
            
            playChime(true);
            
            // Stop camera tracking on complete
            stopCamera();
            
            if (flowMode === 'kiosk') {
                document.getElementById('success-description-label').textContent = "Attendance verified & synchronized with desktop checkpoint.";
                document.getElementById('success-redirect-timer').textContent = "You can close this window now.";
                successOverlay.classList.add('active');
            } else {
                document.getElementById('success-description-label').textContent = "Direct biometric attendance logged successfully.";
                document.getElementById('success-redirect-timer').textContent = "Redirecting to dashboard in 3s...";
                successOverlay.classList.add('active');
                
                setTimeout(() => {
                    window.location.href = '/';
                }, 3000);
            }
        } else {
            const err = await res.json();
            showToast(`Attendance submission failed: ${err.detail}`, 'error');
            resetVerificationState();
        }
    } catch (e) {
        console.error(e);
        showToast("Connection error submitting attendance", "error");
        resetVerificationState();
    }
}
