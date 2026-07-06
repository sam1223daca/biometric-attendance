// Dashboard Logic
// Apple Glassmorphism Biometric Attendance

let map;
let markersLayer;
let detailsMapInstance = null;
let adminToken = localStorage.getItem('admin_token');
let codeTimerInterval = null;
let allLogs = [];

document.addEventListener('DOMContentLoaded', () => {
    // 1. Viewport Check
    detectDevice();
    
    // 2. Initialize Leaflet Map
    initMap();
    
    // 3. Load initial data
    loadDashboardData();
    
    // Poll data every 5 seconds for real-time responsiveness
    setInterval(loadDashboardData, 5000);
    
    // 4. Admin Portal Drawer Trigger
    setupAdminDrawer();

    // 5. Student Portal Redirect Bind
    const studentBtn = document.getElementById('student-portal-btn');
    if (studentBtn) {
        studentBtn.onclick = () => {
            const username = prompt("Enter Student Username / ID:");
            if (!username) return;
            resolveStudentUsername(username.trim());
        };
    }

    // 6. Setup Admin Reports UI
    setupAdminReports();
});

// Device viewport adjust
function detectDevice() {
    const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
    if (isMobile) {
        document.getElementById('mobile-quick-check').style.display = 'inline-flex';
        document.getElementById('checkpoint-link').style.display = 'none';
    }
}

// Map initialization
function initMap() {
    // Center map over India/neutral default
    map = L.map('leaflet-map-element', {
        zoomControl: true,
        scrollWheelZoom: true
    }).setView([20.5937, 78.9629], 4);
    
    // Apple light neutral tiles via CartoDB Positron
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
        subdomains: 'abcd',
        maxZoom: 20
    }).addTo(map);
    
    markersLayer = L.layerGroup().addTo(map);
}

// Stats & Logs loading
async function loadDashboardData() {
    try {
        // Load statistics
        const statsRes = await fetch('/api/dashboard/stats');
        if (statsRes.ok) {
            const stats = await statsRes.json();
            document.getElementById('total-users-val').textContent = stats.total_users;
            
            const checkinsElem = document.getElementById('today-checkins-val');
            if (checkinsElem) checkinsElem.textContent = stats.total_checkins;
            
            const checkoutsElem = document.getElementById('today-checkouts-val');
            if (checkoutsElem) checkoutsElem.textContent = stats.total_checkouts;
        }
        
        // Load logs
        const logsRes = await fetch('/api/dashboard/logs');
        if (logsRes.ok) {
            allLogs = await logsRes.json();
            renderLogsList(allLogs);
            updateMapMarkers(allLogs);
            
            // Refresh advanced reports table unconditionally
            const reportsSection = document.getElementById('admin-reports-section');
            if (reportsSection) {
                renderReportsTable();
            }
        }
        
        document.getElementById('last-update-time').textContent = `Updated ${new Date().toLocaleTimeString()}`;
    } catch (e) {
        console.error("Failed to load dashboard data:", e);
    }
}

