import { BrowserMultiFormatReader } from 'https://esm.sh/@zxing/browser@0.1.5?bundle';
import JsBarcode from 'https://esm.sh/jsbarcode@3.12.3?bundle';

const STUDENTS_KEY = 'dampol_students_v1';
const ATTENDANCE_KEY = 'dampol_attendance_v1';
const PIN_KEY = 'dampol_admin_pin_v1';
const FALLBACK_PHOTO = 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="360"><rect width="100%" height="100%" fill="#e7ebf3"/><text x="50%" y="50%" text-anchor="middle" fill="#667085" font-size="22" font-family="sans-serif">No Photo</text></svg>');
const app = document.querySelector('#app');
const modalRoot = document.querySelector('#modal-root');

function readLocal(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}
function writeLocal(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    console.error('Could not save local data:', error);
    alert('Hindi na-save ang data. Maaaring puno na ang browser storage.');
    return false;
  }
}
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function nowTime() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char]);
}
function safePhoto(value) {
  return typeof value === 'string' && value.startsWith('data:image/') ? value : FALLBACK_PHOTO;
}
function barcodeSvg(value) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  JsBarcode(svg, String(value), { format: 'CODE128', width: 2, height: 50, margin: 12, displayValue: true, font: 'monospace', fontSize: 10, textMargin: 4 });
  return svg.outerHTML;
}

let students = readLocal(STUDENTS_KEY, []);
let attendance = readLocal(ATTENDANCE_KEY, []);
let student = null;
let filter = 'All';
let scannerOpen = false;
let scannerError = false;
let scannerMessage = 'Starting camera…';
let scanning = false;
let scannerControls = null;
let processing = false;
let lastScan = { code: '', at: 0 };
let statusMessage = 'Ready to scan.';
let notRegistered = false;
let modalOpen = false;
let adminUnlocked = false;
let adminPin = localStorage.getItem(PIN_KEY) || '1234';
let pinInput = '';
let pinError = '';
let activeTab = 'students';
let lastSavedStudent = null;
let newPin = '';
const presentGuard = new Set();

function saveStudents() { writeLocal(STUDENTS_KEY, students); }
function saveAttendance() { writeLocal(ATTENDANCE_KEY, attendance); }
function latestStudentStatus(current) {
  return [...attendance].reverse().find((entry) => entry.date === today() && entry.lrn === current.lrn);
}
function markedPresent(current) {
  return attendance.some((entry) => entry.date === today() && entry.lrn === current.lrn && entry.status === 'PRESENT');
}

