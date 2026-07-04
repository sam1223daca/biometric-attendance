// Shared Frontend Utilities
// Apple Glassmorphism Biometric Attendance

// --- Toast Notification Drawer ---
function showToast(message, type = 'info') {
    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    // Choose icon based on type
    let icon = 'ℹ️';
    if (type === 'success') icon = '✓';
    if (type === 'error') icon = '✕';
    
    toast.innerHTML = `<span style="font-size: 16px; font-weight: bold; margin-right: 4px;">${icon}</span> ${message}`;
    container.appendChild(toast);
    
    // Animate in
    setTimeout(() => toast.classList.add('active'), 50);
    
    // Animate out
    setTimeout(() => {
        toast.classList.remove('active');
        setTimeout(() => toast.remove(), 400);
    }, 4000);
}

// --- Audio Synthesizer Beeps (using Web Audio API) ---
function playChime(success = true) {
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const gainNode = ctx.createGain();
        
        osc.connect(gainNode);
        gainNode.connect(ctx.destination);
        
        const now = ctx.currentTime;
        
        if (success) {
            // High-pitched double beep (Apple style)
            osc.type = 'sine';
            osc.frequency.setValueAtTime(880, now); // A5
            gainNode.gain.setValueAtTime(0.12, now);
            gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
            
            // Second tone
            const osc2 = ctx.createOscillator();
            const gainNode2 = ctx.createGain();
            osc2.connect(gainNode2);
            gainNode2.connect(ctx.destination);
            
            osc2.type = 'sine';
            osc2.frequency.setValueAtTime(1320, now + 0.08); // E6
            gainNode2.gain.setValueAtTime(0.12, now + 0.08);
            gainNode2.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
            
            osc.start(now);
            osc.stop(now + 0.12);
            
            osc2.start(now + 0.08);
            osc2.stop(now + 0.28);
        } else {
            // Error chord
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(220, now); // A3
            gainNode.gain.setValueAtTime(0.15, now);
            gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.4);
            
            osc.start(now);
            osc.stop(now + 0.4);
        }
    } catch (e) {
        console.error("Audio feedback failed:", e);
    }
}

// --- WebAuthn Base64URL Conversion Helpers ---
function bufferToBase64Url(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
}

function base64UrlToBuffer(base64url) {
    const base64 = base64url
        .replace(/-/g, '+')
        .replace(/_/g, '/');
    const padLen = (4 - (base64.length % 4)) % 4;
    const paddedBase64 = base64 + '='.repeat(padLen);
    const binary = atob(paddedBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}

// --- Simulated Biometric Scanner Overlay ---
function runFingerprintScanner(username, isRegistration, callback, onCancel = null) {
    let modal = document.getElementById('simulated-scanner-modal');
    if (!modal) {
        // Inject modal HTML
        const modalHtml = `
            <div id="simulated-scanner-modal" class="scanner-modal">
                <div class="scanner-card glass-card">
                    <h3 id="scanner-title" style="margin-bottom: 8px;">Verify Biometrics</h3>
                    <p id="scanner-desc" style="font-size: 13px; color: var(--text-secondary); margin-bottom: 18px;">
                        Place your finger on the scanner
                    </p>
                    <div id="fingerprint-btn" class="fingerprint-container">
                        <div class="pulse-ring"></div>
                        <div class="scanner-line"></div>
                        <svg class="fingerprint-svg" viewBox="0 0 24 24">
                            <path d="M12,2A10,10,0,0,0,2,12a9.89,9.89,0,0,0,2.18,6.17,1,1,0,1,0,1.64-1.14A7.92,7.92,0,0,1,4,12a8,8,0,0,1,16,0,7.91,7.91,0,0,1-1.81,5A1,1,0,1,0,19.74,18.3,9.89,9.89,0,0,0,22,12,10,10,0,0,0,12,2Zm0,4a6,6,0,0,0-6,6,5.92,5.92,0,0,0,1.31,3.7,1,1,0,0,0,1.6-1.2A3.91,3.91,0,0,1,8,12a4,4,0,0,1,8,0,3.91,3.91,0,0,1-.87,2.5,1,1,0,0,0,1.6,1.2A5.92,5.92,0,0,0,18,12,6,6,0,0,0,12,6Zm0,4a2,2,0,0,0-2,2,1.91,1.91,0,0,0,.43,1.2,1,1,0,0,0,1.6-1.2,0.1,0.1,0,0,1,0-.06,0.1,0.1,0,0,1,0,0,1,1,0,0,0,0-.08,2,2,0,0,0,2-2A2,2,0,0,0,12,10Z"/>
                        </svg>
                    </div>
                    <div style="margin-top: 20px; display: flex; justify-content: center; gap: 10px;">
                        <button id="scanner-cancel" class="btn btn-secondary" style="padding: 6px 16px; font-size: 13px;">Cancel</button>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        modal = document.getElementById('simulated-scanner-modal');
    }
    
    const titleEl = document.getElementById('scanner-title');
    const descEl = document.getElementById('scanner-desc');
    const scannerBtn = document.getElementById('fingerprint-btn');
    const cancelBtn = document.getElementById('scanner-cancel');
    
    // Set text parameters
    titleEl.textContent = isRegistration ? "Register Fingerprint" : "Biometric Check-in";
    descEl.textContent = `Demo Simulation: Tap the fingerprint sensor to authenticate ${username || ""}`;
    
    // Reset state classes
    scannerBtn.className = "fingerprint-container";
    
    // Show modal
    modal.classList.add('active');
    
    // Trigger vibration if mobile supports it
    if (navigator.vibrate) navigator.vibrate(30);
    
    const cleanup = () => {
        modal.classList.remove('active');
        // Remove event listeners
        scannerBtn.replaceWith(scannerBtn.cloneNode(true));
        cancelBtn.replaceWith(cancelBtn.cloneNode(true));
    };
    
    // Set up Cancel Handler
    document.getElementById('scanner-cancel').onclick = () => {
        cleanup();
        if (onCancel) onCancel();
    };
    
    // Set up Scan Handler
    document.getElementById('fingerprint-btn').onclick = () => {
        const activeBtn = document.getElementById('fingerprint-btn');
        if (activeBtn.classList.contains('scanning') || activeBtn.classList.contains('success')) return;
        
        activeBtn.classList.add('scanning');
        descEl.textContent = "Scanning... Keep your finger on the sensor";
        if (navigator.vibrate) navigator.vibrate([50, 100]);
        
        setTimeout(() => {
            activeBtn.classList.remove('scanning');
            activeBtn.classList.add('success');
            descEl.textContent = "Verification Successful!";
            
            // Audio Chime feedback
            playChime(true);
            
            if (navigator.vibrate) navigator.vibrate(100);
            
            setTimeout(() => {
                cleanup();
                
                // Construct mock credential payload
                const mockCredential = {
                    id: 'mock_cred_' + Math.random().toString(36).substring(2, 10) + Date.now().toString(36),
                    type: 'public-key',
                    response: {}
                };
                callback(mockCredential);
            }, 800);
        }, 1800);
    };
}
