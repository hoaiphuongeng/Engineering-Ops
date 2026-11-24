/* bridge.js (v3) — Cầu nối SSO Tự Động Đăng Nhập, Đồng Nhất User 2 Chiều & Tối Giản Menu Nhân Viên */
(function () {
  let isApplyingFromMaster = false;
  let lastMasterData = null;
  let powerSwitchPageHooked = false;
  let lastChecklistWeeklyRaw = localStorage.getItem('dailycheck_weekly_shifts_v1') || '';

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

  // ÁP DỤNG SSO & DANH SÁCH USER CHO SỔ DUTY (duty.html)
  function applyToDuty(data) {
    if (!isDutyModule() || !data || !data.currentUser) return;
    const u = data.currentUser;
    const isAdmin = u.role === 'admin';

    appState.users = (data.staff || []).map(s => ({
      id: s.id,
      name: s.name,
      username: s.username,
      password: s.password,
      role: s.role === 'admin' ? 'Admin' : 'Kỹ thuật',
      status: 'Hoạt động'
    }));

    if (Array.isArray(data.dutyScheduleToday) && data.dutyScheduleToday.length > 0) {
      const nonSynced = (appState.schedule || []).filter(x => !String(x.id).startsWith('SCH-SYNC-'));
      appState.schedule = [...data.dutyScheduleToday, ...nonSynced];
    }

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

  // CHẶN CHUYỂN SANG CÁC TAB BỊ ẨN TRONG ĐIỆN NƯỚC KHI LÀ USER NHÂN VIÊN
  function enforcePowerUserView() {
    // Ẩn tất cả mục ngoài "Ghi Chỉ Số Công Tơ" (meters) & "Thiết Bị" (equipment)
    if (!document.getElementById('unified-power-user-css')) {
      const st = document.createElement('style');
      st.id = 'unified-power-user-css';
      st.textContent = `
        /* Ẩn các tab không dành cho User nhân viên (Desktop & Mobile) */
        #nav-dashboard, #nav-sld, #nav-accounts,
        #mnav-dashboard, #mnav-sld, #mnav-accounts,
        #page-dashboard, #page-sld, #page-accounts,
        #btnWipeReportToolbar, #headerPwaBtn, [data-admin-only] {
          display: none !important;
        }
        /* Ẩn khối Tiện ích Kỹ thuật & Backup/Restore trong Sidebar */
        aside .bg-blue-500\\/10 {
          display: none !important;
        }
        /* Nâng thanh chuyển 2 mục (Công tơ / Thiết bị) trên mobile lên trên thanh Stardock */
        @media (max-width: 1023px) {
          body {
            padding-bottom: 160px !important;
          }
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

    // Hook hàm switchPage để User chỉ mở được 'meters' hoặc 'equipment'
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

    // Nếu đang ở trang không được phép (vd: dashboard mặc định) -> chuyển thẳng sang Chỉ số công tơ
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

  // ÁP DỤNG SSO & DANH SÁCH USER CHO ĐIỆN NƯỚC (power.html)
  function applyToPower(data) {
    if (!isPowerModule() || !data || !data.currentUser) return;
    const u = data.currentUser;
    const isAdmin = u.role === 'admin';

    const overlay = document.getElementById('authOverlay');
    if (overlay && !overlay.classList.contains('hidden')) {
      const userInp = document.getElementById('loginUsername');
      const passInp = document.getElementById('loginPassword');
      if (userInp && passInp) {
        userInp.value = u.username;
        passInp.value = u.password;
        try {
          window.handleLogin({ preventDefault: function () {} });
        } catch (e) {
          console.warn('Power auto-login retry:', e);
        }
      }
      setTimeout(() => {
        const ov = document.getElementById('authOverlay');
        if (ov && !ov.classList.contains('hidden') && !sessionStorage.getItem('power_sso_reloaded')) {
          sessionStorage.setItem('power_sso_reloaded', '1');
          location.reload();
        }
      }, 450);
    } else {
      sessionStorage.removeItem('power_sso_reloaded');
      if (typeof window.renderUsersTable === 'function') window.renderUsersTable();
    }

    if (!isAdmin) {
      enforcePowerUserView();
    } else {
      restorePowerAdminView();
    }
  }

  // ÁP DỤNG SSO & GIAO DIỆN CHO CHECKLIST (checklist.html)
  function applyToChecklist(data) {
    if (!isChecklistModule() || !data || !data.currentUser) return;
    const u = data.currentUser;
    const isAdmin = u.role === 'admin';

    const curStoredId = localStorage.getItem('dailycheck_current_user_id_real_v1');
    if (curStoredId !== u.id) {
      localStorage.setItem('dailycheck_current_user_id_real_v1', u.id);
      if (!sessionStorage.getItem('checklist_sso_reloaded_' + u.id)) {
        sessionStorage.setItem('checklist_sso_reloaded_' + u.id, '1');
        location.reload();
        return;
      }
    }

    lastChecklistWeeklyRaw = localStorage.getItem('dailycheck_weekly_shifts_v1') || '';

    if (!isAdmin && !document.getElementById('unified-user-minimal-css')) {
      const st = document.createElement('style');
      st.id = 'unified-user-minimal-css';
      st.textContent = `body { padding-bottom: 92px !important; }`;
      document.head.appendChild(st);
    }
  }

  // CHIỀU 1: LẮNG NGHE GÓI TIN SSO & ĐỒNG BỘ TỪ MASTER (index.html)
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

  // CHIỀU 2: BÁO SẴN SÀNG & THEO DÕI THAY ĐỔI TỪ MODULE CON GỬI NGƯỢC LÊN MASTER
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
              users: appState.users || [],
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
