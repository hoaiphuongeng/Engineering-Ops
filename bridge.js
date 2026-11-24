/* bridge-v7.js — SSO Tài khoản Duty/Admin, Ánh xạ Phân Ca, Ẩn Admin Tối Cao & Tối Giản Tab Điện Nước */
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
  // Tối giản giao diện Ghi Chỉ Số Công Tơ + Dời Menu Bar xuống sát đáy & Tự động ẩn
  let powerNavAutoHideInitialized = false;
  let powerNavHideTimer = null;

  function setPowerBottomNavVisible(visible) {
    const nav = document.querySelector('nav.fixed.bottom-0');
    const handle = document.getElementById('powerNavRevealHandle');
    if (nav) nav.classList.toggle('power-nav-autohidden', !visible);
    if (handle) handle.classList.toggle('handle-hidden', visible);
  }

  function schedulePowerNavAutoHide(delayMs = 3200) {
    clearTimeout(powerNavHideTimer);
    powerNavHideTimer = setTimeout(() => {
      setPowerBottomNavVisible(false);
    }, delayMs);
  }

  function initPowerBottomNavAutoHide() {
    if (powerNavAutoHideInitialized) {
      setPowerBottomNavVisible(true);
      schedulePowerNavAutoHide(3200);
      return;
    }
    const nav = document.querySelector('nav.fixed.bottom-0');
    if (!nav) return;
    powerNavAutoHideInitialized = true;

    // Tạo dấu nhận diện nhỏ sát mép dưới để chạm / rê chuột / vuốt lên mở lại menu bar
    if (!document.getElementById('powerNavRevealHandle')) {
      const handle = document.createElement('div');
      handle.id = 'powerNavRevealHandle';
      handle.className = 'handle-hidden';
      handle.title = 'Chạm hoặc vuốt lên để hiện thanh Công tơ / Thiết bị';
      handle.innerHTML = '<div class="power-nav-pill-bar"></div>';
      handle.addEventListener('click', () => {
        setPowerBottomNavVisible(true);
        schedulePowerNavAutoHide(4000);
      });
      handle.addEventListener('mouseenter', () => {
        setPowerBottomNavVisible(true);
        clearTimeout(powerNavHideTimer);
      });
      document.body.appendChild(handle);
    }

    // Tạm dừng tự ẩn khi đang rê chuột / chạm trên menu bar
    nav.addEventListener('mouseenter', () => clearTimeout(powerNavHideTimer));
    nav.addEventListener('mouseleave', () => schedulePowerNavAutoHide(2400));
    nav.addEventListener('touchstart', () => clearTimeout(powerNavHideTimer), { passive: true });
    nav.addEventListener('click', () => schedulePowerNavAutoHide(900));

    // Tự ẩn khi cuộn xuống, tự hiện khi cuộn lên hoặc ở đầu trang
    let lastScrollY = window.scrollY || 0;
    window.addEventListener('scroll', () => {
      if (!document.getElementById('unified-power-user-css')) return;
      const curY = window.scrollY || 0;
      if (curY > lastScrollY + 12 && curY > 40) {
        clearTimeout(powerNavHideTimer);
        setPowerBottomNavVisible(false);
      } else if (curY < lastScrollY - 14 || curY < 20) {
        setPowerBottomNavVisible(true);
        schedulePowerNavAutoHide(3200);
      }
      lastScrollY = curY;
    }, { passive: true });

    // Cử chỉ vuốt từ cạnh dưới màn hình lên để mở lại menu bar
    let bottomStartY = 0;
    let trackingBottom = false;
    document.addEventListener('touchstart', (e) => {
      if (!document.getElementById('unified-power-user-css')) return;
      if (!e.touches || e.touches.length !== 1) return;
      const y = e.touches[0].clientY;
      if (window.innerHeight - y <= 44) {
        bottomStartY = y;
        trackingBottom = true;
      }
    }, { passive: true });
    document.addEventListener('touchmove', (e) => {
      if (!trackingBottom || !e.touches || e.touches.length !== 1) return;
      const dy = bottomStartY - e.touches[0].clientY;
      if (dy > 18) {
        trackingBottom = false;
        setPowerBottomNavVisible(true);
        schedulePowerNavAutoHide(4000);
      }
    }, { passive: true });
    document.addEventListener('touchend', () => { trackingBottom = false; }, { passive: true });

    // Khi đang nhập số trong ô input -> ẩn ngay menu bar để không che bàn phím / nội dung
    document.addEventListener('focusin', (e) => {
      if (!document.getElementById('unified-power-user-css')) return;
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) {
        clearTimeout(powerNavHideTimer);
        setPowerBottomNavVisible(false);
      }
    });

    setPowerBottomNavVisible(true);
    schedulePowerNavAutoHide(3200);
  }

  function enforcePowerUserView() {
    if (!document.getElementById('unified-power-user-css')) {
      const st = document.createElement('style');
      st.id = 'unified-power-user-css';
      st.textContent = `
        /* 1. Ẩn toàn bộ các trang, sidebar desktop & nút không dành cho nhân viên */
        aside,
        #nav-dashboard, #nav-sld, #nav-accounts,
        #mnav-dashboard, #mnav-sld, #mnav-accounts,
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

        /* 6. Dời menu bar (Công tơ / Thiết bị) xuống sát dưới cùng & hỗ trợ tự động ẩn */
        body {
          padding-bottom: 72px !important;
        }
        nav.fixed.bottom-0 {
          display: flex !important;
          position: fixed !important;
          bottom: calc(0.45rem + env(safe-area-inset-bottom, 0px)) !important;
          left: 50% !important;
          right: auto !important;
          transform: translateX(-50%) !important;
          width: min(82%, 260px) !important;
          border-radius: 1.25rem !important;
          border: 1px solid rgba(255, 255, 255, 0.22) !important;
          box-shadow: 0 10px 28px rgba(0, 0, 0, 0.38) !important;
          padding: 0.3rem 0.75rem !important;
          z-index: 45 !important;
          transition: transform 300ms cubic-bezier(0.22, 1, 0.36, 1), opacity 220ms ease !important;
          will-change: transform, opacity;
        }
        nav.fixed.bottom-0.power-nav-autohidden {
          transform: translate(-50%, calc(100% + 1.5rem)) !important;
          opacity: 0 !important;
          pointer-events: none !important;
        }

        /* Dấu vạch nhỏ sát mép dưới khi menu bar đang ẩn */
        #powerNavRevealHandle {
          position: fixed;
          bottom: 0;
          left: 50%;
          transform: translateX(-50%);
          width: 140px;
          height: 24px;
          display: flex;
          align-items: flex-end;
          justify-content: center;
          padding-bottom: calc(5px + env(safe-area-inset-bottom, 0px));
          z-index: 44;
          cursor: pointer;
          transition: opacity 220ms ease, transform 240ms ease;
        }
        #powerNavRevealHandle.handle-hidden {
          opacity: 0;
          transform: translate(-50%, 100%);
          pointer-events: none;
        }
        .power-nav-pill-bar {
          width: 48px;
          height: 5px;
          border-radius: 9999px;
          background: linear-gradient(90deg, #38bdf8, #34d399);
          box-shadow: 0 0 10px rgba(56, 189, 248, 0.75);
          transition: width 180ms ease, height 180ms ease;
        }
        #powerNavRevealHandle:hover .power-nav-pill-bar,
        #powerNavRevealHandle:active .power-nav-pill-bar {
          width: 64px;
          height: 6px;
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

    initPowerBottomNavAutoHide();
  }

  function restorePowerAdminView() {
    clearTimeout(powerNavHideTimer);
    const st = document.getElementById('unified-power-user-css');
    if (st) st.remove();
    const handle = document.getElementById('powerNavRevealHandle');
    if (handle) handle.remove();
    const nav = document.querySelector('nav.fixed.bottom-0');
    if (nav) nav.classList.remove('power-nav-autohidden');
    powerNavAutoHideInitialized = false;
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
