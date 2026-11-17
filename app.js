// ============================================================================
// SPU Academic Affairs Dashboard - Full-time Lecturers (2569)
// Configured for SPU Real Excel Formats (Mission Summary + FM ตส.-03 + Standard Tables)
// ============================================================================

let rawLecturerList = [];
let processedLecturerList = [];
let currentFilteredList = [];
let scheduleMap = new Map(); // normTeacherName -> Array of courses
let allCoursesList = [];     // Flat list of all courses/sections for View 03
let filteredCoursesList = [];
let facultyChartInstance = null;

// ============================================================================
// 1. PARSERS & NORMALIZATION HELPERS
// ============================================================================
function normalizePersonName(name) {
    return String(name || "")
        .replace(/\s+/g, " ")
        .replace(/^(ผู้ช่วยศาสตราจารย์|รองศาสตราจารย์|ศาสตราจารย์)\s*(ดร\.)?\s*/g, "")
        .replace(/^(ผศ\.ดร\.|รศ\.ดร\.|ศ\.ดร\.|ผศ\.|รศ\.|ศ\.|ดร\.|อ\.|อาจารย์|นาย|นางสาว|นาง)\s*/g, "")
        .replace(/^ดร\.\s*/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

function normalizeDayName(rawDay) {
    const s = String(rawDay || "").trim();
    if (!s || s === "-" || /^N$/i.test(s)) return "ไม่ระบุวัน";
    if (/จันทร์|mon/i.test(s) || /^จ\.?$/i.test(s) || /^M$/i.test(s)) return "จันทร์";
    if (/อังคาร|tue/i.test(s) || /^อ\.?$/i.test(s) || /^T$/i.test(s)) return "อังคาร";
    if (/พุธ|wed/i.test(s) || /^พ\.?$/i.test(s) || /^W$/i.test(s)) return "พุธ";
    if (/พฤหัส|thu/i.test(s) || /^พฤ\.?$/i.test(s) || /^H$/i.test(s)) return "พฤหัสบดี";
    if (/ศุกร์|fri/i.test(s) || /^ศ\.?$/i.test(s) || /^F$/i.test(s)) return "ศุกร์";
    if (/เสาร์|sat/i.test(s) || /^ส\.?$/i.test(s) || /^S$/i.test(s)) return "เสาร์";
    if (/อาทิตย์|sun/i.test(s) || /^อา\.?$/i.test(s) || /^U$/i.test(s)) return "อาทิตย์";
    return s;
}

function formatTimeRange(rawTime) {
    const s = String(rawTime || "").trim();
    if (!s || s === "0000-0000") return "-";
    const m = s.match(/^(\d{2})[:.]?(\d{2})\s*-\s*(\d{2})[:.]?(\d{2})$/);
    if (m) return `${m[1]}:${m[2]} - ${m[3]}:${m[4]}`;
    return s.replace(/\./g, ":");
}

function formatSigned(num) {
    if (Math.abs(num) < 0.005) return "0.00";
    return num > 0 ? `+${num.toFixed(2)}` : num.toFixed(2);
}

/**
 * แยกชื่อ "คณะ / สำนักวิชา" และ "สาขาวิชา" ออกจากข้อความหัวตารางหรือชีตอย่างแม่นยำ
 * เช่น "สรุปพันธกิจอาจารย์ประจำ คณะวิศวกรรมศาสตร์ สาขาวิชาวิศวกรรมโยธา ภาคเรียนที่ 1/2569"
 * -> deptLabel: "คณะวิศวกรรมศาสตร์ · สาขาวิชาวิศวกรรมโยธา"
 */
function extractFacultyAndDept(headerLines, sheetName) {
    let faculty = "";
    let branch = "";

    for (const rawLine of headerLines) {
        const line = String(rawLine || "").replace(/\s+/g, " ").trim();
        if (!line) continue;

        // หาชื่อคณะ / สำนักวิชา / วิทยาลัย
        if (!faculty) {
            const facMatch = line.match(/((?:คณะ|สำนักวิชา|วิทยาลัย)[^\s]+(?:\s+(?!สาขา|ภาควิชา|หลักสูตร|ภาคเรียน|ประจำ|ครั้งที่|โทร)[^\s]+)*)/);
            if (facMatch) {
                faculty = facMatch[1].trim();
            }
        }

        // หาชื่อสาขาวิชา / ภาควิชา / หลักสูตร (รองรับกรณีมี "และ" เชื่อม 2 สาขา)
        if (!branch) {
            const brMatch = line.match(/((?:สาขาวิชา|สาขา|ภาควิชา|หลักสูตร)[^]+?)(?=\s*(?:ภาคเรียน|ประจำภาค|ครั้งที่|ปีการศึกษา|$))/);
            if (brMatch) {
                branch = brMatch[1].replace(/\s+/g, " ").trim();
            }
        }
    }

    const cleanSheet = String(sheetName || "").trim();
    if (faculty && branch) {
        return `${faculty} · ${branch}`;
    }
    if (faculty) {
        return cleanSheet && !cleanSheet.includes(faculty) ? `${faculty} (${cleanSheet})` : faculty;
    }
    if (branch) {
        return branch;
    }
    return cleanSheet || "ไม่ระบุคณะ/สาขา";
}

function parseMissionBlock(remarkTexts, critColRaw, carryColRaw, posRaw) {
    // ตัดเอาเฉพาะข้อความสรุปท้ายหมายเหตุ (เช่น "มีพันธกิจเกินยกมาจากภาคก่อนหน้า + 8.42 นก. พันธกิจประจำ 6 นก. จึงทำให้มีพันธกิจเกินยกไป 2/69 = +2.42 นก.")
    let summaryText = "";
    for (let i = (remarkTexts || []).length - 1; i >= 0; i--) {
        const cleanCell = String(remarkTexts[i] || "").replace(/\s+/g, " ").trim();
        const startIdx = cleanCell.search(/มีพันธกิจ(?:เกิน|ติดค้าง)?(?:ยกมา|จากภาคก่อนหน้า)|พันธกิจประจำ\s*=?\s*\d+/);
        if (startIdx !== -1) {
            summaryText = cleanCell.slice(startIdx).trim();
            break;
        }
    }

    const fullText = (remarkTexts || []).join(" ").replace(/\s+/g, " ").trim();
    if (!summaryText) {
        const fallbackIdx = fullText.search(/มีพันธกิจ(?:เกิน|ติดค้าง)?(?:ยกมา|จากภาคก่อนหน้า)|พันธกิจประจำ\s*=?\s*\d+/);
        summaryText = fallbackIdx !== -1 ? fullText.slice(fallbackIdx).trim() : fullText;
    }

    const calcText = summaryText.replace(/,/g, " ");
    const isLabInstructor = /ครูปฏิบัติการ/.test(posRaw) || /ชม\./.test(critColRaw) || /ชม\./.test(calcText);

    // 1. ยอดยกมา
    let carryVal = null;
    const carryMatch = calcText.match(/(?:ยกมาจาก|จากภาคก่อนหน้า)[^0-9+-]*[=:]?\s*([+-]?\s*\d+(?:\.\d+)?)/i);
    if (carryMatch) {
        carryVal = parseFloat(carryMatch[1].replace(/\s+/g, ""));
    } else if (carryColRaw && carryColRaw !== "-") {
        const colNum = parseFloat(String(carryColRaw).replace(/[^0-9.+-]/g, ""));
        if (!isNaN(colNum)) carryVal = colNum;
    }
    if (carryVal === null) carryVal = 0;

    // 2. พันธกิจประจำ
    let critVal = null;
    const critMatch = calcText.match(/พันธกิจประจำ\s*[=:]?\s*(\d+(?:\.\d+)?)/i);
    if (critMatch) {
        critVal = parseFloat(critMatch[1]);
    } else if (/ไม่มีพันธกิจประจำ|มีมีพันธกิจประจำ/.test(calcText)) {
        critVal = 0;
    } else if (critColRaw && critColRaw !== "-") {
        const colNum = parseFloat(String(critColRaw).replace(/[^0-9.]/g, ""));
        if (!isNaN(colNum)) critVal = colNum;
    }
    if (critVal === null) critVal = 9.0;

    // 3. สอนจริง (null = ไม่ได้ระบุสอนจริงในประโยคสรุป เช่น หักจากยอดยกมาโดยตรง)
    let actualVal = null;
    const actualMatch = calcText.match(/สอนจริง\s*[=:]?\s*(\d+(?:\.\d+)?)/i);
    if (actualMatch) {
        actualVal = parseFloat(actualMatch[1]);
    }

    // 4. ยอดยกไปสุทธิ จากข้อความ "จึงทำให้มี..." โดยตรง
    let netDiff = null;
    const thereforeMatch = calcText.match(/จึงทำให้มี([^]+)$/);
    if (thereforeMatch) {
        const tail = thereforeMatch[1];
        if (/ไม่มีพันธกิจเกินหรือติดค้างยกไป/.test(tail)) {
            netDiff = 0.00;
        } else {
            // กรณีครูปฏิบัติการที่มีวงเล็บหน่วยกิต เช่น = +26.06 ชม. (13.03 นก.) หรือ = -8.27 ชม. (-4.14 นก.)
            const parenCreditMatch = tail.match(/\(([+-]?\s*\d+(?:\.\d+)?)\s*นก\.\)/);
            if (parenCreditMatch) {
                netDiff = parseFloat(parenCreditMatch[1].replace(/\s+/g, ""));
            } else {
                const eqMatch = tail.match(/=\s*([+-]?\s*\d+(?:\.\d+)?)/);
                if (eqMatch) {
                    const rawNet = parseFloat(eqMatch[1].replace(/\s+/g, ""));
                    netDiff = isLabInstructor ? parseFloat((rawNet / 2).toFixed(2)) : rawNet;
                }
            }
        }
    }

    // แปลงชั่วโมงเป็นหน่วยกิตสำหรับครูปฏิบัติการ (2 ชม. = 1 นก.)
    if (isLabInstructor) {
        carryVal = parseFloat((carryVal / 2).toFixed(2));
        critVal = parseFloat((critVal / 2).toFixed(2));
        if (actualVal !== null) actualVal = parseFloat((actualVal / 2).toFixed(2));
    }

    const effectiveActual = actualVal !== null ? actualVal : 0;
    if (netDiff === null || isNaN(netDiff)) {
        netDiff = parseFloat(((carryVal + effectiveActual) - critVal).toFixed(2));
    }

    return {
        carryOver: carryVal,
        actual: effectiveActual,
        hasActual: actualVal !== null,
        criteria: critVal,
        netDiff: netDiff,
        summaryRemark: summaryText
    };
}

// ============================================================================
// 2. DATA PROCESSING & VIEW SWITCHING
// ============================================================================
function processDataset(list) {
    const uniqueMap = new Map();
    const lecturerByNormName = new Map();

    list.forEach((item, idx) => {
        const cleanName = String(item.name || "").trim();
        const cleanDept = String(item.dept || "ไม่ระบุคณะ/สาขา").trim();
        if (!cleanName) return;

        // แยกอิสระตามคณะ/สาขา + ชื่ออาจารย์
        const key = `${cleanDept}::${cleanName}`;
        const netDiff = typeof item.netDiff === "number"
            ? item.netDiff
            : parseFloat(((item.carryOver + item.actual) - item.criteria).toFixed(2));

        let status = "MATCH";
        if (netDiff > 0.009) status = "OVER";
        else if (netDiff < -0.009) status = "UNDER";

        const normName = normalizePersonName(cleanName);
        const importedCourses = scheduleMap.get(normName) || item.courses || [];

        const record = {
            id: idx + 1,
            name: cleanName,
            normName: normName,
            dept: cleanDept,
            position: item.position || "อาจารย์ประจำ",
            carryOver: Number(item.carryOver || 0),
            actual: Number(item.actual || 0),
            hasActual: item.hasActual !== undefined ? Boolean(item.hasActual) : Number(item.actual || 0) > 0,
            criteria: Number(item.criteria || 0),
            netDiff: netDiff,
            status: status,
            rawRemark: item.rawRemark || "",
            courses: importedCourses
        };

        uniqueMap.set(key, record);
        lecturerByNormName.set(normName, record);
    });

    processedLecturerList = Array.from(uniqueMap.values());

    // Build flat course list for View 03
    const builtCourses = [];
    if (scheduleMap.size > 0) {
        scheduleMap.forEach((courses, normTeacher) => {
            const matchedLecturer = lecturerByNormName.get(normTeacher) || null;
            courses.forEach(c => {
                builtCourses.push({
                    code: c.code,
                    title: c.title,
                    section: c.section,
                    day: normalizeDayName(c.day),
                    time: c.time || "-",
                    room: c.room || "-",
                    credits: Number(c.credits || 0),
                    teacherDisplay: matchedLecturer ? matchedLecturer.name : (c.teacherRaw || normTeacher),
                    deptDisplay: matchedLecturer ? matchedLecturer.dept : (c.dept || "ไม่ระบุคณะ/สาขา"),
                    lecturerRef: matchedLecturer,
                    isAuditIssue: !matchedLecturer
                });
            });
        });
    } else {
        processedLecturerList.forEach(lec => {
            (lec.courses || []).forEach(c => {
                builtCourses.push({
                    code: c.code,
                    title: c.title,
                    section: c.section,
                    day: normalizeDayName(c.day),
                    time: c.time || "-",
                    room: c.room || "-",
                    credits: Number(c.credits || 0),
                    teacherDisplay: lec.name,
                    deptDisplay: lec.dept,
                    lecturerRef: lec,
                    isAuditIssue: false
                });
            });
        });
    }

    allCoursesList = builtCourses;

    populateDeptFilter(processedLecturerList);
    populateCourseFilters(allCoursesList);
    applyFilters();
    renderAnalyticsView(processedLecturerList);
    applyCourseFilters();
}

function switchView(viewName) {
    const views = ["overview", "analytics", "courses"];
    views.forEach(v => {
        const el = document.getElementById(`view-${v}`);
        if (!el) return;
        if (v === viewName) el.classList.remove("hidden");
        else el.classList.add("hidden");
    });

    if (viewName === "analytics") {
        renderAnalyticsView(processedLecturerList);
    } else if (viewName === "courses") {
        applyCourseFilters();
    }

    document.querySelectorAll(".nav-item").forEach(el => {
        const isTarget = el.getAttribute("data-view") === viewName;
        if (isTarget) {
            el.className = "nav-item active flex items-center gap-4 px-6 py-3.5 font-medium text-sm text-white bg-gradient-to-r from-spu-pink to-[#9f1239] border-l-4 border-white shadow-md transition-all";
        } else {
            el.className = "nav-item flex items-center gap-4 px-6 py-3.5 font-medium text-sm text-slate-400 hover:text-white hover:bg-white/5 transition-all border-l-4 border-transparent";
        }
    });

    document.querySelectorAll(".tab-switch-btn").forEach(btn => {
        const isTarget = btn.getAttribute("data-view") === viewName;
        if (isTarget) {
            btn.className = "tab-switch-btn active px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-white text-spu-navy shadow-2xs transition-all";
        } else {
            btn.className = "tab-switch-btn px-3.5 py-1.5 rounded-lg text-xs font-semibold text-slate-500 hover:text-slate-800 transition-all";
        }
    });
}

// ============================================================================
// 3. VIEW 01: OVERVIEW RENDERING
// ============================================================================
function populateDeptFilter(data) {
    const deptSelect = document.getElementById("filter-dept");
    if (!deptSelect) return;

    const currentVal = deptSelect.value;
    const depts = [...new Set(data.map(d => d.dept))];

    deptSelect.innerHTML = '<option value="ALL">ทุกคณะ / สาขาวิชา</option>';
    depts.forEach(dept => {
        const opt = document.createElement("option");
        opt.value = dept;
        opt.textContent = dept;
        deptSelect.appendChild(opt);
    });

    if (depts.includes(currentVal)) deptSelect.value = currentVal;
}

function applyFilters() {
    const deptVal = document.getElementById("filter-dept")?.value || "ALL";
    const statusVal = document.getElementById("filter-status")?.value || "ALL";
    const searchVal = (document.getElementById("filter-search")?.value || "").toLowerCase().trim();

    currentFilteredList = processedLecturerList.filter(row => {
        const matchDept = deptVal === "ALL" || row.dept === deptVal;
        let matchStatus = true;
        if (statusVal === "MATCH_OVER") matchStatus = row.netDiff >= -0.009;
        else if (statusVal === "UNDER") matchStatus = row.netDiff < -0.009;

        const matchSearch = !searchVal ||
            row.name.toLowerCase().includes(searchVal) ||
            row.dept.toLowerCase().includes(searchVal) ||
            (row.position || "").toLowerCase().includes(searchVal);

        return matchDept && matchStatus && matchSearch;
    });

    updateKPICards(currentFilteredList);
    renderTable(currentFilteredList);
}

function updateKPICards(data) {
    const total = data.length;
    const matchOrOverList = data.filter(d => d.netDiff >= -0.009);
    const underList = data.filter(d => d.netDiff < -0.009);

    const sumOver = matchOrOverList.reduce((acc, d) => acc + (d.netDiff > 0 ? d.netDiff : 0), 0);
    const sumUnder = underList.reduce((acc, d) => acc + d.netDiff, 0);

    document.getElementById("val-kpi-total").textContent = total;
    document.getElementById("val-kpi-match").textContent = matchOrOverList.length;
    document.getElementById("val-kpi-under").textContent = underList.length;

    const elSumOver = document.getElementById("val-sum-over");
    if (elSumOver) elSumOver.textContent = `${sumOver > 0 ? "+" : ""}${sumOver.toFixed(2)} นก.`;

    const elSumUnder = document.getElementById("val-sum-under");
    if (elSumUnder) elSumUnder.textContent = `${sumUnder.toFixed(2)} นก.`;
}

function renderTable(data) {
    const tbody = document.getElementById("table-body");
    if (!tbody) return;
    tbody.innerHTML = "";

    if (data.length === 0) {
        const isCompletelyEmpty = processedLecturerList.length === 0;
        tbody.innerHTML = isCompletelyEmpty
            ? `
                <tr>
                    <td colspan="5" class="py-12 px-6 text-center text-slate-500">
                        <div class="w-12 h-12 rounded-2xl bg-pink-50 text-spu-pink flex items-center justify-center mx-auto mb-3">
                            <i class="fa-solid fa-file-excel text-xl"></i>
                        </div>
                        <div class="font-bold text-slate-700 text-sm">ยังไม่มีข้อมูลในระบบ</div>
                        <div class="text-xs text-slate-400 mt-1">กรุณากดปุ่ม <strong>“นำเข้าพันธกิจ (.xlsx)”</strong> และ <strong>“นำเข้าตารางสอน (.xlsx)”</strong> ด้านบนเพื่อเริ่มต้นวิเคราะห์ข้อมูลจริง</div>
                    </td>
                </tr>
            `
            : `
                <tr>
                    <td colspan="5" class="py-10 px-6 text-center text-slate-400">
                        <i class="fa-solid fa-magnifying-glass text-2xl mb-2 block opacity-40"></i>
                        ไม่พบข้อมูลอาจารย์ที่ตรงกับเงื่อนไขการค้นหา
                    </td>
                </tr>
            `;
        return;
    }

    data.forEach((row, index) => {
        const isUnder = row.netDiff < -0.009;
        const isOver = row.netDiff > 0.009;

        let badgeHtml = "";
        let resultColor = "";
        let rowBg = "";

        if (isUnder) {
            badgeHtml = `<span class="inline-flex items-center px-3 py-1 rounded-lg text-xs font-semibold bg-rose-50 text-rose-600 border border-rose-200"><i class="fa-solid fa-xmark mr-1.5"></i> ขาดเกณฑ์</span>`;
            resultColor = "text-rose-600 border-rose-200 bg-rose-50";
            rowBg = "bg-rose-50/20";
        } else if (isOver) {
            badgeHtml = `<span class="inline-flex items-center px-3 py-1 rounded-lg text-xs font-semibold bg-emerald-50 text-emerald-600 border border-emerald-200"><i class="fa-solid fa-arrow-trend-up mr-1.5"></i> สอนเกินเกณฑ์</span>`;
            resultColor = "text-emerald-700 border-emerald-200 bg-emerald-50";
        } else {
            badgeHtml = `<span class="inline-flex items-center px-3 py-1 rounded-lg text-xs font-semibold bg-blue-50 text-blue-600 border border-blue-200"><i class="fa-solid fa-check mr-1.5"></i> ครบพอดีเกณฑ์</span>`;
            resultColor = "text-blue-700 border-blue-200 bg-blue-50";
        }

        // สร้างข้อความสรุปให้ตรงตามต้นฉบับ Excel โดยไม่แสดง "สอนจริง 0.00" หากไม่มีการระบุสอนจริง
        const summaryDisplay = row.rawRemark
            ? row.rawRemark
            : `ยกมา ${formatSigned(row.carryOver)} นก. · พันธกิจประจำ ${row.criteria.toFixed(2)} นก. · ยกไป ${formatSigned(row.netDiff)} นก.`;

        const tr = document.createElement("tr");
        tr.className = `hover:bg-slate-50 transition-colors cursor-pointer group ${rowBg}`;
        tr.innerHTML = `
            <td class="py-4 px-6 text-center text-slate-400 font-mono text-xs">${index + 1}</td>
            <td class="py-4 px-6">
                <div class="font-semibold text-slate-800 text-[15px] group-hover:text-spu-pink transition-colors">${row.name}</div>
                <div class="text-xs text-slate-500 mt-0.5"><i class="fa-regular fa-building mr-1 text-slate-400"></i>${row.dept}</div>
                <div class="text-[11px] text-slate-400 mt-0.5">${row.position}</div>
            </td>
            <td class="py-4 px-6 text-center">
                ${badgeHtml}
            </td>
            <td class="py-4 px-6">
                <div class="flex items-center justify-between gap-3 bg-slate-50/90 px-4 py-3 rounded-xl border border-slate-200/80">
                    <div class="text-[13px] text-slate-700 leading-relaxed font-medium">
                        ${summaryDisplay}
                    </div>
                    <div class="shrink-0 text-right">
                        <div class="text-[10px] text-slate-400 font-semibold mb-0.5">ยอดยกไปสุทธิ</div>
                        <span class="${resultColor} font-mono font-bold text-sm px-2.5 py-1 rounded-lg border inline-block">
                            ${formatSigned(row.netDiff)} นก.
                        </span>
                    </div>
                </div>
            </td>
            <td class="py-4 px-4 text-center print:hidden">
                <button type="button" class="w-8 h-8 rounded-lg bg-slate-100 group-hover:bg-spu-pink group-hover:text-white text-slate-500 transition-colors inline-flex items-center justify-center" title="ดูรายละเอียดรายวิชา">
                    <i class="fa-solid fa-chevron-right text-xs"></i>
                </button>
            </td>
        `;

        tr.addEventListener("click", () => openLecturerDrawer(row));
        tbody.appendChild(tr);
    });
}

// ============================================================================
// 4. VIEW 02: ANALYTICS & PRIORITY LISTS RENDERING
// ============================================================================
function renderAnalyticsView(data) {
    const deptStatsMap = new Map();
    data.forEach(row => {
        if (!deptStatsMap.has(row.dept)) {
            deptStatsMap.set(row.dept, {
                dept: row.dept,
                total: 0,
                matchOver: 0,
                under: 0,
                netCredits: 0
            });
        }
        const stat = deptStatsMap.get(row.dept);
        stat.total += 1;
        if (row.netDiff < -0.009) stat.under += 1;
        else stat.matchOver += 1;
        stat.netCredits = parseFloat((stat.netCredits + row.netDiff).toFixed(2));
    });

    const deptStats = Array.from(deptStatsMap.values()).sort((a, b) => a.netCredits - b.netCredits);

    const summaryBody = document.getElementById("faculty-summary-body");
    if (summaryBody) {
        summaryBody.innerHTML = "";
        deptStats.forEach(st => {
            const netClass = st.netCredits < -0.009 ? "text-rose-600 font-bold" : (st.netCredits > 0.009 ? "text-emerald-600 font-bold" : "text-slate-600 font-semibold");
            const tr = document.createElement("tr");
            tr.className = "hover:bg-slate-50 cursor-pointer transition-colors";
            tr.innerHTML = `
                <td class="py-3 px-3 font-medium text-slate-800 hover:text-spu-pink">${st.dept}</td>
                <td class="py-3 px-2 text-center font-semibold">${st.total}</td>
                <td class="py-3 px-2 text-center text-emerald-600 font-semibold">${st.matchOver}</td>
                <td class="py-3 px-2 text-center text-rose-600 font-semibold">${st.under}</td>
                <td class="py-3 px-3 text-right font-mono ${netClass}">${formatSigned(st.netCredits)}</td>
            `;
            tr.addEventListener("click", () => {
                const deptSelect = document.getElementById("filter-dept");
                if (deptSelect) deptSelect.value = st.dept;
                switchView("overview");
                applyFilters();
            });
            summaryBody.appendChild(tr);
        });
    }

    const canvas = document.getElementById("facultyNetChart");
    if (canvas && typeof Chart !== "undefined") {
        if (facultyChartInstance) {
            facultyChartInstance.destroy();
        }
        const labels = deptStats.map(d => d.dept.replace(/^คณะ[^\s·]+\s*·\s*/, ""));
        const fullLabels = deptStats.map(d => d.dept);
        const values = deptStats.map(d => d.netCredits);
        const bgColors = values.map(v => v < 0 ? "rgba(225, 29, 72, 0.85)" : "rgba(16, 185, 129, 0.85)");
        const borderColors = values.map(v => v < 0 ? "#e11d48" : "#10b981");

        facultyChartInstance = new Chart(canvas, {
            type: "bar",
            data: {
                labels: labels,
                datasets: [{
                    label: "ยอดพันธกิจสุทธิ (นก.)",
                    data: values,
                    backgroundColor: bgColors,
                    borderColor: borderColors,
                    borderWidth: 1,
                    borderRadius: 6,
                    barThickness: 24
                }]
            },
            options: {
                indexAxis: "y",
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            title: (items) => fullLabels[items[0].dataIndex],
                            label: (ctx) => ` ยอดสุทธิ: ${formatSigned(ctx.raw)} หน่วยกิต`
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { color: "#f1f5f9" },
                        ticks: { font: { family: "IBM Plex Sans Thai", size: 11 } }
                    },
                    y: {
                        grid: { display: false },
                        ticks: { font: { family: "IBM Plex Sans Thai", size: 12, weight: "600" } }
                    }
                },
                onClick: (e, elements) => {
                    if (elements.length > 0) {
                        const idx = elements[0].index;
                        const selectedDept = fullLabels[idx];
                        const deptSelect = document.getElementById("filter-dept");
                        if (deptSelect) deptSelect.value = selectedDept;
                        switchView("overview");
                        applyFilters();
                    }
                }
            }
        });
    }

    const underList = data.filter(d => d.netDiff < -0.009).sort((a, b) => a.netDiff - b.netDiff);
    const overList = data.filter(d => d.netDiff > 0.009).sort((a, b) => b.netDiff - a.netDiff);

    document.getElementById("badge-under-priority").textContent = `${underList.length} คน`;
    document.getElementById("badge-over-priority").textContent = `${overList.length} คน`;

    const underContainer = document.getElementById("list-top-underload");
    if (underContainer) {
        underContainer.innerHTML = underList.length === 0
            ? '<div class="p-8 text-center text-xs text-slate-400">ไม่มีอาจารย์ที่สอนขาดเกณฑ์</div>'
            : "";
        underList.forEach((item, i) => {
            const subInfo = item.hasActual
                ? `สอนจริง ${item.actual.toFixed(2)} / เกณฑ์ ${item.criteria.toFixed(2)} นก.`
                : `ยกมา ${formatSigned(item.carryOver)} / เกณฑ์ ${item.criteria.toFixed(2)} นก.`;
            const div = document.createElement("div");
            div.className = "px-6 py-3.5 flex items-center justify-between hover:bg-rose-50/30 cursor-pointer transition-colors";
            div.innerHTML = `
                <div class="flex items-center gap-3">
                    <span class="w-6 h-6 rounded-full bg-rose-100 text-rose-700 text-xs font-bold flex items-center justify-center shrink-0">${i + 1}</span>
                    <div>
                        <div class="text-sm font-semibold text-slate-800">${item.name}</div>
                        <div class="text-xs text-slate-500">${item.dept} · ${subInfo}</div>
                    </div>
                </div>
                <div class="text-right">
                    <span class="inline-block font-mono text-sm font-bold text-rose-600 bg-rose-50 border border-rose-200 px-2.5 py-0.5 rounded-lg">
                        ${formatSigned(item.netDiff)} นก.
                    </span>
                </div>
            `;
            div.addEventListener("click", () => openLecturerDrawer(item));
            underContainer.appendChild(div);
        });
    }

    const overContainer = document.getElementById("list-top-overload");
    if (overContainer) {
        overContainer.innerHTML = overList.length === 0
            ? '<div class="p-8 text-center text-xs text-slate-400">ไม่มีอาจารย์ที่สอนเกินเกณฑ์</div>'
            : "";
        overList.forEach((item, i) => {
            const subInfo = item.hasActual
                ? `ยกมา ${formatSigned(item.carryOver)} · สอนจริง ${item.actual.toFixed(2)} · เกณฑ์ ${item.criteria.toFixed(2)} นก.`
                : `ยกมา ${formatSigned(item.carryOver)} · พันธกิจประจำ ${item.criteria.toFixed(2)} นก.`;
            const div = document.createElement("div");
            div.className = "px-6 py-3.5 flex items-center justify-between hover:bg-emerald-50/30 cursor-pointer transition-colors";
            div.innerHTML = `
                <div class="flex items-center gap-3">
                    <span class="w-6 h-6 rounded-full bg-emerald-100 text-emerald-700 text-xs font-bold flex items-center justify-center shrink-0">${i + 1}</span>
                    <div>
                        <div class="text-sm font-semibold text-slate-800">${item.name}</div>
                        <div class="text-xs text-slate-500">${item.dept} · ${subInfo}</div>
                    </div>
                </div>
                <div class="text-right">
                    <span class="inline-block font-mono text-sm font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-lg">
                        ${formatSigned(item.netDiff)} นก.
                    </span>
                </div>
            `;
            div.addEventListener("click", () => openLecturerDrawer(item));
            overContainer.appendChild(div);
        });
    }
}

