// ============================================================================
// Regular.js - โมดูลจัดการระบบสลับโหมดและรายงานวิเคราะห์ข้อมูลอาจารย์ประจำ
// เวอร์ชันปรับปรุง: ป้องกันเลขรหัสวิชาปนเป็นจำนวนคน + ตัดการนับซ้ำชีตหน้าปก + กรองชื่อบุคคล
// ============================================================================

const REG_STORAGE_VERSION = 'v15_fix_778512_and_88_to_76_11';

// ----------------------------------------------------------------------------
// 1. State หลักของโมดูลอาจารย์ประจำและตารางสอน
// ----------------------------------------------------------------------------
let currentAppMode = 'SPECIAL'; // 'SPECIAL' | 'REGULAR'
let currentRegTab = 'reg-tab-overview';

let regRosterList = [];
let regRosterFacultyAgg = [];
let regRosterTotalOverride = null;
let regMissionFacultySummaries = [];
let regMissionRecords = [];
let regImportLogs = [];
let regLastSyncText = '-';

// State สำหรับ Drill-down ในแท็บวิเคราะห์รายคณะ
let faDrilldownFilter = { faculty: 'ALL', major: 'ALL', status: 'ALL', degree: 'ALL', label: 'รายชื่ออาจารย์ประจำ' };

// State สำหรับตารางสอน (เมนูที่ 4)
let tsScheduleRecords = [];
let tsImportLogs = [];
let tsLastUpdated = '-';
let tsCurrentView = 'WEEKLY'; // 'WEEKLY' | 'LIST'

const regCharts = {};

// ----------------------------------------------------------------------------
// 2. Helper Functions มาตรฐานและการตรวจสอบความถูกต้องของรายชื่อบุคคล
// ----------------------------------------------------------------------------
const NON_PERSON_KEYWORDS_RE = /(?:สาขาวิชา|สาขา|คณะ|วิทยาลัย|สำนักวิชา|หลักสูตร|ภาควิชา|หน่วยงาน|มหาวิทยาลัย|พันธกิจ|ค่าสอน|ประมาณการ|หน่วยกิต|ชั่วโมง|คาบสอน|รายวิชา|รหัสวิชา|ชื่อวิชา|วิชาที่สอน|กลุ่มเรียน|ภาคเรียน|ภาคการศึกษา|ปีการศึกษา|หมายเหตุ|สรุป|รวมทั้งสิ้น|รวมทั้งหมด|ตาราง|เกณฑ์|ภาระงาน|ยกไป|ติดค้าง|ขาดอีก|สอนครบ|สอนไม่ครบ|ไม่ครบพันธกิจ|ครบพันธกิจ|ไม่มีพันธกิจ|อาจารย์ประจำ|อาจารย์พิเศษ|อาจารย์ผู้สอน|ผู้สอน|ผู้ทรงคุณวุฒิ|ประจำ|พิเศษ|ร่วมสอน|ลงชื่อ|ผู้รับรอง|คณบดี|รองคณบดี|ผู้ช่วยคณบดี|หัวหน้าสาขา|ประธานหลักสูตร|อธิการบดี|รองอธิการบดี|ลาศึกษา|ลาคลอด|ลาป่วย|ลากิจ|เกษียณ|ลาออก|บรรจุใหม่|ไม่มี|ไม่ระบุ|ทั้งนี้|เนื่องจาก|ตามประกาศ|คำสั่ง|บันทึกข้อความ|จำนวน|ทั้งหมด|ลำดับ|ชื่อ-สกุล|ชื่อ-นามสกุล|ตำแหน่ง|คุณวุฒิ|ได้แก่|คือ|จึงเรียนมาเพื่อ|ปฏิบัติหน้าที่|ช่วยราชการ)/i;

const TITLE_PREFIX_RE = /^(?:ศาสตราจารย์|รองศาสตราจารย์|ผู้ช่วยศาสตราจารย์|อาจารย์|ดร\.|ศ\.ดร\.|รศ\.ดร\.|ผศ\.ดร\.|อ\.ดร\.|ศ\.|รศ\.|ผศ\.|อ\.|ว่าที่\s*ร\.ต\.|นาย|นางสาว|นาง|น\.ส\.|ม\.ร\.ว\.|ม\.ล\.|assoc\.?\s*prof\.?|asst\.?\s*prof\.?|prof\.?|dr\.?|mr\.?|mrs\.?|ms\.?|miss)\s*/i;

const EMBEDDED_TITLE_RE = /(?:^|\s)(?:ศาสตราจารย์|รองศาสตราจารย์|ผู้ช่วยศาสตราจารย์|อาจารย์|ศ\.ดร\.|รศ\.ดร\.|ผศ\.ดร\.|อ\.ดร\.|ศ\.|รศ\.|ผศ\.|อ\.|ดร\.|ว่าที่\s*ร\.ต\.|นาย|นางสาว|นาง|น\.ส\.)\s*/;

function cleanText(val) {
    if (val === null || val === undefined) return '';
    return String(val).replace(/\s+/g, ' ').trim();
}

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function normalizeThaiDigits(str) {
    return String(str || '').replace(/[๐๑๒๓๔๕๖๗๘๙]/g, ch => '๐๑๒๓๔๕๖๗๘๙'.indexOf(ch).toString());
}

function sanitizeLecturerName(raw) {
    let s = cleanText(raw);
    if (!s) return '';
    s = s.replace(/^\s*(?:\(?\d+\)?[.)\s-]+)+/, '');
    s = s.replace(/\([^)]*\)/g, ' ');
    s = s.replace(/\s*(?:[:：–—]|\s-\s|ขาดพันธกิจ|ขาดอีก|เกิน\s*ยกไป|ติดค้าง|สอนครบ|สอนไม่ครบ|ไม่ครบ|ครบตามเกณฑ์|ไม่มีพันธกิจ|เนื่องจาก|ลาศึกษา|จำนวน\s*\d+).*$/i, '');
    return cleanText(s);
}

function stripAllTitles(name) {
    let s = sanitizeLecturerName(name);
    let prev;
    do {
        prev = s;
        s = s.replace(TITLE_PREFIX_RE, '').trim();
    } while (s !== prev);
    return s;
}

function normalizePersonKey(name) {
    const withoutTitle = stripAllTitles(name);
    if (!withoutTitle) return '';
    return withoutTitle.replace(/[\s.]+/g, '').toLowerCase();
}

function hasAcademicOrThaiTitle(raw) {
    const s = cleanText(raw);
    return /^(?:\d+[.)\s-]*)?(?:ศาสตราจารย์|รองศาสตราจารย์|ผู้ช่วยศาสตราจารย์|อาจารย์|ดร\.|ศ\.|รศ\.|ผศ\.|อ\.|ว่าที่|นาย|นางสาว|นาง|น\.ส\.|ม\.ร\.ว\.|ม\.ล\.|assoc\.?\s*prof|asst\.?\s*prof|prof\.|dr\.|mr\.?|mrs\.?|ms\.?|miss)/i.test(s);
}

function isValidPersonName(name) {
    const s = sanitizeLecturerName(name);
    if (!s || s.length < 4 || s.length > 55) return false;
    if (/[0-9๐-๙%=+/฿$#@!?*<>[\]{}|\\]/.test(s)) return false;
    if (NON_PERSON_KEYWORDS_RE.test(s)) return false;

    const withoutTitle = stripAllTitles(s);
    if (!withoutTitle || withoutTitle.length < 3) return false;
    if (NON_PERSON_KEYWORDS_RE.test(withoutTitle)) return false;
    if (EMBEDDED_TITLE_RE.test(withoutTitle)) return false;

    const nameTokens = withoutTitle.split(/\s+/).filter(Boolean);
    const hasTitle = hasAcademicOrThaiTitle(s);

    if (nameTokens.length < 2 || nameTokens.length > 4) return false;
    if (!nameTokens.every(tok => /^[ก-๙a-zA-Z.-]{2,}$/.test(tok))) return false;
    if (nameTokens[0] === nameTokens[1]) return false;

    // ตรวจสอบว่าต้องมีคำนำหน้าชื่อ หรือมีตัวตนอยู่ในฐานข้อมูลรายชื่ออาจารย์ประจำ
    const pKey = normalizePersonKey(s);
    const existsInRoster = regRosterList.some(r => r.personKey === pKey);
    if (!hasTitle && !existsInRoster) {
        return false;
    }

    return true;
}

function resolvePersonWithRoster(rawToken, facultyHint = '') {
    const cleaned = sanitizeLecturerName(rawToken);
    if (!cleaned) return null;

    if (isValidPersonName(cleaned)) {
        const pKey = normalizePersonKey(cleaned);
        if (!pKey || pKey.length < 3) return null;

        const exactRoster = regRosterList.find(r =>
            r.personKey === pKey && (!facultyHint || facultyHint === 'ไม่ระบุคณะ' || r.faculty === facultyHint)
        ) || regRosterList.find(r => r.personKey === pKey);

        if (exactRoster) {
            return {
                personKey: exactRoster.personKey,
                name: exactRoster.name,
                faculty: exactRoster.faculty,
                major: exactRoster.major,
                degree: exactRoster.degree,
                position: exactRoster.position
            };
        }

        return {
            personKey: pKey,
            name: cleaned,
            faculty: facultyHint || 'ไม่ระบุคณะ',
            major: '',
            degree: '',
            position: ''
        };
    }

    if (!/[0-9๐-๙%=+/฿$#@!?*]/.test(cleaned) && !NON_PERSON_KEYWORDS_RE.test(cleaned)) {
        const firstOnly = stripAllTitles(cleaned);
        if (/^[ก-๙a-zA-Z]{2,25}$/.test(firstOnly) && regRosterList.length > 0) {
            const candidates = regRosterList.filter(r => {
                if (facultyHint && facultyHint !== 'ไม่ระบุคณะ' && r.faculty !== facultyHint) return false;
                const rFirst = stripAllTitles(r.name).split(/\s+/)[0] || '';
                return rFirst === firstOnly;
            });
            if (candidates.length === 1) {
                const match = candidates[0];
                return {
                    personKey: match.personKey,
                    name: match.name,
                    faculty: match.faculty,
                    major: match.major,
                    degree: match.degree,
                    position: match.position
                };
            }
        }
    }

    return null;
}

function extractCleanPersonListFromText(rawText, facultyHint = '') {
    const results = [];
    const seen = new Set();
    const cleanedBlock = normalizeThaiDigits(cleanText(rawText));
    if (!cleanedBlock) return results;

    let namesOnlyPart = cleanedBlock.replace(/^.*?(?:ได้แก่|คือ|รายชื่อ)\s*[:：]?\s*/i, '');
    namesOnlyPart = namesOnlyPart.replace(/\s+(\d+[.)])\s+/g, ' , $1 ');
    namesOnlyPart = namesOnlyPart.replace(
        /([ก-๙a-zA-Z]{2,})\s+((?:ศาสตราจารย์|รองศาสตราจารย์|ผู้ช่วยศาสตราจารย์|อาจารย์|ศ\.ดร\.|รศ\.ดร\.|ผศ\.ดร\.|อ\.ดร\.|ศ\.|รศ\.|ผศ\.|อ\.|ดร\.|ว่าที่\s*ร\.ต\.|นาย|นางสาว|นาง|น\.ส\.))/g,
        '$1 , $2'
    );

    const tokens = namesOnlyPart.split(/[,;/|\n]+|\s+และ\s+/);

    for (const tok of tokens) {
        const resolved = resolvePersonWithRoster(tok, facultyHint);
        if (resolved && resolved.personKey && !seen.has(resolved.personKey)) {
            seen.add(resolved.personKey);
            results.push(resolved);
        }
    }
    return results;
}

function normalizeFacultyName(raw, stripParen = true) {
    let s = cleanText(raw);
    if (!s) return 'ไม่ระบุคณะ';
    if (stripParen) {
        s = s.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
    }
    if (/นิติศาสตร์|คนต/i.test(s)) return 'คณะนิติศาสตร์';
    if (/วิศวกรรมศาสตร์|ควศ/i.test(s)) return 'คณะวิศวกรรมศาสตร์';
    if (/ศิลปศาสตร์|คศศ/i.test(s)) return 'คณะศิลปศาสตร์';
    if (/บริหารธุรกิจ|คบธ/i.test(s)) return 'คณะบริหารธุรกิจ';
    if (/การสร้างเจ้าของธุรกิจ/i.test(s)) return 'คณะการสร้างเจ้าของธุรกิจ';
    if (/สำนักวิชาศึกษาทั่วไป/i.test(s)) return 'สำนักวิชาศึกษาทั่วไป';
    if (/ดิจิทัลมีเดีย/i.test(s)) return 'คณะดิจิทัลมีเดีย';
    if (/เทคโนโลยีสารสนเทศ/i.test(s)) return 'คณะเทคโนโลยีสารสนเทศ';
    if (/นิเทศศาสตร์/i.test(s)) return 'คณะนิเทศศาสตร์';
    if (/คณะบัญชี/i.test(s)) return 'คณะบัญชี';
    if (/วิทยาลัยนานาชาติ/i.test(s)) return 'วิทยาลัยนานาชาติ';
    if (/การออกแบบและสถาปัตยกรรมศาสตร์|สถาปัตยกรรม/i.test(s)) return 'คณะการออกแบบและสถาปัตยกรรมศาสตร์';
    if (/โลจิสติกส์และซัพพลายเชน/i.test(s)) return 'วิทยาลัยโลจิสติกส์และซัพพลายเชน';
    if (/บัณฑิตศึกษาด้านการจัดการ/i.test(s)) return 'วิทยาลัยบัณฑิตศึกษาด้านการจัดการ';
    if (/วิทยาศาสตร์และเทคโนโลยี|ควท/i.test(s)) return 'คณะวิทยาศาสตร์และเทคโนโลยี';
    if (/ครุศาสตร์|คคศ/i.test(s)) return 'คณะครุศาสตร์';
    if (/พยาบาลศาสตร์|คพย/i.test(s)) return 'คณะพยาบาลศาสตร์';
    if (/สาธารณสุขศาสตร์|คสธ/i.test(s)) return 'คณะสาธารณสุขศาสตร์';

    const m = s.match(/((?:คณะ|วิทยาลัย|สำนักวิชา)[ก-๙a-zA-Z0-9\s]+?)(?=\s+(?:ภาค|ปี|ครั้งที่|1-|2-|3-|ป\.ตรี|ป\.โท|ป\.เอก|$))/);
    if (m && cleanText(m[1])) return cleanText(m[1]);
    return s;
}

function extractFacultyLabel(text) {
    const s = cleanText(text);
    if (!s) return 'ไม่ระบุคณะ';
    const norm = normalizeFacultyName(s, true);
    if (/^(?:คณะ|วิทยาลัย|สำนักวิชา)/.test(norm)) return norm;
    return 'ไม่ระบุคณะ';
}

function normalizeDegreeLabel(raw) {
    const s = cleanText(raw);
    if (!s) return 'ไม่ระบุคุณวุฒิ';
    if (/เอก|ph\.?d|doctor/i.test(s)) return 'ปริญญาเอก';
    if (/โท|master/i.test(s)) return 'ปริญญาโท';
    if (/ตรี|bachelor/i.test(s)) return 'ปริญญาตรี';
    return s;
}

function sheetToExpandedRows(ws) {
    if (!ws || typeof XLSX === 'undefined') return [];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    const merges = ws['!merges'] || [];
    for (const m of merges) {
        const topLeftVal = (rows[m.s.r] && rows[m.s.r][m.s.c] !== undefined) ? rows[m.s.r][m.s.c] : '';
        if (topLeftVal === '' || topLeftVal === null || topLeftVal === undefined) continue;
        for (let r = m.s.r; r <= m.e.r; r++) {
            if (!rows[r]) rows[r] = [];
            for (let c = m.s.c; c <= m.e.c; c++) {
                if (rows[r][c] === '' || rows[r][c] === undefined) {
                    rows[r][c] = topLeftVal;
                }
            }
        }
    }
    return rows;
}

// ----------------------------------------------------------------------------
// 3. ระบบเปิด File Picker แบบ Direct User Gesture
// ----------------------------------------------------------------------------
function prepareSafeFileInputs() {
    const fileInputIds = ['reg-roster-file-input', 'reg-mission-file-input', 'ts-excel-file-input'];
    fileInputIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.classList.remove('hidden');
            el.style.position = 'fixed';
            el.style.left = '-9999px';
            el.style.top = '0';
            el.style.width = '1px';
            el.style.height = '1px';
            el.style.opacity = '0';
            el.style.pointerEvents = 'none';
            if (el.parentElement !== document.body) {
                document.body.appendChild(el);
            }
        }
    });

    document.querySelectorAll('#reg-import-status-section button[onclick]').forEach(btn => {
        const oc = btn.getAttribute('onclick') || '';
        if (oc.includes('btn-import-regular-roster')) {
            btn.removeAttribute('onclick');
            btn.setAttribute('data-direct-upload', 'roster');
        } else if (oc.includes('btn-import-regular-mission')) {
            btn.removeAttribute('onclick');
            btn.setAttribute('data-direct-upload', 'mission');
        }
    });
}

function openDirectFileDialog(inputId, acceptTypes, onFilesSelected) {
    prepareSafeFileInputs();
    let input = document.getElementById(inputId);

    if (!input) {
        input = document.createElement('input');
        input.type = 'file';
        input.id = inputId;
        input.accept = acceptTypes;
        input.multiple = true;
        input.style.position = 'fixed';
        input.style.left = '-9999px';
        input.style.top = '0';
        input.style.width = '1px';
        input.style.height = '1px';
        input.style.opacity = '0';
        document.body.appendChild(input);
    }

    input.value = '';
    input.onchange = (ev) => {
        const files = ev.target?.files;
        if (files && files.length > 0) {
            onFilesSelected(files);
        }
    };
    input.click();
}

// ----------------------------------------------------------------------------
// 4. ระบบสลับโหมด (อาจารย์พิเศษ <-> อาจารย์ประจำ) และการสลับแท็บ 4 เมนู
// ----------------------------------------------------------------------------
function switchAppMode(mode) {
    currentAppMode = mode === 'REGULAR' ? 'REGULAR' : 'SPECIAL';
    try { localStorage.setItem('aa_active_mode', currentAppMode); } catch (e) {}

    const btnSpecial = document.getElementById('btn-mode-special');
    const btnRegular = document.getElementById('btn-mode-regular');
    const headerTitle = document.getElementById('header-main-title');
    const headerDot = document.getElementById('header-mode-dot');
    const headerBadge = document.getElementById('header-mode-badge-text');

    const specialActions = document.getElementById('special-header-actions');
    const regularActions = document.getElementById('regular-header-actions');
    const specialTabs = document.getElementById('special-nav-tabs-bar');
    const regularTabs = document.getElementById('regular-nav-tabs-bar');
    const specialFilter = document.getElementById('special-global-filter-bar');
    const regularFilter = document.getElementById('regular-global-filter-bar');
    const specialNotice = document.getElementById('data-empty-notice');
    const regularNotice = document.getElementById('reg-data-empty-notice');
    const specialWrapper = document.getElementById('special-dashboard-wrapper');
    const regularWrapper = document.getElementById('regular-dashboard-wrapper');

    if (currentAppMode === 'REGULAR') {
        if (btnRegular) {
            btnRegular.className = 'reg-mode-btn active px-3.5 py-1.5 text-xs font-bold rounded-lg bg-[#159A9C] text-white shadow transition font-disp whitespace-nowrap';
        }
        if (btnSpecial) {
            btnSpecial.className = 'reg-mode-btn px-3.5 py-1.5 text-xs font-bold rounded-lg text-slate-200 hover:text-white transition font-disp whitespace-nowrap';
        }
        if (headerTitle) headerTitle.textContent = 'รายงานวิเคราะห์ข้อมูลอาจารย์ประจำ';
        if (headerDot) headerDot.className = 'w-2 h-2 rounded-full bg-[#159A9C] animate-pulse';
        if (headerBadge) headerBadge.textContent = 'โหมด: อาจารย์ประจำ';

        specialActions?.classList.add('hidden');
        regularActions?.classList.remove('hidden');
        regularActions?.classList.add('flex');

        specialTabs?.classList.add('hidden');
        regularTabs?.classList.remove('hidden');

        specialFilter?.classList.add('hidden');
        regularFilter?.classList.remove('hidden');

        specialNotice?.classList.add('hidden');
        regularNotice?.classList.remove('hidden');

        specialWrapper?.classList.add('hidden');
        regularWrapper?.classList.remove('hidden');

        switchRegularTab(currentRegTab);
        renderAllRegularViews();
    } else {
        if (btnSpecial) {
            btnSpecial.className = 'reg-mode-btn active px-3.5 py-1.5 text-xs font-bold rounded-lg bg-rose text-white shadow transition font-disp whitespace-nowrap';
        }
        if (btnRegular) {
            btnRegular.className = 'reg-mode-btn px-3.5 py-1.5 text-xs font-bold rounded-lg text-slate-200 hover:text-white transition font-disp whitespace-nowrap';
        }
        if (headerTitle) headerTitle.textContent = 'รายงานวิเคราะห์ข้อมูลอาจารย์พิเศษ';
        if (headerDot) headerDot.className = 'w-2 h-2 rounded-full bg-rose animate-pulse';
        if (headerBadge) headerBadge.textContent = 'โหมด: อาจารย์พิเศษ';

        regularActions?.classList.add('hidden');
        regularActions?.classList.remove('flex');
        specialActions?.classList.remove('hidden');

        regularTabs?.classList.add('hidden');
        specialTabs?.classList.remove('hidden');

        regularFilter?.classList.add('hidden');
        specialFilter?.classList.remove('hidden');

        regularNotice?.classList.add('hidden');
        specialNotice?.classList.remove('hidden');

        regularWrapper?.classList.add('hidden');
        specialWrapper?.classList.remove('hidden');
    }
}

