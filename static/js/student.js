// PassBiometric - Student Dashboard Logic

document.addEventListener('DOMContentLoaded', () => {
    // 1. Get user ID from URL query parameters
    const urlParams = new URLSearchParams(window.location.search);
    const userId = urlParams.get('id');
    
    if (!userId) {
        document.getElementById('student-name').textContent = "Access Denied";
        document.getElementById('timeline-container').innerHTML = `
            <div style="text-align: center; padding: 20px; color: var(--system-red); font-weight: 600; font-size: 14px;">
                Error: Student ID parameter (?id=X) is required to view dashboard.
            </div>
        `;
        return;
    }
    
    // 2. Fetch and render dashboard data
    fetchStudentDashboardData(userId);
});

let studentLogs = []; // global timeline data

async function fetchStudentDashboardData(userId) {
    try {
        const adminToken = localStorage.getItem('admin_token');
        const studentToken = localStorage.getItem('student_token');
        const token = studentToken || adminToken;
        
        const res = await fetch(`/api/student/${userId}/dashboard-data`, {
            headers: {
                'Authorization': `Bearer ${token || ''}`
            }
        });
        
        if (res.status === 401 || res.status === 403) {
            document.getElementById('student-name').textContent = "Access Denied";
            document.getElementById('timeline-container').innerHTML = `
                <div style="text-align: center; padding: 30px; background: rgba(255, 59, 48, 0.05); border-radius: var(--radius-medium); border: 1px solid rgba(255, 59, 48, 0.15);">
                    <div style="font-size: 16px; font-weight: 700; color: var(--system-red); margin-bottom: 8px;">Session Expired or Access Denied</div>
                    <p style="font-size: 13px; color: var(--text-secondary); margin-bottom: 20px;">Please authenticate via the Student Portal to view this dashboard.</p>
                    <a href="/" class="btn btn-primary" style="display: inline-flex; width: auto; margin: 0; padding: 8px 20px; font-size: 13px; height: auto;">Return to Portal</a>
                </div>
            `;
            return;
        }
        
        if (res.status === 404) {
            document.getElementById('student-name').textContent = "Not Found";
            document.getElementById('timeline-container').innerHTML = `
                <div style="text-align: center; padding: 30px; background: rgba(255, 149, 0, 0.05); border-radius: var(--radius-medium); border: 1px solid rgba(255, 149, 0, 0.15);">
                    <div style="font-size: 16px; font-weight: 700; color: #ff9500; margin-bottom: 8px;">Student Record Not Found</div>
                    <p style="font-size: 13px; color: var(--text-secondary); margin-bottom: 20px;">No record matches this student ID.</p>
                    <a href="/" class="btn btn-secondary" style="display: inline-flex; width: auto; margin: 0; padding: 8px 20px; font-size: 13px; background: rgba(0,0,0,0.05); border: 1px solid rgba(0,0,0,0.08); color: var(--text-primary); height: auto;">Return to Portal</a>
                </div>
            `;
            return;
        }
        
        if (!res.ok) {
            throw new Error("Failed to load student dashboard logs");
        }
        
        const data = await res.json();
        studentLogs = data.timeline;
        
        // 1. Render profile card
        renderProfile(data.summary);
        
        // 2. Render statistics
        renderStats(data.summary);
        
        // 3. Populate month selector filters
        populateMonthFilters(data.timeline);
        
        // 4. Render initial timeline view
        renderTimeline(data.timeline);
        
        // 5. Setup filter listener
        document.getElementById('month-filter').onchange = (e) => {
            const selectedMonth = e.target.value;
            if (selectedMonth === 'all') {
                renderTimeline(studentLogs);
            } else {
                const filtered = studentLogs.filter(log => getMonthYearString(log.log_date) === selectedMonth);
                renderTimeline(filtered);
            }
        };
        
    } catch (e) {
        console.error(e);
        document.getElementById('timeline-container').innerHTML = `
            <div style="text-align: center; padding: 20px; color: var(--system-red); font-size: 13px;">
                Error loading student dashboard details. Verify user ID exists.
            </div>
        `;
    }
}

function renderProfile(summary) {
    document.getElementById('student-name').textContent = summary.name;
    document.getElementById('student-username').textContent = summary.username;
    document.getElementById('student-role').textContent = summary.role;
    document.getElementById('student-dept').textContent = summary.department || 'General';
    
    const avatar = document.getElementById('student-avatar');
    const placeholder = document.getElementById('student-avatar-placeholder');
    
    if (summary.photo) {
        avatar.src = summary.photo;
        avatar.style.display = 'block';
        placeholder.style.display = 'none';
    } else {
        avatar.style.display = 'none';
        placeholder.style.display = 'block';
    }
}

function renderStats(summary) {
    document.getElementById('stat-percentage').textContent = `${summary.percentage}%`;
    document.getElementById('stat-classes-ratio').textContent = `${summary.present} present / ${summary.total_classes} classes`;
    document.getElementById('stat-progress-bar').style.width = `${summary.percentage}%`;
    
    // Set color themes based on percentage
    const bar = document.getElementById('stat-progress-bar');
    if (summary.percentage < 50) {
        bar.style.background = 'linear-gradient(90deg, var(--system-red) 0%, #ff9f0a 100%)';
    } else if (summary.percentage < 75) {
        bar.style.background = 'linear-gradient(90deg, #ff9f0a 0%, #ffd60a 100%)';
    } else {
        bar.style.background = 'linear-gradient(90deg, var(--system-blue) 0%, #00d2ff 100%)';
    }
    
    document.getElementById('stat-total').textContent = summary.total_classes;
    document.getElementById('stat-present').textContent = summary.present;
    document.getElementById('stat-absent').textContent = summary.absent;
}