// ============================================================================
// 5. VIEW 03: EXCEL-STYLE COURSE & SECTION DIRECTORY RENDERING
// ============================================================================
function populateCourseFilters(courses) {
    const deptSelect = document.getElementById("filter-course-dept");
    const lecturerSelect = document.getElementById("filter-course-lecturer");
    if (!deptSelect || !lecturerSelect) return;

    const currentDept = deptSelect.value || "ALL";
    const depts = [...new Set(courses.map(c => c.deptDisplay))];

    deptSelect.innerHTML = '<option value="ALL">ทุกคณะ / สาขาวิชา</option>';
    depts.forEach(d => {
        const opt = document.createElement("option");
        opt.value = d;
        opt.textContent = d;
        deptSelect.appendChild(opt);
    });
    if (depts.includes(currentDept)) deptSelect.value = currentDept;

    updateCourseLecturerDropdown();
}

function updateCourseLecturerDropdown() {
    const deptSelect = document.getElementById("filter-course-dept");
    const lecturerSelect = document.getElementById("filter-course-lecturer");
    if (!deptSelect || !lecturerSelect) return;

    const selectedDept = deptSelect.value || "ALL";
    const currentLecturer = lecturerSelect.value || "ALL";

    const scopedCourses = selectedDept === "ALL"
        ? allCoursesList
        : allCoursesList.filter(c => c.deptDisplay === selectedDept);

    const teachers = [...new Set(scopedCourses.map(c => c.teacherDisplay))];

    lecturerSelect.innerHTML = '<option value="ALL">อาจารย์ผู้สอนทั้งหมด (' + teachers.length + ' ท่าน)</option>';
    teachers.forEach(t => {
        const opt = document.createElement("option");
        opt.value = t;
        opt.textContent = t;
        lecturerSelect.appendChild(opt);
    });

    if (teachers.includes(currentLecturer)) {
        lecturerSelect.value = currentLecturer;
    } else {
        lecturerSelect.value = "ALL";
    }
}