function switchRegularTab(tabId) {
    currentRegTab = tabId || 'reg-tab-overview';

    document.querySelectorAll('.reg-nav-tab').forEach(btn => {
        const isTarget = btn.getAttribute('data-reg-tab') === currentRegTab;
        if (isTarget) {
            btn.className = 'reg-nav-tab active transition flex items-center space-x-2 whitespace-nowrap px-3.5 py-1.5 rounded-lg text-xs font-bold text-white bg-[#159A9C] shadow font-disp';
        } else {
            btn.className = 'reg-nav-tab transition flex items-center space-x-2 whitespace-nowrap px-3.5 py-1.5 rounded-lg text-xs font-bold text-slate-300 hover:text-white font-disp';
        }
    });

    document.querySelectorAll('.reg-tab-panel').forEach(panel => {
        if (panel.id === currentRegTab) {
            panel.classList.remove('hidden');
        } else {
            panel.classList.add('hidden');
        }
    });

    const importSection = document.getElementById('reg-import-status-section');
    const regFilterBar = document.getElementById('regular-global-filter-bar');
    if (currentRegTab === 'reg-tab-overview') {
        importSection?.classList.remove('hidden');
        if (currentAppMode === 'REGULAR') regFilterBar?.classList.remove('hidden');
        renderOverviewTab();
    } else {
        importSection?.classList.add('hidden');
        regFilterBar?.classList.add('hidden');
        if (currentRegTab === 'reg-tab-faculty') renderFacultyAnalysisTab();
        else if (currentRegTab === 'reg-tab-lecturer') renderLecturerSearchTab();
        else if (currentRegTab === 'reg-tab-schedule') renderTeachingScheduleTab();
    }
}

function togglePresentationMode() {
    document.body.classList.toggle('presentation-mode');
    const isPres = document.body.classList.contains('presentation-mode');
    const btn = document.getElementById('btn-presentation-mode');
    const importSec = document.getElementById('reg-import-status-section');
    const notice1 = document.getElementById('data-empty-notice');
    const notice2 = document.getElementById('reg-data-empty-notice');

    if (isPres) {
        if (btn) btn.innerHTML = '<i class="fa-solid fa-compress mr-1.5"></i> ออกจากโหมดนำเสนอ';
        importSec?.classList.add('hidden');
        notice1?.classList.add('hidden');
        notice2?.classList.add('hidden');
        if (document.documentElement.requestFullscreen && !document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(() => {});
        }
    } else {
        if (btn) btn.innerHTML = '<i class="fa-solid fa-desktop mr-1.5"></i> โหมดนำเสนอ';
        if (currentAppMode === 'REGULAR') {
            notice2?.classList.remove('hidden');
            if (currentRegTab === 'reg-tab-overview') importSec?.classList.remove('hidden');
        } else {
            notice1?.classList.remove('hidden');
        }
        if (document.exitFullscreen && document.fullscreenElement) {
            document.exitFullscreen().catch(() => {});
        }
    }
}

// ----------------------------------------------------------------------------
// 5. ตัวอ่านข้อความสรุปท้ายตาราง (แยกจำนวนคนออกจากรหัสวิชาและหน่วยกิตอย่างเคร่งครัด)
// ----------------------------------------------------------------------------
function sanitizeSummaryTextForCounting(raw) {
    let s = normalizeThaiDigits(cleanText(raw));
    // ตัดเลขลำดับหัวข้อต้นบรรทัด
    s = s.replace(/^\s*(?:\(?\d+\)?[.)])\s*/g, ' ');
    // ตัดภาคการศึกษาและปีการศึกษา
    s = s.replace(/(?:ภาค(?:การศึกษา|เรียน)?ที่\s*)?[123]\s*[/\-]\s*(?:25)?\d{2}/g, ' ');
    s = s.replace(/ปีการศึกษา\s*(?:25)?\d{2}/g, ' ');
    // ตัดตัวเลขที่มีเครื่องหมายจุลภาค (เช่น ยอดเงิน 778,512) และตัวเลข 4 หลักขึ้นไป (เช่น รหัสวิชา 778512)
    s = s.replace(/\b\d{1,3}(?:,\d{3})+\b/g, ' ');
    s = s.replace(/\b\d{4,}\b/g, ' ');
    // ตัดตัวเลขที่ตามด้วยหน่วยนับที่ไม่ใช่คน
    s = s.replace(/\d+(?:\.\d+)?\s*(?:หน่วยกิต|ชั่วโมง|ชม\.?|คาบ(?:สอน)?|รายวิชา|วิชา|%|ร้อยละ|บาท|กลุ่ม|ตอน)/g, ' ');
    s = s.replace(/[()]/g, ' ');
    // ตัดรายชื่อบุคคลหลังคำว่า ได้แก่ / คือ เพื่อไม่ให้นับเลขอื่นปน
    s = s.replace(/(?:ได้แก่|คือ|รายชื่อ)\s*[:：]?\s*.+$/i, ' ');
    return cleanText(s);
}

function isValidHeadcountNumber(num, hasExplicitUnit) {
    if (Number.isNaN(num) || num < 0) return false;
    // จำนวนอาจารย์ประจำต่อสาขา/คณะไม่เกิน 200 คน (ป้องกันเลขรหัสวิชาหรือยอดเงินหลุดเข้ามา)
    if (num > 200) return false;
    if (!hasExplicitUnit && num > 60) return false;
    return true;
}

function extractCountsFromCleanLine(cleanLine) {
    let reg = null;
    let comp = null;
    let incomp = null;
    let noMis = null;

    const mReg = cleanLine.match(/อาจารย์ประจำ(?:หลักสูตร)?(?:\s*ทั้งหมด)?[^\d\n]{0,35}?(\d{1,3})\s*คน/i)
        || cleanLine.match(/อาจารย์ประจำ(?:หลักสูตร)?(?:\s*ทั้งหมด)?[^\d\n]{0,25}?\b(\d{1,2})\b(?!\s*(?:หน่วยกิต|ชั่วโมง|ชม|คาบ|วิชา|%))/i);
    if (mReg) {
        const val = parseInt(mReg[1], 10);
        if (isValidHeadcountNumber(val, /คน/.test(mReg[0]))) reg = val;
    }

    const parts = cleanLine.split(/(?=(?:สอน\s*)?ไม่ครบ|ขาดพันธกิจ|ไม่ผ่านเกณฑ์)/i);

    for (const part of parts) {
        if (/^(?:(?:สอน\s*)?ไม่ครบ|ขาดพันธกิจ|ไม่ผ่านเกณฑ์)/i.test(part)) {
            const mIncompUnit = part.match(/(?:(?:สอน\s*)?ไม่ครบ(?:ตาม)?(?:พันธกิจ(?:ประจำ)?|ตามเกณฑ์|เกณฑ์)?|ขาดพันธกิจ|ไม่ผ่านเกณฑ์)[^\d\n]{0,40}?(\d{1,3})\s*คน/i);
            const mIncompNoUnit = part.match(/(?:(?:สอน\s*)?ไม่ครบ(?:ตาม)?(?:พันธกิจ(?:ประจำ)?|ตามเกณฑ์|เกณฑ์)?|ขาดพันธกิจ|ไม่ผ่านเกณฑ์)[^\d\n]{0,25}?\b(\d{1,2})\b(?!\s*(?:หน่วยกิต|ชั่วโมง|ชม|คาบ|วิชา|%))/i);

            if (mIncompUnit) {
                const val = parseInt(mIncompUnit[1], 10);
                if (isValidHeadcountNumber(val, true)) incomp = val;
            } else if (mIncompNoUnit) {
                const val = parseInt(mIncompNoUnit[1], 10);
                if (isValidHeadcountNumber(val, false)) incomp = val;
            } else if (/(?:(?:สอน\s*)?ไม่ครบ|ขาดพันธกิจ|ไม่ผ่านเกณฑ์)[^\d\n]*(?:[-–—]|ไม่มี)\s*(?:คน)?/i.test(part)) {
                incomp = 0;
            }
        } else {
            const mCompUnit = part.match(/(?:(?:สอน\s*)?ครบ(?:ตาม)?(?:พันธกิจ(?:ประจำ)?|ตามเกณฑ์|เกณฑ์)?|ผ่านเกณฑ์)[^\d\n]{0,40}?(\d{1,3})\s*คน/i);
            const mCompNoUnit = part.match(/(?:(?:สอน\s*)?ครบ(?:ตาม)?(?:พันธกิจ(?:ประจำ)?|ตามเกณฑ์|เกณฑ์)?|ผ่านเกณฑ์)[^\d\n]{0,25}?\b(\d{1,2})\b(?!\s*(?:หน่วยกิต|ชั่วโมง|ชม|คาบ|วิชา|%))/i);

            if (mCompUnit) {
                const val = parseInt(mCompUnit[1], 10);
                if (isValidHeadcountNumber(val, true)) comp = val;
            } else if (mCompNoUnit) {
                const val = parseInt(mCompNoUnit[1], 10);
                if (isValidHeadcountNumber(val, false)) comp = val;
            } else if (/(?:(?:สอน\s*)?ครบ|ผ่านเกณฑ์)[^\d\n]*(?:[-–—]|ไม่มี)\s*(?:คน)?/i.test(part)) {
                comp = 0;
            }
        }
    }

    const mNoUnit = cleanLine.match(/ไม่มีพันธกิจ(?:การสอน|ประจำ)?[^\d\n]{0,35}?(\d{1,3})\s*คน/i);
    const mNoNoUnit = cleanLine.match(/ไม่มีพันธกิจ(?:การสอน|ประจำ)?[^\d\n]{0,25}?\b(\d{1,2})\b(?!\s*(?:หน่วยกิต|ชั่วโมง|ชม|คาบ|วิชา|%))/i);
    if (mNoUnit) {
        const val = parseInt(mNoUnit[1], 10);
        if (isValidHeadcountNumber(val, true)) noMis = val;
    } else if (mNoNoUnit) {
        const val = parseInt(mNoNoUnit[1], 10);
        if (isValidHeadcountNumber(val, false)) noMis = val;
    }

    return { reg, comp, incomp, noMis };
}

function parseMissionSubBlock(subBlockLines, facultyHint = '') {
    let regularCount = null;
    let completeCount = null;
    let incompleteCount = null;
    let noMissionCount = null;
    const parsedIncompletePeople = [];
    const seenKeys = new Set();

    let capturingIncompleteNames = false;

    for (let i = 0; i < subBlockLines.length; i++) {
        const rawLine = normalizeThaiDigits(cleanText(subBlockLines[i]));
        if (!rawLine) continue;

        if (/(?<!ไม่)(?:สอน\s*ครบ|ครบพันธกิจ|ครบตามเกณฑ์|ผ่านเกณฑ์)|ไม่มีพันธกิจ|ลงชื่อ|หมายเหตุ\s*[:：]\s*(?:เกณฑ์|ภาระงาน)/i.test(rawLine)) {
            capturingIncompleteNames = false;
        }

        if (/ไม่ครบ|ขาดพันธกิจ|ไม่ผ่านเกณฑ์/i.test(rawLine)) {
            const mNames = rawLine.match(/(?:คือ|ได้แก่|รายชื่อ)\s*[:：]?\s*(.+)$/i)
                || rawLine.match(/ไม่ครบ[^\d]*\d+[^\d]*คน\s*\(([^)]+)\)/i);
            if (mNames && cleanText(mNames[1])) {
                extractCleanPersonListFromText(mNames[1], facultyHint).forEach(p => {
                    if (!seenKeys.has(p.personKey)) {
                        seenKeys.add(p.personKey);
                        parsedIncompletePeople.push({ ...p, rawDetail: p.name });
                    }
                });
            } else {
                const afterCountPart = rawLine.replace(/^.*?(?:ไม่ครบ|ขาดพันธกิจ|ไม่ผ่านเกณฑ์)[^\d]*\d+\s*(?:คน)?\s*/i, '');
                if (afterCountPart && afterCountPart !== rawLine) {
                    extractCleanPersonListFromText(afterCountPart, facultyHint).forEach(p => {
                        if (!seenKeys.has(p.personKey)) {
                            seenKeys.add(p.personKey);
                            parsedIncompletePeople.push({ ...p, rawDetail: p.name });
                        }
                    });
                }
            }
            capturingIncompleteNames = true;
        } else if (capturingIncompleteNames) {
            extractCleanPersonListFromText(rawLine, facultyHint).forEach(p => {
                if (!seenKeys.has(p.personKey)) {
                    seenKeys.add(p.personKey);
                    parsedIncompletePeople.push({ ...p, rawDetail: p.name });
                }
            });
        }

        const cleanLine = sanitizeSummaryTextForCounting(rawLine);
        const extracted = extractCountsFromCleanLine(cleanLine);

        if (extracted.reg !== null && (regularCount === null || (regularCount === 0 && extracted.reg > 0))) {
            regularCount = extracted.reg;
        }
        if (extracted.comp !== null && (completeCount === null || (completeCount === 0 && extracted.comp > 0))) {
            completeCount = extracted.comp;
        }
        if (extracted.incomp !== null && (incompleteCount === null || (incompleteCount === 0 && extracted.incomp > 0))) {
            incompleteCount = extracted.incomp;
        }
        if (extracted.noMis !== null && (noMissionCount === null || (noMissionCount === 0 && extracted.noMis > 0))) {
            noMissionCount = extracted.noMis;
        }
    }

    return {
        regularCount: regularCount || 0,
        completeCount: completeCount || 0,
        incompleteCount: incompleteCount || 0,
        noMissionCount: noMissionCount || 0,
        parsedIncompletePeople
    };
}

// ----------------------------------------------------------------------------
// 6. การนำเข้าไฟล์ Excel ส่วนที่ 1: ฐานข้อมูลอาจารย์ประจำทั้งหมด
// ----------------------------------------------------------------------------
async function handleImportRegularRosterFiles(fileList) {
    if (!fileList || fileList.length === 0) return;

    if (typeof XLSX === 'undefined') {
        alert('ไม่พบไลบรารีอ่านไฟล์ Excel (XLSX)');
        return;
    }

    const nowText = new Date().toLocaleString('th-TH');

    for (const file of Array.from(fileList)) {
        try {
            const buffer = await file.arrayBuffer();
            const wb = XLSX.read(buffer, { type: 'array' });

            regRosterList = regRosterList.filter(r => r.sourceFile !== file.name);
            regRosterFacultyAgg = regRosterFacultyAgg.filter(a => a.sourceFile !== file.name);
            regRosterTotalOverride = null;

            const exactRosterSheet = wb.SheetNames.find(sn => cleanText(sn) === 'รายชื่ออาจารย์');
            const targetSheets = exactRosterSheet ? [exactRosterSheet] : wb.SheetNames;

            let addedCount = 0;

            for (const sheetName of targetSheets) {
                const ws = wb.Sheets[sheetName];
                const rows = sheetToExpandedRows(ws);
                if (!rows || rows.length === 0) continue;

                const sheetDefaultFac = extractFacultyLabel(sheetName) !== 'ไม่ระบุคณะ'
                    ? extractFacultyLabel(sheetName)
                    : extractFacultyLabel(file.name.replace(/\.[^.]+$/, ''));

                let headerIdx = -1;
                let cSeq = -1, cPrefix = -1, cName = -1, cLastName = -1, cType = -1;
                let cFac = -1, cMaj = -1, cDeg = -1, cPos = -1, cCount = -1;

                for (let r = 0; r < Math.min(rows.length, 30); r++) {
                    const rowStr = (rows[r] || []).map(c => cleanText(c));
                    const fFullName = rowStr.findIndex(c => /(ชื่อ\s*-?\s*(?:นาม)?สกุล|ชื่ออาจารย์|รายชื่อ|ชื่อผู้สอน)/i.test(c));
                    const fFirstName = rowStr.findIndex(c => /^(?:ชื่อ|ชื่อตัว|ชื่อจริง)$/i.test(c));
                    const fLastName = rowStr.findIndex(c => /^(?:นามสกุล|ชื่อสกุล|สกุล)$/i.test(c));
                    const fName = fFullName !== -1 ? fFullName : fFirstName;
                    const fFac = rowStr.findIndex(c => /^(?:คณะ|คณะ\/หน่วยงาน|สังกัด|หน่วยงาน|วิทยาลัย|สำนักวิชา)$/i.test(c));
                    const fCount = rowStr.findIndex(c => /(จำนวนอาจารย์|จำนวน\s*\(คน\)|รวมทั้งหมด)/i.test(c));

                    if (fName !== -1 || (fFac !== -1 && fCount !== -1)) {
                        headerIdx = r;
                        cSeq = rowStr.findIndex(c => /^(?:ลำดับ|ที่)$/i.test(c));
                        cName = fName;
                        cLastName = (fLastName !== -1 && fLastName !== fName) ? fLastName : -1;
                        cPrefix = rowStr.findIndex((c, idx) => idx !== cName && idx !== cLastName && /^(?:คำนำหน้า|คำนำหน้านาม|ยศ)$/i.test(c));
                        cType = rowStr.findIndex(c => /^(?:ประเภท|ประเภทอาจารย์|ประเภทบุคลากร|สถานะบุคลากร)$/i.test(c));
                        cFac = fFac;
                        cMaj = rowStr.findIndex(c => /(สาขา|หลักสูตร|ภาควิชา)/i.test(c));
                        cDeg = rowStr.findIndex(c => /(คุณวุฒิ|วุฒิการศึกษา|ระดับการศึกษา|วุฒิ)/i.test(c));
                        cPos = rowStr.findIndex(c => /^(?:ตำแหน่งทางวิชาการ|ตำแหน่ง)$/i.test(c));
                        cCount = fCount;
                        break;
                    }
                }

                let currentFac = sheetDefaultFac;

                if (headerIdx !== -1 && cName !== -1) {
                    for (let r = headerIdx + 1; r < rows.length; r++) {
                        const row = (rows[r] || []).map(c => cleanText(c));
                        const line = [...new Set(row.filter(Boolean))].join(' ');
                        if (!line) continue;

                        if (/(?:ชื่อ\s*-?\s*(?:นาม)?สกุล|รายชื่ออาจารย์)/i.test(row[cName] || '')) continue;
                        if (/^(?:รวม|รวมทั้งสิ้น|รวมทั้งหมด|สรุปรวม|หมายเหตุ)/i.test(line)) continue;
                        if (cType !== -1 && /อาจารย์พิเศษ|ผู้ทรงคุณวุฒิ/i.test(row[cType] || '')) continue;

                        if (cFac !== -1 && row[cFac]) {
                            const fNorm = normalizeFacultyName(row[cFac], true);
                            if (fNorm && fNorm !== 'ไม่ระบุคณะ') currentFac = fNorm;
                        }

                        const prefixPart = (cPrefix !== -1 && row[cPrefix]) ? row[cPrefix] : '';
                        const firstPart = row[cName] || '';
                        const lastPart = (cLastName !== -1 && row[cLastName]) ? row[cLastName] : '';
                        const rawCombinedName = [prefixPart, firstPart, lastPart].filter(Boolean).join(' ');
                        const cleanedName = sanitizeLecturerName(rawCombinedName);
                        if (!cleanedName || NON_PERSON_KEYWORDS_RE.test(cleanedName)) continue;

                        const withoutTitle = stripAllTitles(cleanedName);
                        const tokens = withoutTitle.split(/\s+/).filter(Boolean);
                        if (tokens.length < 2 || tokens.length > 4) continue;

                        const pKey = normalizePersonKey(cleanedName);
                        if (!pKey || pKey.length < 3) continue;

                        const seqVal = (cSeq !== -1 && row[cSeq]) ? row[cSeq] : r;
                        const recordKey = `${pKey}::${currentFac}::${seqVal}`;

                        if (!regRosterList.some(x => x.recordKey === recordKey)) {
                            regRosterList.push({
                                recordKey,
                                personKey: pKey,
                                name: cleanedName,
                                faculty: currentFac || 'ไม่ระบุคณะ',
                                major: (cMaj !== -1 && row[cMaj]) ? row[cMaj] : 'ไม่ระบุสาขา',
                                degree: (cDeg !== -1 && row[cDeg]) ? normalizeDegreeLabel(row[cDeg]) : 'ไม่ระบุคุณวุฒิ',
                                position: (cPos !== -1 && row[cPos]) ? row[cPos] : prefixPart,
                                sourceFile: file.name
                            });
                            addedCount++;
                        }
                    }
                } else if (headerIdx !== -1 && cFac !== -1 && cCount !== -1) {
                    for (let r = headerIdx + 1; r < rows.length; r++) {
                        const row = (rows[r] || []).map(c => cleanText(c));
                        const facLabel = normalizeFacultyName(row[cFac], true);
                        const numStr = normalizeThaiDigits(row[cCount] || '').replace(/,/g, '');
                        if (/^(?:รวม|ทั้งหมด)/i.test(row[cFac] || '')) continue;
                        if (/^(?:คณะ|วิทยาลัย|สำนักวิชา)/.test(facLabel) && /^\d+$/.test(numStr)) {
                            regRosterFacultyAgg.push({
                                faculty: facLabel,
                                total: parseInt(numStr, 10),
                                sourceFile: file.name
                            });
                        }
                    }
                }
            }

            const summaryFacSheet = wb.SheetNames.find(sn => cleanText(sn) === 'สรุปตามคณะ');
            if (summaryFacSheet && addedCount === 0) {
                const sRows = sheetToExpandedRows(wb.Sheets[summaryFacSheet]);
                for (const r of sRows) {
                    const cells = (r || []).map(c => cleanText(c));
                    if (/รวมทุกคณะ/i.test(cells[0] || '') && /^\d+$/.test(cells[1] || '')) {
                        regRosterTotalOverride = parseInt(cells[1], 10);
                    }
                }
            }

            regImportLogs = regImportLogs.filter(l => l.fileName !== file.name);
            regImportLogs.push({
                fileName: file.name,
                status: addedCount > 0 || regRosterFacultyAgg.length > 0 ? 'SUCCESS' : 'WARNING',
                count: addedCount,
                message: `นำเข้าฐานข้อมูลอาจารย์ประจำสำเร็จ: ${addedCount.toLocaleString()} คน${exactRosterSheet ? ` (จากชีต '${exactRosterSheet}')` : ''}`,
                timestamp: nowText
            });
        } catch (err) {
            console.error('Error importing roster file:', file.name, err);
        }
    }

    regLastSyncText = nowText;
    saveRegularStateToStorage();
    if (currentAppMode !== 'REGULAR') switchAppMode('REGULAR');
    else renderAllRegularViews();
}

