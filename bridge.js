/* bridge.js (v5) — SSO bằng Tài khoản Duty/Admin, Ánh xạ Người Thực Hiện HOÀN TOÀN theo Bảng Phân Ca */
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
  }

  // ==================== 2. ĐIỆN NƯỚC (power.html) ====================
  function enforcePowerUserView() {
    if (!document.getElementById('unified-power-user-css')) {
      const st = document.createElement('style');
      st.id = 'unified-power-user-css';
      st.textContent = `
        #nav-dashboard, #nav-sld, #nav-accounts,
        #mnav-dashboard, #mnav-sld, #mnav-accounts,
        #page-dashboard, #page-sld, #page-accounts,
        #btnWipeReportToolbar, #headerPwaBtn, [data-admin-only] {
          display: none !important;
        }
        aside .bg-blue-500\\/10 {
          display: none !important;
        }
        @media (max-width: 1023px) {
          body { padding-bottom: 160px !important; }
          nav.fixed.bottom-0 {
            bottom: calc(5.5rem + env(safe-area-inset-bottom, 0px)) !important;
            left: 50% !important;
            right: auto !important;
            transform: translateX(-50%) !important;
            width: min(86%, 300px) !important;
            border-radius: 1.25rem !important;
            border: 1px solid rgba(255, 255, 255, 0.2) !important;
            box-shadow: 0 10px 28px rgba(0, 0, 0, 0.35) !important;
            padding: 0.35rem 0.75rem !important;
          }
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
        return origSwitchPage.apply(this, arguments);
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

    if (!isAdmin && !document.getElementById('unified-user-minimal-css')) {
      const st = document.createElement('style');
      st.id = 'unified-user-minimal-css';
      st.textContent = `body { padding-bottom: 92px !important; }`;
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

    if (data.type !== 'UNIFIED_SYNC' || !data.currentUser) return;

    isApplyingFromMaster = true;
    lastMasterData = data;

    try {
      applyToDuty(data);
      applyToPower(data);
      applyToChecklist(data);
    } finally {
      setTimeout(() => { isApplyingFromMaster = false; }, 400);
    }
  });

  // ==================== BÁO SẴN SÀNG & ĐỒNG BỘ CHIỀU NGƯỢC ====================
  window.addEventListener('load', function () {
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
  });
})();