// Render Table List
function renderLogsList(logs) {
    const container = document.getElementById('logs-feed-container');
    if (logs.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; color: var(--text-secondary); padding: 40px;">
                No attendance logs found for today.
            </div>
        `;
        return;
    }
    
    let html = '';
    logs.forEach(log => {
        const checkInStr = log.timestamp 
            ? new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
            : '--:--:--';
            
        const checkOutStr = log.check_out_time
            ? new Date(log.check_out_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
            : null;
            
        const checkOutBadge = checkOutStr
            ? `<span class="badge-type badge-type-out" style="font-size: 10px; padding: 2px 6px;">${checkOutStr}</span>`
            : `<span class="badge-type" style="font-size: 10px; padding: 2px 6px; background: rgba(0,0,0,0.04); color: var(--text-secondary); border: 1px solid rgba(0,0,0,0.06);">Active</span>`;
            
        const nameInitials = log.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
        const badgeClass = `badge-${log.role.toLowerCase()}`;
        
        const completionBadge = checkOutStr
            ? `<span style="font-size: 9px; font-weight: 700; color: var(--system-green); background: var(--system-green-light); padding: 2px 6px; border-radius: var(--radius-small); display: inline-flex; align-items: center; gap: 2px; border: 1px solid rgba(52, 199, 89, 0.12);">
                 ✓ Complete
               </span>`
            : '';
            
        // Check if admin options are unlocked
        const deleteButton = adminToken 
            ? `<button class="log-delete-btn" onclick="deleteAttendanceRecord(${log.id})" title="Delete log">✕</button>` 
            : '';
            
        const detailsButton = adminToken
            ? `<button class="log-details-btn" onclick="showAttendanceDetails(${log.id})" title="View Details">👁️</button>`
            : '';
            
        html += `
            <div class="log-item" id="log-row-${log.id}">
                <div class="log-info">
                    <div class="log-avatar">${nameInitials}</div>
                    <div class="log-meta">
                        <h4>${log.name}</h4>
                        <div style="display: flex; align-items: center; gap: 6px; margin-top: 4px;">
                            <span class="log-badge ${badgeClass}">${log.role}</span>
                            ${completionBadge}
                        </div>
                    </div>
                </div>
                <div class="log-right" style="gap: 12px;">
                    <div style="display: flex; gap: 8px; align-items: center;">
                        <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 2px;">
                            <span style="font-size: 10px; color: var(--text-secondary); font-weight: 500;">In</span>
                            <span class="badge-type badge-type-in" style="font-size: 10px; padding: 2px 6px;">${checkInStr}</span>
                        </div>
                        <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 2px;">
                            <span style="font-size: 10px; color: var(--text-secondary); font-weight: 500;">Out</span>
                            ${checkOutBadge}
                        </div>
                    </div>
                    <div class="log-actions" style="display: flex; gap: 8px; align-items: center;">
                        ${detailsButton}
                        <button class="log-location-btn" onclick="zoomToCoordinate(${log.latitude}, ${log.longitude}, '${log.name}', '${checkInStr}')" title="Locate on Map">📍</button>
                        ${deleteButton}
                    </div>
                </div>
            </div>
        `;
    });
    
    container.innerHTML = html;
}

// Update Map markers
function updateMapMarkers(logs) {
    if (!map || !markersLayer) return;
    
    markersLayer.clearLayers();
    
    if (logs.length === 0) return;
    
    const bounds = [];
    
    logs.forEach(log => {
        const lat = log.latitude;
        const lon = log.longitude;
        
        // Choose color based on role
        let markerColor = '#0071e3'; // blue
        if (log.role === 'Admin') markerColor = '#ff3b30'; // red
        if (log.role === 'Teacher') markerColor = '#0071e3';
        if (log.role === 'Employee') markerColor = '#34c759'; // green
        if (log.role === 'Student') markerColor = '#ff9500'; // amber
        
        const marker = L.circleMarker([lat, lon], {
            radius: 8,
            fillColor: markerColor,
            color: '#ffffff',
            weight: 2,
            opacity: 1,
            fillOpacity: 0.7
        });
        
        const actionLabel = log.log_type === 'Check-Out' ? 'Check-out' : 'Check-in';
        const popupContent = `
            <div style="font-family: 'Outfit', sans-serif; font-size: 13px;">
                <h4 style="margin-bottom: 2px; color: var(--text-primary); font-weight: 600;">${log.name}</h4>
                <p style="margin-bottom: 4px; color: var(--text-secondary); font-size: 11px;">Role: ${log.role}</p>
                <p style="margin: 0; font-size: 11px; color: var(--system-blue);">${actionLabel}: ${new Date(log.timestamp).toLocaleTimeString()}</p>
            </div>
        `;
        
        marker.bindPopup(popupContent);
        markersLayer.addLayer(marker);
        bounds.push([lat, lon]);
    });
    
    // Fit bounds only on first load so we don't disrupt user zooms
    if (bounds.length > 0 && !map.hasOwnProperty('_initialBoundsSet')) {
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 12 });
        map._initialBoundsSet = true;
    }
}

// Zoom map to item
function zoomToCoordinate(lat, lon, name, timeStr) {
    if (!map) return;
    map.setView([lat, lon], 14, { animate: true });
    
    // Find matching marker to open popup
    markersLayer.eachLayer(marker => {
        const markerLatLng = marker.getLatLng();
        if (markerLatLng.lat === lat && markerLatLng.lng === lon) {
            marker.openPopup();
        }
    });
    
    showToast(`Centering on check-in for ${name}`, 'info');
}

// Delete Log Record
async function deleteAttendanceRecord(logId) {
    if (!confirm("Are you sure you want to remove this attendance log?")) return;
    
    try {
        const res = await fetch(`/api/logs/${logId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${adminToken}`
            }
        });
        
        if (res.ok) {
            showToast("Attendance record removed successfully", "success");
            // Slide record row out
            const row = document.getElementById(`log-row-${logId}`);
            if (row) {
                row.style.opacity = '0';
                row.style.transform = 'translateX(-20px)';
                setTimeout(loadDashboardData, 300);
            } else {
                loadDashboardData();
            }
        } else {
            const err = await res.json();
            showToast(`Deletion failed: ${err.detail}`, "error");
        }
    } catch (e) {
        showToast("Network error deleting record", "error");
    }
}

// Setup Admin drawer flow
function setupAdminDrawer() {
    const drawer = document.getElementById('admin-control-drawer');
    const openBtn = document.getElementById('admin-login-btn');
    const closeBtn = document.getElementById('drawer-close-btn');
    const logoutBtn = document.getElementById('admin-logout-btn');
    
    // Bind Save Settings button
    const saveSettingsBtn = document.getElementById('save-settings-btn');
    if (saveSettingsBtn) {
        saveSettingsBtn.onclick = saveSettings;
    }
    
    // Open drawer
    openBtn.onclick = async () => {
        if (adminToken) {
            // Already logged in
            drawer.classList.add('active');
            startAuthorityCodeLoop();
            refreshAdminUsersList();
            loadSettings();
            resetInactivityTimer();
        } else {
            // Initiate Admin Biometric Login flow
            const username = prompt("Enter Administrator Username:");
            if (!username) return;
            
            await performAdminBiometricLogin(username);
        }
    };
    
    // Close Drawer
    closeBtn.onclick = () => {
        drawer.classList.remove('active');
        stopAuthorityCodeLoop();
        if (inactivityTimer) {
            clearTimeout(inactivityTimer);
            inactivityTimer = null;
        }
    };
    
    // Logout Action
    logoutBtn.onclick = () => {
        localStorage.removeItem('admin_token');
        adminToken = null;
        drawer.classList.remove('active');
        stopAuthorityCodeLoop();
        showToast("Administrator Console Locked", "info");
        if (inactivityTimer) {
            clearTimeout(inactivityTimer);
            inactivityTimer = null;
        }
        
        // Close modal if open
        const detailsModal = document.getElementById('attendance-details-modal');
        detailsModal.classList.remove('active');
        setTimeout(() => {
            detailsModal.style.display = 'none';
            destroyModalMap();
        }, 300);
        
        // Refresh feed to remove delete buttons
        loadDashboardData();
    };
    
    // Close Details Modal listeners
    const detailsModal = document.getElementById('attendance-details-modal');
    const modalCloseBtn = document.getElementById('modal-close-btn');
    
    modalCloseBtn.onclick = () => {
        detailsModal.classList.remove('active');
        setTimeout(() => {
            detailsModal.style.display = 'none';
            destroyModalMap();
        }, 300);
    };
    
    detailsModal.onclick = (e) => {
        if (e.target === detailsModal) {
            detailsModal.classList.remove('active');
            setTimeout(() => {
                detailsModal.style.display = 'none';
                destroyModalMap();
            }, 300);
        }
    };
}

// Admin Biometric Challenge & Verification
async function performAdminBiometricLogin(username) {
    try {
        // 1. Fetch WebAuthn/Mock options
        const optionsRes = await fetch('/api/webauthn/login/options', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username })
        });
        
        if (!optionsRes.ok) {
            const err = await optionsRes.json();
            showToast(`Admin Login Options error: ${err.detail}`, 'error');
            return;
        }
        
        const options = await optionsRes.json();
        
        if (options.is_mock) {
            // Run custom simulated fingerprint prompt
            runFingerprintScanner(username, false, async (mockCred) => {
                const verifyRes = await fetch('/api/admin/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        username,
                        challenge: options.challenge,
                        credential: mockCred,
                        is_mock: true
                    })
                });
                
                if (verifyRes.ok) {
                    const auth = await verifyRes.json();
                    adminToken = auth.token;
                    localStorage.setItem('admin_token', adminToken);
                    showToast("Administrator Unlocked", "success");
                    document.getElementById('admin-control-drawer').classList.add('active');
                    startAuthorityCodeLoop();
                    refreshAdminUsersList();
                    loadSettings();
                    loadDashboardData();
                    resetInactivityTimer();
                } else {
                    const err = await verifyRes.json();
                    showToast(`Verification Failed: ${err.detail}`, 'error');
                }
            });
        } else {
            // Real WebAuthn Authentication using window.navigator.credentials
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
            
            const verifyPayload = {
                username,
                challenge: options.challenge,
                is_mock: false,
                credential: {
                    id: assertion.id,
                    rawId: bufferToBase64Url(assertion.rawId),
                    type: assertion.type,
                    response: {
                        clientDataJSON,
                        authenticatorData,
                        signature,
                        userHandle
                    }
                }
            };
            
            const verifyRes = await fetch('/api/admin/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(verifyPayload)
            });
            
            if (verifyRes.ok) {
                const auth = await verifyRes.json();
                adminToken = auth.token;
                localStorage.setItem('admin_token', adminToken);
                showToast("Administrator Authenticated", "success");
                document.getElementById('admin-control-drawer').classList.add('active');
                startAuthorityCodeLoop();
                refreshAdminUsersList();
                loadSettings();
                loadDashboardData();
                resetInactivityTimer();
            } else {
                const err = await verifyRes.json();
                showToast(`Biometric Admin verification failed: ${err.detail}`, "error");
            }
        }
    } catch (e) {
        console.error(e);
        showToast("Admin Biometric Auth Cancelled or Failed", "error");
    }
}

// Start Code Refresh Loop
function startAuthorityCodeLoop() {
    stopAuthorityCodeLoop();
    refreshAuthorityCode();
    codeTimerInterval = setInterval(refreshAuthorityCode, 2000); // Check/update code/timer
}

function stopAuthorityCodeLoop() {
    if (codeTimerInterval) {
        clearInterval(codeTimerInterval);
        codeTimerInterval = null;
    }
}

async function refreshAuthorityCode() {
    if (!adminToken) return;
    
    try {
        const res = await fetch('/api/admin/authority-code', {
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });
        
        if (res.ok) {
            const data = await res.json();
            document.getElementById('rotating-code-val').textContent = data.code;
            
            // Format timer minutes/seconds
            const minutes = Math.floor(data.seconds_left / 60);
            const seconds = data.seconds_left % 60;
            document.getElementById('code-timer-val').textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
            
            // Animate progress bar width smoothly ("flowly")
            const totalDuration = 300; // 5 minutes code cycle
            const percent = Math.max(0, Math.min(100, (data.seconds_left / totalDuration) * 100));
            const timerBar = document.getElementById('code-timer-bar');
            if (timerBar) {
                timerBar.style.width = `${percent}%`;
                // Color transition to red if less than 60s remaining
                if (data.seconds_left < 60) {
                    timerBar.style.background = 'linear-gradient(90deg, var(--system-red) 0%, #ff7b72 100%)';
                    document.getElementById('code-timer-val').style.color = 'var(--system-red)';
                } else {
                    timerBar.style.background = 'linear-gradient(90deg, var(--system-blue) 0%, #00d2ff 100%)';
                    document.getElementById('code-timer-val').style.color = 'var(--system-blue)';
                }
            }
        } else {
            // Token likely expired
            localStorage.removeItem('admin_token');
            adminToken = null;
            document.getElementById('admin-control-drawer').classList.remove('active');
            stopAuthorityCodeLoop();
            showToast("Admin session expired. Please re-authenticate", "error");
            loadDashboardData();
        }
    } catch (e) {
        console.error(e);
    }
}

// Show Attendance Details Modal (Admin only)
async function showAttendanceDetails(logId) {
    if (!adminToken) {
        showToast("Please log in as Admin to view profile details & photos", "error");
        return;
    }
    
    try {
        const res = await fetch(`/api/admin/logs/${logId}/details`, {
            headers: {
                'Authorization': `Bearer ${adminToken}`
            }
        });
        
        if (!res.ok) {
            const err = await res.json();
            showToast(`Failed to load details: ${err.detail}`, 'error');
            return;
        }
        
        const details = await res.json();
        const dateObj = new Date(details.timestamp);
        const day = String(dateObj.getDate()).padStart(2, '0');
        const month = String(dateObj.getMonth() + 1).padStart(2, '0');
        const year = dateObj.getFullYear();
        const dateStr = `${day}/${month}/${year}`;
        const checkInTimeStr = dateObj.toLocaleTimeString();
        const checkOutTimeStr = details.check_out_time 
            ? new Date(details.check_out_time).toLocaleTimeString()
            : 'Active (Not checked out)';
        
        const departmentRow = details.department 
            ? `
                <div class="details-row">
                    <span class="details-label">Department</span>
                    <span class="details-value" style="font-weight:600; color:var(--system-blue);">${details.department}</span>
                </div>
            `
            : '';

        const bodyContainer = document.getElementById('modal-details-body');
        const checkInPhotoHTML = details.check_in_photo 
            ? `<div class="photo-card"><img src="${details.check_in_photo}" alt="Check-In Selfie"><span class="photo-card-label">Check-In Selfie</span></div>`
            : `<div class="photo-card empty"><div class="empty-photo-icon">📷</div><span class="photo-card-label">No Check-In Selfie</span></div>`;

        const checkOutPhotoHTML = details.check_out_time && details.check_out_photo
            ? `<div class="photo-card"><img src="${details.check_out_photo}" alt="Check-Out Selfie"><span class="photo-card-label">Check-Out Selfie</span></div>`
            : `<div class="photo-card empty"><div class="empty-photo-icon">📷</div><span class="photo-card-label">No Check-Out Selfie</span></div>`;

        const enrollPhotoHTML = details.enroll_photo
            ? `<div class="photo-card"><img src="${details.enroll_photo}" alt="Enrolled Profile"><span class="photo-card-label">Enrolled Profile</span></div>`
            : `<div class="photo-card empty"><div class="empty-photo-icon">👤</div><span class="photo-card-label">No Profile Photo</span></div>`;

        bodyContainer.innerHTML = `
            <style>
                .photo-comparison-wrapper {
                    display: flex;
                    gap: 16px;
                    justify-content: center;
                    margin-bottom: 24px;
                    flex-wrap: wrap;
                }
                .photo-card {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 8px;
                    width: 100px;
                }
                .photo-card img {
                    width: 100px;
                    height: 100px;
                    object-fit: cover;
                    border-radius: 16px;
                    border: 2px solid rgba(0, 113, 227, 0.1);
                    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
                }
                .photo-card.empty .empty-photo-icon {
                    width: 100px;
                    height: 100px;
                    border-radius: 16px;
                    background: rgba(0, 0, 0, 0.03);
                    border: 2px dashed rgba(0, 0, 0, 0.1);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 26px;
                    color: var(--text-secondary);
                }
                .photo-card-label {
                    font-size: 9px;
                    font-weight: 700;
                    color: var(--text-secondary);
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                    text-align: center;
                }
            </style>
            <div class="photo-comparison-wrapper">
                ${enrollPhotoHTML}
                ${checkInPhotoHTML}
                ${checkOutPhotoHTML}
            </div>
            <div class="details-grid">
                <div class="details-row">
                    <span class="details-label">Full Name</span>
                    <span class="details-value">${details.name}</span>
                </div>
                <div class="details-row">
                    <span class="details-label">Username / ID</span>
                    <span class="details-value">${details.username}</span>
                </div>
                <div class="details-row">
                    <span class="details-label">Role</span>
                    <span class="log-badge badge-${details.role.toLowerCase()}">${details.role}</span>
                </div>
                ${departmentRow}
                <div class="details-row">
                    <span class="details-label">Date</span>
                    <span class="details-value">${dateStr}</span>
                </div>
                <div class="details-row">
                    <span class="details-label">Check-In Time</span>
                    <span class="details-value" style="font-weight: 600; color: var(--system-green);">${checkInTimeStr}</span>
                </div>
                <div class="details-row">
                    <span class="details-label">Check-Out Time</span>
                    <span class="details-value" style="font-weight: 600; color: ${details.check_out_time ? 'var(--system-blue)' : 'var(--text-secondary)'};">${checkOutTimeStr}</span>
                </div>
                <div class="details-row">
                    <span class="details-label">Latitude</span>
                    <span class="details-value">${details.latitude.toFixed(6)}</span>
                </div>
                <div class="details-row">
                    <span class="details-label">Longitude</span>
                    <span class="details-value">${details.longitude.toFixed(6)}</span>
                </div>
                <div class="details-row" style="justify-content: center; padding-top: 15px;">
                    <a href="https://www.google.com/maps/search/?api=1&query=${details.latitude},${details.longitude}" 
                       target="_blank" class="details-map-link">
                       🌍 View on Google Maps
                    </a>
                </div>
            </div>
        `;
        
        const modal = document.getElementById('attendance-details-modal');
        document.getElementById('modal-map-side').style.display = 'flex';
        document.getElementById('modal-grid-layout').style.gridTemplateColumns = '1fr 1fr';
        modal.style.display = 'flex';
        setTimeout(() => {
            modal.classList.add('active');
            // Fetch live human-readable address
            const addressText = document.getElementById('modal-address-text');
            addressText.textContent = "Fetching live address...";
            fetchAddress(details.latitude, details.longitude, addressText);
            
            // Initialize mini map marking checking coordinate
            initializeModalMap(details.latitude, details.longitude, details.name);
        }, 10);
        
    } catch (e) {
        console.error(e);
        showToast("Error loading check-in details", "error");
    }
}

// Fetch human-readable address using Nominatim (OpenStreetMap reverse geocoding)
async function fetchAddress(lat, lon, element) {
    try {
        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`, {
            headers: {
                'Accept-Language': 'en',
                'User-Agent': 'PassBiometric/1.0 (samarshi.dey@nielit.gov.in)'
            }
        });
        if (res.ok) {
            const data = await res.json();
            element.textContent = data.display_name || `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
        } else {
            element.textContent = `${lat.toFixed(5)}, ${lon.toFixed(5)} (Address lookup unavailable)`;
        }
    } catch (e) {
        console.error(e);
        element.textContent = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
    }
}

// Initialize or refresh Leaflet mini map in the details modal
function initializeModalMap(lat, lon, name) {
    destroyModalMap(); // Clean up previous instance first
    
    setTimeout(() => {
        try {
            detailsMapInstance = L.map('modal-leaflet-map', {
                zoomControl: false,
                attributionControl: false
            }).setView([lat, lon], 16);
            
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                maxZoom: 19
            }).addTo(detailsMapInstance);
            
            // Add marker with pulsing effect or simple clean design
            const marker = L.marker([lat, lon]).addTo(detailsMapInstance);
            marker.bindPopup(`<b>${name}</b><br>Checked in here`).openPopup();
            
            // Recalculate container bounds
            setTimeout(() => {
                if (detailsMapInstance) {
                    detailsMapInstance.invalidateSize();
                }
            }, 350);
            
        } catch (e) {
            console.error("Leaflet modal map initialization error:", e);
        }
    }, 50);
}

// Safely destroy Leaflet details map instance
function destroyModalMap() {
    if (detailsMapInstance) {
        try {
            detailsMapInstance.remove();
        } catch (e) {
            console.error("Error destroying details map:", e);
        }
        detailsMapInstance = null;
    }
}

// Fetch and Render Users list inside Admin Console Drawer
async function refreshAdminUsersList() {
    if (!adminToken) return;
    
    const container = document.getElementById('admin-users-list');
    try {
        const res = await fetch('/api/admin/users', {
            headers: {
                'Authorization': `Bearer ${adminToken}`
            }
        });
        
        if (!res.ok) {
            container.innerHTML = `<div style="text-align: center; font-size: 11px; color: var(--system-red); padding: 10px;">Failed to load users</div>`;
            return;
        }
        
        const users = await res.json();
        if (users.length === 0) {
            container.innerHTML = `<div style="text-align: center; font-size: 11px; color: var(--text-secondary); padding: 10px;">No users registered</div>`;
            return;
        }
        
        let html = '';
        users.forEach(user => {
            const roleBadge = `<span class="log-badge badge-${user.role.toLowerCase()}" style="font-size:8px; padding:1px 4px; border-radius:4px; font-weight:700; text-transform:uppercase;">${user.role}</span>`;
            const deptText = user.department ? `<div style="font-size:9px; color:var(--text-secondary); margin-top:2px;">${user.department}</div>` : '';
            
            html += `
                <div style="display:flex; justify-content:space-between; align-items:center; padding:6px 8px; background:rgba(255,255,255,0.7); border-radius:var(--radius-small); border:1px solid rgba(0,0,0,0.03);">
                    <div style="flex:1; min-width:0; padding-right:8px;">
                        <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                            <span style="font-size:12px; font-weight:600; color:var(--text-primary); text-overflow:ellipsis; overflow:hidden; white-space:nowrap; max-width: 110px;">${user.name}</span>
                            ${roleBadge}
                        </div>
                        <div style="font-size:10px; color:var(--text-secondary); text-overflow:ellipsis; overflow:hidden; white-space:nowrap; margin-top:2px;">ID: ${user.username}</div>
                        ${deptText}
                    </div>
                    <div style="display:flex; align-items:center; gap:4px; flex-shrink:0;">
                        <button class="btn btn-secondary" onclick="window.open('/student?id=${user.id}', '_blank')" title="View Student Dashboard" style="padding:4px 6px; font-size:10px; line-height:1; min-width:unset; margin:0; width:auto; display:inline-flex; align-items:center;">👤</button>
                        <button class="log-delete-btn" onclick="deleteUserAccount(${user.id}, '${user.name.replace(/'/g, "\\'")}')" title="Delete User account" style="padding:4px 8px; font-size:10px; margin:0;">✕</button>
                    </div>
                </div>
            `;
        });
        container.innerHTML = html;
        refreshAdminPendingList();
        
    } catch (e) {
        console.error(e);
        container.innerHTML = `<div style="text-align: center; font-size: 11px; color: var(--system-red); padding: 10px;">Error fetching users</div>`;
    }
}

// Admin Account Deletion Request
async function deleteUserAccount(userId, name) {
    if (!confirm(`WARNING: Are you sure you want to permanently delete user "${name}"?\n\nThis will instantly remove all their biometric credentials, profile data, and check-in logs. This action cannot be undone.`)) {
        return;
    }
    
    try {
        const res = await fetch(`/api/admin/users/${userId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${adminToken}`
            }
        });
        
        if (res.ok) {
            showToast(`User account "${name}" successfully deleted`, "success");
            // Refresh user list and stats/logs
            refreshAdminUsersList();
            loadDashboardData();
        } else {
            const err = await res.json();
            showToast(`Failed to delete user: ${err.detail}`, "error");
        }
    } catch (e) {
        console.error(e);
        showToast("Error communicating with server", "error");
    }
}

// Fetch and Render Pending Approvals list inside Admin Console Drawer
async function refreshAdminPendingList() {
    if (!adminToken) return;
    
    const container = document.getElementById('admin-pending-list');
    if (!container) return;
    
    try {
        const res = await fetch('/api/admin/users/pending', {
            headers: {
                'Authorization': `Bearer ${adminToken}`
            }
        });
        
        if (!res.ok) {
            container.innerHTML = `<div style="text-align: center; font-size: 11px; color: var(--system-red); padding: 10px;">Failed to load pending approvals</div>`;
            return;
        }
        
        const pending = await res.json();
        if (pending.length === 0) {
            container.innerHTML = `<div style="text-align: center; font-size: 11px; color: var(--text-secondary); padding: 10px;">No pending approvals</div>`;
            return;
        }
        
        let html = '';
        pending.forEach(user => {
            const roleBadge = `<span class="log-badge badge-${user.role.toLowerCase()}" style="font-size:8px; padding:1px 4px; border-radius:4px; font-weight:700; text-transform:uppercase;">${user.role}</span>`;
            const deptText = user.department ? `<div style="font-size:9px; color:var(--text-secondary); margin-top:2px;">${user.department}</div>` : '';
            html += `
                <div style="display:flex; justify-content:space-between; align-items:center; padding:6px 8px; background:rgba(255,255,255,0.7); border-radius:var(--radius-small); border:1px solid rgba(0,0,0,0.03);">
                    <div style="flex:1; min-width:0; padding-right:8px;">
                        <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                            <span style="font-size:12px; font-weight:600; color:var(--text-primary); text-overflow:ellipsis; overflow:hidden; white-space:nowrap; max-width: 90px;">${user.name}</span>
                            ${roleBadge}
                        </div>
                        <div style="font-size:10px; color:var(--text-secondary); text-overflow:ellipsis; overflow:hidden; white-space:nowrap; margin-top:2px;">ID: ${user.username}</div>
                        ${deptText}
                    </div>
                    <div style="display:flex; align-items:center; gap:6px; flex-shrink:0;">
                        <button class="log-details-btn" onclick="viewPendingUserPhoto(${user.id})" title="View Profile Photo" style="padding:4px 6px; font-size:10px;">👁️</button>
                        <button class="log-details-btn" onclick="approveUserAccount(${user.id}, '${user.name.replace(/'/g, "\\'")}')" title="Approve User" style="background:#e8f5e9; color:var(--system-green); padding:4px 6px; font-size:10px;">✓</button>
                        <button class="log-delete-btn" onclick="rejectUserAccount(${user.id}, '${user.name.replace(/'/g, "\\'")}')" title="Reject User" style="padding:4px 6px; font-size:10px;">✕</button>
                    </div>
                </div>
            `;
        });
        container.innerHTML = html;
        
    } catch (e) {
        console.error(e);
        container.innerHTML = `<div style="text-align: center; font-size: 11px; color: var(--system-red); padding: 10px;">Error fetching pending approvals</div>`;
    }
}

// Approve user account
async function approveUserAccount(userId, name) {
    try {
        const res = await fetch(`/api/admin/users/${userId}/approve`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${adminToken}`
            }
        });
        
        if (res.ok) {
            showToast(`User account "${name}" has been approved!`, "success");
            refreshAdminUsersList();
            loadDashboardData();
        } else {
            const err = await res.json();
            showToast(`Failed to approve user: ${err.detail}`, "error");
        }
    } catch (e) {
        console.error(e);
        showToast("Error communicating with server", "error");
    }
}