// ----------------------------------------------------------------------------
// 7. การนำเข้าไฟล์ Excel ส่วนที่ 2: พันธกิจของทุกคณะ (ป้องกันการนับซ้ำหน้าปก)
// ----------------------------------------------------------------------------
function isCoverSummarySheet(rows, sheetName, totalCandidateSheets) {
    if (totalCandidateSheets <= 1) return false;
    const sn = cleanText(sheetName);
    let branchRowCount = 0;
    let hasMissionSummaryHeader = false;
    let hasLecturerRosterTable = false;
    let hasCourseCode = false;

    for (let r = 0; r < rows.length; r++) {
        const uCells = [...new Set((rows[r] || []).map(c => cleanText(c)).filter(Boolean))];
        if (uCells.length === 0) continue;
        const line = uCells.join(' ');

        if (/บันทึกข้อความ|เรียน\s*อธิการบดี|1\.\s*พันธกิจอาจารย์ประจำ|สรุปพันธกิจอาจารย์ประจำ|สรุปผลการปฏิบัติพันธกิจ/i.test(line)) {
            hasMissionSummaryHeader = true;
        }
        if (/^(?:สาขาวิชา|หลักสูตร|ภาควิชา|วิศวกรรม|นิติ|ศิลป|บริหาร|บัญชี|นิเทศ|เทคโนโลยี|ดิจิทัล)/i.test(uCells[0]) && !/ครบ|ไม่ครบ|สรุป|รวม/i.test(uCells[0])) {
            branchRowCount++;
        }
        if (/(?:ชื่อ\s*-?\s*(?:นาม)?สกุล|รายชื่ออาจารย์|รหัสวิชา)/i.test(line)) {
            hasLecturerRosterTable = true;
        }
        if (/\b\d{6,8}\b/.test(line)) {
            hasCourseCode = true;
        }
    }

    if (!hasLecturerRosterTable && !hasCourseCode && (branchRowCount >= 2 || hasMissionSummaryHeader || /^พันธกิจ|^สรุป|^ภาพรวม/i.test(sn))) {
        return true;
    }
    return false;
}

function parseCoverSheetBranchTotals(rows) {
    let headerIdx = -1;
    let cBranch = -1, cReg = -1, cComp = -1, cIncomp = -1;

    for (let r = 0; r < Math.min(rows.length, 30); r++) {
        const cells = (rows[r] || []).map(c => cleanText(c));
        const fBranch = cells.findIndex(c => /^(?:สาขาวิชา|สาขา|หลักสูตร|ภาควิชา|หน่วยงาน)$/i.test(c));
        const fComp = cells.findIndex(c => /(?:สอน)?ครบ/i.test(c) && !/ไม่ครบ/i.test(c));
        const fIncomp = cells.findIndex(c => /ไม่ครบ/i.test(c));
        if (fBranch !== -1 && (fComp !== -1 || fIncomp !== -1)) {
            headerIdx = r;
            cBranch = fBranch;
            cReg = cells.findIndex(c => /จำนวนอาจารย์|ทั้งหมด/i.test(c));
            cComp = fComp;
            cIncomp = fIncomp;
            break;
        }
    }

    const branches = [];
    let totalReg = 0, totalComp = 0, totalIncomp = 0;

    if (headerIdx !== -1) {
        for (let r = headerIdx + 1; r < rows.length; r++) {
            const cells = (rows[r] || []).map(c => normalizeThaiDigits(cleanText(c)));
            const bName = cells[cBranch] || '';
            if (!bName) continue;
            if (/^(?:รวม|รวมทั้งสิ้น|รวมทั้งหมด|สรุป)/i.test(bName)) break;
            if (!/^(?:สาขา|หลักสูตร|ภาควิชา|วิศวกรรม|นิติ|ศิลป|บริหาร|บัญชี|นิเทศ|เทคโนโลยี|ดิจิทัล)/i.test(bName)) continue;

            const parseCellNum = (idx) => {
                if (idx === -1) return 0;
                const v = cells[idx] || '';
                const m = v.match(/\b(\d{1,3})\b/);
                const val = m ? parseInt(m[1], 10) : 0;
                return val <= 200 ? val : 0;
            };

            const reg = parseCellNum(cReg);
            const comp = parseCellNum(cComp);
            const incomp = parseCellNum(cIncomp);
            branches.push({ branchName: bName, regularCount: reg, completeCount: comp, incompleteCount: incomp });
            totalReg += reg;
            totalComp += comp;
            totalIncomp += incomp;
        }
    }

    return { branches, totalReg, totalComp, totalIncomp };
}

function scanRegularPeopleFromSheet(rows, baseFaculty, defaultMajor, rosterByKey) {
    let currentGroupType = 'REGULAR';
    let currentMajor = defaultMajor || '';
    const regularPeopleMap = new Map();
    let lastPersonKey = null;

    let cPrefix = -1, cName = -1, cLastName = -1;
    for (let r = 0; r < Math.min(rows.length, 25); r++) {
        const rowStr = (rows[r] || []).map(c => cleanText(c));
        const fFull = rowStr.findIndex(c => /(ชื่อ\s*-?\s*(?:นาม)?สกุล|ชื่ออาจารย์|รายชื่อ|ชื่อผู้สอน)/i.test(c));
        const fFirst = rowStr.findIndex(c => /^(?:ชื่อ|ชื่อตัว|ชื่อจริง)$/i.test(c));
        const fLast = rowStr.findIndex(c => /^(?:นามสกุล|ชื่อสกุล|สกุล)$/i.test(c));
        if (fFull !== -1 || fFirst !== -1) {
            cName = fFull !== -1 ? fFull : fFirst;
            cLastName = (fLast !== -1 && fLast !== cName) ? fLast : -1;
            cPrefix = rowStr.findIndex((c, idx) => idx !== cName && idx !== cLastName && /^(?:คำนำหน้า|คำนำหน้านาม|ยศ)$/i.test(c));
            break;
        }
    }

    for (let r = 0; r < rows.length; r++) {
        const cells = (rows[r] || []).map(c => cleanText(c));
        const uniqueCells = [...new Set(cells.filter(Boolean))];
        if (uniqueCells.length === 0) continue;
        const rowLine = uniqueCells.join(' ');

        if (/^สาขาวิชา|^หลักสูตร/i.test(cells[0]) && !/ครบ|ไม่ครบ|สรุป|รวม/i.test(cells[0])) {
            currentMajor = cells[0];
        }

        if (/^(?:สรุปพันธกิจ|สรุป\s*การเสนอประมาณการ|สรุปประมาณการ|สรุปรวมพันธกิจ)/i.test(uniqueCells[0] || '')) {
            lastPersonKey = null;
            continue;
        }

        if (/อาจารย์ประจำแบบพิเศษ|อาจารย์ประจำพิเศษ|อาจารย์ประจำร่วมสอน|อาจารย์พิเศษ|ผู้ทรงคุณวุฒิ/i.test(rowLine)) {
            currentGroupType = 'OTHER';
            lastPersonKey = null;
            continue;
        }
        if (/^(?:[-–•]|\d+[.)])?\s*อาจารย์ประจำ(?:หลักสูตร|สาขา)?(?!แบบพิเศษ|พิเศษ|ร่วมสอน)/i.test(rowLine)) {
            currentGroupType = 'REGULAR';
            lastPersonKey = null;
            continue;
        }

        let matchedPerson = null;

        if (cName !== -1) {
            const pPart = (cPrefix !== -1 && cells[cPrefix]) ? cells[cPrefix] : '';
            const nPart = cells[cName] || '';
            const lPart = (cLastName !== -1 && cells[cLastName]) ? cells[cLastName] : '';
            const combined = [pPart, nPart, lPart].filter(Boolean).join(' ');
            const san = sanitizeLecturerName(combined);
            const pKey = normalizePersonKey(san);

            if (pKey && rosterByKey.has(pKey)) {
                const rInfo = rosterByKey.get(pKey);
                matchedPerson = {
                    personKey: rInfo.personKey,
                    name: rInfo.name,
                    faculty: rInfo.faculty || baseFaculty,
                    major: rInfo.major || currentMajor || '',
                    degree: rInfo.degree || '',
                    position: rInfo.position || pPart
                };
            } else if (currentGroupType === 'REGULAR' && isValidPersonName(san)) {
                matchedPerson = {
                    personKey: pKey,
                    name: san,
                    faculty: baseFaculty,
                    major: currentMajor || '',
                    degree: '',
                    position: pPart
                };
            }
        }

        if (!matchedPerson) {
            for (let c = 0; c < Math.min(cells.length, 10); c++) {
                const c1 = cells[c] || '';
                const c2 = cells[c + 1] || '';
                const c3 = cells[c + 2] || '';
                const c4 = cells[c + 3] || '';
                if (!c1 || /^\d+[.)]?$/.test(c1)) continue;

                const combos = [
                    c1,
                    c2 ? `${c1} ${c2}` : '',
                    (c2 && c3) ? `${c1} ${c2} ${c3}` : '',
                    (c2 && c3 && c4) ? `${c1} ${c2} ${c3} ${c4}` : ''
                ].filter(Boolean);

                for (const combo of combos) {
                    const san = sanitizeLecturerName(combo);
                    if (!san) continue;
                    const pKey = normalizePersonKey(san);

                    if (pKey && rosterByKey.has(pKey)) {
                        const rInfo = rosterByKey.get(pKey);
                        matchedPerson = {
                            personKey: rInfo.personKey,
                            name: rInfo.name,
                            faculty: rInfo.faculty || baseFaculty,
                            major: rInfo.major || currentMajor || '',
                            degree: rInfo.degree || '',
                            position: rInfo.position || ''
                        };
                        break;
                    }

                    if (currentGroupType === 'REGULAR' && isValidPersonName(san)) {
                        matchedPerson = {
                            personKey: pKey,
                            name: san,
                            faculty: baseFaculty,
                            major: currentMajor || '',
                            degree: '',
                            position: hasAcademicOrThaiTitle(c1) && !c1.includes(' ') ? c1 : ''
                        };
                        break;
                    }
                }
                if (matchedPerson) break;
            }
        }

        const isKnownRegular = matchedPerson && rosterByKey.has(matchedPerson.personKey);

        if ((currentGroupType === 'REGULAR' || isKnownRegular) && matchedPerson && isValidPersonName(matchedPerson.name)) {
            lastPersonKey = matchedPerson.personKey;
            if (!regularPeopleMap.has(lastPersonKey)) {
                regularPeopleMap.set(lastPersonKey, {
                    personKey: lastPersonKey,
                    name: matchedPerson.name,
                    faculty: matchedPerson.faculty || baseFaculty,
                    major: matchedPerson.major || currentMajor || '',
                    degree: matchedPerson.degree || '',
                    position: matchedPerson.position || '',
                    notes: []
                });
            }
        }

        if (lastPersonKey && regularPeopleMap.has(lastPersonKey)) {
            regularPeopleMap.get(lastPersonKey).notes.push(rowLine);
        }
    }

    return regularPeopleMap;
}

function classifyPersonNoteStatus(fullNote) {
    if (/ไม่มีพันธกิจ/i.test(fullNote)) return 'NO_MISSION';
    if (/ติดค้าง\s*ยกไป|ขาดพันธกิจ|สอนไม่ครบ|ไม่ครบพันธกิจ|ไม่ครบตามเกณฑ์|ไม่ผ่านเกณฑ์/i.test(fullNote)) return 'INCOMPLETE';
    if (/เกิน\s*(?:ยกไป|เกณฑ์|พันธกิจ|\d)|ครบตามเกณฑ์|ครบพันธกิจ|สอนครบ|ผ่านเกณฑ์|ไม่ติดค้าง/i.test(fullNote)) return 'COMPLETE';
    return 'NOT_FOUND';
}