function switchCourseDisplayMode(mode) {
    const gridContainer = document.getElementById("timetable-grid-container");
    const excelContainer = document.getElementById("excel-table-container");
    const btnTimetable = document.getElementById("btn-mode-timetable");
    const btnExcel = document.getElementById("btn-mode-excel");

    if (!gridContainer || !excelContainer) return;

    if (mode === "timetable") {
        gridContainer.classList.remove("hidden");
        excelContainer.classList.add("hidden");
        if (btnTimetable) btnTimetable.className = "px-3.5 py-1.5 rounded-lg text-xs font-bold bg-spu-navy text-white shadow-2xs transition-all flex items-center gap-1.5";
        if (btnExcel) btnExcel.className = "px-3.5 py-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:text-slate-900 transition-all flex items-center gap-1.5";
    } else {
        gridContainer.classList.add("hidden");
        excelContainer.classList.remove("hidden");
        if (btnExcel) btnExcel.className = "px-3.5 py-1.5 rounded-lg text-xs font-bold bg-spu-navy text-white shadow-2xs transition-all flex items-center gap-1.5";
        if (btnTimetable) btnTimetable.className = "px-3.5 py-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:text-slate-900 transition-all flex items-center gap-1.5";
    }
}

function applyCourseFilters() {
    const deptFilter = document.getElementById("filter-course-dept")?.value || "ALL";
    const lecturerFilter = document.getElementById("filter-course-lecturer")?.value || "ALL";
    const dayFilter = document.getElementById("filter-course-day")?.value || "ALL";
    const auditFilter = document.getElementById("filter-course-audit")?.value || "ALL";
    const searchVal = (document.getElementById("filter-course-search")?.value || "").toLowerCase().trim();

    filteredCoursesList = allCoursesList.filter(c => {
        const matchDept = deptFilter === "ALL" || c.deptDisplay === deptFilter;
        const matchLecturer = lecturerFilter === "ALL" || c.teacherDisplay === lecturerFilter;
        const matchDay = dayFilter === "ALL" || c.day === dayFilter;

        let matchAudit = true;
        if (auditFilter === "LINKED") matchAudit = !c.isAuditIssue;
        else if (auditFilter === "AUDIT") matchAudit = c.isAuditIssue;

        const matchSearch = !searchVal ||
            c.code.toLowerCase().includes(searchVal) ||
            c.title.toLowerCase().includes(searchVal) ||
            c.teacherDisplay.toLowerCase().includes(searchVal) ||
            c.deptDisplay.toLowerCase().includes(searchVal) ||
            c.section.toLowerCase().includes(searchVal) ||
            c.day.toLowerCase().includes(searchVal) ||
            c.room.toLowerCase().includes(searchVal);

        return matchDept && matchLecturer && matchDay && matchAudit && matchSearch;
    });

    updateCourseKPICards(filteredCoursesList);
    renderWeeklyTimetable(filteredCoursesList);
    renderCourseTableExcelStyle(filteredCoursesList);
}