// View profile details/photo of a pending user (re-uses existing details modal)
async function viewPendingUserPhoto(userId) {
    if (!adminToken) return;
    
    try {
        const res = await fetch(`/api/admin/users/${userId}/details`, {
            headers: {
                'Authorization': `Bearer ${adminToken}`
            }
        });
        
        if (!res.ok) {
            const err = await res.json();
            showToast(`Failed to load details: ${err.detail}`, 'error');
            return;
        }
        
        const details = await res.json();
        
        const bodyContainer = document.getElementById('modal-details-body');
        const departmentRow = details.department 
            ? `
                <div class="details-row">
                    <span class="details-label">Department</span>
                    <span class="details-value" style="font-weight:600; color:var(--system-blue);">${details.department}</span>
                </div>
            `
            : '';
            
        const locationRow = (details.latitude !== null && details.latitude !== undefined)
            ? `
                <div class="details-row">
                    <span class="details-label">Enrollment Location</span>
                    <span class="details-value" style="font-size:11px; font-weight:600; color:var(--system-blue);">${details.latitude.toFixed(5)}, ${details.longitude.toFixed(5)}</span>
                </div>
            `
            : '';
            
        bodyContainer.innerHTML = `
            <div class="details-photo-container">
                <img src="${details.photo}" alt="${details.name} profile photo">
            </div>
            <div class="details-grid">
                <div class="details-row">
                    <span class="details-label">Full Name</span>
                    <span class="details-value">${details.name}</span>
                </div>
                <div class="details-row">
                    <span class="details-label">Username / ID</span>
                    <span class="details-value">${details.username}</span>
                </div>
                <div class="details-row">
                    <span class="details-label">Role</span>
                    <span class="log-badge badge-${details.role.toLowerCase()}">${details.role}</span>
                </div>
                ${departmentRow}
                ${locationRow}
                <div class="details-row">
                    <span class="details-label">Status</span>
                    <span class="badge-type" style="background:#fff3e0; color:var(--system-amber); border: 1px solid rgba(255,149,0,0.15); font-size:10px; padding:3px 8px;">PENDING APPROVAL</span>
                </div>
            </div>
        `;
        
        const modal = document.getElementById('attendance-details-modal');
        const mapSide = document.getElementById('modal-map-side');
        const gridLayout = document.getElementById('modal-grid-layout');
        
        if (details.latitude !== null && details.longitude !== null && details.latitude !== undefined && details.longitude !== undefined) {
            mapSide.style.display = 'flex';
            gridLayout.style.gridTemplateColumns = '1fr 1fr';
            modal.style.display = 'flex';
            setTimeout(() => {
                modal.classList.add('active');
                
                const addressText = document.getElementById('modal-address-text');
                if (addressText) {
                    addressText.textContent = "Fetching live enrollment address...";
                    fetchAddress(details.latitude, details.longitude, addressText);
                }
                
                initializeModalMap(details.latitude, details.longitude, details.name);
            }, 10);
        } else {
            mapSide.style.display = 'none';
            gridLayout.style.gridTemplateColumns = '1fr';
            modal.style.display = 'flex';
            setTimeout(() => {
                modal.classList.add('active');
                destroyModalMap();
            }, 10);
        }
        
    } catch (e) {
        console.error(e);
        showToast("Error loading user profile photo", "error");
    }
}