async function handleImportRegularMissionFiles(fileList) {
    if (!fileList || fileList.length === 0) return;

    if (typeof XLSX === 'undefined') {
        alert('ไม่พบไลบรารีอ่านไฟล์ Excel (XLSX)');
        return;
    }

    const statusLabel = document.getElementById('reg-upload-status-label');
    if (statusLabel) statusLabel.textContent = `กำลังอ่านไฟล์พันธกิจ ${fileList.length} ไฟล์...`;

    const nowText = new Date().toLocaleString('th-TH');
    const rosterByKey = new Map();
    regRosterList.forEach(r => {
        if (r.personKey && !rosterByKey.has(r.personKey)) {
            rosterByKey.set(r.personKey, r);
        }
    });

    for (const file of Array.from(fileList)) {
        try {
            const buffer = await file.arrayBuffer();
            const wb = XLSX.read(buffer, { type: 'array' });
            let foundAnySummary = false;
            let fileLogDetails = [];

            regMissionFacultySummaries = regMissionFacultySummaries.filter(item => item.fileName !== file.name);
            regMissionRecords = regMissionRecords.filter(item => item.fileName !== file.name);

            const candidateSheets = wb.SheetNames.filter(name => {
                const sn = cleanText(name);
                if (wb.SheetNames.length > 1 && /^sheet\d+$/i.test(sn)) return false;
                if (/รายวิชา|คำอธิบาย|เกณฑ์|วิธีคิด|note|remark|copy of|สำเนา|ตัวอย่าง|template/i.test(sn)) return false;
                return true;
            });

            const coverSheets = [];
            const detailSheets = [];
            for (const sn of candidateSheets) {
                const r = sheetToExpandedRows(wb.Sheets[sn]);
                if (isCoverSummarySheet(r, sn, candidateSheets.length)) {
                    coverSheets.push({ sheetName: sn, rows: r });
                } else {
                    detailSheets.push(sn);
                }
            }

            let coverReference = { branches: [], totalReg: 0, totalComp: 0, totalIncomp: 0 };
            for (const cs of coverSheets) {
                const parsedCover = parseCoverSheetBranchTotals(cs.rows);
                if (parsedCover.totalComp > 0 || parsedCover.totalIncomp > 0) {
                    coverReference = parsedCover;
                    break;
                }
            }

            const sheetsToProcess = detailSheets.length > 0 ? detailSheets : candidateSheets;

            let fileDefaultFaculty = normalizeFacultyName(file.name.replace(/\.[^.]+$/, ''), true);
            if (!/^(?:คณะ|วิทยาลัย|สำนักวิชา)/.test(fileDefaultFaculty)) fileDefaultFaculty = 'ไม่ระบุคณะ';

            const rawProcessedSummaries = [];

            for (const sheetName of sheetsToProcess) {
                const ws = wb.Sheets[sheetName];
                const rows = sheetToExpandedRows(ws);
                if (!rows || rows.length === 0) continue;

                const topHeaderText = rows.slice(0, 8)
                    .map(r => [...new Set((r || []).map(c => cleanText(c)).filter(Boolean))].join(' '))
                    .join(' ');

                let baseFaculty = 'ไม่ระบุคณะ';
                for (let r = rows.length - 1; r >= 0; r--) {
                    const line = [...new Set((rows[r] || []).map(c => cleanText(c)).filter(Boolean))].join(' ');
                    if (/สรุปพันธกิจ|สรุป\s*การเสนอประมาณการ|สรุปประมาณการ|สรุปรวมพันธกิจ/i.test(line)) {
                        const f = extractFacultyLabel(line);
                        if (f && f !== 'ไม่ระบุคณะ') { baseFaculty = f; break; }
                    }
                }
                if (baseFaculty === 'ไม่ระบุคณะ') {
                    for (let r = 0; r < Math.min(rows.length, 20); r++) {
                        const line = [...new Set((rows[r] || []).map(c => cleanText(c)).filter(Boolean))].join(' ');
                        const f = extractFacultyLabel(line);
                        if (f && f !== 'ไม่ระบุคณะ') { baseFaculty = f; break; }
                    }
                }
                if (baseFaculty === 'ไม่ระบุคณะ') {
                    const sFac = extractFacultyLabel(sheetName);
                    if (sFac && sFac !== 'ไม่ระบุคณะ') baseFaculty = sFac;
                }
                if (baseFaculty === 'ไม่ระบุคณะ' && fileDefaultFaculty !== 'ไม่ระบุคณะ') {
                    baseFaculty = fileDefaultFaculty;
                }

                let subLabel = '';
                const progMatch = topHeaderText.match(/(หลักสูตร[^\s(]+|สาขาวิชา[^\s(]+(?:\s+และ\s+[^\s(]+)?)/);
                if (progMatch) subLabel = cleanText(progMatch[1]);
                else if (/ป\.?ตรี/i.test(file.name)) subLabel = 'ระดับปริญญาตรี';
                else if (/ป\.?โท/i.test(file.name)) subLabel = 'ระดับปริญญาโท';
                else if (/ป\.?เอก/i.test(file.name)) subLabel = 'ระดับปริญญาเอก';
                else if (!/^(?:sheet\d+|final|พันธกิจ|สรุป|รวม)$/i.test(cleanText(sheetName))) subLabel = cleanText(sheetName);

                // ขั้นที่ A: สแกนรายชื่ออาจารย์ในตารางของชีตปัจจุบัน
                const regularPeopleMap = scanRegularPeopleFromSheet(rows, baseFaculty, subLabel, rosterByKey);
                let rowComp = 0;
                let rowIncomp = 0;
                let rowNoMis = 0;
                for (const pObj of regularPeopleMap.values()) {
                    const st = classifyPersonNoteStatus(pObj.notes.join(' '));
                    if (st === 'COMPLETE') rowComp++;
                    else if (st === 'INCOMPLETE') rowIncomp++;
                    else if (st === 'NO_MISSION') rowNoMis++;
                }

                // ขั้นที่ B: ค้นหาส่วนสรุปพันธกิจท้ายตาราง (ข้ามแถวที่มีรหัสวิชา 6-8 หลัก)
                const nonEmptyRows = [];
                for (let r = 0; r < rows.length; r++) {
                    const cells = [...new Set((rows[r] || []).map(c => cleanText(c)).filter(Boolean))];
                    if (cells.length > 0) {
                        nonEmptyRows.push(cells.join(' '));
                    }
                }

                const subBlockLines = [];
                let insideOtherLecturerBlock = false;
                const tailLines = nonEmptyRows.slice(Math.max(0, nonEmptyRows.length - 40));

                for (let i = 0; i < tailLines.length; i++) {
                    const line = tailLines[i];

                    // ข้ามแถวตารางรายวิชาที่มีรหัสวิชา 6-8 หลัก เพื่อไม่ให้นำรหัสวิชามานับเป็นจำนวนคน
                    if (/\b\d{6,8}\b/.test(normalizeThaiDigits(line))) {
                        continue;
                    }

                    if (subBlockLines.length > 0 && /(?:สรุป\s*(?:การเสนอ)?ประมาณการค่าสอน|2\.\s*ประมาณการค่าสอน|ค่าตอบแทนการสอน)/i.test(line)) {
                        break;
                    }

                    if (/อาจารย์ประจำ(?:แบบพิเศษ|พิเศษ|ร่วมสอน)|อาจารย์พิเศษ|ผู้ทรงคุณวุฒิ/i.test(line)) {
                        insideOtherLecturerBlock = true;
                        continue;
                    }
                    if (/(?:^|[\s\-–•.)])อาจารย์ประจำ(?!แบบพิเศษ|พิเศษ|ร่วมสอน)/i.test(line)) {
                        insideOtherLecturerBlock = false;
                    }
                    if (insideOtherLecturerBlock) continue;

                    if (/(?:อาจารย์ประจำ|สอน\s*ครบ|ครบพันธกิจ|ครบตามเกณฑ์|ผ่านเกณฑ์|สอน\s*ไม่ครบ|ไม่ครบพันธกิจ|ขาดพันธกิจ|ไม่ผ่านเกณฑ์|ไม่มีพันธกิจ|สรุปพันธกิจ|สรุปผลการปฏิบัติพันธกิจ)/i.test(line)) {
                        subBlockLines.push(line);
                        for (let k = 1; k <= 3 && (i + k) < tailLines.length; k++) {
                            const nextLine = tailLines[i + k];
                            if (/\b\d{6,8}\b/.test(normalizeThaiDigits(nextLine))) break;
                            if (/อาจารย์พิเศษ|ผู้ทรงคุณวุฒิ|สรุป\s*(?:การเสนอ)?ประมาณการค่าสอน|2\.\s*ประมาณการค่าสอน|ลงชื่อ|คณบดี|หัวหน้าสาขา/i.test(nextLine)) break;
                            if (!subBlockLines.includes(nextLine)) subBlockLines.push(nextLine);
                        }
                    }
                }

                let matchedLineText = '';
                let regularCount = 0;
                let completeCount = 0;
                let incompleteCount = 0;
                let noMissionCount = 0;
                let parsedIncompletePeople = [];

                if (subBlockLines.length > 0) {
                    matchedLineText = subBlockLines.join(' | ');
                    const parsed = parseMissionSubBlock(subBlockLines, baseFaculty);
                    regularCount = parsed.regularCount;
                    completeCount = parsed.completeCount;
                    incompleteCount = parsed.incompleteCount;
                    noMissionCount = parsed.noMissionCount;
                    parsedIncompletePeople = parsed.parsedIncompletePeople;
                }

                if (rowComp > completeCount) completeCount = rowComp;
                if (rowIncomp > incompleteCount) incompleteCount = rowIncomp;
                if (rowNoMis > noMissionCount) noMissionCount = rowNoMis;
                if (regularPeopleMap.size > regularCount) regularCount = regularPeopleMap.size;

                if (!matchedLineText && (completeCount > 0 || incompleteCount > 0 || noMissionCount > 0)) {
                    matchedLineText = `นับจากตารางรายชื่อ (${sheetName}): ครบ ${completeCount} คน, ไม่ครบ ${incompleteCount} คน`;
                }

                rawProcessedSummaries.push({
                    id: `${file.name}::${sheetName}`,
                    fileName: file.name,
                    sheetName,
                    faculty: baseFaculty,
                    baseFaculty,
                    subUnit: subLabel || sheetName,
                    regularCount: regularCount || (completeCount + incompleteCount + noMissionCount) || regularPeopleMap.size,
                    completeCount,
                    incompleteCount,
                    noMissionCount,
                    incompleteNames: parsedIncompletePeople.map(p => p.name),
                    rawLine: matchedLineText,
                    sourceFile: `${file.name} (${sheetName})`,
                    updatedAt: nowText,
                    regularPeopleMap,
                    parsedIncompletePeople
                });
            }

            // กรองชีตหน้าปกสรุปที่หลุดรอด (ชีตที่มี 0 รายชื่ออาจารย์ ขณะที่ชีตอื่นในไฟล์เดียวกันมีรายชื่ออาจารย์)
            const hasDetailSheetsWithPeople = rawProcessedSummaries.some(s => s.regularPeopleMap.size > 0);
            const fileProcessedSummaries = hasDetailSheetsWithPeople
                ? rawProcessedSummaries.filter(s => s.regularPeopleMap.size > 0)
                : rawProcessedSummaries;

            // เก็บข้อมูลอ้างอิงจากชีตหน้าปกที่ถูกกรองออก (ถ้ายังไม่มี coverReference)
            if (hasDetailSheetsWithPeople && coverReference.totalComp === 0 && coverReference.totalIncomp === 0) {
                for (const skipped of rawProcessedSummaries.filter(s => s.regularPeopleMap.size === 0)) {
                    if (skipped.completeCount > 0 || skipped.incompleteCount > 0) {
                        coverReference = {
                            branches: [],
                            totalReg: skipped.regularCount,
                            totalComp: skipped.completeCount,
                            totalIncomp: skipped.incompleteCount
                        };
                        break;
                    }
                }
            }

            // ขั้นที่ C: ตรวจสอบเทียบกับตารางหน้าปก (เช่น พันธกิจ1-69 ของคณะวิศวกรรมศาสตร์)
            if (coverReference.totalComp > 0 || coverReference.totalIncomp > 0) {
                const sumDetailComp = fileProcessedSummaries.reduce((s, x) => s + x.completeCount, 0);
                const sumDetailIncomp = fileProcessedSummaries.reduce((s, x) => s + x.incompleteCount, 0);

                if (sumDetailComp < coverReference.totalComp) {
                    let deficit = coverReference.totalComp - sumDetailComp;
                    for (const br of coverReference.branches) {
                        if (deficit <= 0) break;
                        const targetSummary = fileProcessedSummaries.find(s =>
                            s.sheetName.includes(br.branchName.replace(/^สาขาวิชา/, '')) ||
                            br.branchName.includes(s.sheetName)
                        ) || fileProcessedSummaries.find(s => s.completeCount < br.completeCount);

                        if (targetSummary && targetSummary.completeCount < br.completeCount) {
                            const add = Math.min(deficit, br.completeCount - targetSummary.completeCount);
                            targetSummary.completeCount += add;
                            deficit -= add;
                        }
                    }
                    if (deficit > 0 && fileProcessedSummaries.length > 0) {
                        fileProcessedSummaries[0].completeCount += deficit;
                    }
                }

                if (sumDetailIncomp < coverReference.totalIncomp) {
                    const deficitIncomp = coverReference.totalIncomp - sumDetailIncomp;
                    if (fileProcessedSummaries.length > 0) {
                        fileProcessedSummaries[fileProcessedSummaries.length - 1].incompleteCount += deficitIncomp;
                    }
                }
            }

            for (const item of fileProcessedSummaries) {
                const { regularPeopleMap, parsedIncompletePeople, ...summaryRecord } = item;

                if (summaryRecord.rawLine || summaryRecord.regularCount > 0 || summaryRecord.completeCount > 0 || summaryRecord.incompleteCount > 0) {
                    foundAnySummary = true;
                    regMissionFacultySummaries.push(summaryRecord);
                    fileLogDetails.push(`${summaryRecord.baseFaculty}${summaryRecord.subUnit ? ` (${summaryRecord.subUnit})` : ''}: ครบ ${summaryRecord.completeCount} คน, ไม่ครบ ${summaryRecord.incompleteCount} คน`);
                }

                const sourceKey = summaryRecord.sourceFile;
                const incompleteKeySet = new Set(parsedIncompletePeople.map(p => p.personKey));
                const recordedKeysInSheet = new Set();

                const pendingClassification = [];
                let classifiedCompleteCount = 0;

                for (const pObj of regularPeopleMap.values()) {
                    if (!isValidPersonName(pObj.name)) continue;
                    const fullNote = pObj.notes.join(' ');
                    let status = classifyPersonNoteStatus(fullNote);
                    let remark = '';

                    if (incompleteKeySet.has(pObj.personKey)) {
                        status = 'INCOMPLETE';
                    }

                    if (status === 'NO_MISSION') {
                        remark = `ไม่มีพันธกิจการสอน (${pObj.position || 'ผู้บริหาร/คณบดี'})`;
                    } else if (status === 'INCOMPLETE') {
                        remark = cleanText(pObj.notes.find(n => /ยกไป|ติดค้าง|ไม่ครบ|ขาด/.test(n)) || 'สอนไม่ครบพันธกิจ (-)');
                    } else if (status === 'COMPLETE') {
                        remark = cleanText(pObj.notes.find(n => /ยกไป|ครบ|เกิน/.test(n)) || 'สอนครบพันธกิจ (+)');
                        classifiedCompleteCount++;
                    }

                    if (status !== 'NOT_FOUND') {
                        recordedKeysInSheet.add(pObj.personKey);
                        regMissionRecords.push({
                            fileName: file.name,
                            sheetName: summaryRecord.sheetName,
                            personKey: pObj.personKey,
                            name: pObj.name,
                            faculty: summaryRecord.baseFaculty,
                            major: pObj.major || summaryRecord.subUnit || '',
                            position: pObj.position || '',
                            degree: pObj.degree || '',
                            status,
                            remark,
                            note: remark,
                            sourceFile: sourceKey
                        });
                    } else {
                        pendingClassification.push(pObj);
                    }
                }

                const remainingCompleteNeeded = Math.max(0, summaryRecord.completeCount - classifiedCompleteCount);
                if (remainingCompleteNeeded > 0 && pendingClassification.length > 0) {
                    const toMarkComplete = pendingClassification.slice(0, remainingCompleteNeeded);
                    for (const pObj of toMarkComplete) {
                        recordedKeysInSheet.add(pObj.personKey);
                        regMissionRecords.push({
                            fileName: file.name,
                            sheetName: summaryRecord.sheetName,
                            personKey: pObj.personKey,
                            name: pObj.name,
                            faculty: summaryRecord.baseFaculty,
                            major: pObj.major || summaryRecord.subUnit || '',
                            position: pObj.position || '',
                            degree: pObj.degree || '',
                            status: 'COMPLETE',
                            remark: 'สอนครบพันธกิจ (+)',
                            note: 'สอนครบพันธกิจ (+)',
                            sourceFile: sourceKey
                        });
                    }
                }

                parsedIncompletePeople.forEach(ip => {
                    if (!isValidPersonName(ip.name)) return;
                    if (!recordedKeysInSheet.has(ip.personKey)) {
                        recordedKeysInSheet.add(ip.personKey);
                        regMissionRecords.push({
                            fileName: file.name,
                            sheetName: summaryRecord.sheetName,
                            personKey: ip.personKey,
                            name: ip.name,
                            faculty: summaryRecord.baseFaculty,
                            major: ip.major || summaryRecord.subUnit || '',
                            position: ip.position || '',
                            degree: ip.degree || '',
                            status: 'INCOMPLETE',
                            remark: 'สอนไม่ครบพันธกิจ (-) (จากสรุปท้ายตาราง)',
                            note: 'สอนไม่ครบพันธกิจ (-) (จากสรุปท้ายตาราง)',
                            sourceFile: sourceKey
                        });
                    }
                });
            }

            regImportLogs = regImportLogs.filter(l => l.fileName !== file.name);
            regImportLogs.push({
                fileName: file.name,
                status: foundAnySummary ? 'SUCCESS' : 'WARNING',
                count: foundAnySummary ? 1 : 0,
                message: foundAnySummary
                    ? `อ่านข้อมูลสำเร็จ (${fileLogDetails.join(' | ')})`
                    : 'ไม่พบข้อความสรุปอาจารย์ประจำท้ายตาราง Excel',
                timestamp: nowText
            });
        } catch (err) {
            console.error('Error reading mission file:', file.name, err);
            regImportLogs = regImportLogs.filter(l => l.fileName !== file.name);
            regImportLogs.push({
                fileName: file.name,
                status: 'ERROR',
                count: 0,
                message: `อ่านไฟล์ผิดพลาด: ${err.message}`,
                timestamp: nowText
            });
        }
    }

    regLastSyncText = nowText;
    saveRegularStateToStorage();
    if (currentAppMode !== 'REGULAR') switchAppMode('REGULAR');
    else renderAllRegularViews();
    document.getElementById('reg-sheet-status-drawer')?.classList.remove('hidden');
}

// ----------------------------------------------------------------------------
// 8. ฟังก์ชันรวมยอดสอนครบ / สอนไม่ครบ แยกรายคณะ และยอดรวมทั้งหมด
// ----------------------------------------------------------------------------
function getAggregatedMissionSummary(selFac = 'ALL') {
    const byFacultyMap = new Map();
    let grandTotalRegular = 0;
    let grandTotalComplete = 0;
    let grandTotalIncomplete = 0;
    let grandTotalNoMission = 0;

    for (const item of regMissionFacultySummaries) {
        const fac = normalizeFacultyName(item.baseFaculty || item.faculty, true);
        if (selFac !== 'ALL' && fac !== selFac) continue;

        if (!byFacultyMap.has(fac)) {
            byFacultyMap.set(fac, {
                faculty: fac,
                regularCount: 0,
                completeCount: 0,
                incompleteCount: 0,
                noMissionCount: 0,
                subUnits: [],
                details: []
            });
        }
        const entry = byFacultyMap.get(fac);
        const regVal = Number(item.regularCount) || 0;
        const compVal = Number(item.completeCount) || 0;
        const incompVal = Number(item.incompleteCount) || 0;
        const noMisVal = Number(item.noMissionCount) || 0;

        entry.regularCount += regVal;
        entry.completeCount += compVal;
        entry.incompleteCount += incompVal;
        entry.noMissionCount += noMisVal;
        entry.subUnits.push({
            id: item.id,
            fileName: item.fileName,
            sheetName: item.sheetName,
            subUnit: item.subUnit || item.sheetName || '',
            regularCount: regVal,
            completeCount: compVal,
            incompleteCount: incompVal,
            noMissionCount: noMisVal
        });
        entry.details.push(`${item.subUnit || item.sheetName || 'หลัก'}: ครบ ${compVal} / ไม่ครบ ${incompVal}`);

        grandTotalRegular += regVal;
        grandTotalComplete += compVal;
        grandTotalIncomplete += incompVal;
        grandTotalNoMission += noMisVal;
    }

    const faculties = Array.from(byFacultyMap.values()).sort((a, b) => a.faculty.localeCompare(b.faculty, 'th'));

    return {
        faculties,
        grandTotalRegular,
        grandTotalComplete,
        grandTotalIncomplete,
        grandTotalNoMission,
        grandTotalEvaluated: grandTotalComplete + grandTotalIncomplete + grandTotalNoMission
    };
}

// ----------------------------------------------------------------------------
// 9. การคำนวณตัวเลขหลักและการรวมข้อมูลรายบุคคล
// ----------------------------------------------------------------------------
function getAuthoritativeTotalLecturersCount(selFac = 'ALL') {
    if (selFac === 'ALL') {
        if (regRosterList.length > 0) return regRosterList.length;
        if (regRosterFacultyAgg.length > 0) {
            return regRosterFacultyAgg.reduce((sum, a) => sum + (a.total || 0), 0);
        }
        if (regRosterTotalOverride !== null && regRosterTotalOverride > 0) return regRosterTotalOverride;
        return 0;
    }

    if (regRosterList.length > 0) {
        return regRosterList.filter(r => r.faculty === selFac).length;
    }
    if (regRosterFacultyAgg.length > 0) {
        const aggSum = regRosterFacultyAgg
            .filter(a => a.faculty === selFac)
            .reduce((sum, a) => sum + (a.total || 0), 0);
        if (aggSum > 0) return aggSum;
    }
    return 0;
}

function buildMergedRegularLecturers() {
    const personMap = new Map();

    regRosterList.forEach((r, idx) => {
        if (!r.personKey || NON_PERSON_KEYWORDS_RE.test(r.name)) return;
        const mapKey = r.recordKey || `${r.personKey}::${idx}`;
        personMap.set(mapKey, {
            personKey: r.personKey,
            name: r.name,
            faculty: r.faculty || 'ไม่ระบุคณะ',
            major: r.major || 'ไม่ระบุสาขา',
            degree: r.degree || 'ไม่ระบุคุณวุฒิ',
            position: r.position || '',
            inRoster: true,
            status: 'NOT_FOUND',
            remarks: [],
            sources: r.sourceFile ? [r.sourceFile] : []
        });
    });

    regMissionRecords.forEach(m => {
        if (!m.personKey || !isValidPersonName(m.name)) return;

        let matchedKey = null;
        for (const [k, v] of personMap.entries()) {
            const isExact = v.personKey === m.personKey;
            const isLongSubMatch = v.faculty === m.faculty &&
                v.personKey.length >= 8 && m.personKey.length >= 8 &&
                (v.personKey.includes(m.personKey) || m.personKey.includes(v.personKey));

            if (isExact || isLongSubMatch) {
                matchedKey = k;
                break;
            }
        }

        const remarkStr = m.remark || m.note || '';
        if (matchedKey) {
            const entry = personMap.get(matchedKey);
            if (entry.status !== 'INCOMPLETE') {
                entry.status = m.status;
            }
            if (m.major && (!entry.major || entry.major === 'ไม่ระบุสาขา')) entry.major = m.major;
            if (remarkStr && !entry.remarks.includes(remarkStr)) entry.remarks.push(remarkStr);
            if (m.sourceFile && !entry.sources.includes(m.sourceFile)) entry.sources.push(m.sourceFile);
        } else {
            const fallbackKey = `mission::${m.personKey}::${m.faculty}`;
            if (personMap.has(fallbackKey)) {
                const existing = personMap.get(fallbackKey);
                if (existing.status !== 'INCOMPLETE') existing.status = m.status;
                if (remarkStr && !existing.remarks.includes(remarkStr)) existing.remarks.push(remarkStr);
                if (m.sourceFile && !existing.sources.includes(m.sourceFile)) existing.sources.push(m.sourceFile);
            } else {
                personMap.set(fallbackKey, {
                    personKey: m.personKey,
                    name: m.name,
                    faculty: m.faculty || 'ไม่ระบุคณะ',
                    major: m.major || 'ไม่ระบุสาขา',
                    degree: m.degree || 'ไม่ระบุคุณวุฒิ',
                    position: m.position || '',
                    inRoster: false,
                    status: m.status,
                    remarks: remarkStr ? [remarkStr] : [],
                    sources: m.sourceFile ? [m.sourceFile] : []
                });
            }
        }
    });

    const mergedList = [];
    const seenPersonFac = new Set();
    personMap.forEach(item => {
        if (NON_PERSON_KEYWORDS_RE.test(item.name)) return;
        const dedupeKey = `${item.personKey}::${item.faculty}`;
        if (seenPersonFac.has(dedupeKey)) return;
        seenPersonFac.add(dedupeKey);
        item.remarkText = item.remarks.join(' | ');
        item.sourceText = item.sources.join(', ') || '-';
        mergedList.push(item);
    });

    return mergedList.sort((a, b) => a.name.localeCompare(b, 'th'));
}

function getAllKnownFaculties() {
    const missionSum = getAggregatedMissionSummary();
    return [...new Set([
        ...regRosterList.map(l => l.faculty),
        ...regRosterFacultyAgg.map(a => a.faculty),
        ...missionSum.faculties.map(f => f.faculty)
    ])].filter(f => f && f !== 'ไม่ระบุคณะ').sort((a, b) => a.localeCompare(b, 'th'));
}

function getStatusBadgeHtml(status) {
    const baseCls = 'inline-flex items-center justify-center gap-1.5 px-3 py-1 rounded-full text-[11.5px] font-bold whitespace-nowrap leading-none font-disp shrink-0';
    if (status === 'COMPLETE') {
        return `<span class="${baseCls} bg-[#E6F6F6] text-[#0F7678] border border-[#159A9C]/35"><i class="fa-solid fa-circle-check text-[#159A9C] text-[12px]"></i><span>สอนครบพันธกิจ (+)</span></span>`;
    }
    if (status === 'INCOMPLETE') {
        return `<span class="${baseCls} bg-red-50 text-red-700 border border-red-200"><i class="fa-solid fa-circle-xmark text-red-600 text-[12px]"></i><span>สอนไม่ครบพันธกิจ (-)</span></span>`;
    }
    if (status === 'NO_MISSION') {
        return `<span class="${baseCls} bg-amber-50 text-amber-700 border border-amber-200"><i class="fa-solid fa-minus-circle text-amber-500 text-[12px]"></i><span>ไม่มีพันธกิจการสอน</span></span>`;
    }
    return `<span class="${baseCls} bg-slate-100 text-slate-600 border border-slate-200"><i class="fa-solid fa-circle-question text-slate-400 text-[12px]"></i><span>ยังไม่ระบุสถานะ</span></span>`;
}

function destroyChartSafe(key) {
    if (regCharts[key]) {
        try { regCharts[key].destroy(); } catch (e) {}
        delete regCharts[key];
    }
}

// ----------------------------------------------------------------------------
// 10. เมนูที่ 1: ภาพรวม (Overview)
// ----------------------------------------------------------------------------
function renderOverviewTab() {
    const selFac = document.getElementById('reg-faculty-filter')?.value || 'ALL';
    const selStatusFilter = document.getElementById('reg-status-filter')?.value || 'ALL';

    const allMissionSum = getAggregatedMissionSummary();
    const missionSum = getAggregatedMissionSummary(selFac);

    const rosterCount = getAuthoritativeTotalLecturersCount(selFac);
    const authoritativeTotal = rosterCount > 0
        ? rosterCount
        : (missionSum.grandTotalRegular > 0
            ? missionSum.grandTotalRegular
            : (missionSum.grandTotalComplete + missionSum.grandTotalIncomplete + missionSum.grandTotalNoMission));

    const pendingCount = Math.max(0, authoritativeTotal - missionSum.grandTotalComplete - missionSum.grandTotalIncomplete);

    const allRosterCount = getAuthoritativeTotalLecturersCount('ALL');
    const displayAllRosterCount = allRosterCount > 0 ? allRosterCount : allMissionSum.grandTotalRegular;

    const rosterBadge = document.getElementById('reg-roster-status-badge');
    const rosterCountText = document.getElementById('reg-roster-count-text');
    const rosterUpdatedText = document.getElementById('reg-roster-updated-text');

    if (rosterCountText) rosterCountText.textContent = `${displayAllRosterCount.toLocaleString()} คน`;
    if (rosterUpdatedText) rosterUpdatedText.textContent = regLastSyncText;
    if (rosterBadge) {
        rosterBadge.textContent = allRosterCount > 0 ? 'นำเข้าแล้ว' : (allMissionSum.grandTotalEvaluated > 0 ? 'อ้างอิงไฟล์พันธกิจ' : 'รอการนำเข้า');
        rosterBadge.className = (allRosterCount > 0 || allMissionSum.grandTotalEvaluated > 0)
            ? 'px-2.5 py-1 rounded-full text-[11px] font-bold bg-[#E6F6F6] text-[#0F7678] font-disp whitespace-nowrap'
            : 'px-2.5 py-1 rounded-full text-[11px] font-bold bg-slate-100 text-slate-700 font-disp whitespace-nowrap';
    }

    const successLogs = regImportLogs.filter(l => l.status === 'SUCCESS').length;
    const errorLogs = regImportLogs.filter(l => l.status !== 'SUCCESS').length;
    const setTxt = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

    setTxt('reg-mission-success-badge', `สำเร็จ: ${successLogs} ไฟล์/คณะ`);
    setTxt('reg-mission-error-badge', `ผิดพลาด: ${errorLogs}`);
    setTxt('reg-mission-updated-text', regLastSyncText);
    setTxt('reg-status-lecturers', `${displayAllRosterCount.toLocaleString()} คน`);
    setTxt('reg-status-missions', `${allMissionSum.grandTotalEvaluated.toLocaleString()} คน`);

    const statusLabel = document.getElementById('reg-upload-status-label');
    if (statusLabel) {
        statusLabel.textContent = (allRosterCount > 0 || allMissionSum.grandTotalEvaluated > 0)
            ? `พร้อมใช้งาน (อาจารย์ทั้งหมด ${displayAllRosterCount.toLocaleString()} คน | ครบพันธกิจ ${allMissionSum.grandTotalComplete.toLocaleString()} คน | ไม่ครบ ${allMissionSum.grandTotalIncomplete.toLocaleString()} คน)`
            : 'รอการนำเข้าข้อมูล';
    }

    const drawerBody = document.getElementById('reg-sheet-status-drawer-body');
    if (drawerBody) {
        if (regImportLogs.length === 0) {
            drawerBody.innerHTML = `<div class="text-slate-400 col-span-full">ยังไม่มีรายการตรวจสอบ</div>`;
        } else {
            drawerBody.innerHTML = regImportLogs.map(log => `
                <div class="p-2.5 rounded-xl border ${log.status === 'SUCCESS' ? 'border-[#159A9C]/30 bg-[#E6F6F6]/40' : 'border-amber-300 bg-amber-50'}">
                    <div class="font-bold text-ink truncate">${escapeHtml(log.fileName)}</div>
                    <div class="text-[11px] text-slate-600 mt-0.5">${escapeHtml(log.message)} (${escapeHtml(log.timestamp)})</div>
                </div>
            `).join('');
        }
    }

    const faculties = getAllKnownFaculties();
    const facSelect = document.getElementById('reg-faculty-filter');
    if (facSelect) {
        const prev = facSelect.value;
        facSelect.innerHTML = `<option value="ALL">ทุกคณะ (ทั้งหมด)</option>` +
            faculties.map(f => `<option value="${escapeHtml(f)}">${escapeHtml(f)}</option>`).join('');
        if (faculties.includes(prev)) facSelect.value = prev;
    }

    const calcPct = (val) => authoritativeTotal > 0 ? ((val / authoritativeTotal) * 100).toFixed(1) : '0.0';
    setTxt('reg-kpi-total-lecturers', authoritativeTotal.toLocaleString());
    setTxt('reg-kpi-complete-lecturers', missionSum.grandTotalComplete.toLocaleString());
    setTxt('reg-kpi-incomplete-lecturers', missionSum.grandTotalIncomplete.toLocaleString());
    setTxt('reg-kpi-pending-lecturers', pendingCount.toLocaleString());
    setTxt('reg-kpi-pending-pct', `คิดเป็น ${calcPct(pendingCount)}% ของทั้งหมด`);

    const mergedLecturers = buildMergedRegularLecturers().filter(l => selFac === 'ALL' || l.faculty === selFac);
    const completeList = mergedLecturers.filter(l => l.status === 'COMPLETE');
    const incompleteList = mergedLecturers.filter(l => l.status === 'INCOMPLETE');

    const compPctEl = document.getElementById('reg-kpi-complete-pct');
    if (compPctEl) {
        const previewNames = completeList.slice(0, 2).map(p => p.name).join(', ');
        const extraCompleteCount = Math.max(0, completeList.length - 2);
        compPctEl.innerHTML = `
            <span class="block">คิดเป็น ${calcPct(missionSum.grandTotalComplete)}% ของทั้งหมด</span>
            ${previewNames ? `<span class="block text-[10px] text-slate-500 truncate mt-0.5" title="${escapeHtml(previewNames)}">รายชื่อ: ${escapeHtml(previewNames)}${extraCompleteCount > 0 ? ` (+${extraCompleteCount})` : ''}</span>` : ''}
            <span class="inline-flex items-center mt-1 text-[11px] font-bold text-[#0F7678] underline"><i class="fa-solid fa-table-list mr-1"></i>คลิกดูรายชื่อสอนครบ (${missionSum.grandTotalComplete.toLocaleString()} คน)</span>
        `;
    }

    const incompPctEl = document.getElementById('reg-kpi-incomplete-pct');
    if (incompPctEl) {
        const previewNames = incompleteList.slice(0, 2).map(p => p.name).join(', ');
        const extraIncompleteCount = Math.max(0, incompleteList.length - 2);
        incompPctEl.innerHTML = `
            <span class="block">คิดเป็น ${calcPct(missionSum.grandTotalIncomplete)}% ของทั้งหมด</span>
            ${previewNames ? `<span class="block text-[10px] text-slate-500 truncate mt-0.5" title="${escapeHtml(previewNames)}">รายชื่อ: ${escapeHtml(previewNames)}${extraIncompleteCount > 0 ? ` (+${extraIncompleteCount})` : ''}</span>` : ''}
            <span class="inline-flex items-center mt-1 text-[11px] font-bold text-red-700 underline"><i class="fa-solid fa-table-list mr-1"></i>คลิกดูรายชื่อสอนไม่ครบ (${missionSum.grandTotalIncomplete.toLocaleString()} คน)</span>
        `;
    }

    renderOverviewCharts(missionSum.grandTotalComplete, missionSum.grandTotalIncomplete, pendingCount, faculties);

    const tbody = document.getElementById('reg-mission-table-body');
    const badge = document.getElementById('reg-mission-table-badge');
    const globalQuery = cleanText(document.getElementById('reg-global-search-input')?.value).toLowerCase();

    const missionFacMap = new Map(allMissionSum.faculties.map(f => [f.faculty, f]));
    const tableRowsData = faculties.map(fac => {
        const mItem = missionFacMap.get(fac) || {
            faculty: fac,
            regularCount: 0,
            completeCount: 0,
            incompleteCount: 0,
            noMissionCount: 0,
            details: []
        };
        const rTot = getAuthoritativeTotalLecturersCount(fac);
        const tot = rTot > 0
            ? rTot
            : (mItem.regularCount > 0 ? mItem.regularCount : (mItem.completeCount + mItem.incompleteCount + mItem.noMissionCount));
        const pend = Math.max(0, tot - mItem.completeCount - mItem.incompleteCount);
        return {
            faculty: fac,
            total: tot,
            completeCount: mItem.completeCount,
            incompleteCount: mItem.incompleteCount,
            pendingCount: pend,
            details: mItem.details
        };
    }).filter(row => {
        if (selFac !== 'ALL' && row.faculty !== selFac) return false;
        if (selStatusFilter === 'COMPLETE' && row.completeCount === 0) return false;
        if (selStatusFilter === 'INCOMPLETE' && row.incompleteCount === 0) return false;
        if (selStatusFilter === 'PENDING' && row.pendingCount === 0) return false;
        if (globalQuery && !row.faculty.toLowerCase().includes(globalQuery)) return false;
        return true;
    });

    if (badge) badge.textContent = `${tableRowsData.length.toLocaleString()} คณะ`;

    if (tbody) {
        if (tableRowsData.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="7" class="text-center py-10 text-slate-400">
                        <i class="fa-solid fa-folder-open text-3xl mb-2 text-slate-300 block"></i>
                        <p>ยังไม่มีข้อมูลอาจารย์ประจำ กรุณานำเข้าข้อมูลในส่วนด้านบน</p>
                    </td>
                </tr>`;
        } else {
            tbody.innerHTML = tableRowsData.map((row, idx) => {
                const rate = row.total > 0 ? ((row.completeCount / row.total) * 100).toFixed(1) : '0.0';
                const barWidth = Math.min(100, parseFloat(rate));
                const detailHint = row.details.length > 1 ? ` title="${escapeHtml(row.details.join(' | '))}"` : '';

                return `
                    <tr class="hover:bg-slate-50 transition"${detailHint}>
                        <td class="py-3 px-4 text-center font-semibold text-slate-500">${idx + 1}</td>
                        <td class="py-3 px-4 font-bold text-ink">
                            ${escapeHtml(row.faculty)}
                            ${row.details.length > 1 ? `<span class="block text-[10px] font-normal text-slate-400">${escapeHtml(row.details.join(' • '))}</span>` : ''}
                        </td>
                        <td class="py-3 px-4 text-center font-bold text-navy">${row.total.toLocaleString()}</td>
                        <td onclick="openKpiDetailModal('COMPLETE', '${escapeHtml(row.faculty)}')" class="py-3 px-4 text-center font-bold text-[#0F7678] cursor-pointer hover:underline" title="คลิกดูรายชื่อสอนครบของ${escapeHtml(row.faculty)}">${row.completeCount.toLocaleString()}</td>
                        <td onclick="openKpiDetailModal('INCOMPLETE', '${escapeHtml(row.faculty)}')" class="py-3 px-4 text-center font-bold text-red-600 cursor-pointer hover:underline" title="คลิกดูรายชื่อสอนไม่ครบของ${escapeHtml(row.faculty)}">${row.incompleteCount.toLocaleString()}</td>
                        <td class="py-3 px-4 text-center font-semibold text-slate-500">${row.pendingCount.toLocaleString()}</td>
                        <td class="py-3 px-4">
                            <div class="flex items-center gap-2">
                                <div class="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden">
                                    <div class="bg-[#159A9C] h-2 rounded-full" style="width:${barWidth}%"></div>
                                </div>
                                <span class="font-bold text-xs text-ink w-12 text-right font-disp">${rate}%</span>
                            </div>
                        </td>
                    </tr>`;
            }).join('');
        }
    }
}

function renderOverviewCharts(complete, incomplete, pending, faculties) {
    if (typeof Chart === 'undefined') return;

    const donutEl = document.getElementById('ov-chart-mission-donut');
    if (donutEl) {
        destroyChartSafe('ovDonut');
        regCharts.ovDonut = new Chart(donutEl, {
            type: 'doughnut',
            data: {
                labels: ['สอนครบพันธกิจ (+)', 'สอนไม่ครบพันธกิจ (-)', 'รอประเมิน / ผู้บริหาร'],
                datasets: [{
                    data: [complete, incomplete, pending],
                    backgroundColor: ['#159A9C', '#DC2626', '#94A3B8'],
                    borderWidth: 2,
                    borderColor: '#FFFFFF'
                }]
            },
            options: {
                animation: false,
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { position: 'bottom', labels: { font: { family: 'IBM Plex Sans Thai', size: 12 } } } }
            }
        });
    }

    const rateEl = document.getElementById('ov-chart-faculty-rate');
    if (rateEl) {
        destroyChartSafe('ovRate');
        const rows = faculties.map(f => {
            const m = getAggregatedMissionSummary(f);
            const rTot = getAuthoritativeTotalLecturersCount(f);
            const t = rTot > 0 ? rTot : (m.grandTotalRegular > 0 ? m.grandTotalRegular : m.grandTotalEvaluated);
            return { faculty: f.replace(/^คณะ/, ''), rate: t > 0 ? Number(((m.grandTotalComplete / t) * 100).toFixed(1)) : 0 };
        }).sort((a, b) => b.rate - a.rate);

        regCharts.ovRate = new Chart(rateEl, {
            type: 'bar',
            data: {
                labels: rows.map(r => r.faculty),
                datasets: [{
                    label: 'อัตราการสอนครบพันธกิจ (%)',
                    data: rows.map(r => r.rate),
                    backgroundColor: '#234876',
                    borderRadius: 6
                }]
            },
            options: {
                animation: false,
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                scales: { x: { beginAtZero: true, max: 100 } },
                plugins: { legend: { display: false } }
            }
        });
    }
}

// ----------------------------------------------------------------------------
// 11. เมนูที่ 2: วิเคราะห์รายคณะ (Faculty Analysis) + Drill-down
// ----------------------------------------------------------------------------
function renderFacultyAnalysisTab() {
    const allLecturers = buildMergedRegularLecturers();
    const faculties = getAllKnownFaculties();

    const facSel = document.getElementById('fa-filter-faculty');
    const majSel = document.getElementById('fa-filter-major');
    const majorChartFacSel = document.getElementById('fa-major-chart-faculty-select');

    if (facSel) {
        const prev = facSel.value;
        facSel.innerHTML = `<option value="ALL">ทุกคณะ (ทั้งหมด)</option>` +
            faculties.map(f => `<option value="${escapeHtml(f)}">${escapeHtml(f)}</option>`).join('');
        if (faculties.includes(prev)) facSel.value = prev;
    }
    if (majorChartFacSel) {
        const prev = majorChartFacSel.value;
        majorChartFacSel.innerHTML = `<option value="ALL">แสดงทุกคณะ</option>` +
            faculties.map(f => `<option value="${escapeHtml(f)}">${escapeHtml(f)}</option>`).join('');
        if (faculties.includes(prev)) majorChartFacSel.value = prev;
    }

    const selFac = facSel?.value || 'ALL';
    const majors = [...new Set(allLecturers
        .filter(l => selFac === 'ALL' || l.faculty === selFac)
        .map(l => l.major)
        .filter(Boolean))].sort((a, b) => a.localeCompare(b, 'th'));

    if (majSel) {
        const prev = majSel.value;
        majSel.innerHTML = `<option value="ALL">ทุกสาขาวิชา</option>` +
            majors.map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('');
        if (majors.includes(prev)) majSel.value = prev;
    }

    const selMaj = majSel?.value || 'ALL';
    const selStatus = document.getElementById('fa-filter-status')?.value || 'ALL';
    const selDeg = document.getElementById('fa-filter-degree')?.value || 'ALL';

    const filtered = allLecturers.filter(l => {
        if (selFac !== 'ALL' && l.faculty !== selFac) return false;
        if (selMaj !== 'ALL' && l.major !== selMaj) return false;
        if (selDeg !== 'ALL' && l.degree !== selDeg) return false;
        if (selStatus !== 'ALL') {
            if (selStatus === 'PENDING') {
                if (l.status === 'COMPLETE' || l.status === 'INCOMPLETE') return false;
            } else if (l.status !== selStatus) return false;
        }
        return true;
    });

    const missionSum = getAggregatedMissionSummary(selFac);
    const rTot = getAuthoritativeTotalLecturersCount(selFac);
    const totalCount = (selMaj === 'ALL' && selStatus === 'ALL' && selDeg === 'ALL')
        ? (rTot > 0 ? rTot : (missionSum.grandTotalRegular > 0 ? missionSum.grandTotalRegular : filtered.length))
        : filtered.length;

    const mTotals = (selMaj === 'ALL' && selStatus === 'ALL' && selDeg === 'ALL')
        ? { complete: missionSum.grandTotalComplete, incomplete: missionSum.grandTotalIncomplete }
        : {
            complete: filtered.filter(l => l.status === 'COMPLETE').length,
            incomplete: filtered.filter(l => l.status === 'INCOMPLETE').length
        };
    const pendingCount = Math.max(0, totalCount - mTotals.complete - mTotals.incomplete);

    const setTxt = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    setTxt('fa-kpi-total', totalCount.toLocaleString());
    setTxt('fa-kpi-complete', mTotals.complete.toLocaleString());
    setTxt('fa-kpi-incomplete', mTotals.incomplete.toLocaleString());
    setTxt('fa-kpi-pending', pendingCount.toLocaleString());

    renderFacultyDeepDiveCharts(faculties, allLecturers);

    const tbody = document.getElementById('fa-comparison-table-body');
    const tfoot = document.getElementById('fa-comparison-table-foot');
    if (tbody) {
        if (faculties.length === 0) {
            tbody.innerHTML = `<tr><td colspan="9" class="text-center py-8 text-slate-400">ยังไม่มีข้อมูลรายคณะ</td></tr>`;
            if (tfoot) tfoot.innerHTML = '';
        } else {
            let sumTot = 0, sumComp = 0, sumIncomp = 0, sumBach = 0, sumMast = 0, sumDoc = 0;
            tbody.innerHTML = faculties.map((fac, i) => {
                const facPeople = allLecturers.filter(l => l.faculty === fac);
                const m = getAggregatedMissionSummary(fac);
                const facRosterTot = getAuthoritativeTotalLecturersCount(fac);
                const tot = facRosterTot > 0 ? facRosterTot : (m.grandTotalRegular > 0 ? m.grandTotalRegular : m.grandTotalEvaluated);
                const pend = Math.max(0, tot - m.grandTotalComplete - m.grandTotalIncomplete);
                const bach = facPeople.filter(l => l.degree === 'ปริญญาตรี').length;
                const mast = facPeople.filter(l => l.degree === 'ปริญญาโท').length;
                const doc = facPeople.filter(l => l.degree === 'ปริญญาเอก').length;

                sumTot += tot;
                sumComp += m.grandTotalComplete;
                sumIncomp += m.grandTotalIncomplete;
                sumBach += bach; sumMast += mast; sumDoc += doc;

                return `
                    <tr class="hover:bg-slate-50 transition">
                        <td class="py-2.5 px-3 text-center text-slate-500 font-semibold">${i + 1}</td>
                        <td class="py-2.5 px-4 font-bold text-ink">${escapeHtml(fac)}</td>
                        <td onclick="window.filterFacultyDetailSection({ faculty: '${escapeHtml(fac)}', status: 'ALL', label: '${escapeHtml(fac)} (ทั้งหมด)' })" class="py-2.5 px-3 text-center font-bold text-navy cursor-pointer hover:underline">${tot}</td>
                        <td onclick="window.filterFacultyDetailSection({ faculty: '${escapeHtml(fac)}', status: 'COMPLETE', label: '${escapeHtml(fac)} - ครบพันธกิจ (+)' })" class="py-2.5 px-3 text-center font-bold text-[#0F7678] cursor-pointer hover:underline">${m.grandTotalComplete}</td>
                        <td onclick="window.filterFacultyDetailSection({ faculty: '${escapeHtml(fac)}', status: 'INCOMPLETE', label: '${escapeHtml(fac)} - ไม่ครบพันธกิจ (-)' })" class="py-2.5 px-3 text-center font-bold text-red-600 cursor-pointer hover:underline">${m.grandTotalIncomplete}</td>
                        <td onclick="window.filterFacultyDetailSection({ faculty: '${escapeHtml(fac)}', status: 'PENDING', label: '${escapeHtml(fac)} - ไม่ระบุสถานะ' })" class="py-2.5 px-3 text-center text-slate-600 cursor-pointer hover:underline">${pend}</td>
                        <td class="py-2.5 px-3 text-center">${bach}</td>
                        <td class="py-2.5 px-3 text-center">${mast}</td>
                        <td class="py-2.5 px-3 text-center">${doc}</td>
                    </tr>`;
            }).join('');

            if (tfoot) {
                const rosterAll = getAuthoritativeTotalLecturersCount('ALL');
                const lockedAll = rosterAll > 0 ? rosterAll : sumTot;
                tfoot.innerHTML = `
                    <tr>
                        <td colspan="2" class="py-3 px-4 text-right">รวมทั้งหมด (${lockedAll} คน)</td>
                        <td class="py-3 px-3 text-center text-navy">${lockedAll}</td>
                        <td class="py-3 px-3 text-center text-[#0F7678]">${sumComp}</td>
                        <td class="py-3 px-3 text-center text-red-600">${sumIncomp}</td>
                        <td class="py-3 px-3 text-center">${Math.max(0, lockedAll - sumComp - sumIncomp)}</td>
                        <td class="py-3 px-3 text-center">${sumBach}</td>
                        <td class="py-3 px-3 text-center">${sumMast}</td>
                        <td class="py-3 px-3 text-center">${sumDoc}</td>
                    </tr>`;
            }
        }
    }
}

function renderFacultyDeepDiveCharts(faculties, allLecturers) {
    if (typeof Chart === 'undefined') return;
    const shortLabels = faculties.map(f => f.replace(/^คณะ/, ''));

    const c1 = document.getElementById('fa-chart-faculty-comparison');
    if (c1) {
        destroyChartSafe('faComp');
        regCharts.faComp = new Chart(c1, {
            type: 'bar',
            data: {
                labels: shortLabels,
                datasets: [{
                    label: 'จำนวนอาจารย์ประจำ (คน)',
                    data: faculties.map(f => {
                        const rTot = getAuthoritativeTotalLecturersCount(f);
                        if (rTot > 0) return rTot;
                        const m = getAggregatedMissionSummary(f);
                        return m.grandTotalRegular > 0 ? m.grandTotalRegular : m.grandTotalEvaluated;
                    }),
                    backgroundColor: '#234876',
                    borderRadius: 6
                }]
            },
            options: { animation: false, responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
        });
    }

    const c2 = document.getElementById('fa-chart-mission-stacked');
    if (c2) {
        destroyChartSafe('faMission');
        regCharts.faMission = new Chart(c2, {
            type: 'bar',
            data: {
                labels: shortLabels,
                datasets: [
                    { label: 'ครบพันธกิจ (+)', data: faculties.map(f => getAggregatedMissionSummary(f).grandTotalComplete), backgroundColor: '#159A9C' },
                    { label: 'ไม่ครบพันธกิจ (-)', data: faculties.map(f => getAggregatedMissionSummary(f).grandTotalIncomplete), backgroundColor: '#DC2626' }
                ]
            },
            options: {
                animation: false,
                responsive: true,
                maintainAspectRatio: false,
                scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } }
            }
        });
    }

    const c3 = document.getElementById('fa-chart-qualification-donut');
    if (c3) {
        destroyChartSafe('faQual');
        const degs = ['ปริญญาเอก', 'ปริญญาโท', 'ปริญญาตรี', 'ไม่ระบุคุณวุฒิ'];
        regCharts.faQual = new Chart(c3, {
            type: 'doughnut',
            data: {
                labels: degs,
                datasets: [{
                    data: degs.map(d => allLecturers.filter(l => l.degree === d).length),
                    backgroundColor: ['#234876', '#159A9C', '#CF8A22', '#94A3B8']
                }]
            },
            options: { animation: false, responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
        });
    }

    const c4 = document.getElementById('fa-chart-major-horizontal');
    if (c4) {
        destroyChartSafe('faMajor');
        const majFac = document.getElementById('fa-major-chart-faculty-select')?.value || 'ALL';
        const majorCounts = new Map();
        allLecturers.filter(l => majFac === 'ALL' || l.faculty === majFac).forEach(l => {
            const m = l.major || 'ไม่ระบุสาขา';
            majorCounts.set(m, (majorCounts.get(m) || 0) + 1);
        });
        const top15 = Array.from(majorCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 15);
        regCharts.faMajor = new Chart(c4, {
            type: 'bar',
            data: {
                labels: top15.map(x => x[0]),
                datasets: [{ label: 'จำนวนอาจารย์ (คน)', data: top15.map(x => x[1]), backgroundColor: '#159A9C', borderRadius: 5 }]
            },
            options: { animation: false, indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
        });
    }
}

window.filterFacultyDetailSection = function(opts = {}) {
    faDrilldownFilter = {
        faculty: opts.faculty || document.getElementById('fa-filter-faculty')?.value || 'ALL',
        major: opts.major || document.getElementById('fa-filter-major')?.value || 'ALL',
        status: opts.status || 'ALL',
        degree: opts.degree || document.getElementById('fa-filter-degree')?.value || 'ALL',
        label: opts.label || 'รายชื่ออาจารย์ประจำ'
    };

    const section = document.getElementById('fa-detail-section');
    const heading = document.getElementById('fa-detail-heading');
    if (section) section.classList.remove('hidden');
    if (heading) heading.textContent = faDrilldownFilter.label;

    renderFacultyDrilldownTable();
    section?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
};

function renderFacultyDrilldownTable() {
    const tbody = document.getElementById('fa-detail-table-body');
    const badge = document.getElementById('fa-detail-count-badge');
    if (!tbody) return;

    const q = cleanText(document.getElementById('fa-detail-search-input')?.value).toLowerCase();
    const list = buildMergedRegularLecturers().filter(l => {
        if (faDrilldownFilter.faculty !== 'ALL' && l.faculty !== faDrilldownFilter.faculty) return false;
        if (faDrilldownFilter.major !== 'ALL' && l.major !== faDrilldownFilter.major) return false;
        if (faDrilldownFilter.degree !== 'ALL' && l.degree !== faDrilldownFilter.degree) return false;
        if (faDrilldownFilter.status !== 'ALL') {
            if (faDrilldownFilter.status === 'PENDING') {
                if (l.status === 'COMPLETE' || l.status === 'INCOMPLETE') return false;
            } else if (l.status !== faDrilldownFilter.status) return false;
        }
        if (q && !`${l.name} ${l.faculty} ${l.major} ${l.remarkText}`.toLowerCase().includes(q)) return false;
        return true;
    });

    if (badge) badge.textContent = `${list.length.toLocaleString()} คน`;
    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center py-8 text-slate-400">ไม่พบรายชื่อในกลุ่มที่เลือก</td></tr>`;
        return;
    }

    tbody.innerHTML = list.map((item, idx) => `
        <tr class="hover:bg-slate-50">
            <td class="py-2.5 px-3 text-center text-slate-500">${idx + 1}</td>
            <td class="py-2.5 px-4 font-bold text-ink">${escapeHtml(item.name)}</td>
            <td class="py-2.5 px-4">${escapeHtml(item.faculty)}</td>
            <td class="py-2.5 px-4">${escapeHtml(item.major)}</td>
            <td class="py-2.5 px-4">${escapeHtml(item.degree)}</td>
            <td class="py-2.5 px-4 text-center whitespace-nowrap">${getStatusBadgeHtml(item.status)}</td>
            <td class="py-2.5 px-4 text-slate-600 leading-relaxed">${escapeHtml(item.remarkText || '-')}</td>
        </tr>
    `).join('');
}

// ----------------------------------------------------------------------------
// 12. เมนูที่ 3: ค้นหารายบุคคล (Lecturer Search)
// ----------------------------------------------------------------------------
function renderLecturerSearchTab() {
    const tbody = document.getElementById('reg-person-search-tbody');
    const countBadge = document.getElementById('reg-search-tab-count');
    if (!tbody) return;

    const faculties = getAllKnownFaculties();
    const facSel = document.getElementById('reg-person-faculty-filter');
    if (facSel) {
        const prev = facSel.value;
        facSel.innerHTML = `<option value="ALL">ทุกคณะ</option>` +
            faculties.map(f => `<option value="${escapeHtml(f)}">${escapeHtml(f)}</option>`).join('');
        if (faculties.includes(prev)) facSel.value = prev;
    }

    const q = cleanText(document.getElementById('reg-person-search-input')?.value).toLowerCase();
    const selFac = facSel?.value || 'ALL';
    const selDeg = document.getElementById('reg-person-degree-filter')?.value || 'ALL';
    const selStatus = document.getElementById('reg-person-status-filter')?.value || 'ALL';

    const list = buildMergedRegularLecturers().filter(l => {
        if (selFac !== 'ALL' && l.faculty !== selFac) return false;
        if (selDeg !== 'ALL' && l.degree !== selDeg) return false;
        if (selStatus !== 'ALL') {
            if (selStatus === 'PENDING') {
                if (l.status === 'COMPLETE' || l.status === 'INCOMPLETE' || l.status === 'NO_MISSION') return false;
            } else if (l.status !== selStatus) return false;
        }
        if (q && !`${l.name} ${l.faculty} ${l.major} ${l.remarkText}`.toLowerCase().includes(q)) return false;
        return true;
    });

    if (countBadge) countBadge.textContent = `พบ ${list.length.toLocaleString()} คน`;

    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center py-10 text-slate-400">ไม่พบรายชื่ออาจารย์ประจำตามเงื่อนไขที่ค้นหา</td></tr>`;
        return;
    }

    tbody.innerHTML = list.map((item, idx) => `
        <tr class="hover:bg-slate-50 transition">
            <td class="py-2.5 px-3 text-center text-slate-500 font-semibold">${idx + 1}</td>
            <td class="py-2.5 px-4 font-bold text-ink">${escapeHtml(item.name)}</td>
            <td class="py-2.5 px-4 text-ink-soft">${escapeHtml(item.faculty)}</td>
            <td class="py-2.5 px-4 text-ink-soft">${escapeHtml(item.major)}</td>
            <td class="py-2.5 px-4">${escapeHtml(item.degree)}</td>
            <td class="py-2.5 px-4 text-center whitespace-nowrap">${getStatusBadgeHtml(item.status)}</td>
            <td class="py-2.5 px-4 text-center whitespace-nowrap">
                <button type="button" onclick="openLecturerProfileModal('${escapeHtml(item.personKey)}')" class="px-2.5 py-1 rounded-lg bg-navy/10 hover:bg-navy text-navy hover:text-white text-[11px] font-bold font-disp transition">
                    <i class="fa-solid fa-id-card mr-1"></i>ดูโปรไฟล์ & ตารางสอน
                </button>
            </td>
        </tr>
    `).join('');
}


// ----------------------------------------------------------------------------
// 13. เมนูที่ 4: ตารางสอนอาจารย์ (รองรับตารางกริด FM ตส.-03 ป.โท, ป.ตรี และ PDF)
// ----------------------------------------------------------------------------
const TS_STORAGE_KEY = 'aa_ts_schedule_v2';

const TS_DAY_MAP = {
    M: { order: 1, label: 'จันทร์ (M)' },
    T: { order: 2, label: 'อังคาร (T)' },
    W: { order: 3, label: 'พุธ (W)' },
    H: { order: 4, label: 'พฤหัสบดี (H)' },
    F: { order: 5, label: 'ศุกร์ (F)' },
    S: { order: 6, label: 'เสาร์ (S)' },
    U: { order: 7, label: 'อาทิตย์ (U)' }
};

function normalizeScheduleDay(cellText) {
    const s = cleanText(cellText);
    if (!s) return null;
    if (/^(?:จันทร์|จ\.?)(?:\s*M)?$/i.test(s) || /^M$/i.test(s)) return TS_DAY_MAP.M;
    if (/^(?:อังคาร|อ\.?)(?:\s*T)?$/i.test(s) || /^T$/i.test(s)) return TS_DAY_MAP.T;
    if (/^(?:พุธ|พ\.?)(?:\s*W)?$/i.test(s) || /^W$/i.test(s)) return TS_DAY_MAP.W;
    if (/^(?:พฤหัสบดี|พฤ\.?)(?:\s*H)?$/i.test(s) || /^H$/i.test(s)) return TS_DAY_MAP.H;
    if (/^(?:ศุกร์|ศ\.?)(?:\s*F)?$/i.test(s) || /^F$/i.test(s)) return TS_DAY_MAP.F;
    if (/^(?:เสาร์|ส\.?)(?:\s*S)?$/i.test(s) || /^S$/i.test(s)) return TS_DAY_MAP.S;
    if (/^(?:อาทิตย์|อา\.?)(?:\s*U)?$/i.test(s) || /^U$/i.test(s)) return TS_DAY_MAP.U;
    return null;
}

function mergeContiguousTimeRanges(timeList) {
    if (!timeList || timeList.length === 0) return '-';
    if (timeList.length === 1) return timeList[0];

    const parsed = timeList.map(t => {
        const m = t.match(/^(\d{1,2}[.:]\d{2})\s*[-–]\s*(\d{1,2}[.:]\d{2})$/);
        return m ? { start: m[1], end: m[2], raw: t } : { start: null, end: null, raw: t };
    });

    if (parsed.some(p => !p.start)) return timeList.join(', ');

    const result = [];
    let cur = { ...parsed[0] };
    for (let i = 1; i < parsed.length; i++) {
        if (cur.end === parsed[i].start) {
            cur.end = parsed[i].end;
        } else {
            result.push(`${cur.start}-${cur.end}`);
            cur = { ...parsed[i] };
        }
    }
    result.push(`${cur.start}-${cur.end}`);
    return result.join(', ');
}

function parseTimetableGridSheet(ws, sheetName, fileName) {
    const rawRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    const merges = ws['!merges'] || [];

    const rows = rawRows.map(r => [...r]);
    for (const m of merges) {
        const val = rawRows[m.s.r]?.[m.s.c] ?? '';
        if (val === '' || val === null || val === undefined) continue;
        if (m.s.r === m.e.r) {
            for (let c = m.s.c; c <= m.e.c; c++) {
                if (!rows[m.s.r]) rows[m.s.r] = [];
                rows[m.s.r][c] = val;
            }
        }
    }

    const defaultFaculty = normalizeFacultyName(fileName.replace(/\.[^.]+$/, ''), true);
    const defaultType = /พิเศษ/.test(sheetName) ? 'อาจารย์พิเศษ' : (/ประจำ/.test(sheetName) ? 'อาจารย์ประจำ' : '');

    const blockStarts = [];
    for (let r = 0; r < rows.length; r++) {
        const row = rows[r] || [];
        for (let c = 0; c <= Math.min(3, row.length - 1); c++) {
            const cell = cleanText(row[c]);
            const m = cell.match(/^ตารางสอน(?:ชื่อผู้สอน|อาจารย์)\s*[:：]?\s*(.+)$/i);
            if (m && cleanText(m[1])) {
                let hasGridBelow = false;
                for (let k = r + 1; k <= Math.min(rows.length - 1, r + 18); k++) {
                    const checkRow = (rows[k] || []).slice(0, 4).map(x => cleanText(x));
                    if (checkRow.some(x => /^วัน\s*\/\s*เวลา$/i.test(x))) {
                        hasGridBelow = true;
                        break;
                    }
                    if (k > r + 1 && checkRow.some(x => /^ตารางสอน(?:ชื่อผู้สอน|อาจารย์)\s*/i.test(x))) {
                        break;
                    }
                }
                if (hasGridBelow) {
                    blockStarts.push({ rowIdx: r, colIdx: c, rawLecturer: cleanText(m[1]) });
                }
                break;
            }
        }
    }

    if (blockStarts.length === 0) return [];

    const extracted = [];

    for (let b = 0; b < blockStarts.length; b++) {
        const startRow = blockStarts[b].rowIdx;
        const endRow = (b + 1 < blockStarts.length) ? blockStarts[b + 1].rowIdx - 1 : rows.length - 1;
        const lecturerName = sanitizeLecturerName(blockStarts[b].rawLecturer) || blockStarts[b].rawLecturer;

        let faculty = defaultFaculty;
        let major = '';
        let semester = '1';
        let year = '2569';
        let lecturerType = defaultType;
        const courseMap = new Map();
        let gridHeaderRow = -1;
        let dayColIdx = -1;
        const timeSlotsByCol = new Map();
        let inNoTimeSection = false;

        for (let r = startRow; r <= endRow; r++) {
            const row = (rows[r] || []).map(c => cleanText(c));
            const mainCells = row.slice(0, 8).filter(Boolean);
            if (mainCells.length === 0) continue;
            const line = [...new Set(mainCells)].join(' ');

            const foundDayHeaderCol = row.slice(0, 4).findIndex(c => /^วัน\s*\/\s*เวลา$/i.test(c));
            if (foundDayHeaderCol !== -1) {
                gridHeaderRow = r;
                dayColIdx = foundDayHeaderCol;
                inNoTimeSection = false;
                for (let c = dayColIdx + 1; c < row.length; c++) {
                    const tVal = normalizeThaiDigits(row[c]);
                    if (/\d{1,2}[.:]\d{2}\s*[-–]\s*\d{1,2}[.:]\d{2}/.test(tVal)) {
                        timeSlotsByCol.set(c, tVal.replace(/\s+/g, ''));
                    }
                }
                continue;
            }

            if (gridHeaderRow === -1) {
                const facExtracted = extractFacultyLabel(line);
                if (facExtracted !== 'ไม่ระบุคณะ') faculty = facExtracted;

                if (/อาจารย์พิเศษ/.test(line)) lecturerType = 'อาจารย์พิเศษ';
                else if (/อาจารย์ประจำ/.test(line) && !lecturerType) lecturerType = 'อาจารย์ประจำ';

                const progMatch = line.match(/((?:หลักสูตร|สาขาวิชา)[^\s|]+(?:\s+(?!ภาค\b)[^\s|]+)*)/);
                if (progMatch && !major) major = cleanText(progMatch[1]);

                const semMatch = normalizeThaiDigits(line).match(/ภาค(?:การศึกษา|เรียน)?(?:ที่)?\s*([123])\s*[/\-]\s*(25\d{2}|\d{2})/);
                if (semMatch) {
                    semester = semMatch[1];
                    year = semMatch[2].length === 2 ? `25${semMatch[2]}` : semMatch[2];
                }

                for (const cell of row.slice(0, 6)) {
                    const mCourse = cell.match(/^วิชา\s*([A-Za-z]{2,5}\d{4,6}|\d{5,8})\s*(.+)$/i);
                    if (mCourse) {
                        const code = cleanText(mCourse[1]).toUpperCase();
                        const subj = cleanText(mCourse[2]);
                        if (code && subj) courseMap.set(code, subj);
                    }
                }

                if (/สอนรายวิชาไม่ระบุวันเวลาสอน/i.test(line)) {
                    inNoTimeSection = true;
                    continue;
                }
                if (inNoTimeSection) {
                    const mNoTime = line.match(/([A-Za-z]{2,5}\d{4,6}|\d{5,8})\s+([ก-๙a-zA-Z0-9\s().,/-]{3,80})/);
                    if (mNoTime) {
                        extracted.push({
                            dayOrder: 8,
                            day: 'ไม่ระบุวัน/เวลา',
                            time: 'ไม่ระบุเวลา',
                            code: mNoTime[1].toUpperCase(),
                            subject: cleanText(mNoTime[2]),
                            section: '-',
                            room: '-',
                            lecturer: lecturerName,
                            lecturerType: lecturerType || 'อาจารย์ประจำ',
                            faculty: faculty || 'ไม่ระบุคณะ',
                            major: major || sheetName,
                            year,
                            semester,
                            sourceFile: fileName
                        });
                    }
                }
                continue;
            }

            const dayInfo = normalizeScheduleDay(row[dayColIdx]);
            if (!dayInfo) continue;

            const dayCourseSlots = new Map();

            for (const [colIdx, timeLabel] of timeSlotsByCol.entries()) {
                const rawCell = cleanText(row[colIdx]);
                if (!rawCell) continue;
                if (/^(?:>*\s*O\.?\s*H\.?\s*<*|office\s*hour|วันหยุด|พัก|ว่าง|-+|–+|—+)$/i.test(rawCell)) continue;

                const parts = rawCell.split(/\s*[/,\n]+\s*/).map(p => cleanText(p)).filter(Boolean);
                for (const part of parts) {
                    const codeMatch = part.match(/\b([A-Za-z]{2,5}\d{4,6}|\d{5,8})\b/i);
                    if (!codeMatch) continue;
                    const code = codeMatch[1].toUpperCase();

                    const secMatch = part.match(/(?:กลุ่ม|sec\.?|ตอน)\s*([0-9A-Za-z]+)/i) || part.match(/\(\s*(\d{1,3})\s*\)/);
                    const roomMatch = part.match(/(?:ห้อง|room)\s*([0-9A-Za-z-]+)/i);
                    const section = secMatch ? secMatch[1] : '-';
                    const room = roomMatch ? roomMatch[1] : '-';

                    const key = `${code}||${section}||${room}`;
                    if (!dayCourseSlots.has(key)) {
                        dayCourseSlots.set(key, { code, section, room, times: [] });
                    }
                    const slotObj = dayCourseSlots.get(key);
                    if (!slotObj.times.includes(timeLabel)) {
                        slotObj.times.push(timeLabel);
                    }
                }
            }

            for (const item of dayCourseSlots.values()) {
                extracted.push({
                    dayOrder: dayInfo.order,
                    day: dayInfo.label,
                    time: mergeContiguousTimeRanges(item.times),
                    code: item.code,
                    subject: courseMap.get(item.code) || `รายวิชา ${item.code}`,
                    section: item.section,
                    room: item.room,
                    lecturer: lecturerName,
                    lecturerType: lecturerType || 'อาจารย์ประจำ',
                    faculty: faculty || 'ไม่ระบุคณะ',
                    major: major || sheetName,
                    year,
                    semester,
                    sourceFile: fileName
                });
            }
        }
    }

    return extracted;
}

async function handleImportTeachingScheduleFiles(fileList) {
    if (!fileList || fileList.length === 0) return;

    for (const file of Array.from(fileList)) {
        try {
            tsScheduleRecords = tsScheduleRecords.filter(r => r.sourceFile !== file.name);
            tsImportLogs = tsImportLogs.filter(l => l.fileName !== file.name);

            if (/\.xlsx?$/i.test(file.name)) {
                if (typeof XLSX === 'undefined') {
                    alert('ไม่พบไลบรารีอ่านไฟล์ Excel (XLSX)');
                    return;
                }
                const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
                let addedCount = 0;

                for (const sheetName of wb.SheetNames) {
                    const ws = wb.Sheets[sheetName];
                    if (!ws) continue;

                    const gridRecords = parseTimetableGridSheet(ws, sheetName, file.name);
                    if (gridRecords.length > 0) {
                        tsScheduleRecords.push(...gridRecords);
                        addedCount += gridRecords.length;
                        continue;
                    }

                    const rows = sheetToExpandedRows(ws);
                    let hIdx = -1, cDay = -1, cTime = -1, cCode = -1, cSubj = -1, cSec = -1, cRoom = -1, cLec = -1, cFac = -1;
                    for (let r = 0; r < Math.min(rows.length, 25); r++) {
                        const rowStr = (rows[r] || []).map(c => cleanText(c));
                        const fSubj = rowStr.findIndex(c => /^(?:ชื่อวิชา|รายวิชา)$/i.test(c));
                        const fLec = rowStr.findIndex(c => /^(?:ผู้สอน|อาจารย์ผู้สอน|ชื่ออาจารย์|ชื่อ-สกุล)$/i.test(c));
                        if (fSubj !== -1 && fLec !== -1) {
                            hIdx = r;
                            cDay = rowStr.findIndex(c => /^(?:วัน|day)$/i.test(c));
                            cTime = rowStr.findIndex(c => /(?:เวลา|time|คาบ)/i.test(c));
                            cCode = rowStr.findIndex(c => /(?:รหัสวิชา|code)/i.test(c));
                            cSubj = fSubj;
                            cSec = rowStr.findIndex(c => /(?:กลุ่ม|sec)/i.test(c));
                            cRoom = rowStr.findIndex(c => /(?:ห้อง|room)/i.test(c));
                            cLec = fLec;
                            cFac = rowStr.findIndex(c => /(?:คณะ)/i.test(c));
                            break;
                        }
                    }

                    if (hIdx !== -1) {
                        for (let r = hIdx + 1; r < rows.length; r++) {
                            const row = rows[r] || [];
                            const lecName = sanitizeLecturerName(row[cLec]);
                            const subjName = cleanText(row[cSubj]);
                            if (!lecName || !subjName) continue;
                            const dayInfo = normalizeScheduleDay(cDay !== -1 ? row[cDay] : '');
                            tsScheduleRecords.push({
                                dayOrder: dayInfo ? dayInfo.order : 8,
                                day: dayInfo ? dayInfo.label : (cDay !== -1 ? cleanText(row[cDay]) || '-' : '-'),
                                time: cTime !== -1 ? cleanText(row[cTime]) || '-' : '-',
                                code: cCode !== -1 ? cleanText(row[cCode]) || '-' : '-',
                                subject: subjName,
                                section: cSec !== -1 ? cleanText(row[cSec]) || '-' : '-',
                                room: cRoom !== -1 ? cleanText(row[cRoom]) || '-' : '-',
                                lecturer: lecName,
                                lecturerType: 'อาจารย์ประจำ',
                                faculty: cFac !== -1 ? normalizeFacultyName(row[cFac], true) : normalizeFacultyName(file.name, true),
                                major: sheetName,
                                year: '2569',
                                semester: '1',
                                sourceFile: file.name
                            });
                            addedCount++;
                        }
                    }
                }

                tsImportLogs.push({ fileName: file.name, count: addedCount, status: addedCount > 0 ? 'SUCCESS' : 'WARNING' });
            } else if (/\.pdf$/i.test(file.name) && window.pdfjsLib) {
                const pdf = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
                let addedCount = 0;
                for (let p = 1; p <= pdf.numPages; p++) {
                    const page = await pdf.getPage(p);
                    const pageText = (await page.getTextContent()).items.map(it => it.str).join(' ');
                    const lecMatch = pageText.match(/ตารางสอน(?:ชื่อผู้สอน|อาจารย์)\s*[:：]?\s*([ก-๙.\s]+?)(?=\s+(?:ตำแหน่ง|คณะ|หลักสูตร|สาขา|ภาค|$))/);
                    const lecturerName = lecMatch ? sanitizeLecturerName(lecMatch[1]) : `ผู้สอน (หน้า ${p})`;
                    for (const m of pageText.matchAll(/วิชา\s*([A-Za-z]{2,5}\d{4,6}|\d{5,8})\s+([ก-๙a-zA-Z0-9\s()-]{3,60})/g)) {
                        tsScheduleRecords.push({
                            dayOrder: 8,
                            day: '-',
                            time: '-',
                            code: m[1].toUpperCase(),
                            subject: cleanText(m[2]),
                            section: '-',
                            room: '-',
                            lecturer: lecturerName || `ผู้สอน (หน้า ${p})`,
                            lecturerType: 'อาจารย์ประจำ',
                            faculty: normalizeFacultyName(file.name, true),
                            major: '-',
                            year: '2569',
                            semester: '1',
                            sourceFile: file.name
                        });
                        addedCount++;
                    }
                }
                tsImportLogs.push({ fileName: file.name, count: addedCount, status: addedCount > 0 ? 'SUCCESS' : 'WARNING' });
            }
        } catch (err) {
            console.error('Error importing teaching schedule:', file.name, err);
            tsImportLogs.push({ fileName: file.name, count: 0, status: 'ERROR' });
        }
    }

    tsLastUpdated = new Date().toLocaleString('th-TH');
    saveTeachingScheduleToStorage();
    renderTeachingScheduleTab();
}

function renderTeachingScheduleTab() {
    const setTxt = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

    const faculties = [...new Set(tsScheduleRecords.map(r => r.faculty).filter(f => f && f !== 'ไม่ระบุคณะ'))].sort((a, b) => a.localeCompare(b, 'th'));
    const facSel = document.getElementById('ts-filter-faculty');
    if (facSel) {
        const prev = facSel.value;
        facSel.innerHTML = `<option value="ALL">ทุกคณะ (ทั้งหมด)</option>` + faculties.map(f => `<option value="${escapeHtml(f)}">${escapeHtml(f)}</option>`).join('');
        if (faculties.includes(prev)) facSel.value = prev;
    }

    const selFac = facSel?.value || 'ALL';
    const majors = [...new Set(tsScheduleRecords.filter(r => selFac === 'ALL' || r.faculty === selFac).map(r => r.major).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'th'));
    const majSel = document.getElementById('ts-filter-major');
    if (majSel) {
        const prev = majSel.value;
        majSel.innerHTML = `<option value="ALL">ทุกสาขา / ชีต</option>` + majors.map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('');
        if (majors.includes(prev)) majSel.value = prev;
    }

    const selMaj = majSel?.value || 'ALL';
    const selYear = document.getElementById('ts-filter-year')?.value || 'ALL';
    const selSem = document.getElementById('ts-filter-semester')?.value || 'ALL';
    const q = cleanText(document.getElementById('ts-filter-search')?.value).toLowerCase();

    const filtered = tsScheduleRecords.filter(r => {
        if (selFac !== 'ALL' && r.faculty !== selFac) return false;
        if (selMaj !== 'ALL' && r.major !== selMaj) return false;
        if (selYear !== 'ALL' && r.year !== selYear) return false;
        if (selSem !== 'ALL' && r.semester !== selSem) return false;
        if (q && !`${r.lecturer} ${r.code} ${r.subject} ${r.room} ${r.day} ${r.lecturerType}`.toLowerCase().includes(q)) return false;
        return true;
    });

    const uniqueLecturers = [...new Set(filtered.map(r => r.lecturer))].filter(Boolean).sort((a, b) => a.localeCompare(b, 'th'));

    setTxt('ts-total-records', `${filtered.length.toLocaleString()} รายการ`);
    setTxt('ts-total-lecturers', `${uniqueLecturers.length.toLocaleString()} คน`);
    setTxt('ts-last-updated', tsLastUpdated);
    setTxt('ts-file-count', tsImportLogs.length.toLocaleString());

    const logList = document.getElementById('ts-import-log-list');
    if (logList) {
        logList.innerHTML = tsImportLogs.length === 0
            ? `<div class="text-slate-400">ยังไม่มีไฟล์ตารางสอนที่นำเข้า</div>`
            : tsImportLogs.map(l => `<div class="p-2 rounded-lg bg-slate-50 border border-slate-200 font-semibold">${escapeHtml(l.fileName)} <span class="text-[#0F7678]">(${l.count.toLocaleString()} คาบ/รายการ)</span></div>`).join('');
    }

    const lecSelect = document.getElementById('ts-select-lecturer');
    if (lecSelect) {
        const prev = lecSelect.value;
        lecSelect.innerHTML = uniqueLecturers.length === 0
            ? `<option value="">-- กรุณานำเข้าไฟล์ตารางสอน --</option>`
            : uniqueLecturers.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
        if (uniqueLecturers.includes(prev)) lecSelect.value = prev;
    }

    const selectedLec = lecSelect?.value || uniqueLecturers[0] || '';
    const personRecs = filtered
        .filter(r => !selectedLec || r.lecturer === selectedLec)
        .sort((a, b) => (a.dayOrder || 9) - (b.dayOrder || 9) || a.time.localeCompare(b.time));

    const lecTypeBadge = personRecs[0]?.lecturerType ? ` (${personRecs[0].lecturerType})` : '';
    setTxt('ts-weekly-title', selectedLec ? `ตารางสอนรายสัปดาห์: ${selectedLec}${lecTypeBadge}` : 'ตารางสอนรายสัปดาห์');
    setTxt('ts-weekly-badge', `${personRecs.length} ช่วงสอน`);

    const gridContainer = document.getElementById('ts-weekly-grid-container');
    if (gridContainer) {
        if (personRecs.length === 0) {
            gridContainer.innerHTML = `<div class="text-center py-12 text-xs text-slate-400 border border-dashed border-slate-200 rounded-xl">ยังไม่มีข้อมูลตารางสอน กรุณากดปุ่ม <strong>“นำเข้าไฟล์ตารางสอน (Excel / PDF)”</strong> ด้านบนเพื่ออัปโหลดไฟล์</div>`;
        } else {
            const allDays = [
                TS_DAY_MAP.M, TS_DAY_MAP.T, TS_DAY_MAP.W,
                TS_DAY_MAP.H, TS_DAY_MAP.F, TS_DAY_MAP.S, TS_DAY_MAP.U
            ];
            const unscheduledRecs = personRecs.filter(r => r.dayOrder === 8);

            const weeklyRowsHtml = allDays.map(d => {
                const daySlots = personRecs.filter(r => r.dayOrder === d.order);
                return `
                    <tr class="${daySlots.length > 0 ? 'bg-white' : 'bg-slate-50/60'} hover:bg-slate-50 transition">
                        <td class="py-3 px-4 font-bold text-navy border-r border-slate-200 w-36 align-top">${escapeHtml(d.label)}</td>
                        <td class="py-2.5 px-4">
                            ${daySlots.length === 0
                                ? `<span class="text-slate-300 text-[11px]">- ไม่มีตารางสอน -</span>`
                                : `<div class="flex flex-wrap gap-2">${daySlots.map(s => `
                                    <div class="px-3 py-2 rounded-xl border border-[#159A9C]/35 bg-[#E6F6F6]/60 text-xs">
                                        <div class="font-bold text-[#0F7678] font-disp">
                                            <i class="fa-regular fa-clock mr-1"></i>${escapeHtml(s.time)}
                                            <span class="ml-1.5 px-1.5 py-0.5 rounded bg-navy text-white text-[10px]">${escapeHtml(s.code)}</span>
                                            ${s.section && s.section !== '-' ? `<span class="ml-1 text-[10px] text-slate-600">(กลุ่ม ${escapeHtml(s.section)})</span>` : ''}
                                        </div>
                                        <div class="text-ink font-semibold mt-0.5">${escapeHtml(s.subject)}</div>
                                        ${s.room && s.room !== '-' ? `<div class="text-[10px] text-slate-500 mt-0.5"><i class="fa-solid fa-location-dot mr-1"></i>ห้อง ${escapeHtml(s.room)}</div>` : ''}
                                    </div>`).join('')}</div>`}
                        </td>
                    </tr>`;
            }).join('');

            gridContainer.innerHTML = `
                <div class="overflow-x-auto rounded-xl border border-slate-200">
                    <table class="w-full text-left border-collapse text-xs">
                        <thead class="bg-navy text-white font-disp">
                            <tr>
                                <th class="py-2.5 px-4 w-36">วัน</th>
                                <th class="py-2.5 px-4">ช่วงเวลา / รายวิชาที่สอน</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-slate-200">${weeklyRowsHtml}</tbody>
                    </table>
                </div>
                ${unscheduledRecs.length > 0 ? `
                <div class="mt-3 p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs">
                    <div class="font-bold text-amber-800 mb-1">รายวิชาไม่ระบุวัน/เวลาสอน:</div>
                    <ul class="list-disc pl-5 text-amber-900 space-y-0.5">
                        ${unscheduledRecs.map(u => `<li><strong>${escapeHtml(u.code)}</strong> ${escapeHtml(u.subject)}</li>`).join('')}
                    </ul>
                </div>` : ''}`;
        }
    }

    setTxt('ts-list-count-badge', `${filtered.length.toLocaleString()} รายการ`);
    const listBody = document.getElementById('ts-list-tbody');
    if (listBody) {
        listBody.innerHTML = filtered.length === 0
            ? `<tr><td colspan="8" class="text-center py-10 text-slate-400">ยังไม่มีข้อมูลตารางสอน</td></tr>`
            : filtered.map((r, i) => `
                <tr class="hover:bg-slate-50">
                    <td class="py-2.5 px-3 text-center text-slate-500">${i + 1}</td>
                    <td class="py-2.5 px-3 font-bold text-navy whitespace-nowrap">${escapeHtml(r.day)}</td>
                    <td class="py-2.5 px-3 whitespace-nowrap">${escapeHtml(r.time)}</td>
                    <td class="py-2.5 px-3 font-bold text-[#0F7678]">${escapeHtml(r.code)}</td>
                    <td class="py-2.5 px-4">${escapeHtml(r.subject)}</td>
                    <td class="py-2.5 px-3 text-center">${escapeHtml(r.section)}</td>
                    <td class="py-2.5 px-3">${escapeHtml(r.room)}</td>
                    <td class="py-2.5 px-4 font-bold text-ink">${escapeHtml(r.lecturer)} <span class="text-[10px] font-normal text-slate-400">(${escapeHtml(r.lecturerType || '-')})</span></td>
                </tr>`).join('');
    }
}

function saveTeachingScheduleToStorage() {
    try {
        localStorage.setItem(TS_STORAGE_KEY, JSON.stringify({
            records: tsScheduleRecords,
            logs: tsImportLogs,
            lastUpdated: tsLastUpdated
        }));
    } catch (e) {}
}

function loadTeachingScheduleFromStorage() {
    try {
        const raw = localStorage.getItem(TS_STORAGE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        tsScheduleRecords = parsed.records || [];
        tsImportLogs = parsed.logs || [];
        tsLastUpdated = parsed.lastUpdated || '-';
    } catch (e) {}
}
// ----------------------------------------------------------------------------
// 14. Modal แสดงรายชื่อเมื่อคลิกการ์ด KPI
// ----------------------------------------------------------------------------
window.openKpiDetailModal = function(statusType = 'ALL', preselectFaculty = null) {
    const selFac = preselectFaculty || document.getElementById('reg-faculty-filter')?.value || 'ALL';
    const allLecturers = buildMergedRegularLecturers();
    const allMissionSum = getAggregatedMissionSummary();

    const titles = {
        ALL: 'รายชื่ออาจารย์ประจำทั้งหมด',
        COMPLETE: 'รายชื่ออาจารย์ที่สอนครบพันธกิจ (+) รวมทุกคณะ',
        INCOMPLETE: 'รายชื่ออาจารย์ที่สอนไม่ครบพันธกิจ (-) รวมทุกคณะ',
        PENDING: 'รายชื่ออาจารย์ที่ยังไม่ระบุสถานะ / ผู้บริหาร'
    };

    const byStatus = allLecturers.filter(l => {
        if (NON_PERSON_KEYWORDS_RE.test(l.name)) return false;
        if (statusType === 'ALL') return true;
        if (statusType === 'PENDING') return l.status !== 'COMPLETE' && l.status !== 'INCOMPLETE';
        return l.status === statusType;
    });

    const faculties = getAllKnownFaculties();
    const missionFacMap = new Map(allMissionSum.faculties.map(f => [f.faculty, f]));

    const facultyBreakdown = faculties.map(fac => {
        const m = missionFacMap.get(fac) || { regularCount: 0, completeCount: 0, incompleteCount: 0, noMissionCount: 0 };
        const rTot = getAuthoritativeTotalLecturersCount(fac);
        const tot = rTot > 0 ? rTot : (m.regularCount > 0 ? m.regularCount : (m.completeCount + m.incompleteCount + m.noMissionCount));
        const count = statusType === 'COMPLETE'
            ? m.completeCount
            : statusType === 'INCOMPLETE'
                ? m.incompleteCount
                : statusType === 'ALL'
                    ? tot
                    : Math.max(0, tot - m.completeCount - m.incompleteCount);
        return { faculty: fac, count };
    }).filter(x => x.count > 0);

    const selMissionSum = getAggregatedMissionSummary(selFac);
    const selRTot = getAuthoritativeTotalLecturersCount(selFac);
    const selTot = selRTot > 0 ? selRTot : (selMissionSum.grandTotalRegular > 0 ? selMissionSum.grandTotalRegular : selMissionSum.grandTotalEvaluated);

    const authoritativeTotalForModal = statusType === 'COMPLETE'
        ? selMissionSum.grandTotalComplete
        : statusType === 'INCOMPLETE'
            ? selMissionSum.grandTotalIncomplete
            : statusType === 'ALL'
                ? selTot
                : Math.max(0, selTot - selMissionSum.grandTotalComplete - selMissionSum.grandTotalIncomplete);

    showDynamicRegularModal(titles[statusType] || titles.ALL, byStatus, {
        statusType,
        initialFaculty: selFac,
        facultyBreakdown,
        authoritativeTotal: authoritativeTotalForModal
    });
};

window.openLecturerProfileModal = function(personKey) {
    const person = buildMergedRegularLecturers().find(l => l.personKey === personKey);
    if (!person) return;
    showDynamicRegularModal(`โปรไฟล์อาจารย์ประจำ: ${person.name}`, [person], {
        statusType: 'SINGLE',
        initialFaculty: 'ALL',
        facultyBreakdown: [],
        authoritativeTotal: 1
    });
};

function showDynamicRegularModal(titleText, peopleList, meta = {}) {
    let modal = document.getElementById('reg-dynamic-kpi-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'reg-dynamic-kpi-modal';
        modal.className = 'fixed inset-0 z-[999] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4';
        document.body.appendChild(modal);
    }

    let activeModalFac = meta.initialFaculty || 'ALL';
    const breakdown = meta.facultyBreakdown || [];
    const totalAllFaculties = breakdown.reduce((s, b) => s + b.count, 0) || meta.authoritativeTotal || peopleList.length;

    modal.classList.remove('hidden');
    modal.innerHTML = `
        <div class="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-5xl max-h-[88vh] flex flex-col overflow-hidden">
            <div class="p-4 bg-navy-900 text-white flex items-center justify-between gap-3">
                <div>
                    <h3 class="text-base font-bold font-disp">${escapeHtml(titleText)}</h3>
                    <p id="reg-modal-subtitle" class="text-xs text-slate-300 mt-0.5">ยอดรวมทุกคณะ: ${totalAllFaculties.toLocaleString()} คน | รายชื่อที่ดึงได้: ${peopleList.length.toLocaleString()} คน</p>
                </div>
                <button type="button" onclick="document.getElementById('reg-dynamic-kpi-modal').classList.add('hidden')" class="px-3 py-1.5 rounded-xl bg-white/15 hover:bg-white/25 text-xs font-bold font-disp shrink-0">
                    <i class="fa-solid fa-xmark mr-1"></i>ปิดหน้าต่าง
                </button>
            </div>

            ${breakdown.length > 0 ? `
            <div class="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center gap-1.5 text-xs">
                <span class="font-bold text-ink font-disp mr-1">ยอดแต่ละคณะที่บวกรวมกัน:</span>
                <button type="button" data-modal-fac="ALL" class="reg-modal-fac-pill px-2.5 py-1 rounded-lg font-bold font-disp transition ${activeModalFac === 'ALL' ? 'bg-navy text-white' : 'bg-white border border-slate-300 text-ink hover:bg-slate-100'}">
                    รวมทุกคณะ (${totalAllFaculties.toLocaleString()} คน)
                </button>
                ${breakdown.map(b => `
                    <button type="button" data-modal-fac="${escapeHtml(b.faculty)}" class="reg-modal-fac-pill px-2.5 py-1 rounded-lg font-bold font-disp transition ${activeModalFac === b.faculty ? 'bg-[#159A9C] text-white' : 'bg-white border border-slate-300 text-ink hover:bg-slate-100'}">
                        ${escapeHtml(b.faculty.replace(/^คณะ/, ''))}: ${b.count.toLocaleString()} คน
                    </button>
                `).join('')}
            </div>` : ''}

            <div class="px-4 py-2 bg-white border-b border-slate-200 flex items-center justify-between gap-2">
                <div class="relative flex-1 max-w-md">
                    <i class="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs"></i>
                    <input type="text" id="reg-modal-search-input" placeholder="ค้นหาชื่อ-นามสกุล, คณะ หรือสาขา..." class="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:ring-navy focus:border-navy">
                </div>
                <span id="reg-modal-filtered-badge" class="text-xs font-bold text-navy font-disp"></span>
            </div>

            <div class="overflow-auto custom-scrollbar flex-1">
                <table class="w-full text-left border-collapse text-xs">
                    <thead class="bg-slate-100 text-ink font-bold font-disp sticky top-0">
                        <tr>
                            <th class="py-3 px-3 text-center w-14 whitespace-nowrap">ลำดับ</th>
                            <th class="py-3 px-4 whitespace-nowrap">ชื่อ-นามสกุล</th>
                            <th class="py-3 px-4 whitespace-nowrap">คณะ</th>
                            <th class="py-3 px-4 min-w-[150px]">สาขา / หลักสูตร</th>
                            <th class="py-3 px-4 text-center whitespace-nowrap">สถานะพันธกิจ</th>
                            <th class="py-3 px-4 min-w-[240px]">หมายเหตุ / แหล่งข้อมูล</th>
                        </tr>
                    </thead>
                    <tbody id="reg-modal-tbody" class="divide-y divide-slate-200"></tbody>
                </table>
            </div>
        </div>`;

    const renderModalRows = () => {
        const q = cleanText(document.getElementById('reg-modal-search-input')?.value).toLowerCase();
        const rows = peopleList.filter(p => {
            if (NON_PERSON_KEYWORDS_RE.test(p.name)) return false;
            if (activeModalFac !== 'ALL' && p.faculty !== activeModalFac) return false;
            if (q && !`${p.name} ${p.faculty} ${p.major} ${p.remarkText} ${p.sourceText}`.toLowerCase().includes(q)) return false;
            return true;
        });

        const selectedFacSummaryCount = activeModalFac === 'ALL'
            ? totalAllFaculties
            : (breakdown.find(b => b.faculty === activeModalFac)?.count || rows.length);

        const subtitleEl = document.getElementById('reg-modal-subtitle');
        if (subtitleEl) {
            const scopeLabel = activeModalFac === 'ALL' ? 'ยอดรวมทุกคณะ' : `ยอด${activeModalFac}`;
            subtitleEl.textContent = `${scopeLabel}: ${selectedFacSummaryCount.toLocaleString()} คน | รายชื่อที่ดึงได้: ${rows.length.toLocaleString()} คน`;
        }

        const badge = document.getElementById('reg-modal-filtered-badge');
        if (badge) badge.textContent = `รายชื่อที่แสดง: ${rows.length.toLocaleString()} คน`;

        const tbody = document.getElementById('reg-modal-tbody');
        if (!tbody) return;
        if (rows.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" class="text-center py-8 text-slate-400">ไม่พบรายชื่อในหมวดหมู่นี้</td></tr>`;
            return;
        }

        tbody.innerHTML = rows.map((p, i) => `
            <tr class="hover:bg-slate-50">
                <td class="py-2.5 px-3 text-center text-slate-500 whitespace-nowrap">${i + 1}</td>
                <td class="py-2.5 px-4 font-bold text-ink whitespace-nowrap">${escapeHtml(p.name)}</td>
                <td class="py-2.5 px-4 whitespace-nowrap">${escapeHtml(p.faculty)}</td>
                <td class="py-2.5 px-4">${escapeHtml(p.major || '-')}</td>
                <td class="py-2.5 px-4 text-center whitespace-nowrap">${getStatusBadgeHtml(p.status)}</td>
                <td class="py-2.5 px-4 text-slate-600 leading-relaxed">${escapeHtml(p.remarkText || p.sourceText || '-')}</td>
            </tr>`).join('');
    };

    modal.querySelectorAll('.reg-modal-fac-pill').forEach(pill => {
        pill.addEventListener('click', () => {
            activeModalFac = pill.getAttribute('data-modal-fac') || 'ALL';
            modal.querySelectorAll('.reg-modal-fac-pill').forEach(b => {
                const isSelected = (b.getAttribute('data-modal-fac') || 'ALL') === activeModalFac;
                b.className = isSelected
                    ? 'reg-modal-fac-pill px-2.5 py-1 rounded-lg font-bold font-disp transition bg-[#159A9C] text-white'
                    : 'reg-modal-fac-pill px-2.5 py-1 rounded-lg font-bold font-disp transition bg-white border border-slate-300 text-ink hover:bg-slate-100';
            });
            renderModalRows();
        });
    });

    document.getElementById('reg-modal-search-input')?.addEventListener('input', renderModalRows);
    renderModalRows();
}

// ----------------------------------------------------------------------------
// 15. ส่งออกรายงาน Excel (Export Excel)
// ----------------------------------------------------------------------------
function exportRegularOverviewExcel() {
    if (typeof XLSX === 'undefined') return alert('ไม่พบไลบรารี XLSX');
    const faculties = getAllKnownFaculties();
    const summaryData = faculties.map((fac, idx) => {
        const m = getAggregatedMissionSummary(fac);
        const rTot = getAuthoritativeTotalLecturersCount(fac);
        const tot = rTot > 0 ? rTot : (m.grandTotalRegular > 0 ? m.grandTotalRegular : m.grandTotalEvaluated);
        const pend = Math.max(0, tot - m.grandTotalComplete - m.grandTotalIncomplete);
        const rate = tot > 0 ? Number(((m.grandTotalComplete / tot) * 100).toFixed(1)) : 0;
        return {
            'ลำดับ': idx + 1,
            'คณะ': fac,
            'อาจารย์ประจำทั้งหมด (คน)': tot,
            'สอนครบพันธกิจ (+)': m.grandTotalComplete,
            'สอนไม่ครบพันธกิจ (-)': m.grandTotalIncomplete,
            'รอประเมิน/ผู้บริหาร': pend,
            'อัตราครบพันธกิจ (%)': rate
        };
    });

    const rosterData = buildMergedRegularLecturers().map((p, idx) => ({
        'ลำดับ': idx + 1,
        'ชื่อ-นามสกุล': p.name,
        'คณะ': p.faculty,
        'สาขา': p.major,
        'คุณวุฒิ': p.degree,
        'สถานะพันธกิจ': p.status === 'COMPLETE' ? 'สอนครบพันธกิจ (+)' : p.status === 'INCOMPLETE' ? 'สอนไม่ครบพันธกิจ (-)' : p.status === 'NO_MISSION' ? 'ไม่มีพันธกิจการสอน' : 'ยังไม่ระบุสถานะ',
        'หมายเหตุ': p.remarkText || '-'
    }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryData), 'สรุประดับคณะ');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rosterData), 'รายชื่ออาจารย์ประจำ');
    XLSX.writeFile(wb, 'รายงานวิเคราะห์อาจารย์ประจำ.xlsx');
}

// ----------------------------------------------------------------------------
// 16. LocalStorage Persistence
// ----------------------------------------------------------------------------
function saveRegularStateToStorage() {
    try {
        localStorage.setItem('aa_reg_schema_version', REG_STORAGE_VERSION);
        localStorage.setItem('aa_reg_roster_list', JSON.stringify(regRosterList));
        localStorage.setItem('aa_reg_roster_agg', JSON.stringify(regRosterFacultyAgg));
        localStorage.setItem('aa_reg_roster_override', JSON.stringify(regRosterTotalOverride));
        localStorage.setItem('aa_reg_mission_summaries', JSON.stringify(regMissionFacultySummaries));
        localStorage.setItem('aa_reg_mission_records', JSON.stringify(regMissionRecords));
        localStorage.setItem('aa_reg_import_logs', JSON.stringify(regImportLogs));
        localStorage.setItem('aa_reg_last_sync', regLastSyncText);
    } catch (e) {}
}

function loadRegularStateFromStorage() {
    try {
        const ver = localStorage.getItem('aa_reg_schema_version');
        if (ver !== REG_STORAGE_VERSION) {
            Object.keys(localStorage).forEach(k => {
                if (k.startsWith('aa_reg_')) localStorage.removeItem(k);
            });
            return;
        }
        const rList = localStorage.getItem('aa_reg_roster_list');
        const rAgg = localStorage.getItem('aa_reg_roster_agg');
        const rOver = localStorage.getItem('aa_reg_roster_override');
        const mSum = localStorage.getItem('aa_reg_mission_summaries');
        const mRec = localStorage.getItem('aa_reg_mission_records');
        const logs = localStorage.getItem('aa_reg_import_logs');
        const sync = localStorage.getItem('aa_reg_last_sync');

        if (rList) regRosterList = JSON.parse(rList);
        if (rAgg) regRosterFacultyAgg = JSON.parse(rAgg);
        if (rOver) regRosterTotalOverride = JSON.parse(rOver);
        if (mSum) regMissionFacultySummaries = JSON.parse(mSum);
        if (mRec) regMissionRecords = JSON.parse(mRec);
        if (logs) regImportLogs = JSON.parse(logs);
        if (sync) regLastSyncText = sync;
    } catch (e) {}
}

function renderAllRegularViews() {
    renderOverviewTab();
    renderFacultyAnalysisTab();
    renderLecturerSearchTab();
    renderTeachingScheduleTab();
}

// ----------------------------------------------------------------------------
// 17. ผูก Event Listener ครบทุกปุ่มและทุก Input ในหน้า index.html
// ----------------------------------------------------------------------------
document.addEventListener('change', (e) => {
    const target = e.target;
    if (!target) return;

    if (target.type === 'file' && target.files && target.files.length > 0) {
        if (target.id === 'reg-roster-file-input') {
            handleImportRegularRosterFiles(target.files);
            target.value = '';
            return;
        }
        if (target.id === 'reg-mission-file-input') {
            handleImportRegularMissionFiles(target.files);
            target.value = '';
            return;
        }
        if (target.id === 'ts-excel-file-input') {
            handleImportTeachingScheduleFiles(target.files);
            target.value = '';
            return;
        }
    }

    if (['reg-faculty-filter', 'reg-status-filter'].includes(target.id)) {
        renderOverviewTab();
        return;
    }

    if (['fa-filter-faculty', 'fa-filter-major', 'fa-filter-status', 'fa-filter-degree', 'fa-major-chart-faculty-select'].includes(target.id)) {
        renderFacultyAnalysisTab();
        return;
    }

    if (['reg-person-faculty-filter', 'reg-person-degree-filter', 'reg-person-status-filter'].includes(target.id)) {
        renderLecturerSearchTab();
        return;
    }

    if (['ts-filter-faculty', 'ts-filter-major', 'ts-filter-year', 'ts-filter-semester', 'ts-select-lecturer'].includes(target.id)) {
        renderTeachingScheduleTab();
    }
}, true);

document.addEventListener('input', (e) => {
    const id = e.target?.id || '';
    if (id === 'reg-global-search-input') renderOverviewTab();
    else if (id === 'fa-detail-search-input') renderFacultyDrilldownTable();
    else if (id === 'reg-person-search-input') renderLecturerSearchTab();
    else if (id === 'ts-filter-search') renderTeachingScheduleTab();
}, true);

document.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;

    const directType = btn.getAttribute('data-direct-upload');
    const inlineOnclick = btn.getAttribute('onclick') || '';

    if (
        btn.id === 'btn-import-regular-roster' ||
        directType === 'roster' ||
        inlineOnclick.includes('btn-import-regular-roster')
    ) {
        e.preventDefault();
        e.stopImmediatePropagation();
        openDirectFileDialog('reg-roster-file-input', '.xlsx, .xls, .csv', handleImportRegularRosterFiles);
        return;
    }

    if (
        btn.id === 'btn-import-regular-mission' ||
        directType === 'mission' ||
        inlineOnclick.includes('btn-import-regular-mission')
    ) {
        e.preventDefault();
        e.stopImmediatePropagation();
        openDirectFileDialog('reg-mission-file-input', '.xlsx, .xls', handleImportRegularMissionFiles);
        return;
    }

    if (btn.id === 'btn-ts-upload-excel') {
        e.preventDefault();
        e.stopImmediatePropagation();
        openDirectFileDialog('ts-excel-file-input', '.xlsx, .xls, .pdf', handleImportTeachingScheduleFiles);
        return;
    }

    if (btn.id === 'btn-mode-special') {
        e.preventDefault();
        switchAppMode('SPECIAL');
        return;
    }
    if (btn.id === 'btn-mode-regular') {
        e.preventDefault();
        switchAppMode('REGULAR');
        return;
    }

    if (btn.id === 'btn-presentation-mode') {
        e.preventDefault();
        togglePresentationMode();
        return;
    }

    if (btn.classList.contains('reg-nav-tab')) {
        e.preventDefault();
        const tabId = btn.getAttribute('data-reg-tab');
        if (tabId) switchRegularTab(tabId);
        return;
    }

    if (btn.id === 'btn-toggle-sheet-status-list') {
        e.preventDefault();
        document.getElementById('reg-sheet-status-drawer')?.classList.toggle('hidden');
        return;
    }
    if (btn.id === 'btn-reset-reg-filters') {
        e.preventDefault();
        const f1 = document.getElementById('reg-faculty-filter');
        const f2 = document.getElementById('reg-status-filter');
        const f3 = document.getElementById('reg-global-search-input');
        if (f1) f1.value = 'ALL';
        if (f2) f2.value = 'ALL';
        if (f3) f3.value = '';
        renderOverviewTab();
        return;
    }
    if (btn.id === 'btn-fa-reset-filters') {
        e.preventDefault();
        ['fa-filter-faculty', 'fa-filter-major', 'fa-filter-status', 'fa-filter-degree'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = 'ALL';
        });
        renderFacultyAnalysisTab();
        return;
    }
    if (btn.id === 'btn-fa-close-drilldown') {
        e.preventDefault();
        document.getElementById('fa-detail-section')?.classList.add('hidden');
        return;
    }

    if (btn.id === 'btn-export-regular-excel' || btn.id === 'btn-fa-export-comparison') {
        e.preventDefault();
        exportRegularOverviewExcel();
        return;
    }

    if (btn.id === 'btn-ts-view-weekly') {
        e.preventDefault();
        tsCurrentView = 'WEEKLY';
        btn.className = 'ts-view-btn active px-3.5 py-1.5 rounded-lg bg-navy text-white text-xs font-bold font-disp transition';
        const listBtn = document.getElementById('btn-ts-view-list');
        if (listBtn) listBtn.className = 'ts-view-btn px-3.5 py-1.5 rounded-lg text-slate-600 hover:text-ink text-xs font-bold font-disp transition';
        document.getElementById('ts-panel-weekly')?.classList.remove('hidden');
        document.getElementById('ts-panel-list')?.classList.add('hidden');
        document.getElementById('ts-weekly-person-picker')?.classList.remove('hidden');
        return;
    }
    if (btn.id === 'btn-ts-view-list') {
        e.preventDefault();
        tsCurrentView = 'LIST';
        btn.className = 'ts-view-btn active px-3.5 py-1.5 rounded-lg bg-navy text-white text-xs font-bold font-disp transition';
        const weekBtn = document.getElementById('btn-ts-view-weekly');
        if (weekBtn) weekBtn.className = 'ts-view-btn px-3.5 py-1.5 rounded-lg text-slate-600 hover:text-ink text-xs font-bold font-disp transition';
        document.getElementById('ts-panel-list')?.classList.remove('hidden');
        document.getElementById('ts-panel-weekly')?.classList.add('hidden');
        document.getElementById('ts-weekly-person-picker')?.classList.add('hidden');
        return;
    }
    if (btn.id === 'btn-ts-toggle-log') {
        e.preventDefault();
        document.getElementById('ts-import-log-panel')?.classList.toggle('hidden');
        return;
    }
    if (btn.id === 'btn-ts-refresh') {
        e.preventDefault();
        renderTeachingScheduleTab();
        return;
    }


    if (btn.id === 'btn-ts-clear') {
        e.preventDefault();
        tsScheduleRecords = [];
        tsImportLogs = [];
        tsLastUpdated = '-';
        localStorage.removeItem(TS_STORAGE_KEY);
        renderTeachingScheduleTab();
        return;
    }
    if (btn.id === 'btn-clear-regular-all') {
        e.preventDefault();
        regRosterList = [];
        regRosterFacultyAgg = [];
        regRosterTotalOverride = null;
        regMissionFacultySummaries = [];
        regMissionRecords = [];
        regImportLogs = [];
        regLastSyncText = '-';
        Object.keys(localStorage).forEach(k => {
            if (k.startsWith('aa_reg_')) localStorage.removeItem(k);
        });
        renderAllRegularViews();
    }
}, true);

// ----------------------------------------------------------------------------
// 18. เริ่มต้นระบบเมื่อโหลดหน้าเว็บเสร็จ
// ----------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
    prepareSafeFileInputs();
    loadRegularStateFromStorage();
    loadTeachingScheduleFromStorage();
    const savedMode = localStorage.getItem('aa_active_mode') || 'SPECIAL';
    switchAppMode(savedMode);
});