function renderWeeklyTimetable(courses) {
    const tbody = document.getElementById("weekly-timetable-body");
    if (!tbody) return;
    tbody.innerHTML = "";

    const DAY_CONFIG = [
        { key: "จันทร์", label: "วันจันทร์", badgeBg: "bg-amber-400 text-slate-900", rowTint: "bg-amber-50/30" },
        { key: "อังคาร", label: "วันอังคาร", badgeBg: "bg-pink-500 text-white", rowTint: "bg-pink-50/30" },
        { key: "พุธ", label: "วันพุธ", badgeBg: "bg-emerald-600 text-white", rowTint: "bg-emerald-50/30" },
        { key: "พฤหัสบดี", label: "วันพฤหัสบดี", badgeBg: "bg-orange-500 text-white", rowTint: "bg-orange-50/30" },
        { key: "ศุกร์", label: "วันศุกร์", badgeBg: "bg-sky-500 text-white", rowTint: "bg-sky-50/30" },
        { key: "เสาร์", label: "วันเสาร์", badgeBg: "bg-purple-600 text-white", rowTint: "bg-purple-50/30" },
        { key: "อาทิตย์", label: "วันอาทิตย์", badgeBg: "bg-rose-600 text-white", rowTint: "bg-rose-50/30" },
        { key: "ไม่ระบุวัน", label: "ไม่ระบุวันเรียน", badgeBg: "bg-slate-500 text-white", rowTint: "bg-slate-50/50" }
    ];

    const dayFilter = document.getElementById("filter-course-day")?.value || "ALL";

    DAY_CONFIG.forEach(dayObj => {
        const dayCourses = courses
            .filter(c => c.day === dayObj.key)
            .sort((a, b) => String(a.time).localeCompare(String(b.time)));

        if (dayObj.key === "ไม่ระบุวัน" && dayCourses.length === 0) return;
        if (dayFilter !== "ALL" && dayFilter !== dayObj.key) return;

        const tr = document.createElement("tr");
        tr.className = `${dayObj.rowTint} hover:bg-slate-50/80 transition-colors`;

        let cardsHtml = "";
        if (dayCourses.length === 0) {
            cardsHtml = `<div class="text-slate-400 italic py-2 text-xs">— ไม่มีรายวิชาเรียนใน${dayObj.label} —</div>`;
        } else {
            cardsHtml = `<div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">`;
            dayCourses.forEach((c, idx) => {
                const isLinked = Boolean(c.lecturerRef);
                cardsHtml += `
                    <div class="bg-white rounded-xl border ${isLinked ? "border-slate-200 hover:border-spu-teal" : "border-amber-300 bg-amber-50/30"} p-3 shadow-2xs transition-all flex flex-col justify-between">
                        <div>
                            <div class="flex items-center justify-between gap-2 mb-1.5">
                                <span class="inline-flex items-center gap-1 font-mono text-[11px] font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                                    <i class="fa-regular fa-clock text-spu-teal"></i> ${c.time !== "-" ? c.time : "ไม่ระบุเวลา"}
                                </span>
                                <span class="font-mono text-[11px] font-bold text-spu-navy bg-blue-50 border border-blue-200 px-2 py-0.5 rounded">
                                    Sec ${c.section}
                                </span>
                            </div>
                            <div class="font-mono font-bold text-sm text-spu-navy mt-1">
                                ${c.code} <span class="font-sans font-semibold text-slate-800">${c.title}</span>
                            </div>
                        </div>
                        <div class="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-600">
                            <span class="truncate max-w-[65%] font-medium ${isLinked ? "text-spu-pink cursor-pointer hover:underline timetable-teacher-link" : ""}" data-idx="${idx}">
                                <i class="fa-solid fa-user-tie mr-1 text-slate-400"></i>${c.teacherDisplay}
                            </span>
                            <span class="font-mono font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded">
                                <i class="fa-solid fa-door-open mr-1 text-slate-400"></i>${c.room !== "-" ? c.room : "ไม่ระบุห้อง"}
                            </span>
                        </div>
                    </div>
                `;
            });
            cardsHtml += `</div>`;
        }

        const totalDayCredits = dayCourses.reduce((sum, c) => sum + c.credits, 0);

        tr.innerHTML = `
            <td class="py-4 px-3 text-center align-top border-r border-slate-300 bg-white">
                <span class="inline-block w-full py-1.5 px-2 rounded-lg font-bold text-xs shadow-2xs ${dayObj.badgeBg}">
                    ${dayObj.label}
                </span>
            </td>
            <td class="py-3.5 px-4 align-top border-r border-slate-300">
                ${cardsHtml}
            </td>
            <td class="py-4 px-3 text-center align-top bg-white">
                <div class="font-bold text-sm text-slate-800">${dayCourses.length} วิชา</div>
                <div class="text-[11px] font-mono text-slate-500 mt-0.5">${totalDayCredits.toFixed(2)} นก.</div>
            </td>
        `;

        tr.querySelectorAll(".timetable-teacher-link").forEach(el => {
            const idx = Number(el.getAttribute("data-idx"));
            const targetCourse = dayCourses[idx];
            if (targetCourse && targetCourse.lecturerRef) {
                el.addEventListener("click", () => openLecturerDrawer(targetCourse.lecturerRef));
            }
        });

        tbody.appendChild(tr);
    });
}

