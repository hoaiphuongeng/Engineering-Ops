/* bridge-v12.js — Chuẩn Hóa Toàn Bộ Menu Bar Nằm Ngang Phía Trên (Kiểu Quản Lý Kho) + SSO & Đồng Bộ 5 Module */
(function () {
  let isApplyingFromMaster = false;
  let lastMasterData = null;
  let powerSwitchPageHooked = false;
  let dutyHooksApplied = false;
  let lastChecklistWeeklyRaw = localStorage.getItem('dailycheck_weekly_shifts_v1') || '';

  const SUPER_ADMIN_USERNAME = 'shp';
  const POWER_STATE_KEY = 'RESORT_UTILITY_OS_STATE_V5';

  function isSuperAdminObj(u) {
    return Boolean(u && (u.isSuperAdmin === true || String(u.username || '').toLowerCase() === SUPER_ADMIN_USERNAME));
  }

  function hideSuperAdminRowsInDom(containerSelector) {
    const container = document.querySelector(containerSelector);
    if (!container) return;
    container.querySelectorAll('tr').forEach(tr => {
      const txt = (tr.textContent || '').toLowerCase();
      if (/\b@?shp\b/.test(txt) || txt.includes('admin tối cao') || txt.includes('sup-001')) {
        tr.style.display = 'none';
      }
    });
  }
  const POWER_SESSION_KEY = 'RESORT_UTILITY_SESSION_V5';
  const POWER_USER_ALLOWED_PAGES = ['meters', 'equipment'];

  function getTodayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function isDutyModule() {
    return !!document.getElementById('login-screen') && typeof appState !== 'undefined';
  }

  function isPowerModule() {
    return !!document.getElementById('authOverlay') && typeof window.handleLogin === 'function';
  }

  function isChecklistModule() {
    return !!document.getElementById('root') && !document.getElementById('authOverlay') && !document.getElementById('login-screen');
  }

  function isBmsLogModule() {
    return !!document.getElementById('chiller-grid') && !!document.getElementById('tank-grid') && typeof datalogs !== 'undefined';
  }

  function isStockModule() {
    return !!document.getElementById('view-inventory') && !!document.getElementById('tab-stocktake');
  }

  async function hashPowerPasswordLocal(plainText, usernameSalt) {
    const encoder = new TextEncoder();
    const data = encoder.encode(`${String(usernameSalt || 'resort_salt').toLowerCase().trim()}::${plainText}`);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async function resolvePowerUsers(data) {
    if (Array.isArray(data.powerUsers) && data.powerUsers.length > 0) {
      return data.powerUsers;
    }
    return Promise.all((data.staff || []).map(async u => ({
      id: u.id,
      username: u.username,
      fullName: u.name,
      role: u.role === 'admin' ? 'admin' : 'user',
      passwordHash: await hashPowerPasswordLocal(u.password || '123456', u.username),
      mustChangePassword: false,
      createdAt: u.createdAt || new Date().toISOString()
    })));
  }

  function getUsersSignature(users, activeUsername) {
    const compact = (users || []).map(u => `${u.username}:${u.role}:${u.fullName}:${u.passwordHash}`).sort().join('|');
    return `${activeUsername || ''}::${compact}`;
  }

  // ==================== 1. SỔ DUTY (duty.html) ====================
  // - Đăng nhập SSO theo `data.staff` (Admin / Duty dùng chung)
  // - Ánh xạ người thực hiện, lịch trực, giao/nhận ca HOÀN TOÀN theo `data.rosterStaff` + `data.dutyScheduleToday`
  function applyToDuty(data) {
    if (!isDutyModule() || !data || !data.currentUser) return;
    const u = data.currentUser;
    const isAdmin = u.role === 'admin';

    // 1. Tài khoản đăng nhập (ẩn Admin Tối Cao shp nếu đang đăng nhập bằng Admin khác)
    const isSupViewer = Boolean(data.isCurrentSuperAdmin || isSuperAdminObj(u));
    const filteredStaffForDuty = isSupViewer
      ? (data.staff || [])
      : (data.staff || []).filter(s => !isSuperAdminObj(s));
    const loginUsers = filteredStaffForDuty.map(s => ({
      id: s.id,
      name: s.name,
      username: s.username,
      password: s.password,
      role: s.role === 'admin' ? 'Admin' : 'Kỹ thuật',
      status: 'Hoạt động'
    }));
    appState.users = loginUsers;

    // 2. Đồng bộ lịch trực hôm nay từ BẢNG PHÂN CA (rosterStaff)
    const today = getTodayStr();
    const nonSyncedToday = (appState.schedule || []).filter(x => !String(x.id).startsWith('SCH-SYNC-') && x.date !== today);
    const syncedToday = Array.isArray(data.dutyScheduleToday) ? data.dutyScheduleToday : [];
    appState.schedule = [...syncedToday, ...nonSyncedToday];

    // 3. Tự động đăng nhập bằng tài khoản SSO (Admin hoặc Duty dùng chung)
    const matchedUser =
      appState.users.find(x => x.username.toLowerCase() === String(u.username || '').toLowerCase()) ||
      appState.users.find(x => x.id === u.id) ||
      appState.users[0];

    appState.currentUser = matchedUser;

    const loginScreen = document.getElementById('login-screen');
    if (loginScreen) {
      loginScreen.classList.add('opacity-0', 'pointer-events-none', 'hidden');
      loginScreen.style.display = 'none';
    }

    // 4. Hook các dropdown chọn người thực hiện & giao/nhận ca để LUÔN lấy theo BẢNG PHÂN CA (không lấy tên tài khoản Duty)
    if (!dutyHooksApplied) {
      dutyHooksApplied = true;

      if (typeof window.updateAssigneeDropdown === 'function') {
        const origUpdateAssignee = window.updateAssigneeDropdown;
        window.updateAssigneeDropdown = function () {
          origUpdateAssignee.apply(this, arguments);
          const sel = document.getElementById('task-assignee');
          if (!sel || !lastMasterData) return;
          const shift = document.getElementById('task-shift')?.value || '';
          const date = document.getElementById('filter-date')?.value || getTodayStr();
          const scheduled = (appState.schedule || []).filter(s => s.shift === shift && s.date === date).map(s => s.staffName);
          const allRosterNames = (lastMasterData.rosterStaff || []).map(r => r.name);
          const names = scheduled.length > 0 ? [...new Set(scheduled)] : [...new Set(allRosterNames)];
          if (names.length > 0) {
            sel.innerHTML = names.map(n => `<option value="${n}">${n}</option>`).join('');
          }
        };
      }

      if (typeof window.updateHandoverStaffOptions === 'function') {
        const origUpdateHandover = window.updateHandoverStaffOptions;
        window.updateHandoverStaffOptions = function () {
          origUpdateHandover.apply(this, arguments);
          if (!lastMasterData) return;
          const allRosterNames = (lastMasterData.rosterStaff || []).map(r => r.name);
          if (allRosterNames.length === 0) return;

          const currentShift = appState.activeShiftSession?.shift || 'Ca Sáng';
          const currentDate = appState.activeShiftSession?.date || getTodayStr();
          const nextSession = typeof window.getNextShiftSession === 'function'
            ? window.getNextShiftSession(currentShift, currentDate)
            : { shift: 'Ca Chiều', date: currentDate };

          const curStaff = (appState.schedule || []).filter(s => s.date === currentDate && s.shift === currentShift).map(s => s.staffName);
          const nextStaff = (appState.schedule || []).filter(s => s.date === nextSession.date && s.shift === nextSession.shift).map(s => s.staffName);

          const buildRosterOptions = (scheduledNames) => {
            const uniq = [...new Set(scheduledNames)];
            let html = '';
            if (uniq.length > 1) html += `<option value="${uniq.join(', ')}">Cả ca: ${uniq.join(', ')}</option>`;
            if (uniq.length > 0) {
              html += `<optgroup label="Đang trực theo Bảng Phân Ca">` + uniq.map(n => `<option value="${n}">${n}</option>`).join('') + `</optgroup>`;
            }
            const others = allRosterNames.filter(n => !uniq.includes(n));
            if (others.length > 0) {
              html += `<optgroup label="Nhân sự khác (Bảng Phân Ca)">` + others.map(n => `<option value="${n}">${n}</option>`).join('') + `</optgroup>`;
            }
            return html;
          };

          const fromSel = document.getElementById('handover-staff-name');
          const recSel = document.getElementById('handover-receiver-name');
          if (fromSel) fromSel.innerHTML = buildRosterOptions(curStaff);
          if (recSel) recSel.innerHTML = buildRosterOptions(nextStaff);
        };
      }
    }

    if (typeof window.renderLoginQuickUsers === 'function') window.renderLoginQuickUsers();
    if (typeof window.updateUserProfileUI === 'function') window.updateUserProfileUI();
    if (typeof window.renderAll === 'function') window.renderAll();

    if (!isAdmin) {
      document.querySelectorAll('[onclick*="switchView(\'admin\')"], [data-view="admin"]').forEach(el => {
        el.style.display = 'none';
      });
      if (typeof window.switchView === 'function' && window.currentActiveViewName === 'admin') {
        window.switchView('tasks');
      }
    }
    standardizeDutyTopMenuBar(isAdmin);
  }

  // ==================== 2. ĐIỆN NƯỚC (power.html) ====================
  // Tối giản giao diện Ghi Chỉ Số Công Tơ cho nhân viên (Menu bar đã được chuẩn hóa lên phía trên kiểu Quản Lý Kho)
  function enforcePowerUserView() {
    if (!document.getElementById('unified-power-user-css')) {
      const st = document.createElement('style');
      st.id = 'unified-power-user-css';
      st.textContent = `
        /* 1. Ẩn toàn bộ các trang & nút không dành cho nhân viên */
        #page-dashboard, #page-sld, #page-accounts,
        #toggleOfflineSimBtn, #headerPwaBtn,
        header button[onclick*="handleLogout"],
        [data-admin-only] {
          display: none !important;
        }

        /* 2. Đơn giản hóa tối đa trang Ghi Chỉ Số Công Tơ (#page-meters) */
        #page-meters button[onclick*="openMeterZonesModal"],
        #btnAddMeterToolbar,
        #btnWipeReportToolbar,
        #page-meters > div:nth-child(2),
        #page-meters > div:nth-child(5),
        #tableLossElecSummary,
        #tableLossWaterSummary {
          display: none !important;
        }

        /* 3. Thu gọn bảng chỉ số còn đúng 5 cột cốt lõi: Công tơ | Số cũ | Số mới | Tiêu thụ | Lưu */
        #electricMeterSection th:nth-child(2), #electricMeterSection td:nth-child(2),
        #electricMeterSection th:nth-child(3), #electricMeterSection td:nth-child(3),
        #electricMeterSection th:nth-child(7), #electricMeterSection td:nth-child(7),
        #waterMeterSection th:nth-child(2), #waterMeterSection td:nth-child(2),
        #waterMeterSection th:nth-child(3), #waterMeterSection td:nth-child(3),
        #waterMeterSection th:nth-child(7), #waterMeterSection td:nth-child(7) {
          display: none !important;
        }

        /* 4. Trên mỗi dòng công tơ, chỉ giữ duy nhất nút Lưu */
        #electricMeterTableBody button[onclick*="moveMeterOrder"],
        #electricMeterTableBody button[onclick*="openEditMeterModal"],
        #electricMeterTableBody button[onclick*="deleteMeter"],
        #waterMeterTableBody button[onclick*="moveMeterOrder"],
        #waterMeterTableBody button[onclick*="openEditMeterModal"],
        #waterMeterTableBody button[onclick*="deleteMeter"] {
          display: none !important;
        }

        /* 5. Tối ưu ô nhập số trên điện thoại */
        .meter-reading-input {
          min-width: 98px !important;
          font-size: 16px !important;
          padding: 0.55rem 0.7rem !important;
          border-width: 2px !important;
        }
        #electricMeterSection th, #electricMeterSection td,
        #waterMeterSection th, #waterMeterSection td {
          padding-left: 0.65rem !important;
          padding-right: 0.65rem !important;
        }
      `;
      document.head.appendChild(st);
    }

    if (!powerSwitchPageHooked && typeof window.switchPage === 'function') {
      const origSwitchPage = window.switchPage;
      window.switchPage = function (pageId) {
        const isCurrentUserAdmin = lastMasterData?.currentUser?.role === 'admin';
        if (!isCurrentUserAdmin && !POWER_USER_ALLOWED_PAGES.includes(pageId)) {
          return origSwitchPage.call(this, 'meters');
        }
        const res = origSwitchPage.apply(this, arguments);
        updateUnifiedTopBarActive('power', pageId);
        return res;
      };
      powerSwitchPageHooked = true;
    }

    const activePage = document.querySelector('.page-view.active');
    const activeId = activePage ? activePage.id.replace('page-', '') : '';
    if (!POWER_USER_ALLOWED_PAGES.includes(activeId) && typeof window.switchPage === 'function') {
      window.switchPage('meters');
    }
  }

  function restorePowerAdminView() {
    const st = document.getElementById('unified-power-user-css');
    if (st) st.remove();
  }

  async function applyToPower(data) {
    if (!isPowerModule() || !data || !data.currentUser) return;
    const u = data.currentUser;
    const isAdmin = u.role === 'admin';

    const powerUsers = await resolvePowerUsers(data);
    const incomingSig = getUsersSignature(powerUsers, u.username);

    let localSigBefore = '';
    try {
      const raw = localStorage.getItem(POWER_STATE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        localSigBefore = getUsersSignature(parsed.users || [], JSON.parse(localStorage.getItem(POWER_SESSION_KEY) || '{}').username);
        parsed.users = powerUsers;
        parsed.lastUpdated = Date.now();
        localStorage.setItem(POWER_STATE_KEY, JSON.stringify(parsed));
      }
    } catch {}

    localStorage.setItem(POWER_SESSION_KEY, JSON.stringify({ username: u.username }));

    const overlay = document.getElementById('authOverlay');
    const isOverlayVisible = overlay && !overlay.classList.contains('hidden');
    const displayedUserEl = document.getElementById('accProfileUsername');
    const displayedUser = displayedUserEl ? displayedUserEl.textContent.replace('@', '').trim().toLowerCase() : '';
    const isDifferentUser = displayedUser && displayedUser !== String(u.username || '').toLowerCase();
    const isUsersListChanged = localSigBefore && localSigBefore !== incomingSig;

    const lastReloadedSig = sessionStorage.getItem('power_synced_sig_v5');
    if ((isOverlayVisible || isDifferentUser || isUsersListChanged) && lastReloadedSig !== incomingSig) {
      if (isOverlayVisible && !isUsersListChanged) {
        const userInp = document.getElementById('loginUsername');
        const passInp = document.getElementById('loginPassword');
        if (userInp && passInp) {
          userInp.value = u.username;
          passInp.value = u.password;
          try { window.handleLogin({ preventDefault: function () {} }); } catch {}
        }
      }
      setTimeout(() => {
        const ovNow = document.getElementById('authOverlay');
        const stillBlocked = ovNow && !ovNow.classList.contains('hidden');
        if (stillBlocked || isDifferentUser || isUsersListChanged) {
          sessionStorage.setItem('power_synced_sig_v5', incomingSig);
          location.reload();
        }
      }, 250);
      return;
    }

    sessionStorage.setItem('power_synced_sig_v5', incomingSig);
    const isSupViewer = Boolean(data.isCurrentSuperAdmin || isSuperAdminObj(u));
    if (typeof window.renderUsersTable === 'function') {
      if (!window._unifiedPowerUsersHooked) {
        window._unifiedPowerUsersHooked = true;
        const origRenderUsers = window.renderUsersTable;
        window.renderUsersTable = function () {
          const res = origRenderUsers.apply(this, arguments);
          const viewerIsSup = Boolean(lastMasterData && (lastMasterData.isCurrentSuperAdmin || isSuperAdminObj(lastMasterData.currentUser)));
          if (!viewerIsSup) hideSuperAdminRowsInDom('#usersTableBody');
          return res;
        };
      }
      window.renderUsersTable();
    }
    if (!isSupViewer) hideSuperAdminRowsInDom('#usersTableBody');

    if (!isAdmin) {
      enforcePowerUserView();
    } else {
      restorePowerAdminView();
    }
    standardizePowerTopMenuBar(isAdmin);
  }

  // ==================== 3. CHECKLIST (checklist.html) ====================
  // Khi tài khoản dùng chung (Duty) đăng nhập, mặc định chọn nhân sự đang trực ca hiện tại từ Bảng Phân Ca
  function applyToChecklist(data) {
    if (!isChecklistModule() || !data || !data.currentUser) return;
    const u = data.currentUser;
    const isAdmin = u.role === 'admin';

    // Nếu là tài khoản Duty dùng chung và có nhân sự đang trực ca hiện tại trong Bảng Phân Ca -> tự ánh xạ sang ID nhân sự trực ca đầu tiên (vẫn giữ quyền user)
    // Nếu chưa có ai trực ca này -> dùng ID tài khoản Duty để mở Checklist
    const onDutyNow = Array.isArray(data.onDutyNow) ? data.onDutyNow : [];
    const targetChecklistUserId = (!isAdmin && onDutyNow.length > 0) ? onDutyNow[0].id : u.id;

    const curStoredId = localStorage.getItem('dailycheck_current_user_id_real_v1');
    if (curStoredId !== targetChecklistUserId) {
      localStorage.setItem('dailycheck_current_user_id_real_v1', targetChecklistUserId);
      if (!sessionStorage.getItem('checklist_sso_reloaded_' + targetChecklistUserId)) {
        sessionStorage.setItem('checklist_sso_reloaded_' + targetChecklistUserId, '1');
        location.reload();
        return;
      }
    }

    lastChecklistWeeklyRaw = localStorage.getItem('dailycheck_weekly_shifts_v1') || '';

    const isSupViewer = Boolean(data.isCurrentSuperAdmin || isSuperAdminObj(u));
    if (!isSupViewer && !window._unifiedChecklistHideObserver) {
      const hideShpInChecklist = () => {
        document.querySelectorAll('#root tbody tr, #root option').forEach(el => {
          const txt = (el.textContent || '').toLowerCase();
          if (/\b@?shp\b/.test(txt) || txt.includes('admin tối cao') || txt.includes('sup-001')) {
            el.style.display = 'none';
          }
        });
      };
      hideShpInChecklist();
      window._unifiedChecklistHideObserver = new MutationObserver(hideShpInChecklist);
      const rootEl = document.getElementById('root');
      if (rootEl) window._unifiedChecklistHideObserver.observe(rootEl, { childList: true, subtree: true });
    }

    standardizeChecklistTopMenuBar();
  }

  // ==================== 4. GIÁM SÁT CHILLER & BỒN NƯỚC (log.html) ====================
  let lastBmsSyncedHash = '';

  function applyToBmsLog(data) {
    if (!isBmsLogModule() || !data || !data.currentUser) return;
    const u = data.currentUser;
    const isAdmin = u.role === 'admin';

    // 1. Phân quyền giao diện: User (duty) ẩn nút Xóa Datalog; Admin giữ toàn quyền
    const existingCss = document.getElementById('unified-bms-user-css');
    if (!isAdmin) {
      if (!existingCss) {
        const st = document.createElement('style');
        st.id = 'unified-bms-user-css';
        st.textContent = `
          button[onclick*="openClearModal"] {
            display: none !important;
          }
          body {
            padding-bottom: 48px !important;
          }
        `;
        document.head.appendChild(st);
      }
    } else if (existingCss) {
      existingCss.remove();
    }

    // 2. Ánh xạ nhân viên thao tác từ BẢNG PHÂN CA (rosterStaff + onDutyNow)
    const onDutyNow = Array.isArray(data.onDutyNow) ? data.onDutyNow : [];
    const rosterStaff = Array.isArray(data.rosterStaff) ? data.rosterStaff : [];
    const currentShift = data.currentShift || '';

    let dl = document.getElementById('unified-bms-operators');
    if (!dl) {
      dl = document.createElement('datalist');
      dl.id = 'unified-bms-operators';
      document.body.appendChild(dl);
    }

    const opts = [];
    const seen = new Set();
    onDutyNow.forEach(r => {
      const label = currentShift ? `${r.name} (${currentShift})` : r.name;
      if (!seen.has(label)) { seen.add(label); opts.push(label); }
    });
    rosterStaff.forEach(r => {
      if (!seen.has(r.name)) { seen.add(r.name); opts.push(r.name); }
    });
    if (isAdmin && u.name && !seen.has(u.name)) {
      opts.push(u.name);
    }
    dl.innerHTML = opts.map(o => `<option value="${o.replace(/"/g, '&quot;')}"></option>`).join('');

    ['chiller-operator', 'tank-operator', 'valve-operator'].forEach(id => {
      const inp = document.getElementById(id);
      if (inp) inp.setAttribute('list', 'unified-bms-operators');
    });

    // Gợi ý sẵn nhân viên đang trực ca từ Bảng Phân Ca vào localStorage của log.html
    const defaultOp = (!isAdmin && onDutyNow.length > 0)
      ? (currentShift ? `${onDutyNow[0].name} (${currentShift})` : onDutyNow[0].name)
      : (isAdmin ? u.name : '');
    if (defaultOp) {
      try { localStorage.setItem('bms_scada_last_operator_v1', defaultOp); } catch {}
    }
    standardizeBmsLogTopMenuBar();
  }

  function applyBmsCloudSync(data) {
    if (!isBmsLogModule() || !data || !data.deviceState) return;
    const incomingHash = data.bmsHash || JSON.stringify({ d: data.deviceState, l: data.datalogs || [] });
    if (incomingHash === lastBmsSyncedHash) return;

    isApplyingFromMaster = true;
    lastBmsSyncedHash = incomingHash;
    try {
      appState = data.deviceState;
      datalogs = Array.isArray(data.datalogs) ? data.datalogs : [];
      try {
        localStorage.setItem('bms_scada_device_state_v1', JSON.stringify(appState));
        localStorage.setItem('bms_scada_datalog_v1', JSON.stringify(datalogs));
      } catch {}
      if (typeof window.renderAll === 'function') window.renderAll();
    } finally {
      setTimeout(() => { isApplyingFromMaster = false; }, 350);
    }
  }

  // ==================== 5. KHO VẬT TƯ KỸ THUẬT (stock.html) ====================
  function applyToStock(data) {
    if (!isStockModule() || !data || !data.currentUser) return;
    const u = data.currentUser;
    const isAdmin = u.role === 'admin';

    // 1. Phân quyền giao diện: User (duty) ẩn nút Xóa VT, Cài đặt hệ thống & Chốt kiểm kê
    const existingCss = document.getElementById('unified-stock-user-css');
    if (!isAdmin) {
      if (!existingCss) {
        const st = document.createElement('style');
        st.id = 'unified-stock-user-css';
        st.textContent = `
          button[onclick*="deleteItem"],
          button[onclick*="openSettingsModal"],
          #btn-finalize-stocktake {
            display: none !important;
          }
          body {
            padding-bottom: 48px !important;
          }
        `;
        document.head.appendChild(st);
      }
    } else if (existingCss) {
      existingCss.remove();
    }

    // 2. Đồng bộ danh sách nhân sự từ BẢNG PHÂN CA vào EMPLOYEE_LIST của Kho Vật Tư
    const onDutyNow = Array.isArray(data.onDutyNow) ? data.onDutyNow : [];
    const rosterStaff = Array.isArray(data.rosterStaff) ? data.rosterStaff : [];
    const mergedNames = [];
    const seen = new Set();

    onDutyNow.forEach(r => {
      if (r && r.name && !seen.has(r.name)) { seen.add(r.name); mergedNames.push(r.name); }
    });
    rosterStaff.forEach(r => {
      if (r && r.name && !seen.has(r.name)) { seen.add(r.name); mergedNames.push(r.name); }
    });
    if (isAdmin && u.name && !seen.has(u.name)) {
      seen.add(u.name);
      mergedNames.push(u.name);
    }

    if (typeof EMPLOYEE_LIST !== 'undefined' && Array.isArray(EMPLOYEE_LIST) && mergedNames.length > 0) {
      EMPLOYEE_LIST.length = 0;
      mergedNames.forEach(n => EMPLOYEE_LIST.push(n));
    }

    // 3. Tự động điền sẵn Người thực hiện (theo nhân sự đang trực ca hoặc Admin) nếu ô đang trống
    const defaultPerformer = (!isAdmin && onDutyNow.length > 0)
      ? onDutyNow[0].name
      : (isAdmin ? u.name : (mergedNames[0] || ''));

    if (defaultPerformer) {
      ['import-performer', 'export-performer', 'stocktake-performer-input'].forEach(id => {
        const el = document.getElementById(id);
        if (el && !el.value.trim()) {
          el.value = defaultPerformer;
        }
      });
    }
  }

  // ==================== 6. CHUẨN HÓA MENU BAR NẰM NGANG PHÍA TRÊN (KIỂU QUẢN LÝ KHO) ====================
  let dutySwitchViewHooked = false;
  let checklistTopNavObserver = null;

  function ensureUnifiedTopBarStyles() {
    if (document.getElementById('unified-stock-topbar-css')) return;
    const st = document.createElement('style');
    st.id = 'unified-stock-topbar-css';
    st.textContent = `
      /* Kiểu thanh Segmented iOS Tab Bar đồng nhất với Quản Lý Kho (stock.html) */
      .unified-stock-topbar-wrap {
        width: 100%;
        margin-top: 0.55rem;
      }
      .unified-stock-topbar {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 4px;
        border-radius: 1rem;
        background: rgba(226, 232, 240, 0.72);
        border: 1px solid rgba(203, 213, 225, 0.55);
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        overflow-x: auto;
        scrollbar-width: none;
        -ms-overflow-style: none;
      }
      .unified-stock-topbar::-webkit-scrollbar { display: none; }
      .dark .unified-stock-topbar {
        background: rgba(30, 41, 59, 0.72);
        border-color: rgba(71, 85, 105, 0.5);
      }
      .unified-stock-tab {
        flex: 1 1 0%;
        min-width: max-content;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 8px 13px;
        border-radius: 0.75rem;
        font-size: 12px;
        font-weight: 600;
        line-height: 1.2;
        white-space: nowrap;
        color: #475569;
        background: transparent;
        border: 1px solid transparent;
        cursor: pointer;
        transition: all 180ms cubic-bezier(0.22, 1, 0.36, 1);
        user-select: none;
      }
      .dark .unified-stock-tab {
        color: #94a3b8;
      }
      .unified-stock-tab:hover {
        color: #0f172a;
        background: rgba(255, 255, 255, 0.45);
      }
      .dark .unified-stock-tab:hover {
        color: #f8fafc;
        background: rgba(51, 65, 85, 0.55);
      }
      .unified-stock-tab:active {
        transform: scale(0.97);
      }
      .unified-stock-tab.is-active {
        background: #ffffff;
        color: #0f172a;
        font-weight: 700;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08), 0 1px 2px rgba(0, 0, 0, 0.04);
      }
      .dark .unified-stock-tab.is-active {
        background: #334155;
        color: #ffffff;
        border-color: rgba(148, 163, 184, 0.25);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
      }
      .unified-stock-tab svg {
        width: 15px;
        height: 15px;
        flex-shrink: 0;
      }
    `;
    document.head.appendChild(st);
  }

  function updateUnifiedTopBarActive(moduleType, activeKey) {
    const bar = document.getElementById('unified-stock-topbar');
    if (!bar) return;
    bar.querySelectorAll('.unified-stock-tab').forEach(btn => {
      btn.classList.toggle('is-active', btn.dataset.key === activeKey);
    });
  }

  function svgIcon(pathD) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${pathD}</svg>`;
  }

  // --- A. SỔ DUTY (duty.html): Ẩn sidebar trái & bottom nav mobile -> Thay bằng thanh ngang phía trên ---
  function standardizeDutyTopMenuBar(isAdmin) {
    ensureUnifiedTopBarStyles();
    if (!document.getElementById('unified-duty-topbar-override-css')) {
      const st = document.createElement('style');
      st.id = 'unified-duty-topbar-override-css';
      st.textContent = `
        aside#sidebar,
        nav.fixed.bottom-0 {
          display: none !important;
        }
      `;
      document.head.appendChild(st);
    }

    const header = document.querySelector('header');
    if (!header) return;

    const tabs = [
      { key: 'dashboard', label: 'Tổng quan', icon: svgIcon('<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>') },
      { key: 'tasks', label: 'Công việc', icon: svgIcon('<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>') },
      { key: 'handover', label: 'Bàn giao ca', icon: svgIcon('<path d="M16 3l4 4-4 4"/><path d="M20 7H4"/><path d="M8 21l-4-4 4-4"/><path d="M4 17h16"/>') },
      { key: 'reports', label: 'Báo cáo', icon: svgIcon('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8"/><path d="M8 17h8"/>') },
      { key: 'schedule', label: 'Lịch trực', icon: svgIcon('<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>') }
    ];
    if (isAdmin) {
      tabs.push({ key: 'admin', label: 'Quản trị', icon: svgIcon('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>') });
    }

    let wrap = document.getElementById('unified-stock-topbar-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'unified-stock-topbar-wrap';
      wrap.className = 'unified-stock-topbar-wrap max-w-7xl mx-auto';
      header.appendChild(wrap);
    }

    const activeKey = window.currentActiveViewName || 'dashboard';
    wrap.innerHTML = `<nav id="unified-stock-topbar" class="unified-stock-topbar">${
      tabs.map(t => `<button type="button" data-key="${t.key}" class="unified-stock-tab ${t.key === activeKey ? 'is-active' : ''}">${t.icon}<span>${t.label}</span></button>`).join('')
    }</nav>`;

    wrap.querySelectorAll('.unified-stock-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.key;
        if (typeof window.switchView === 'function') window.switchView(key);
        updateUnifiedTopBarActive('duty', key);
      });
    });

    if (!dutySwitchViewHooked && typeof window.switchView === 'function') {
      dutySwitchViewHooked = true;
      const origSwitchView = window.switchView;
      window.switchView = function (viewName) {
        const res = origSwitchView.apply(this, arguments);
        updateUnifiedTopBarActive('duty', viewName);
        return res;
      };
    }
  }

  // --- B. ĐIỆN NƯỚC (power.html): Ẩn sidebar trái & bottom nav -> Thay bằng thanh ngang phía trên ---
  function standardizePowerTopMenuBar(isAdmin) {
    ensureUnifiedTopBarStyles();
    if (!document.getElementById('unified-power-topbar-override-css')) {
      const st = document.createElement('style');
      st.id = 'unified-power-topbar-override-css';
      st.textContent = `
        aside,
        nav.fixed.bottom-0 {
          display: none !important;
        }
      `;
      document.head.appendChild(st);
    }

    const header = document.querySelector('header');
    if (!header) return;

    const allTabs = [
      { key: 'dashboard', label: 'Tổng quan', adminOnly: true, icon: svgIcon('<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>') },
      { key: 'meters', label: 'Chỉ số công tơ', adminOnly: false, icon: svgIcon('<path d="M12 14l4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>') },
      { key: 'sld', label: 'Sơ đồ 1 sợi', adminOnly: true, icon: svgIcon('<circle cx="12" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><path d="M18 9v1a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V9"/><path d="M12 12v3"/>') },
      { key: 'equipment', label: 'Thiết bị', adminOnly: false, icon: svgIcon('<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3"/>') },
      { key: 'accounts', label: 'Tài khoản', adminOnly: true, icon: svgIcon('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>') }
    ];
    const tabs = isAdmin ? allTabs : allTabs.filter(t => !t.adminOnly);

    let wrap = document.getElementById('unified-stock-topbar-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'unified-stock-topbar-wrap';
      wrap.className = 'unified-stock-topbar-wrap';
      header.appendChild(wrap);
    }

    const activePage = document.querySelector('.page-view.active');
    const activeKey = activePage ? activePage.id.replace('page-', '') : (isAdmin ? 'dashboard' : 'meters');

    wrap.innerHTML = `<nav id="unified-stock-topbar" class="unified-stock-topbar">${
      tabs.map(t => `<button type="button" data-key="${t.key}" class="unified-stock-tab ${t.key === activeKey ? 'is-active' : ''}">${t.icon}<span>${t.label}</span></button>`).join('')
    }</nav>`;

    wrap.querySelectorAll('.unified-stock-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.key;
        if (typeof window.switchPage === 'function') window.switchPage(key);
        updateUnifiedTopBarActive('power', key);
      });
    });

    if (!powerSwitchPageHooked && typeof window.switchPage === 'function') {
      powerSwitchPageHooked = true;
      const origSwitchPage = window.switchPage;
      window.switchPage = function (pageId) {
        const isCurrentUserAdmin = lastMasterData?.currentUser?.role === 'admin';
        if (!isCurrentUserAdmin && !POWER_USER_ALLOWED_PAGES.includes(pageId)) {
          return origSwitchPage.call(this, 'meters');
        }
        const res = origSwitchPage.apply(this, arguments);
        updateUnifiedTopBarActive('power', pageId);
        return res;
      };
    }
  }

  // --- C. CHILLER & BỒN NƯỚC (log.html): Thêm thanh ngang phía trên để chuyển nhanh 3 khu vực ---
  function standardizeBmsLogTopMenuBar() {
    ensureUnifiedTopBarStyles();
    const header = document.querySelector('header');
    if (!header) return;

    const tabs = [
      { key: 'all', label: 'Tất cả', icon: svgIcon('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>') },
      { key: 'chiller', label: 'Hệ thống Chiller', icon: svgIcon('<path d="M12 2v20M2 12h20M4.93 4.93l14.14 14.14M19.07 4.93L4.93 19.07"/>') },
      { key: 'tank', label: 'Bồn Nước & Van', icon: svgIcon('<path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/>') },
      { key: 'datalog', label: 'Nhật Ký Datalog', icon: svgIcon('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8"/><path d="M8 17h8"/>') }
    ];

    let wrap = document.getElementById('unified-stock-topbar-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'unified-stock-topbar-wrap';
      wrap.className = 'unified-stock-topbar-wrap max-w-7xl mx-auto px-3 sm:px-6 pb-2.5';
      header.appendChild(wrap);
    }

    const currentKey = window._bmsActiveSectionTab || 'all';
    wrap.innerHTML = `<nav id="unified-stock-topbar" class="unified-stock-topbar">${
      tabs.map(t => `<button type="button" data-key="${t.key}" class="unified-stock-tab ${t.key === currentKey ? 'is-active' : ''}">${t.icon}<span>${t.label}</span></button>`).join('')
    }</nav>`;

    const applySectionFilter = (key) => {
      window._bmsActiveSectionTab = key;
      const sections = {
        chiller: document.querySelector('section[aria-labelledby="chiller-section-title"]'),
        tank: document.querySelector('section[aria-labelledby="tank-section-title"]'),
        datalog: document.querySelector('section[aria-labelledby="datalog-section-title"]')
      };
      Object.entries(sections).forEach(([k, el]) => {
        if (!el) return;
        el.style.display = (key === 'all' || key === k) ? '' : 'none';
      });
      updateUnifiedTopBarActive('log', key);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    wrap.querySelectorAll('.unified-stock-tab').forEach(btn => {
      btn.addEventListener('click', () => applySectionFilter(btn.dataset.key));
    });
  }

  // --- D. CHECKLIST (checklist.html - React): Đưa thanh điều hướng iOS từ đáy lên ngay dưới Header, kiểu ngang Quản Lý Kho ---
  function standardizeChecklistTopMenuBar() {
    ensureUnifiedTopBarStyles();
    if (!document.getElementById('unified-checklist-topbar-css')) {
      const st = document.createElement('style');
      st.id = 'unified-checklist-topbar-css';
      st.textContent = `
        /* Chuyển thanh điều hướng React từ bottom-0 lên top cố định ngay dưới Header */
        .unified-cl-nav-wrap {
          position: fixed !important;
          top: var(--unified-cl-header-h, 58px) !important;
          bottom: auto !important;
          left: 0 !important;
          right: 0 !important;
          z-index: 35 !important;
          transform: none !important;
          opacity: 1 !important;
          pointer-events: auto !important;
          background: rgba(255, 255, 255, 0.88) !important;
          backdrop-filter: blur(20px) !important;
          -webkit-backdrop-filter: blur(20px) !important;
          border-bottom: 1px solid rgba(0, 0, 0, 0.08) !important;
          padding: 6px 12px 8px 12px !important;
        }
        .dark .unified-cl-nav-wrap {
          background: rgba(28, 28, 30, 0.88) !important;
          border-bottom: 1px solid rgba(255, 255, 255, 0.1) !important;
        }
        .unified-cl-nav-wrap > div {
          max-width: 80rem !important;
          margin: 0 auto !important;
          padding: 0 !important;
        }
        nav[aria-label="Thanh điều hướng iOS"] {
          height: auto !important;
          min-height: 40px !important;
          padding: 4px !important;
          border-radius: 1rem !important;
          background: rgba(226, 232, 240, 0.72) !important;
          border: 1px solid rgba(203, 213, 225, 0.55) !important;
          box-shadow: none !important;
          justify-content: flex-start !important;
          gap: 4px !important;
          overflow-x: auto !important;
          scrollbar-width: none !important;
        }
        nav[aria-label="Thanh điều hướng iOS"]::-webkit-scrollbar { display: none; }
        .dark nav[aria-label="Thanh điều hướng iOS"] {
          background: rgba(30, 41, 59, 0.72) !important;
          border-color: rgba(71, 85, 105, 0.5) !important;
        }
        nav[aria-label="Thanh điều hướng iOS"] > button {
          flex: 1 1 0% !important;
          min-width: max-content !important;
          flex-direction: row !important;
          align-items: center !important;
          justify-content: center !important;
          gap: 6px !important;
          height: auto !important;
          padding: 7px 12px !important;
          border-radius: 0.75rem !important;
          white-space: nowrap !important;
        }
        /* Gọn nút QR (nếu hiển thị trên mobile) nằm cùng hàng ngang không nhô lên */
        nav[aria-label="Thanh điều hướng iOS"] > button > div[class*="-mt-4"] {
          margin-top: 0 !important;
          width: 22px !important;
          height: 22px !important;
          border-radius: 6px !important;
          border-width: 0 !important;
          box-shadow: none !important;
        }
        nav[aria-label="Thanh điều hướng iOS"] > button > div[class*="-mt-4"] svg {
          width: 14px !important;
          height: 14px !important;
        }
        nav[aria-label="Thanh điều hướng iOS"] > button span {
          margin-top: 0 !important;
          font-size: 12px !important;
        }
        /* Chừa khoảng trống phía trên nội dung chính để không bị thanh top menu che */
        #root main {
          padding-top: 60px !important;
        }
      `;
      document.head.appendChild(st);
    }

    const syncChecklistNavPosition = () => {
      const hdr = document.querySelector('#root header');
      if (hdr && hdr.offsetHeight > 0) {
        document.documentElement.style.setProperty('--unified-cl-header-h', `${hdr.offsetHeight}px`);
      }
      const nav = document.querySelector('nav[aria-label="Thanh điều hướng iOS"]');
      if (nav) {
        const wrap = nav.closest('div.fixed') || (nav.parentElement && nav.parentElement.parentElement);
        if (wrap && !wrap.classList.contains('unified-cl-nav-wrap')) {
          wrap.classList.add('unified-cl-nav-wrap');
        }
      }
    };

    syncChecklistNavPosition();
    if (!checklistTopNavObserver) {
      checklistTopNavObserver = new MutationObserver(syncChecklistNavPosition);
      const rootEl = document.getElementById('root');
      if (rootEl) checklistTopNavObserver.observe(rootEl, { childList: true, subtree: true });
      window.addEventListener('resize', syncChecklistNavPosition);
    }
  }

  // ==================== 7. KHOẢNG ĐỆM ĐÁY AN TOÀN CHO STARDOCK ====================
  function applyDockOffsetToModule(dockState) {
    const active = Boolean(dockState && dockState.active);
    const offset = active ? Math.max(0, Number(dockState.offset) || 0) : 0;
    document.documentElement.style.setProperty('--unified-dock-offset', `${offset}px`);

    const existing = document.getElementById('unified-dock-clearance-css');
    if (!active) {
      if (existing) existing.remove();
      return;
    }

    if (!existing) {
      const st = document.createElement('style');
      st.id = 'unified-dock-clearance-css';
      st.textContent = `
        body {
          padding-bottom: calc(var(--unified-dock-offset, 74px) + 28px) !important;
          transition: padding-bottom 280ms ease;
        }
        #toast-container {
          bottom: calc(var(--unified-dock-offset, 74px) + 16px + env(safe-area-inset-bottom, 0px)) !important;
          transition: bottom 280ms cubic-bezier(0.22, 1, 0.36, 1) !important;
        }
        #root .fixed.bottom-6 {
          bottom: calc(var(--unified-dock-offset, 74px) + 1.25rem + env(safe-area-inset-bottom, 0px)) !important;
          transition: bottom 280ms cubic-bezier(0.22, 1, 0.36, 1) !important;
        }
      `;
      document.head.appendChild(st);
    }
  }

  // ==================== LẮNG NGHE GÓI TIN TỪ MASTER ====================
  window.addEventListener('message', function (event) {
    const data = event.data;
    if (!data || !data.type) return;

    if (data.type === 'UNIFIED_LOGOUT') {
      sessionStorage.clear();
      if (isDutyModule() && typeof window.handleLogout === 'function') window.handleLogout();
      if (isPowerModule() && typeof window.handleLogout === 'function') window.handleLogout();
      return;
    }

    if (data.type === 'BMS_LOG_SYNC') {
      applyBmsCloudSync(data);
      return;
    }

    if (data.type === 'UNIFIED_DOCK_STATE' && data.dockState) {
      applyDockOffsetToModule(data.dockState);
      return;
    }

    if (data.type !== 'UNIFIED_SYNC' || !data.currentUser) return;

    isApplyingFromMaster = true;
    lastMasterData = data;

    try {
      applyToDuty(data);
      applyToPower(data);
      applyToChecklist(data);
      applyToBmsLog(data);
      applyToStock(data);
      if (data.dockState) applyDockOffsetToModule(data.dockState);
    } finally {
      setTimeout(() => { isApplyingFromMaster = false; }, 400);
    }
  });

  // ==================== BÁO SẴN SÀNG & ĐỒNG BỘ CHIỀU NGƯỢC ====================
  window.addEventListener('load', function () {
    if (isChecklistModule()) standardizeChecklistTopMenuBar();
    if (isBmsLogModule()) standardizeBmsLogTopMenuBar();
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'MODULE_READY' }, '*');
    }

    if (isDutyModule()) {
      if (typeof window.applyCloudData === 'function') {
        const origApplyCloud = window.applyCloudData;
        window.applyCloudData = function (cloudState) {
          const res = origApplyCloud.apply(this, arguments);
          if (lastMasterData) {
            isApplyingFromMaster = true;
            try { applyToDuty(lastMasterData); } finally {
              setTimeout(() => { isApplyingFromMaster = false; }, 300);
            }
          }
          return res;
        };
      }

      if (typeof window.saveState === 'function') {
        const origSaveState = window.saveState;
        window.saveState = function () {
          const res = origSaveState.apply(this, arguments);
          if (!isApplyingFromMaster && window.parent && window.parent !== window) {
            const today = getTodayStr();
            const todaySchedule = (appState.schedule || []).filter(s => s.date === today);
            window.parent.postMessage({
              type: 'MODULE_TO_MASTER_SYNC',
              source: 'duty',
              todaySchedule
            }, '*');
          }
          return res;
        };
      }
    }

    if (isChecklistModule()) {
      setInterval(() => {
        if (isApplyingFromMaster) return;
        const currentRaw = localStorage.getItem('dailycheck_weekly_shifts_v1') || '';
        if (currentRaw && currentRaw !== lastChecklistWeeklyRaw) {
          lastChecklistWeeklyRaw = currentRaw;
          try {
            window.parent.postMessage({
              type: 'MODULE_TO_MASTER_SYNC',
              source: 'checklist',
              weeklyShifts: JSON.parse(currentRaw)
            }, '*');
          } catch {}
        }
      }, 1500);
    }

    if (isBmsLogModule() && typeof window.saveToStorage === 'function') {
      const origSaveToStorage = window.saveToStorage;
      window.saveToStorage = function () {
        const res = origSaveToStorage.apply(this, arguments);
        if (!isApplyingFromMaster && window.parent && window.parent !== window) {
          const h = JSON.stringify({ d: appState, l: datalogs || [] });
          if (h !== lastBmsSyncedHash) {
            lastBmsSyncedHash = h;
            window.parent.postMessage({
              type: 'BMS_LOG_UPDATE',
              deviceState: appState,
              datalogs: datalogs || []
            }, '*');
          }
        }
        return res;
      };
    }
  });
})();