function populateMonthFilters(timeline) {
    const filterSelect = document.getElementById('month-filter');
    filterSelect.innerHTML = '<option value="all">All Months</option>';
    
    const uniqueMonths = new Set();
    timeline.forEach(log => {
        const monthStr = getMonthYearString(log.log_date);
        if (monthStr) uniqueMonths.add(monthStr);
    });
    
    uniqueMonths.forEach(month => {
        const opt = document.createElement('option');
        opt.value = month;
        opt.textContent = month;
        filterSelect.appendChild(opt);
    });
}

function renderTimeline(logs) {
    const container = document.getElementById('timeline-container');
    if (logs.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; font-size: 13px; color: var(--text-secondary); padding: 30px; background: rgba(0,0,0,0.01); border-radius: var(--radius-small); border: 1px dashed rgba(0,0,0,0.08);">
                No attendance logs found for the selected period.
            </div>
        `;
        return;
    }
    
    let html = '';
    logs.forEach(log => {
        // Format Date nicely: e.g. "03-07-2026" -> "July 3, 2026"
        const dateObj = new Date(log.log_date);
        const options = { year: 'numeric', month: 'long', day: 'numeric' };
        const formattedDate = dateObj.toLocaleDateString('en-US', options);
        
        // Formats check-in and out timestamps
        const checkInTime = log.check_in_time ? formatLocalTime(log.check_in_time) : '--';
        const checkOutTime = log.check_out_time ? formatLocalTime(log.check_out_time) : 'Pending';
        
        // Status badge
        let statusBadge = '';
        if (log.status === 'Late Arrival') {
            statusBadge = '<span class="log-badge" style="font-size: 10px; padding: 2px 8px; font-weight: 700; background: rgba(255, 149, 0, 0.15); color: #ff9500; border: 1.5px solid rgba(255, 149, 0, 0.25); border-radius: 6px; text-transform: uppercase;">LATE</span>';
        } else {
            statusBadge = '<span class="log-badge badge-approved" style="font-size: 10px; padding: 2px 8px; font-weight: 700;">PRESENT</span>';
        }
        
        // Thumbnails
        const inPhotoHTML = log.check_in_photo 
            ? `<img src="${log.check_in_photo}" alt="Check-In Selfie" title="Check-In Selfie" style="width:44px; height:44px; border-radius:8px; object-fit:cover; border:1.5px solid rgba(0, 113, 227, 0.15); box-shadow: 0 2px 6px rgba(0,0,0,0.05);">`
            : `<div title="No Check-In Photo" style="width:44px; height:44px; border-radius:8px; background:rgba(0,0,0,0.03); border:1.5px dashed rgba(0,0,0,0.08); display:flex; align-items:center; justify-content:center; font-size:16px; color:var(--text-secondary);">📷</div>`;

        const outPhotoHTML = log.check_out_time && log.check_out_photo
            ? `<img src="${log.check_out_photo}" alt="Check-Out Selfie" title="Check-Out Selfie" style="width:44px; height:44px; border-radius:8px; object-fit:cover; border:1.5px solid rgba(0, 113, 227, 0.15); box-shadow: 0 2px 6px rgba(0,0,0,0.05);">`
            : `<div title="No Check-Out Photo" style="width:44px; height:44px; border-radius:8px; background:rgba(0,0,0,0.03); border:1.5px dashed rgba(0,0,0,0.08); display:flex; align-items:center; justify-content:center; font-size:16px; color:var(--text-secondary);">📷</div>`;
            
        html += `
            <div class="log-item" style="display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; background: rgba(255,255,255,0.75); border-radius: var(--radius-medium); border: 1px solid rgba(0,0,0,0.04); box-shadow: 0 2px 8px rgba(0,0,0,0.02); gap: 15px;">
                <div style="flex: 1; min-width: 0;">
                    <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
                        <span style="font-size: 13px; font-weight: 700; color: var(--text-primary);">${formattedDate}</span>
                        ${statusBadge}
                    </div>
                    <div style="display: flex; gap: 15px; font-size: 12px; color: var(--text-secondary);">
                        <div>Check-in: <strong style="color: var(--text-primary);">${checkInTime}</strong></div>
                        <div>Check-out: <strong style="color: var(--text-primary);">${checkOutTime}</strong></div>
                    </div>
                </div>
                
                <!-- Selfie Matching Previews -->
                <div style="display: flex; gap: 6px; align-items: center; flex-shrink: 0;">
                    <div style="display: flex; flex-direction: column; align-items: center; gap: 2px;">
                        ${inPhotoHTML}
                        <span style="font-size: 8px; font-weight: 700; color: var(--text-secondary);">IN</span>
                    </div>
                    <div style="display: flex; flex-direction: column; align-items: center; gap: 2px;">
                        ${outPhotoHTML}
                        <span style="font-size: 8px; font-weight: 700; color: var(--text-secondary);">OUT</span>
                    </div>
                </div>
            </div>
        `;
    });
    container.innerHTML = html;
}

// Helpers
function getMonthYearString(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    return `${months[date.getMonth()]} ${date.getFullYear()}`;
}

function formatLocalTime(isoStr) {
    if (!isoStr) return '--';
    const date = new Date(isoStr);
    let hours = date.getHours();
    let minutes = date.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12; // the hour '0' should be '12'
    minutes = minutes < 10 ? '0' + minutes : minutes;
    return `${hours}:${minutes} ${ampm}`;
}