function updateCourseKPICards(courses) {
    const uniqueCodes = new Set(courses.map(c => c.code.toUpperCase()));
    const totalSections = courses.length;
    const totalCredits = courses.reduce((acc, c) => acc + c.credits, 0);
    const auditCount = courses.filter(c => c.isAuditIssue).length;

    document.getElementById("val-course-unique").textContent = uniqueCodes.size;
    document.getElementById("val-course-sections").textContent = totalSections;
    document.getElementById("val-course-credits").textContent = `รวม ${totalCredits.toFixed(2)} นก.`;
    document.getElementById("val-course-audit").textContent = auditCount;
}

function renderCourseTableExcelStyle(courses) {
    const tbody = document.getElementById("course-table-body");
    if (!tbody) return;
    tbody.innerHTML = "";

    if (courses.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="11" class="py-10 px-6 text-center text-slate-400">
                    <i class="fa-solid fa-table text-2xl mb-2 block opacity-40"></i>
                    ไม่พบข้อมูลรายวิชาในคณะหรืออาจารย์ที่เลือก
                </td>
            </tr>
        `;
        return;
    }

    const groupsMap = new Map();
    courses.forEach(c => {
        const groupKey = `${c.deptDisplay}:::${c.teacherDisplay}`;
        if (!groupsMap.has(groupKey)) {
            groupsMap.set(groupKey, {
                dept: c.deptDisplay,
                teacher: c.teacherDisplay,
                lecturerRef: c.lecturerRef,
                items: []
            });
        }
        groupsMap.get(groupKey).items.push(c);
    });

    let globalRowIndex = 1;
    let grandTotalCredits = 0;

    groupsMap.forEach((group) => {
        const rowSpanCount = group.items.length;
        const isLinked = Boolean(group.lecturerRef);
        let teacherSubtotal = 0;

        group.items.forEach((c, idxInGroup) => {
            teacherSubtotal += c.credits;
            grandTotalCredits += c.credits;

            const tr = document.createElement("tr");
            tr.className = `hover:bg-blue-50/40 transition-colors ${c.isAuditIssue ? "bg-amber-50/40" : ""}`;

            let mergedColsHtml = "";
            if (idxInGroup === 0) {
                mergedColsHtml = `
                    <td rowspan="${rowSpanCount}" class="py-2.5 px-3 align-top bg-slate-50/60 border-r border-slate-300 font-medium text-slate-700">
                        ${group.dept}
                    </td>
                    <td rowspan="${rowSpanCount}" class="py-2.5 px-3 align-top bg-slate-50/60 border-r border-slate-300">
                        <div class="${isLinked ? "text-spu-pink hover:underline cursor-pointer font-bold" : "text-slate-800 font-bold"} teacher-cell-link">
                            ${group.teacher}
                        </div>
                        <div class="text-[11px] text-slate-500 mt-1">
                            จำนวน ${rowSpanCount} กลุ่มเรียน
                        </div>
                    </td>
                `;
            }

            const statusBadge = isLinked
                ? `<span class="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200"><i class="fa-solid fa-check mr-1 text-[9px]"></i> เชื่อมโยงแล้ว</span>`
                : `<span class="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200"><i class="fa-solid fa-triangle-exclamation mr-1 text-[9px]"></i> รอตรวจสอบ</span>`;

            tr.innerHTML = `
                <td class="py-2.5 px-3 text-center text-slate-500 font-mono border-r border-slate-200">${globalRowIndex++}</td>
                ${mergedColsHtml}
                <td class="py-2.5 px-3 text-center font-mono font-bold text-spu-navy border-r border-slate-200">${c.code}</td>
                <td class="py-2.5 px-3 text-slate-800 border-r border-slate-200">${c.title}</td>
                <td class="py-2.5 px-2 text-center font-mono font-semibold text-slate-700 border-r border-slate-200">${c.section}</td>
                <td class="py-2.5 px-2 text-center font-semibold text-slate-700 border-r border-slate-200">${c.day}</td>
                <td class="py-2.5 px-2 text-center font-mono text-slate-600 border-r border-slate-200">${c.time}</td>
                <td class="py-2.5 px-2 text-center font-mono text-slate-600 border-r border-slate-200">${c.room}</td>
                <td class="py-2.5 px-3 text-right font-mono font-semibold text-slate-900 border-r border-slate-200">${c.credits.toFixed(2)}</td>
                <td class="py-2.5 px-3 text-center">${statusBadge}</td>
            `;

            if (idxInGroup === 0 && isLinked) {
                tr.querySelector(".teacher-cell-link")?.addEventListener("click", () => {
                    openLecturerDrawer(group.lecturerRef);
                });
            }

            tbody.appendChild(tr);
        });

        const subTr = document.createElement("tr");
        subTr.className = "bg-slate-100/90 border-t border-b-2 border-slate-300 font-semibold text-slate-700";

        let missionCompareHtml = "";
        if (group.lecturerRef) {
            const criteria = group.lecturerRef.criteria;
            const diff = parseFloat((teacherSubtotal - criteria).toFixed(2));
            const diffText = diff >= 0 ? `เกินเกณฑ์ +${diff.toFixed(2)}` : `ต่ำกว่าเกณฑ์ ${diff.toFixed(2)}`;
            const diffColor = diff >= 0 ? "text-emerald-700" : "text-rose-600";
            missionCompareHtml = `<span class="text-[11px] font-normal text-slate-500 mr-2">(เกณฑ์ ${criteria.toFixed(2)} นก. · <strong class="${diffColor}">${diffText}</strong>)</span>`;
        }

        subTr.innerHTML = `
            <td colspan="9" class="py-2 px-4 text-right border-r border-slate-300">
                ${missionCompareHtml}
                รวมหน่วยกิตสอนของ <span class="text-spu-navy font-bold">${group.teacher}</span>
            </td>
            <td class="py-2 px-3 text-right font-mono font-bold text-sm text-spu-navy bg-amber-50/80 border-r border-slate-300">
                ${teacherSubtotal.toFixed(2)}
            </td>
            <td class="py-2 px-3 text-center text-[11px] text-slate-500">
                ${group.items.length} รายการ
            </td>
        `;
        tbody.appendChild(subTr);
    });

    const grandTr = document.createElement("tr");
    grandTr.className = "bg-[#1e2542] text-white font-bold";
    grandTr.innerHTML = `
        <td colspan="9" class="py-3 px-4 text-right border-r border-slate-600">
            รวมหน่วยกิตทั้งหมดตามเงื่อนไขที่เลือก (${groupsMap.size} อาจารย์ · ${courses.length} กลุ่มเรียน)
        </td>
        <td class="py-3 px-3 text-right font-mono text-sm text-amber-300 border-r border-slate-600">
            ${grandTotalCredits.toFixed(2)}
        </td>
        <td class="py-3 px-3 text-center text-[11px] text-slate-300">
            หน่วยกิตรวม
        </td>
    `;
    tbody.appendChild(grandTr);
}

// ============================================================================
// 6. SLIDE-OVER DRAWER (รายละเอียดรายบุคคลและรายวิชาสอน)
// ============================================================================
function openLecturerDrawer(row) {
    const backdrop = document.getElementById("lecturer-drawer-backdrop");
    const drawer = document.getElementById("lecturer-drawer");
    if (!backdrop || !drawer) return;

    document.getElementById("drawer-lecturer-name").textContent = row.name;
    document.getElementById("drawer-lecturer-dept").textContent = `${row.dept} (${row.position || "อาจารย์ประจำ"})`;

    document.getElementById("drawer-val-carry").textContent = formatSigned(row.carryOver);
    document.getElementById("drawer-val-actual").textContent = row.hasActual ? row.actual.toFixed(2) : "-";
    document.getElementById("drawer-val-criteria").textContent = row.criteria.toFixed(2);
    document.getElementById("drawer-val-net").textContent = `${formatSigned(row.netDiff)} นก.`;

    const statusCard = document.getElementById("drawer-status-card");
    const netBox = document.getElementById("drawer-box-net");

    if (row.netDiff < -0.009) {
        statusCard.className = "p-4 rounded-xl border border-rose-200 bg-rose-50/70 flex items-center justify-between";
        statusCard.innerHTML = `
            <div class="flex items-center gap-3">
                <i class="fa-solid fa-triangle-exclamation text-rose-600 text-xl"></i>
                <div>
                    <div class="text-sm font-bold text-rose-800">สถานะ: สอนไม่ครบพันธกิจ (ขาดเกณฑ์)</div>
                    <div class="text-xs text-rose-600">ต้องจัดสรรภาระงานเพิ่มอีก ${Math.abs(row.netDiff).toFixed(2)} หน่วยกิต</div>
                </div>
            </div>
        `;
        netBox.className = "p-3 rounded-xl border border-rose-200 bg-rose-50 text-rose-700";
    } else if (row.netDiff > 0.009) {
        statusCard.className = "p-4 rounded-xl border border-emerald-200 bg-emerald-50/70 flex items-center justify-between";
        statusCard.innerHTML = `
            <div class="flex items-center gap-3">
                <i class="fa-solid fa-circle-check text-emerald-600 text-xl"></i>
                <div>
                    <div class="text-sm font-bold text-emerald-800">สถานะ: สอนเกินพันธกิจ (Overload)</div>
                    <div class="text-xs text-emerald-700">มียอดพันธกิจเกินสะสมยกไป +${row.netDiff.toFixed(2)} หน่วยกิต</div>
                </div>
            </div>
        `;
        netBox.className = "p-3 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-700";
    } else {
        statusCard.className = "p-4 rounded-xl border border-blue-200 bg-blue-50/70 flex items-center justify-between";
        statusCard.innerHTML = `
            <div class="flex items-center gap-3">
                <i class="fa-solid fa-check-double text-blue-600 text-xl"></i>
                <div>
                    <div class="text-sm font-bold text-blue-800">สถานะ: สอนครบพอดีเกณฑ์</div>
                    <div class="text-xs text-blue-600">ภาระงานสอนเป็นไปตามเกณฑ์ที่กำหนดพอดี</div>
                </div>
            </div>
        `;
        netBox.className = "p-3 rounded-xl border border-blue-200 bg-blue-50 text-blue-700";
    }

    document.getElementById("drawer-raw-remark").textContent = row.rawRemark || "ไม่มีข้อความหมายเหตุเพิ่มเติม";

    const courses = row.courses || [];
    document.getElementById("drawer-course-count").textContent = `${courses.length} รายวิชา`;
    const coursesBody = document.getElementById("drawer-courses-body");
    coursesBody.innerHTML = "";

    if (courses.length === 0) {
        coursesBody.innerHTML = `
            <tr>
                <td colspan="5" class="py-6 px-4 text-center text-slate-400">
                    ยังไม่มีข้อมูลรายวิชาสอน (สามารถกดปุ่ม “นำเข้าตารางสอน” ด้านบนเพื่อแสดงรายวิชา)
                </td>
            </tr>
        `;
    } else {
        courses.forEach(c => {
            const dayText = c.day ? normalizeDayName(c.day) : "-";
            const timeText = c.time && c.time !== "-" ? `<div class="text-[10px] text-slate-400 font-mono">${c.time}</div>` : "";
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td class="py-2.5 px-3 font-mono font-semibold text-spu-navy">${c.code || "-"}</td>
                <td class="py-2.5 px-3 text-slate-700">${c.title || "-"}</td>
                <td class="py-2.5 px-2 text-center text-slate-700 font-medium">${dayText}${timeText}</td>
                <td class="py-2.5 px-2 text-center font-mono text-slate-500">${c.section || "-"}</td>
                <td class="py-2.5 px-3 text-right font-mono font-semibold text-slate-800">${Number(c.credits || 0).toFixed(2)}</td>
            `;
            coursesBody.appendChild(tr);
        });
    }

    backdrop.classList.remove("hidden");
    requestAnimationFrame(() => {
        drawer.classList.remove("translate-x-full");
    });
}