// Reject pending user account (sets approved = -1)
async function rejectUserAccount(userId, name) {
    if (!confirm(`Are you sure you want to reject user "${name}"?\n\nThis user will be notified that their enrollment request was rejected when they attempt to check in next time.`)) {
        return;
    }
    
    try {
        const res = await fetch(`/api/admin/users/${userId}/reject`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${adminToken}`
            }
        });
        
        if (res.ok) {
            showToast(`User account "${name}" successfully rejected`, "success");
            refreshAdminUsersList();
            loadDashboardData();
        } else {
            const err = await res.json();
            showToast(`Failed to reject user: ${err.detail}`, "error");
        }
    } catch (e) {
        console.error(e);
        showToast("Error communicating with server", "error");
    }
}

// Inactivity auto-lock manager
let inactivityTimer = null;
const INACTIVITY_LIMIT = 60000; // 1 minute in milliseconds

function resetInactivityTimer() {
    if (inactivityTimer) {
        clearTimeout(inactivityTimer);
    }
    
    // Only schedule if logged in and drawer is open
    const drawer = document.getElementById('admin-control-drawer');
    if (adminToken && drawer && drawer.classList.contains('active')) {
        inactivityTimer = setTimeout(autoLockConsole, INACTIVITY_LIMIT);
    }
}

function autoLockConsole() {
    const logoutBtn = document.getElementById('admin-logout-btn');
    if (logoutBtn) {
        logoutBtn.click();
        showToast("Admin Console locked due to 1 minute of inactivity", "warning");
    }
}

// Global user activity tracking events
['mousemove', 'keydown', 'click', 'scroll', 'touchstart'].forEach(eventName => {
    document.addEventListener(eventName, resetInactivityTimer, { passive: true });
});

async function loadSettings() {
    try {
        const res = await fetch('/api/admin/settings', {
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });
        if (!res.ok) return;
        const settings = await res.json();
        if (settings.checkin_start) document.getElementById('settings-checkin-start').value = settings.checkin_start;
        if (settings.checkin_end) document.getElementById('settings-checkin-end').value = settings.checkin_end;
        if (settings.checkout_start) document.getElementById('settings-checkout-start').value = settings.checkout_start;
        if (settings.checkout_end) document.getElementById('settings-checkout-end').value = settings.checkout_end;
    } catch (e) {
        console.error("Error loading settings:", e);
    }
}

async function saveSettings() {
    const checkin_start = document.getElementById('settings-checkin-start').value;
    const checkin_end = document.getElementById('settings-checkin-end').value;
    const checkout_start = document.getElementById('settings-checkout-start').value;
    const checkout_end = document.getElementById('settings-checkout-end').value;
    
    if (!checkin_start || !checkin_end || !checkout_start || !checkout_end) {
        showToast("All settings fields are required", "error");
        return;
    }
    
    try {
        const res = await fetch('/api/admin/settings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${adminToken}`
            },
            body: JSON.stringify({
                checkin_start,
                checkin_end,
                checkout_start,
                checkout_end
            })
        });
        
        if (res.ok) {
            showToast("Schedule settings saved successfully", "success");
        } else {
            const err = await res.json();
            showToast(`Failed to save settings: ${err.detail}`, "error");
        }
    } catch (e) {
        console.error("Error saving settings:", e);
        showToast("Error connecting to settings API", "error");
    }
}