function renderApp() {
  const todayRecords = attendance.filter((record) => record.date === today());
  const visibleRecords = todayRecords.filter((record) => filter === 'All' || record.grade === filter);
  const statusIcon = notRegistered ? '!' : '✓';
  const studentCard = student ? (() => {
    const latest = latestStudentStatus(student);
    const alreadyPresent = markedPresent(student);
    return `<article class="student-card">
      <div class="verified-banner"><span aria-hidden="true">✿</span> VERIFIED — Officially Enrolled</div>
      <div class="student-content"><div class="photo-wrap"><img src="${escapeHtml(safePhoto(student.photo))}" alt="${escapeHtml(student.name)} student photo"></div>
        <div class="student-info"><p class="school-mini">DAMPOL 1ST NATIONAL HIGH SCHOOL</p><h2>${escapeHtml(student.name)}</h2>
          <div class="info-row"><b>LRN</b><span>${escapeHtml(student.lrn)}</span></div>
          <div class="info-row"><b>Grade &amp; Section</b><span>${escapeHtml(student.section)}</span></div>
          <div class="attendance-state">${latest ? `Today's latest status: ${escapeHtml(latest.status)} at ${escapeHtml(latest.time)}` : 'No attendance marked today.'}</div>
        </div>
      </div>
      <div class="confirm-actions">
        <button class="confirm-btn" data-action="mark-present" ${alreadyPresent ? 'disabled title="This student is already marked present today."' : ''}>✓ ${alreadyPresent ? 'ALREADY MARKED PRESENT' : 'MARK PRESENT'}</button>
        <button class="timeout-btn" data-action="mark-timeout">TIME OUT</button>
      </div>
      <p class="face-note">Guard: confirm that the student's face matches the official photo before marking attendance.</p>
    </article>`;
  })() : '';
  const unknownCard = notRegistered ? `<div class="not-registered"><div class="x-icon">×</div><h2>NOT REGISTERED</h2><p>This barcode/LRN is not in the Dampol 1st NHS local database.</p><strong>ENTRY NOT AUTHORIZED</strong></div>` : '';
  const scannerPanel = scannerOpen ? `<div class="scanner-panel" id="scanner-panel"><video id="camera-preview" autoplay playsinline muted aria-label="Live barcode camera view"></video>${scannerError ? '' : '<div class="scan-frame"></div>'}<p id="scanner-message" class="scanner-message ${scannerError ? 'scanner-error' : ''}">${escapeHtml(scannerMessage)}</p><button class="secondary-btn" data-action="stop-scanner">Stop Scanner</button></div>` : '';
  const rows = visibleRecords.length ? visibleRecords.map((record, index) => `<tr data-row="${index}"><td>${escapeHtml(record.date)}</td><td>${escapeHtml(record.time)}</td><td>${escapeHtml(record.name)}</td><td>${escapeHtml(record.lrn)}</td><td>${escapeHtml(record.section)}</td><td><span class="status-pill ${record.status === 'TIME OUT' ? 'out' : ''}">${escapeHtml(record.status)}</span></td></tr>`).join('') : '<tr><td class="empty" colspan="6">No attendance records yet.</td></tr>';
  app.innerHTML = `<div class="app-shell">
    <header class="topbar"><div class="brand-lockup"><div class="brand-mark" aria-hidden="true">⌂</div><div><h1>Dampol 1st National High School</h1><p>Barcode Gate Verification &amp; Attendance System</p></div></div><button class="ghost-btn" data-action="open-admin">♙ Admin</button></header>
    <main class="container"><section aria-label="Gate verification">
      <div class="hero-card"><div><span class="eyebrow">SCHOOL GUARD</span><h2>Scan Student ID</h2><p>Point the camera at the compact barcode printed on the student ID.</p></div><button class="scan-btn" data-action="start-scanner">◉ &nbsp; SCAN BARCODE</button></div>
      ${scannerPanel}
      <div class="status-box"><span class="status-icon" aria-hidden="true">${statusIcon}</span><span class="status-text">${escapeHtml(statusMessage)}</span>${(student || notRegistered) ? '<button class="back-btn" data-action="back">← Bumalik</button>' : ''}</div>
      ${studentCard}${unknownCard}
    </section>
    <section class="dashboard" aria-label="Today attendance log"><div class="dashboard-head"><div><span class="eyebrow">TODAY · ${today()}</span><h2>Attendance Log</h2></div><select class="filter-select" id="grade-filter" aria-label="Filter attendance by grade"><option value="All" ${filter === 'All' ? 'selected' : ''}>All Grades</option><option value="11" ${filter === '11' ? 'selected' : ''}>Grade 11</option><option value="12" ${filter === '12' ? 'selected' : ''}>Grade 12</option></select></div>
      <div class="stats"><div><b>${students.length}</b><span>Students</span></div><div><b>${todayRecords.filter((record) => record.status === 'PRESENT').length}</b><span>Present today</span></div><div><b>${todayRecords.filter((record) => record.status === 'TIME OUT').length}</b><span>Time out today</span></div></div>
      <div class="table-wrap"><table><thead><tr><th>Date</th><th>Time</th><th>Name</th><th>LRN</th><th>Grade-Section</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>
    </section></main></div>`;
}

function updateScannerMessage() {
  const message = document.querySelector('#scanner-message');
  if (message) {
    message.textContent = scannerMessage;
    message.classList.toggle('scanner-error', scannerError);
  }
  const frame = document.querySelector('.scan-frame');
  if (frame) frame.hidden = scannerError;
}
function stopScanner() {
  scanning = false;
  scannerControls?.stop();
  scannerControls = null;
  const video = document.querySelector('#camera-preview');
  const stream = video?.srcObject;
  if (stream && stream.getTracks) stream.getTracks().forEach((track) => track.stop());
  if (video) video.srcObject = null;
  scannerOpen = false;
}
async function startScanner() {
  if (scanning) return;
  scannerOpen = true;
  scannerError = false;
  scannerMessage = 'Checking camera access…';
  renderApp();
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    scannerError = true;
    scannerMessage = 'Camera access requires HTTPS or localhost. Open this site securely, then try again.';
    updateScannerMessage();
    return;
  }
  scanning = true;
  try {
    const reader = new BrowserMultiFormatReader();
    const video = document.querySelector('#camera-preview');
    if (!video) throw new Error('Camera preview is unavailable.');
    scannerMessage = 'Requesting rear camera permission…';
    updateScannerMessage();
    const controls = await reader.decodeFromConstraints(
      { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
      video,
      (result) => { if (result && scanning) handleCode(result.getText()); },
    );
    scannerControls = controls;
    if (scanning) {
      scannerMessage = 'Scanning… hold the barcode inside the frame.';
      updateScannerMessage();
    } else {
      controls.stop();
    }
  } catch (error) {
    scanning = false;
    scannerError = true;
    const name = error instanceof DOMException ? error.name : '';
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') scannerMessage = 'Camera permission was denied. Allow camera access in browser settings, then try again.';
    else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') scannerMessage = 'No camera was found on this device.';
    else scannerMessage = 'Camera could not start. Check camera permission and HTTPS access.';
    updateScannerMessage();
  }
}
function handleCode(rawValue) {
  if (!rawValue || !scanning || processing) return;
  const now = Date.now();
  if (rawValue === lastScan.code && now - lastScan.at < 2500) return;
  processing = true;
  lastScan = { code: rawValue, at: now };
  stopScanner();
  student = students.find((entry) => entry.lrn === rawValue || entry.barcode === rawValue) || null;
  notRegistered = !student;
  statusMessage = student ? 'Student verified. Guard must confirm the face matches the official photo.' : `Barcode ${rawValue} is not registered.`;
  renderApp();
  window.setTimeout(() => { processing = false; }, 1400);
}
function returnToScanHome() {
  stopScanner();
  student = null;
  notRegistered = false;
  statusMessage = 'Ready to scan.';
  scannerError = false;
  scannerMessage = 'Starting camera…';
  processing = false;
  lastScan = { code: '', at: 0 };
  renderApp();
}
function markAttendance(status) {
  if (!student) return;
  const date = today();
  const key = `${date}:${student.lrn}`;
  if (status === 'PRESENT') {
    if (markedPresent(student) || presentGuard.has(key)) {
      statusMessage = `${student.name} is already marked present today.`;
      renderApp();
      return;
    }
    presentGuard.add(key);
  }
  const grade = (student.section.match(/^(\d{2})/) || [])[1] || '';
  attendance.push({ date, time: nowTime(), name: student.name, lrn: student.lrn, grade, section: student.section, status });
  saveAttendance();
  statusMessage = `${status === 'PRESENT' ? 'Marked Present' : 'Time Out'} — ${student.name}`;
  renderApp();
}

function openAdmin() {
  modalOpen = true;
  adminUnlocked = false;
  pinInput = '';
  pinError = '';
  activeTab = 'students';
  renderAdminModal();
}
function closeAdmin() {
  modalOpen = false;
  modalRoot.innerHTML = '';
}
function renderAdminModal() {
  if (!modalOpen) { modalRoot.innerHTML = ''; return; }
  let content = '';
  if (!adminUnlocked) {
    content = `<div class="pin-panel"><span class="eyebrow">ADMIN ACCESS</span><h2 id="admin-title">Enter Admin PIN</h2><p>Default PIN for first setup: <b>1234</b>. Change it after opening Admin.</p><form id="admin-pin-form"><input id="pin-input" type="password" inputmode="numeric" maxlength="12" placeholder="Admin PIN" value="${escapeHtml(pinInput)}" required><button class="primary-btn" type="submit">⌑ &nbsp; OPEN ADMIN</button>${pinError ? `<p class="error">${escapeHtml(pinError)}</p>` : ''}</form></div>`;
  } else {
    content = `<div class="admin-tabs" role="tablist" aria-label="Admin sections">${[['students','Students'],['attendance','Attendance'],['settings','Settings']].map(([tab,label]) => `<button class="tab ${activeTab === tab ? 'active' : ''}" role="tab" aria-selected="${activeTab === tab}" data-action="tab" data-tab="${tab}">${label}</button>`).join('')}</div>${renderAdminTab()}`;
  }
  modalRoot.innerHTML = `<div class="modal" id="admin-modal" role="presentation"><section class="modal-card" role="dialog" aria-modal="true" aria-labelledby="admin-title"><button class="close-btn" aria-label="Close admin" data-action="close-admin">×</button>${content}</section></div>`;
  if (!adminUnlocked) document.querySelector('#pin-input')?.focus();
}
function renderAdminTab() {
  if (activeTab === 'students') {
    const barcode = lastSavedStudent ? (() => { try { return barcodeSvg(lastSavedStudent.barcode); } catch { return ''; } })() : '';
    const list = students.length ? students.map((entry) => `<tr><td>${escapeHtml(entry.lrn)}</td><td>${escapeHtml(entry.name)}</td><td>${escapeHtml(entry.section)}</td><td class="mini-barcode">${escapeHtml(entry.barcode)}</td><td><button class="delete-btn" data-action="delete-student" data-lrn="${escapeHtml(entry.lrn)}">Delete</button></td></tr>`).join('') : '<tr><td class="empty" colspan="5">No students registered.</td></tr>';
    return `<section class="admin-tab"><h2>Student Database</h2><form class="student-form" id="student-form"><input class="field-input" name="lrn" required placeholder="LRN" inputmode="numeric" aria-label="LRN"><input class="field-input" name="name" required placeholder="Full Name" aria-label="Full Name"><input class="field-input" name="section" required placeholder="Grade & Section e.g. 11-ICT A" aria-label="Grade and section"><label class="file-label">Student Photo<input class="field-input" name="photo" type="file" accept="image/*" aria-label="Student photo"></label><button class="primary-btn" type="submit">＋ SAVE STUDENT &amp; GENERATE BARCODE</button></form>${lastSavedStudent ? `<div class="barcode-output"><h3>Compact ID Barcode · Code 128</h3>${barcode}<p>LRN: ${escapeHtml(lastSavedStudent.lrn)} — compact Code 128 barcode</p><button class="secondary-btn" data-action="print-barcode">▤ PRINT BARCODE</button></div>` : ''}<div class="student-list-wrap"><table><thead><tr><th>LRN</th><th>Name</th><th>Grade-Section</th><th>Barcode</th><th>Actions</th></tr></thead><tbody>${list}</tbody></table></div></section>`;
  }
  if (activeTab === 'attendance') return '<section class="admin-tab"><h2>Export Attendance</h2><p class="admin-tab-copy">Export the full attendance history. CSV opens directly in Microsoft Excel.</p><button class="primary-btn" data-action="export-attendance">EXPORT CSV FOR EXCEL</button><button class="danger-btn" data-action="clear-attendance">CLEAR ALL ATTENDANCE</button></section>';
  return `<section class="admin-tab"><h2>Admin Settings</h2><label class="settings-field">Change Admin PIN<input id="new-pin" type="password" inputmode="numeric" maxlength="12" placeholder="New PIN" value="${escapeHtml(newPin)}"></label><button class="primary-btn" data-action="change-pin">CHANGE PIN</button><p class="small">Student and attendance data are stored in this browser only. No server is required.</p></section>`;
}
async function readPhoto(file) {
  if (!file || file.size === 0) return '';
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => resolve('');
    reader.readAsDataURL(file);
  });
}
async function saveStudent(form) {
  const fields = new FormData(form);
  const lrn = String(fields.get('lrn') || '').trim();
  const name = String(fields.get('name') || '').trim();
  const section = String(fields.get('section') || '').trim();
  if (students.some((entry) => entry.lrn === lrn)) { alert('That LRN is already registered.'); return; }
  const photo = await readPhoto(fields.get('photo'));
  const record = { lrn, name, section, photo, barcode: lrn };
  students.push(record);
  saveStudents();
  lastSavedStudent = record;
  form.reset();
  renderApp();
  renderAdminModal();
}
function deleteStudent(lrn) {
  if (!confirm('Delete this student?')) return;
  students = students.filter((entry) => entry.lrn !== lrn);
  saveStudents();
  if (student?.lrn === lrn) { student = null; notRegistered = false; statusMessage = 'Ready to scan.'; }
  renderApp();
  renderAdminModal();
}
function exportAttendance() {
  const rows = [['Date','Time','Name','LRN','Grade-Section','Status'], ...attendance.map((entry) => [entry.date, entry.time, entry.name, entry.lrn, entry.section, entry.status])];
  const csv = rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `Dampol_Attendance_${today()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
function printBarcode() {
  if (!lastSavedStudent) return;
  const printWindow = window.open('', '_blank');
  if (!printWindow) { alert('Allow pop-ups to print the student barcode.'); return; }
  printWindow.document.write(`<!doctype html><html><head><title>Dampol student barcode</title><style>body{font:14px Arial,sans-serif;text-align:center;padding:42px;color:#15233d}.id{display:inline-block;border:1px solid #dce3ed;border-radius:12px;padding:24px 28px}svg{width:310px;height:75px}.name{font-weight:700;margin:12px 0 5px}.caption{font:11px monospace;color:#58657b}</style></head><body><div class="id">${barcodeSvg(lastSavedStudent.barcode)}<div class="name">${escapeHtml(lastSavedStudent.name)}</div><div class="caption">LRN: ${escapeHtml(lastSavedStudent.lrn)} · Code 128</div></div><script>window.onload=()=>window.print()<\/script></body></html>`);
  printWindow.document.close();
}
function clearAttendance() {
  if (!confirm('Clear ALL attendance records? This cannot be undone.')) return;
  attendance = [];
  presentGuard.clear();
  saveAttendance();
  renderApp();
  renderAdminModal();
}
function changePin() {
  const value = newPin.trim();
  if (value.length < 4) { alert('PIN must be at least 4 characters.'); return; }
  adminPin = value;
  localStorage.setItem(PIN_KEY, value);
  newPin = '';
  alert('Admin PIN changed.');
  renderAdminModal();
}

app.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  if (action === 'open-admin') openAdmin();
  else if (action === 'close-admin') closeAdmin();
  else if (action === 'start-scanner') startScanner();
  else if (action === 'stop-scanner') { stopScanner(); renderApp(); }
  else if (action === 'back') returnToScanHome();
  else if (action === 'mark-present') markAttendance('PRESENT');
  else if (action === 'mark-timeout') markAttendance('TIME OUT');
});
modalRoot.addEventListener('click', (event) => {
  if (event.target.id === 'admin-modal') { closeAdmin(); return; }
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  if (action === 'close-admin') closeAdmin();
  else if (action === 'tab') { activeTab = button.dataset.tab; renderAdminModal(); }
  else if (action === 'delete-student') deleteStudent(button.dataset.lrn);
  else if (action === 'print-barcode') printBarcode();
  else if (action === 'export-attendance') exportAttendance();
  else if (action === 'clear-attendance') clearAttendance();
  else if (action === 'change-pin') changePin();
});
modalRoot.addEventListener('input', (event) => {
  if (event.target.id === 'pin-input') pinInput = event.target.value;
  if (event.target.id === 'new-pin') newPin = event.target.value;
});
modalRoot.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (event.target.id === 'admin-pin-form') {
    pinInput = document.querySelector('#pin-input').value;
    if (pinInput === adminPin) { adminUnlocked = true; pinError = ''; }
    else pinError = 'Incorrect PIN.';
    renderAdminModal();
  } else if (event.target.id === 'student-form') {
    await saveStudent(event.target);
  }
});
app.addEventListener('change', (event) => {
  if (event.target.id === 'grade-filter') { filter = event.target.value; renderApp(); }
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && modalOpen) closeAdmin();
});

renderApp();