function closeLecturerDrawer() {
    const backdrop = document.getElementById("lecturer-drawer-backdrop");
    const drawer = document.getElementById("lecturer-drawer");
    if (!backdrop || !drawer) return;

    drawer.classList.add("translate-x-full");
    setTimeout(() => {
        backdrop.classList.add("hidden");
    }, 280);
}

// ============================================================================
// 7. EXCEL IMPORTS & EXPORTS (รองรับทั้งไฟล์จริง SPU และตารางมาตรฐาน)
// ============================================================================
function handleMissionExcelUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: "array" });
            const extractedRows = [];

            // กรองเฉพาะชีตหลัก (ข้ามชีตสำรอง/ชีตเก่าเช่น "(3)", "Sheet1", "อ.พิเศษ")
            const validSheets = workbook.SheetNames.filter(name => {
                if (/^(sheet\d+|สรุป|total|summary|รายวิชา)/i.test(name.trim())) return false;
                if (/\(\d+\)|พิเศษ|เก่า|old|copy/i.test(name)) return false;
                return true;
            });

            validSheets.forEach(sheetName => {
                const worksheet = workbook.Sheets[sheetName];
                const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });
                if (!rows || rows.length < 4) return;

                // ตรวจสอบว่าเป็นชีตสรุปพันธกิจรายบุคคลหรือไม่ (ต้องมีคำว่า "ลำดับ" และ "ชื่อ")
                let headerIdx = -1;
                let colNo = -1;
                let colName = -1;
                let colPos = -1;
                let colCrit = -1;
                let colCarry = -1;
                let colCourse = -1;
                let colCreditStr = -1;
                let colSec = -1;
                let colDay = -1;
                let colTime = -1;
                let colRoom = -1;
                let colRemark = -1;

                for (let r = 0; r < Math.min(10, rows.length); r++) {
                    const rowStrs = rows[r].map(c => String(c).replace(/\s+/g, " ").trim());
                    const foundName = rowStrs.findIndex(c => /ชื่อ\s*-\s*สกุล|ชื่อ.*สกุล|ชื่อ.*กสุล/i.test(c));
                    if (foundName !== -1) {
                        headerIdx = r;
                        colNo = rowStrs.findIndex(c => /ลำดับ/i.test(c));
                        if (colNo === -1) colNo = 0;
                        colName = foundName;
                        colPos = rowStrs.findIndex(c => /ตำแหน่ง/i.test(c));
                        colCrit = rowStrs.findIndex(c => /พันธกิจตามเกณฑ์/i.test(c));
                        colCarry = rowStrs.findIndex(c => /ขาด\/เกินยกมา|ยกมา/i.test(c));
                        colRemark = rowStrs.findIndex(c => /หมายเหตุ/i.test(c));

                        // แถวหัวตารางย่อย (r + 1)
                        const subRow = (r + 1 < rows.length) ? rows[r + 1].map(c => String(c).replace(/\s+/g, " ").trim()) : [];
                        colCourse = subRow.findIndex(c => /^วิชา$/i.test(c));
                        colCreditStr = subRow.findIndex(c => /^หน่วยกิต$/i.test(c));
                        colSec = subRow.findIndex(c => /^กลุ่มเรียน$/i.test(c));
                        colDay = subRow.findIndex(c => /^วัน$/i.test(c));
                        colTime = subRow.findIndex(c => /^เวลา$/i.test(c));
                        colRoom = subRow.findIndex(c => /^ห้อง$/i.test(c));
                        break;
                    }
                }

                if (headerIdx === -1 || colName === -1) return;

                // ดึงชื่อคณะและสาขาวิชาแบบแยกชัดเจน
                const headerLines = rows.slice(0, headerIdx).map(r => r.filter(Boolean).join(" "));
                const deptLabel = extractFacultyAndDept(headerLines, sheetName);

                let inRegularSection = true;
                let currentBlock = null;

                const finalizeBlock = (blk) => {
                    if (!blk || !blk.name) return;
                    const metrics = parseMissionBlock(blk.remarks, blk.critRaw, blk.carryRaw, blk.posRaw);
                    extractedRows.push({
                        name: blk.name,
                        dept: deptLabel,
                        position: blk.posRaw || "อาจารย์ประจำ",
                        carryOver: metrics.carryOver,
                        actual: metrics.actual,
                        hasActual: metrics.hasActual,
                        criteria: metrics.criteria,
                        netDiff: metrics.netDiff,
                        rawRemark: metrics.summaryRemark,
                        courses: blk.courses
                    });
                };

                for (let r = headerIdx + 2; r < rows.length; r++) {
                    const row = rows[r];
                    const c0 = String(row[colNo] || "").replace(/\s+/g, " ").trim();
                    const cName = String(row[colName] || "").replace(/\s+/g, " ").trim();

                    // หยุดเมื่อเข้าสู่ส่วน "อาจารย์พิเศษ" หรือ "สรุป"
                    if (/อาจารย์พิเศษ|สรุป\s*การเสนอประมาณการ/i.test(c0) || /สรุป\s*การเสนอประมาณการ/i.test(cName)) {
                        inRegularSection = false;
                        break;
                    }
                    if (!inRegularSection) continue;

                    // เริ่มบล็อกอาจารย์ประจำคนใหม่เมื่อคอลัมน์ลำดับเป็นตัวเลข และมีชื่อ
                    if (/^\d+$/.test(c0) && cName) {
                        finalizeBlock(currentBlock);
                        currentBlock = {
                            name: cName,
                            posRaw: colPos !== -1 ? String(row[colPos] || "").replace(/\s+/g, " ").trim() : "",
                            critRaw: colCrit !== -1 ? String(row[colCrit] || "").replace(/\s+/g, " ").trim() : "",
                            carryRaw: colCarry !== -1 ? String(row[colCarry] || "").replace(/\s+/g, " ").trim() : "",
                            remarks: [],
                            courses: []
                        };
                    }

                    if (!currentBlock) continue;

                    // เก็บหมายเหตุทุกแถวของอาจารย์คนนั้น
                    if (colRemark !== -1 && row[colRemark]) {
                        const rem = String(row[colRemark]).replace(/\s+/g, " ").trim();
                        if (rem) currentBlock.remarks.push(rem);
                    }

                    // เก็บรายวิชาที่แสดงในตารางพันธกิจไว้เป็นข้อมูลสำรองกรณีอัปโหลดไฟล์พันธกิจไฟล์เดียว
                    if (colCourse !== -1 && row[colCourse]) {
                        const rawCode = String(row[colCourse]).replace(/\s+/g, " ").trim();
                        const rawCredStr = colCreditStr !== -1 ? String(row[colCreditStr] || "").trim() : "";
                        const credNumMatch = rawCredStr.match(/^(\d+(?:\.\d+)?)/);
                        const credVal = credNumMatch ? parseFloat(credNumMatch[1]) : 0;

                        if (rawCode) {
                            currentBlock.courses.push({
                                code: rawCode,
                                title: rawCredStr ? `หน่วยกิต ${rawCredStr}` : "-",
                                section: colSec !== -1 ? (String(row[colSec] || "").replace(/\s+/g, " ").trim() || "-") : "-",
                                day: colDay !== -1 ? normalizeDayName(row[colDay]) : "ไม่ระบุวัน",
                                time: colTime !== -1 ? formatTimeRange(String(row[colTime] || "").split("\n")[0]) : "-",
                                room: colRoom !== -1 ? (String(row[colRoom] || "").replace(/\s+/g, " ").trim() || "-") : "-",
                                credits: credVal
                            });
                        }
                    }
                }

                finalizeBlock(currentBlock);
            });

            if (extractedRows.length > 0) {
                rawLecturerList = extractedRows;
                processDataset(rawLecturerList);

                const bannerBadge = document.getElementById("status-banner-badge");
                if (bannerBadge) {
                    bannerBadge.className = "bg-emerald-50 border border-emerald-300 text-emerald-800 text-xs font-semibold px-3.5 py-1.5 rounded-lg whitespace-nowrap";
                    bannerBadge.textContent = scheduleMap.size > 0
                        ? `สถานะ: ผูกพันธกิจ (${extractedRows.length} คน) และตารางสอน (${allCoursesList.length} รายวิชา) สำเร็จ`
                        : `สถานะ: นำเข้าพันธกิจสำเร็จ (${extractedRows.length} รายชื่อ · แยก ${new Set(extractedRows.map(r => r.dept)).size} สาขา)`;
                }
            } else {
                alert("ไม่พบข้อมูลอาจารย์ประจำในไฟล์พันธกิจ กรุณาตรวจสอบว่าไฟล์มีคอลัมน์ 'ลำดับ' และ 'ชื่อ - สกุล'");
            }
        } catch (err) {
            console.error(err);
            alert("เกิดข้อผิดพลาดในการอ่านไฟล์พันธกิจ: " + err.message);
        }
        event.target.value = "";
    };
    reader.readAsArrayBuffer(file);
}

function handleScheduleExcelUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: "array" });
            const newScheduleMap = new Map();
            let courseCount = 0;

            // กรองเฉพาะชีตหลัก (ข้ามชีตสำรองที่มีวงเล็บหรือชีตสรุปเกิน 5 วิชา)
            const validSheets = workbook.SheetNames.filter(name => {
                if (/เกิน\s*5\s*วิชา|สรุป|summary|pivot|\(2\)|\(3\)/i.test(name)) return false;
                return true;
            });

            validSheets.forEach(sheetName => {
                const worksheet = workbook.Sheets[sheetName];
                const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });
                if (!rows || rows.length === 0) return;

                // ตรวจสอบว่าเป็นฟอร์ม ตส.-03 (ตารางสอนอาจารย์รายบุคคล) หรือไม่
                const isTS03Format = rows.slice(0, 20).some(r =>
                    r.some(cell => /ตารางสอนอาจารย์|FM\s*ตส\.-03/i.test(String(cell)))
                );

                if (isTS03Format) {
                    // อ่านบล็อก FM ตส.-03 ทีละอาจารย์ในชีต
                    const blockStarts = [];
                    for (let r = 0; r < rows.length; r++) {
                        if (rows[r].some(cell => /ตารางสอนอาจารย์/i.test(String(cell)))) {
                            blockStarts.push(r);
                        }
                    }

                    blockStarts.forEach((startRow, bIdx) => {
                        const endRow = bIdx + 1 < blockStarts.length ? blockStarts[bIdx + 1] : rows.length;
                        const headerRow = rows[startRow] || [];
                        const deptRow = rows[startRow + 1] || [];

                        // หาชื่ออาจารย์ในแถวเดียวกับ "ตารางสอนอาจารย์"
                        let teacherRaw = "";
                        for (let c = 0; c < headerRow.length; c++) {
                            const val = String(headerRow[c] || "").replace(/\s+/g, " ").trim();
                            if (val && !/ตารางสอนอาจารย์|ตำแหน่ง/i.test(val)) {
                                teacherRaw = val;
                                break;
                            }
                        }
                        if (!teacherRaw) return;

                        // แยกคณะและสาขาวิชาจากแถวถัดไป (startRow + 1)
                        const deptParts = deptRow
                            .map(c => String(c || "").replace(/\s+/g, " ").trim())
                            .filter(v => v && !/ภาคเรียนที่/i.test(v));
                        const deptLabel = deptParts.length >= 2
                            ? `${deptParts[0]} · ${deptParts[1]}`
                            : (deptParts[0] || sheetName.trim());

                        // 1. สร้างพจนานุกรมชื่อวิชา + หน่วยกิต จากส่วนบนของฟอร์ม (ระหว่าง startRow+3 ถึงก่อน "วัน/เวลา")
                        const courseMetaMap = new Map();
                        let gridStartRow = endRow;

                        for (let r = startRow + 2; r < endRow; r++) {
                            const rStr = rows[r].join(" ");
                            if (/วัน\/เวลา/.test(rStr)) {
                                gridStartRow = r;
                                break;
                            }
                            for (let c = 0; c < rows[r].length; c++) {
                                const cellTxt = String(rows[r][c] || "").replace(/\s+/g, " ").trim();
                                // จับรูปแบบ: "CEG66168 การจัดการโครงการก่อสร้าง 3(3-0-9)" หรือ "EEG450/EEG45567 ชื่อวิชา 3(3-0-6)"
                                const m = cellTxt.match(/^([A-Z]{2,4}\d{3,5}(?:\s*\/\s*[A-Z]{2,4}\d{3,5})*)\s+(.+?)\s+(\d+(?:\.\d+)?)\s*\(\d+-\d+-\d+\)/i);
                                if (m) {
                                    const fullCode = m[1].replace(/\s+/g, "");
                                    const title = m[2].trim();
                                    const credits = parseFloat(m[3]);
                                    courseMetaMap.set(fullCode, { title, credits });
                                    // เก็บรหัสย่อยตัวแรกไว้เผื่อในตารางกริดเขียนแค่รหัสหลักตัวเดียว
                                    const primaryCode = fullCode.split("/")[0];
                                    if (!courseMetaMap.has(primaryCode)) {
                                        courseMetaMap.set(primaryCode, { title, credits });
                                    }
                                }
                            }
                        }

                        // 2. อ่านตารางกริดวัน-เวลา (M, T, W, H, F, S, U)
                        const normTeacher = normalizePersonName(teacherRaw);
                        if (!newScheduleMap.has(normTeacher)) {
                            newScheduleMap.set(normTeacher, []);
                        }

                        const dayLetters = new Set(["M", "T", "W", "H", "F", "S", "U"]);
                        for (let r = gridStartRow; r < endRow; r++) {
                            const dayCell = String(rows[r][0] || "").trim().toUpperCase();
                            if (!dayLetters.has(dayCell)) continue;

                            const dayName = normalizeDayName(dayCell);
                            const rowTop = rows[r] || [];
                            const rowBottom = (r + 1 < endRow) ? (rows[r + 1] || []) : [];

                            // สแกนหาช่องรหัสวิชาในแถววันนั้น (ข้ามคอลัมน์สรุปยอดด้านขวาสุด เช่น ยกมา/ใช้/เบิก)
                            for (let c = 1; c < Math.min(rowTop.length, 10); c++) {
                                const topTxt = String(rowTop[c] || "").replace(/\s+/g, " ").trim();
                                if (!topTxt || /^(วันหยุด|\(OH\)|ยกมา|ใช้|เบิก)$/i.test(topTxt)) continue;

                                const codeMatch = topTxt.match(/^([A-Z]{2,4}\d{3,5}(?:\s*\/\s*[A-Z]{2,4}\d{3,5})*)/i);
                                if (!codeMatch) continue;

                                const codeClean = codeMatch[1].replace(/\s+/g, "");
                                const secMatch = topTxt.match(/\(([^)]+)\)/);
                                const sectionStr = secMatch ? secMatch[1].trim() : "-";

                                // อ่านห้องเรียน หน่วยกิต และเวลาจากแถวล่าง (rowBottom)
                                const botSlice = rowBottom.slice(c, Math.min(c + 3, 10)).map(x => String(x || "").replace(/\s+/g, " ").trim()).join(" ");
                                const roomMatch = botSlice.match(/(\d{2}-\d{3,4}|Online|LAB[^\s]*)/i);
                                const timeMatch = botSlice.match(/(\d{4}\s*-\s*\d{4}|\d{1,2}[:.]\d{2}\s*-\s*\d{1,2}[:.]\d{2})/);
                                const credSlotMatch = botSlice.match(/\((\d+(?:\.\d+)?)\s*นก\.\)/);

                                const meta = courseMetaMap.get(codeClean) || courseMetaMap.get(codeClean.split("/")[0]) || { title: "-", credits: 0 };
                                const finalCredits = credSlotMatch ? parseFloat(credSlotMatch[1]) : meta.credits;

                                newScheduleMap.get(normTeacher).push({
                                    code: codeClean,
                                    title: meta.title,
                                    section: sectionStr,
                                    day: dayName,
                                    time: timeMatch ? formatTimeRange(timeMatch[1]) : "-",
                                    room: roomMatch ? roomMatch[1] : "-",
                                    credits: finalCredits,
                                    teacherRaw: teacherRaw,
                                    dept: deptLabel
                                });
                                courseCount++;
                            }
                        }

                        // หากอาจารย์มีรายวิชาที่ไม่มีเวลาลงตารางกริด (เช่น โครงงาน/สหกิจ/Replacement D400) ให้ดึงจากรายการด้านบนด้วย
                        if (newScheduleMap.get(normTeacher).length === 0 && courseMetaMap.size > 0) {
                            const addedCodes = new Set();
                            courseMetaMap.forEach((meta, codeKey) => {
                                if (addedCodes.has(meta.title)) return;
                                addedCodes.add(meta.title);
                                newScheduleMap.get(normTeacher).push({
                                    code: codeKey,
                                    title: meta.title,
                                    section: "-",
                                    day: "ไม่ระบุวัน",
                                    time: "-",
                                    room: "-",
                                    credits: meta.credits,
                                    teacherRaw: teacherRaw,
                                    dept: deptLabel
                                });
                                courseCount++;
                            });
                        }
                    });
                }
            });

            if (courseCount > 0) {
                scheduleMap = newScheduleMap;
                processDataset(rawLecturerList);
                const bannerBadge = document.getElementById("status-banner-badge");
                if (bannerBadge) {
                    bannerBadge.className = "bg-emerald-50 border border-emerald-300 text-emerald-800 text-xs font-semibold px-3.5 py-1.5 rounded-lg whitespace-nowrap";
                    bannerBadge.textContent = rawLecturerList.length > 0
                        ? `สถานะ: ผูกพันธกิจ (${rawLecturerList.length} คน) และตารางสอน (${courseCount} รายวิชา) สำเร็จ`
                        : `สถานะ: นำเข้าตารางสอนสำเร็จ (${courseCount} รายวิชา) — รอนำเข้าไฟล์พันธกิจ`;
                }
            } else {
                alert("ไม่พบข้อมูลตารางสอนในไฟล์ที่เลือก กรุณาตรวจสอบว่าไฟล์เป็นแบบฟอร์มตารางสอนอาจารย์ (FM ตส.-03)");
            }
        } catch (err) {
            console.error(err);
            alert("เกิดข้อผิดพลาดในการอ่านไฟล์ตารางสอน: " + err.message);
        }
        event.target.value = "";
    };
    reader.readAsArrayBuffer(file);
}