async function resolveStudentUsername(username) {
    try {
        const res = await fetch(`/api/users/by-username/${encodeURIComponent(username)}`);
        if (!res.ok) {
            showToast("Username not found. Check ID and try again.", "error");
            return;
        }
        const data = await res.json();
        window.open(`/student?id=${data.id}`, '_blank');
    } catch (e) {
        console.error(e);
        showToast("Error resolving student details", "error");
    }
}

function setupAdminReports() {
    const filterBtn = document.getElementById('btn-filter-reports');
    const resetBtn = document.getElementById('btn-reset-reports');
    const csvBtn = document.getElementById('export-csv-btn');
    const excelBtn = document.getElementById('export-excel-btn');
    const pdfBtn = document.getElementById('export-pdf-btn');
    
    if (filterBtn) filterBtn.onclick = () => renderReportsTable(true);
    if (resetBtn) {
        resetBtn.onclick = () => {
            document.getElementById('filter-date').value = '';
            document.getElementById('filter-dept').value = '';
            document.getElementById('filter-student').value = '';
            document.getElementById('filter-status').value = 'All';
            renderReportsTable(true);
        };
    }
    
    if (csvBtn) csvBtn.onclick = () => exportReport('csv');
    if (excelBtn) excelBtn.onclick = () => exportReport('excel');
    if (pdfBtn) pdfBtn.onclick = () => exportReport('pdf');
}

