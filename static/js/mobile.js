// Mobile Check-in Logic
// Apple Glassmorphism Biometric Attendance

let flowMode = 'direct'; // 'direct' or 'kiosk'
let sessionId = null;
let isScanningActive = false;

const badge = document.getElementById('sync-mode-badge');
const title = document.getElementById('portal-title');
const usernameField = document.getElementById('username-field');
const scanBtn = document.getElementById('trigger-scan-btn');
const statusLabel = document.getElementById('verification-status-label');

const bioStatus = document.getElementById('biometric-support-status');
const gpsStatus = document.getElementById('gps-support-status');
const successOverlay = document.getElementById('mobile-success-overlay');

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
    
    // 3. Setup Scan Trigger
    scanBtn.onclick = startVerificationFlow;
});

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
                    is_mock: isMock
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
                    longitude: lon
                })
            });
        }
        
        if (res.ok) {
            // Display success
            scanBtn.className = "fingerprint-container success";
            statusLabel.textContent = "Check-In / Out Complete!";
            
            playChime(true);
            
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
