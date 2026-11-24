/* bridge.js — Cầu nối SSO, Nhân sự, Phân ca & Tối giản giao diện User */
(function () {
  window.addEventListener('message', function (event) {
    const data = event.data;
    if (!data || data.type !== 'UNIFIED_SYNC' || !data.currentUser) return;

    const u = data.currentUser;
    const isAdmin = u.role === 'admin';

    // 1. MODULE DUTY LOGBOOK (duty.html)
    if (typeof window.appState !== 'undefined' && document.getElementById('login-screen')) {
      window.appState.users = data.staff.map(s => ({
        id: s.id, name: s.name, username: s.username, password: s.password,
        role: s.role === 'admin' ? 'Admin' : 'Kỹ thuật', status: 'Hoạt động'
      }));
      if (Array.isArray(data.dutyScheduleToday) && data.dutyScheduleToday.length > 0) {
        const nonSynced = (window.appState.schedule || []).filter(x => !String(x.id).startsWith('SCH-SYNC-'));
        window.appState.schedule = [...data.dutyScheduleToday, ...nonSynced];
      }
      window.appState.currentUser = window.appState.users.find(x => x.username === u.username) || window.appState.users[0];
      document.getElementById('login-screen').classList.add('hidden');
      if (typeof window.updateUserProfileUI === 'function') window.updateUserProfileUI();
      if (typeof window.renderAll === 'function') window.renderAll();

      // Tối giản menu cho User: ẩn nút Quản trị & chuyển thẳng vào Sổ công việc
      if (!isAdmin) {
        document.querySelectorAll('[onclick*="admin"], #nav-admin, #btn-nav-admin').forEach(el => el.style.display = 'none');
        if (typeof window.switchView === 'function') window.switchView('tasks');
      }
    }

    // 2. MODULE RESORT POWER (power.html)
    if (document.getElementById('authOverlay') && typeof window.completeLoginSession === 'function') {
      const powerUser = {
        username: u.username,
        fullName: u.name,
        role: isAdmin ? 'admin' : 'operator'
      };
      if (typeof window.resortState !== 'undefined' && Array.isArray(window.resortState.users)) {
        data.staff.forEach(s => {
          if (!window.resortState.users.some(pu => pu.username === s.username)) {
            window.resortState.users.push({ username: s.username, password: s.password, fullName: s.name, role: s.role === 'admin' ? 'admin' : 'operator' });
          }
        });
      }
      window.completeLoginSession(powerUser);
      if (typeof window.applyRolePermissionUI === 'function') window.applyRolePermissionUI();

      // Cấp User: ẩn các mục cấu hình/admin, giữ giao diện Ghi chỉ số điện nước gọn gàng
      if (!isAdmin) {
        document.querySelectorAll('[data-admin-only], #btnWipeReportToolbar').forEach(el => el.style.display = 'none');
      }
    }

    // 3. MODULE DAILY CHECKLIST (checklist.html — React bundle)
    if (document.getElementById('root') && !document.getElementById('authOverlay') && !document.getElementById('login-screen')) {
      // Dữ liệu nhân sự & lịch trực đã được ghi vào localStorage (dailycheck_employees_real_v1, dailycheck_weekly_shifts_v1)
      // Ẩn các nút quản trị nâng cao nếu là User (chừa lại luồng kiểm tra biểu mẫu)
      if (!isAdmin) {
        const styleId = 'unified-user-minimal-css';
        if (!document.getElementById(styleId)) {
          const st = document.createElement('style');
          st.id = styleId;
          st.textContent = `body { padding-bottom: 84px !important; }`;
          document.head.appendChild(st);
        }
      }
    }
  });
})();