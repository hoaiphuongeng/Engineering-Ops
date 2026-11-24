/* bridge.js (v4) — Đồng Bộ User & SSO Tuyệt Đối Cho Tab Điện Nước, Sổ Duty & Checklist */
(function () {
  let isApplyingFromMaster = false;
  let lastMasterData = null;
  let powerSwitchPageHooked = false;
  let lastChecklistWeeklyRaw = localStorage.getItem('dailycheck_weekly_shifts_v1') || '';

  const POWER_STATE_KEY = 'RESORT_UTILITY_OS_STATE_V5';
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

  // ==================== 2. ĐIỆN NƯỚC (power.html) ====================
  function enforcePowerUserView() {
    if (!document.getElementById('unified-power-user-css')) {
      const st = document.createElement('style');
      st.id = 'unified-power-user-css';
      st.textContent = `
        /* Ẩn các mục ngoài Chỉ số công tơ & Thiết bị cho User nhân viên */
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

    // 1. Lấy danh sách powerUsers (đã băm SHA-256 chuẩn) và ghi đồng nhất vào localStorage
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
    } catch (e) {
      console.warn('Power localStorage sync warning:', e);
    }

    localStorage.setItem(POWER_SESSION_KEY, JSON.stringify({ username: u.username }));

    // 2. Kiểm tra trạng thái hiện tại trong DOM của power.html
    const overlay = document.getElementById('authOverlay');
    const isOverlayVisible = overlay && !overlay.classList.contains('hidden');
    const displayedUserEl = document.getElementById('accProfileUsername');
    const displayedUser = displayedUserEl ? displayedUserEl.textContent.replace('@', '').trim().toLowerCase() : '';
    const isDifferentUser = displayedUser && displayedUser !== String(u.username || '').toLowerCase();
    const isUsersListChanged = localSigBefore && localSigBefore !== incomingSig;

    // Nếu overlay đang hiện (chưa đăng nhập / vừa khởi tạo users rỗng) hoặc danh sách user/tài khoản vừa thay đổi
    // -> Nạp lại iframe power.html đúng 1 lần (chống lặp bằng sessionStorage theo chữ ký) để module nhận appState.users mới nhất
    const lastReloadedSig = sessionStorage.getItem('power_synced_sig_v4');
    if ((isOverlayVisible || isDifferentUser || isUsersListChanged) && lastReloadedSig !== incomingSig) {
      // Thử đăng nhập trực tiếp trước nếu danh sách user không đổi và form login đang sẵn sàng
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
          sessionStorage.setItem('power_synced_sig_v4', incomingSig);
          location.reload();
        }
      }, 250);
      return;
    }

    // Đã đồng bộ xong -> cập nhật bảng user & phân quyền giao diện
    sessionStorage.setItem('power_synced_sig_v4', incomingSig);
    if (typeof window.renderUsersTable === 'function') window.renderUsersTable();

    if (!isAdmin) {
      enforcePowerUserView();
    } else {
      restorePowerAdminView();
    }
  }

  // ==================== 3. CHECKLIST (checklist.html) ====================
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