function exportToExcel(filterType = "ALL") {
    let targetData = currentFilteredList;
    let fileName = "สรุปพันธกิจอาจารย์ประจำ_2569_ทั้งหมด.xlsx";

    if (filterType === "MATCH_OVER") {
        targetData = currentFilteredList.filter(d => d.netDiff >= -0.009);
        fileName = "รายชื่ออาจารย์_สอนครบและเกินเกณฑ์_2569.xlsx";
    } else if (filterType === "UNDER") {
        targetData = currentFilteredList.filter(d => d.netDiff < -0.009);
        fileName = "รายชื่ออาจารย์_สอนไม่ครบพันธกิจ_2569.xlsx";
    }

    if (targetData.length === 0) {
        alert("ไม่มีข้อมูลในกลุ่มนี้สำหรับส่งออก");
        return;
    }

    const exportRows = targetData.map((d, i) => ({
        "ลำดับ": i + 1,
        "ชื่อ-นามสกุล": d.name,
        "ตำแหน่ง": d.position,
        "คณะ/สาขาวิชา": d.dept,
        "สถานะ": d.netDiff < -0.009 ? "ขาดเกณฑ์" : (d.netDiff > 0.009 ? "สอนเกินเกณฑ์" : "ครบพอดีเกณฑ์"),
        "ยอดยกมา (นก.)": d.carryOver,
        "สอนจริง (นก.)": d.hasActual ? d.actual : "-",
        "เกณฑ์ประจำภาค (นก.)": d.criteria,
        "ยอดยกไปสุทธิ (นก.)": d.netDiff,
        "สรุปพันธกิจ": d.rawRemark
    }));

    const ws = XLSX.utils.json_to_sheet(exportRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "สรุปพันธกิจ 2569");
    XLSX.writeFile(wb, fileName);
}

function exportCoursesToExcel() {
    if (filteredCoursesList.length === 0) {
        alert("ไม่มีข้อมูลรายวิชาสำหรับส่งออก");
        return;
    }

    const rows = filteredCoursesList.map((c, i) => ({
        "ลำดับ": i + 1,
        "คณะ/สาขาวิชา": c.deptDisplay,
        "ชื่อ-สกุล อาจารย์ผู้สอน": c.teacherDisplay,
        "รหัสวิชา": c.code,
        "ชื่อรายวิชา": c.title,
        "กลุ่มเรียน (Sec)": c.section,
        "วันเรียน": c.day,
        "เวลาเรียน": c.time,
        "ห้องเรียน": c.room,
        "หน่วยกิต": c.credits,
        "สถานะฐานข้อมูล": c.lecturerRef ? "เชื่อมโยงฐานพันธกิจแล้ว" : "รอตรวจสอบ"
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "ตารางสอนแยกตามอาจารย์");
    XLSX.writeFile(wb, "ตารางรายวิชาและภาระงานสอน_2569.xlsx");
}

// ============================================================================
// 8. INITIALIZATION & EVENT LISTENERS
// ============================================================================
document.addEventListener("DOMContentLoaded", () => {
    rawLecturerList = [];
    scheduleMap.clear();
    processDataset(rawLecturerList);

    const bannerBadge = document.getElementById("status-banner-badge");
    if (bannerBadge) {
        bannerBadge.className = "bg-slate-100 border border-slate-300 text-slate-700 text-xs font-semibold px-3.5 py-1.5 rounded-lg whitespace-nowrap";
        bannerBadge.textContent = "สถานะ: รอการนำเข้าไฟล์ข้อมูลจริง (.xlsx)";
    }

    // View Switcher Events
    document.querySelectorAll("[data-view]").forEach(el => {
        el.addEventListener("click", (e) => {
            e.preventDefault();
            const targetView = el.getAttribute("data-view");
            if (targetView) switchView(targetView);
        });
    });

    // Filters & Search (View 01)
    document.getElementById("filter-dept")?.addEventListener("change", applyFilters);
    document.getElementById("filter-status")?.addEventListener("change", applyFilters);
    document.getElementById("filter-search")?.addEventListener("input", applyFilters);

    // Filters & Search (View 03 Timetable & Excel Courses)
    document.getElementById("btn-mode-timetable")?.addEventListener("click", () => switchCourseDisplayMode("timetable"));
    document.getElementById("btn-mode-excel")?.addEventListener("click", () => switchCourseDisplayMode("excel"));
    document.getElementById("filter-course-dept")?.addEventListener("change", () => {
        updateCourseLecturerDropdown();
        applyCourseFilters();
    });
    document.getElementById("filter-course-lecturer")?.addEventListener("change", applyCourseFilters);
    document.getElementById("filter-course-day")?.addEventListener("change", applyCourseFilters);
    document.getElementById("filter-course-audit")?.addEventListener("change", applyCourseFilters);
    document.getElementById("filter-course-search")?.addEventListener("input", applyCourseFilters);
    document.getElementById("btn-export-courses")?.addEventListener("click", exportCoursesToExcel);

    // File Uploads
    document.getElementById("file-upload-excel")?.addEventListener("change", handleMissionExcelUpload);
    document.getElementById("file-upload-schedule")?.addEventListener("change", handleScheduleExcelUpload);

    // Clear / Reset Data
    document.getElementById("btn-reset-sample")?.addEventListener("click", () => {
        scheduleMap.clear();
        rawLecturerList = [];
        processDataset(rawLecturerList);
        const bannerBadge = document.getElementById("status-banner-badge");
        if (bannerBadge) {
            bannerBadge.className = "bg-slate-100 border border-slate-300 text-slate-700 text-xs font-semibold px-3.5 py-1.5 rounded-lg whitespace-nowrap";
            bannerBadge.textContent = "สถานะ: ล้างข้อมูลแล้ว — รอการนำเข้าไฟล์ใหม่ (.xlsx)";
        }
    });

    // KPI Cards Export
    document.getElementById("kpi-total-faculty")?.addEventListener("click", () => exportToExcel("ALL"));
    document.getElementById("kpi-match-count")?.addEventListener("click", () => exportToExcel("MATCH_OVER"));
    document.getElementById("kpi-under-count")?.addEventListener("click", () => exportToExcel("UNDER"));
    document.getElementById("nav-export-all")?.addEventListener("click", (e) => {
        e.preventDefault();
        exportToExcel("ALL");
    });

    // Drawer Close & Print
    document.getElementById("btn-close-drawer")?.addEventListener("click", closeLecturerDrawer);
    document.getElementById("btn-close-drawer-footer")?.addEventListener("click", closeLecturerDrawer);
    document.getElementById("lecturer-drawer-backdrop")?.addEventListener("click", closeLecturerDrawer);
    document.getElementById("btn-drawer-print")?.addEventListener("click", () => window.print());

    // Global Print
    document.getElementById("btn-print-report")?.addEventListener("click", () => window.print());
});