// Checkpoint Kiosk Sync Coordination
// Apple Glassmorphism Biometric Attendance

let sessionPollInterval = null;
let currentSessionId = null;
let redirectUrl = null;

const qrContainer = document.getElementById('qr-code-element');
const statusText = document.getElementById('sync-status-text');
const successOverlay = document.getElementById('checkpoint-success-overlay');

document.addEventListener('DOMContentLoaded', () => {
    // Generate QR session on load
    startNewSyncSession();
    
    // Make QR Box clickable for easier localhost double-device testing
    const qrBox = document.querySelector('.qr-box');
    qrBox.style.cursor = 'pointer';
    qrBox.title = "Click to open mobile link in new tab (Local testing)";
    qrBox.onclick = () => {
        if (redirectUrl) {
            window.open(redirectUrl, '_blank');
        }
    };
});

async function startNewSyncSession() {
    // Stop any active polling
    stopPolling();
    
    // Clear old QR code
    qrContainer.innerHTML = '';
    statusText.textContent = "Requesting secure session link...";
    
    try {
        const res = await fetch('/api/sessions/create', { method: 'POST' });
        if (!res.ok) {
            statusText.textContent = "Connection failed. Retrying...";
            setTimeout(startNewSyncSession, 3000);
            return;
        }
        
        const data = await res.json();
        currentSessionId = data.session_id;
        
        redirectUrl = data.redirect_url;
        
        // Generate QR code using public API (eliminates qrcodejs library dependency)
        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&margin=10&data=${encodeURIComponent(redirectUrl)}`;
        qrContainer.innerHTML = `<img src="${qrUrl}" alt="Kiosk Sync Link QR" style="max-width:100%; height:auto; border-radius:var(--radius-medium);">`;
        
        statusText.textContent = "Scan QR code to check-in";
        
        // Start polling verification status
        startPolling();
        
    } catch (e) {
        console.error(e);
        statusText.textContent = "Network error. Retrying...";
        setTimeout(startNewSyncSession, 3000);
    }
}

function startPolling() {
    stopPolling();
    sessionPollInterval = setInterval(checkSessionStatus, 1500);
}

function stopPolling() {
    if (sessionPollInterval) {
        clearInterval(sessionPollInterval);
        sessionPollInterval = null;
    }
}

async function checkSessionStatus() {
    if (!currentSessionId) return;
    
    try {
        const res = await fetch(`/api/sessions/${currentSessionId}/status`);
        if (!res.ok) {
            // Session likely expired or deleted
            startNewSyncSession();
            return;
        }
        
        const session = await res.json();
        
        if (session.status === 'verified') {
            // Success!
            stopPolling();
            displaySuccessScreen(session.user);
        }
    } catch (e) {
        console.error("Polling error:", e);
    }
}

function displaySuccessScreen(user) {
    // 1. Populate details
    document.getElementById('success-user-photo').src = user.photo;
    document.getElementById('success-user-name').textContent = user.name;
    document.getElementById('success-user-detail').textContent = `Role: ${user.role} | Time: ${user.time}`;
    
    // 2. Audio Chime Playback
    playChime(true);
    
    // 3. Show overlay
    successOverlay.classList.add('active');
    
    // 4. Auto-reset Kiosk after 5 seconds
    setTimeout(() => {
        successOverlay.classList.remove('active');
        // Delay QR recreation slightly for smooth transitions
        setTimeout(() => {
            startNewSyncSession();
        }, 400);
    }, 5000);
}