function renderReportsTable(showToastOnFilter = false) {
    const dateVal = document.getElementById('filter-date').value;
    const deptVal = document.getElementById('filter-dept').value.toLowerCase().trim();
    const studentVal = document.getElementById('filter-student').value.toLowerCase().trim();
    const statusVal = document.getElementById('filter-status').value;
    
    let filtered = [...allLogs];
    
    if (dateVal) {
        filtered = filtered.filter(log => {
            if (!log.timestamp) return false;
            const logDate = new Date(log.timestamp).toISOString().split('T')[0];
            return logDate === dateVal;
        });
    }
    
    if (deptVal) {
        filtered = filtered.filter(log => log.department && log.department.toLowerCase().includes(deptVal));
    }
    
    if (studentVal) {
        filtered = filtered.filter(log => {
            const matchName = log.name && log.name.toLowerCase().includes(studentVal);
            const matchUsername = log.username && log.username.toLowerCase().includes(studentVal);
            return matchName || matchUsername;
        });
    }
    
    if (statusVal !== 'All') {
        filtered = filtered.filter(log => log.status === statusVal);
    }
    
    document.getElementById('reports-count-badge').textContent = `${filtered.length} records`;
    
    const tbody = document.getElementById('reports-table-body');
    if (filtered.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" style="text-align: center; color: var(--text-secondary); padding: 30px;">
                    No report logs match the active filters.
                </td>
            </tr>
        `;
        return;
    }
    
    let html = '';
    filtered.forEach(log => {
        const checkInStr = log.timestamp 
            ? new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : '--:--';
            
        const checkOutStr = log.check_out_time
            ? new Date(log.check_out_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : '--:--';
            
        const dateStr = log.timestamp
            ? new Date(log.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
            : '--';
            
        const hoursDiff = calculateHoursDiff(log.timestamp, log.check_out_time);
        
        if (log.status === 'Late Arrival') {
            statusBadge = '<span class="log-badge" style="font-size: 8px; padding: 2px 6px; font-weight:700; background: rgba(255, 149, 0, 0.15); color: #ff9500; border: 1px solid rgba(255, 149, 0, 0.25); border-radius: 4px; text-transform: uppercase;">LATE ARRIVAL</span>';
        } else {
            statusBadge = '<span class="log-badge badge-approved" style="font-size: 8px; padding: 2px 6px; font-weight:700;">ON TIME</span>';
        }
        
        html += `
            <tr style="border-bottom: 1px solid rgba(0,0,0,0.04); background: rgba(255,255,255,0.4);">
                <td style="padding: 10px 16px; font-weight: 600; color: var(--text-primary);">${log.name} <span style="font-size:10px; color:var(--text-secondary); font-weight:500;">(${log.username})</span></td>
                <td style="padding: 10px 16px; color: var(--text-secondary);">${log.department || 'General'}</td>
                <td style="padding: 10px 16px; color: var(--text-primary);">${dateStr}</td>
                <td style="padding: 10px 16px; color: var(--text-primary);">${checkInStr}</td>
                <td style="padding: 10px 16px; color: var(--text-primary);">${checkOutStr}</td>
                <td style="padding: 10px 16px; font-weight: 600; color: var(--text-secondary);">${hoursDiff}</td>
                <td style="padding: 10px 16px;">${statusBadge}</td>
            </tr>
        `;
    });
    
    tbody.innerHTML = html;
    
    if (showToastOnFilter) {
        showToast(`Filtered down to ${filtered.length} logs`, "info");
    }
}

function exportReport(format) {
    const dateVal = document.getElementById('filter-date').value;
    const deptVal = document.getElementById('filter-dept').value.trim();
    const studentVal = document.getElementById('filter-student').value.trim();
    const statusVal = document.getElementById('filter-status').value;
    
    // Create direct URL redirection to backend export API
    const params = new URLSearchParams({
        format: format
    });
    if (dateVal) params.append('date', dateVal);
    if (deptVal) params.append('dept', deptVal);
    if (studentVal) params.append('student', studentVal);
    if (statusVal && statusVal !== 'All') params.append('status', statusVal);
    
    const exportUrl = `/api/admin/export?${params.toString()}`;
    
    // Bypass popup blockers in sandboxed iframe environments for CSV/Excel formats
    if (format === 'pdf') {
        window.open(exportUrl, '_blank');
    } else {
        window.location.href = exportUrl;
    }
    showToast(`Export request initiated for ${format.toUpperCase()}`, "info");
}

function calculateHoursDiff(checkIn, checkOut) {
    if (!checkIn || !checkOut) return '-';
    const start = new Date(checkIn);
    const end = new Date(checkOut);
    const diffMs = end - start;
    if (diffMs < 0) return '-';
    const totalMins = Math.floor(diffMs / 60000);
    const hrs = Math.floor(totalMins / 60);
    const mins = totalMins % 60;
    return `${hrs}h ${mins}m`;
}
