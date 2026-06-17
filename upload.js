(function () {
  'use strict';

  function parseJsonResponse(res) {
    var ct = (res.headers.get('Content-Type') || '').toLowerCase();
    return res.text().then(function (text) {
      if (ct.indexOf('application/json') !== -1 || (text.trim().charAt(0) === '{') || (text.trim().charAt(0) === '[')) {
        try { return JSON.parse(text); } catch (e) { throw new Error('Invalid JSON'); }
      }
      throw new Error('Server did not return JSON');
    });
  }

  function getDefaultBusinessHours() {
    var out = {};
    for (var d = 0; d <= 6; d++) {
      out[d] = { start: '00:00', end: '24:00' };
    }
    return out;
  }

  function fillTimeOptions(selectEl, endMode) {
    if (!selectEl) return;
    selectEl.innerHTML = '';
    var i, j, t, o;
    if (endMode) {
      for (j = 1; j <= 24; j++) {
        t = j === 24 ? '24:00' : (j < 10 ? '0' : '') + j + ':00';
        o = document.createElement('option');
        o.value = t;
        o.textContent = t;
        selectEl.appendChild(o);
      }
    } else {
      for (i = 0; i < 24; i++) {
        t = (i < 10 ? '0' : '') + i + ':00';
        o = document.createElement('option');
        o.value = t;
        o.textContent = t;
        selectEl.appendChild(o);
      }
    }
  }

  function applySettingsToForm(settings) {
    settings = settings || getDefaultBusinessHours();
    for (var d = 0; d <= 6; d++) {
      var startEl = document.getElementById('bh-start-' + d);
      var endEl = document.getElementById('bh-end-' + d);
      var day = settings[d] || settings[String(d)];
      if (startEl) startEl.value = (day && day.start) ? day.start : '00:00';
      if (endEl) endEl.value = (day && day.end) ? day.end : '24:00';
    }
  }

  function getBhStoreId() {
    var sel = document.getElementById('bh-store-select');
    return (sel && sel.value ? String(sel.value).trim() : 'default') || 'default';
  }

  function loadBusinessHoursStoreSelect(selectedStoreId) {
    var sel = document.getElementById('bh-store-select');
    if (!sel) return Promise.resolve(getBhStoreId());
    return fetch('/api/stores').then(function (res) { return parseJsonResponse(res); }).then(function (body) {
      var stores = body && body.stores ? body.stores : [];
      if (!stores.length) stores = [{ id: 'default', name: 'Default' }];
      var keep = selectedStoreId || sel.value || 'default';
      sel.innerHTML = '';
      stores.forEach(function (s) {
        var opt = document.createElement('option');
        opt.value = s.id || 'default';
        opt.textContent = s.name || s.id || 'default';
        sel.appendChild(opt);
      });
      if (keep && Array.prototype.some.call(sel.options, function (o) { return o.value === keep; })) {
        sel.value = keep;
      } else {
        sel.value = stores[0].id || 'default';
      }
      return sel.value;
    }).catch(function () {
      sel.innerHTML = '<option value="default">Default</option>';
      sel.value = 'default';
      return 'default';
    });
  }

  function loadBusinessHoursSettings(storeId) {
    var targetStoreId = (storeId || getBhStoreId() || 'default').trim() || 'default';
    return fetch('/api/business-hours?storeId=' + encodeURIComponent(targetStoreId))
      .then(function (res) { return parseJsonResponse(res); })
      .then(function (settings) {
        if (settings && typeof settings === 'object') applySettingsToForm(settings);
        else applySettingsToForm(getDefaultBusinessHours());
      })
      .catch(function () { applySettingsToForm(getDefaultBusinessHours()); });
  }

  function initBusinessHoursUI() {
    for (var d = 0; d <= 6; d++) {
      var startEl = document.getElementById('bh-start-' + d);
      var endEl = document.getElementById('bh-end-' + d);
      if (startEl) fillTimeOptions(startEl, false);
      if (endEl) fillTimeOptions(endEl, true);
    }
    loadBusinessHoursStoreSelect().then(function (storeId) {
      return loadBusinessHoursSettings(storeId);
    });
    var storeSel = document.getElementById('bh-store-select');
    if (storeSel) {
      storeSel.addEventListener('change', function () {
        loadBusinessHoursSettings(getBhStoreId());
      });
    }
  }

  function collectBusinessHoursFromForm() {
    var settings = {};
    for (var d = 0; d <= 6; d++) {
      var startEl = document.getElementById('bh-start-' + d);
      var endEl = document.getElementById('bh-end-' + d);
      settings[d] = {
        start: (startEl && startEl.value) ? startEl.value : '00:00',
        end: (endEl && endEl.value) ? endEl.value : '24:00'
      };
    }
    return settings;
  }

  function switchUploadTab(tabName) {
    document.querySelectorAll('.tabs .tab').forEach(function (btn) {
      var isActive = btn.getAttribute('data-tab') === tabName;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    document.querySelectorAll('main .panel').forEach(function (panel) {
      panel.classList.toggle('active', panel.id === tabName + '-panel');
    });
  }

  function formatReceivedAt(isoStr) {
    if (!isoStr) return '—';
    try {
      var d = new Date(isoStr);
      if (isNaN(d.getTime())) return isoStr;
      var y = d.getFullYear();
      var m = String(d.getMonth() + 1).padStart(2, '0');
      var day = String(d.getDate()).padStart(2, '0');
      var h = String(d.getHours()).padStart(2, '0');
      var min = String(d.getMinutes()).padStart(2, '0');
      var s = String(d.getSeconds()).padStart(2, '0');
      return y + '-' + m + '-' + day + ' ' + h + ':' + min + ':' + s;
    } catch (e) { return isoStr; }
  }

  function loadUploadLog() {
    var tbody = document.getElementById('upload-log-tbody');
    var emptyEl = document.getElementById('upload-log-empty');
    if (!tbody) return;
    if (emptyEl) emptyEl.textContent = '読み込み中…';
    fetch('/api/upload-log').then(function (res) { return parseJsonResponse(res); }).then(function (body) {
      var logs = body.logs || [];
      tbody.innerHTML = '';
      logs.forEach(function (row) {
        var tr = document.createElement('tr');
        tr.innerHTML = '<td>' + formatReceivedAt(row.receivedAt).replace(/</g, '&lt;') + '</td>' +
          '<td>' + (row.storeId || '').replace(/</g, '&lt;') + '</td>' +
          '<td>' + (row.businessDate || '').replace(/</g, '&lt;') + '</td>';
        tbody.appendChild(tr);
      });
      if (emptyEl) emptyEl.textContent = logs.length === 0 ? 'データがありません。' : '';
    }).catch(function () {
      tbody.innerHTML = '';
      if (emptyEl) emptyEl.textContent = '読み込みに失敗しました。';
    });
  }

  document.querySelectorAll('.tabs .tab').forEach(function (btn) {
    btn.addEventListener('click', function () {
      switchUploadTab(btn.getAttribute('data-tab'));
    });
  });

  function loadStoresMaster() {
    var tbody = document.getElementById('stores-tbody');
    var rateInput = document.getElementById('exchange-rate-input');
    var updatedAtEl = document.getElementById('exchange-rate-updated-at');
    if (!tbody) return;
    fetch('/api/stores').then(function (res) { return parseJsonResponse(res); }).then(function (body) {
      var stores = body.stores || [];
      if (stores.length === 0) stores = [{ id: 'default', name: 'Default' }];
      if (rateInput) rateInput.value = body.exchangeRate != null && body.exchangeRate !== '' ? String(body.exchangeRate) : '';
      if (updatedAtEl) updatedAtEl.textContent = body.exchangeRateUpdatedAt ? formatUserDate(body.exchangeRateUpdatedAt) : '—';
      tbody.innerHTML = '';
      stores.forEach(function (s) {
        var tr = document.createElement('tr');
        tr.innerHTML = '<td><input type="text" class="store-id-input" value="' + (s.id || '').replace(/"/g, '&quot;') + '" placeholder="e.g. default" maxlength="32"></td>' +
          '<td><input type="text" class="store-name-input" value="' + (s.name || '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '" placeholder="店舗名"></td>' +
          '<td><button type="button" class="btn-delete-store">削除</button></td>';
        var deleteBtn = tr.querySelector('.btn-delete-store');
        if (deleteBtn) deleteBtn.addEventListener('click', function () {
          if (tbody.querySelectorAll('tr').length <= 1) return;
          tr.remove();
        });
        tbody.appendChild(tr);
      });
    }).catch(function () {
      if (rateInput) rateInput.value = '';
      if (updatedAtEl) updatedAtEl.textContent = '—';
      tbody.innerHTML = '<tr><td><input type="text" class="store-id-input" value="default" placeholder="ID"></td><td><input type="text" class="store-name-input" value="Default" placeholder="店舗名"></td><td><button type="button" class="btn-delete-store">削除</button></td></tr>';
    });
  }

  function collectStoresFromTable() {
    var tbody = document.getElementById('stores-tbody');
    if (!tbody) return [];
    var rows = tbody.querySelectorAll('tr');
    var list = [];
    for (var i = 0; i < rows.length; i++) {
      var idIn = rows[i].querySelector('.store-id-input');
      var nameIn = rows[i].querySelector('.store-name-input');
      var id = idIn ? String(idIn.value || '').trim() : '';
      var name = nameIn ? String(nameIn.value || '').trim() : '';
      if (id) list.push({ id: id, name: name || id });
    }
    return list;
  }

  document.querySelectorAll('.tabs .tab').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var tab = btn.getAttribute('data-tab');
      switchUploadTab(tab);
      if (tab === 'stores') loadStoresMaster();
      if (tab === 'log') loadUploadLog();
      if (tab === 'monitoring') loadMonitoring();
      if (tab === 'audit') loadAuditLog();
      if (tab === 'users') loadUsers();
      if (tab === 'product-master') loadProductMasterList();
      if (tab === 'classification') loadClassificationList();
    });
  });

  // ---- Monitoring ----
  function fmtAge(seconds) {
    if (seconds == null || !isFinite(seconds)) return '—';
    var s = Math.max(0, Math.round(seconds));
    if (s < 60) return s + '秒';
    if (s < 3600) return Math.round(s / 60) + '分';
    if (s < 86400) return (s / 3600).toFixed(1) + '時間';
    return (s / 86400).toFixed(1) + '日';
  }

  function loadMonitoring() {
    var fv = document.getElementById('monitor-freshness-value');
    var fs = document.getElementById('monitor-freshness-sub');
    var lv = document.getElementById('monitor-latest-value');
    var ls = document.getElementById('monitor-latest-sub');
    var tv = document.getElementById('monitor-today-value');
    var ts = document.getElementById('monitor-today-sub');
    var updated = document.getElementById('monitor-updated');
    if (fv) fv.textContent = '読み込み中…';

    // Data freshness probe (machine endpoint reused for the human view).
    fetch('/api/health/freshness').then(function (r) { return r.json().catch(function () { return {}; }); }).then(function (b) {
      if (!fv) return;
      var outside = b && b.outsideHours;
      var stale = b && b.stale;
      if (outside) {
        // Closed / before opening: staleness monitoring is paused, not an error.
        fv.textContent = '休止中（営業時間外）';
        fv.className = 'monitor-card-value is-good';
      } else {
        fv.textContent = stale ? '⚠ 鮮度低下' : '✓ 最新';
        fv.className = 'monitor-card-value ' + (stale ? 'is-bad' : 'is-good');
      }
      if (fs) {
        if (b && b.reason === 'no_uploads') fs.textContent = 'アップロード履歴がありません';
        else if (b && b.ageSeconds != null) {
          var base = '最終受信から ' + fmtAge(b.ageSeconds) + '（閾値 ' + fmtAge(b.thresholdSeconds) + '）';
          fs.textContent = outside ? base + ' / 営業時間外のため監視停止中' : base;
        } else fs.textContent = '';
      }
    }).catch(function () { if (fv) { fv.textContent = '取得失敗'; fv.className = 'monitor-card-value is-bad'; } });

    // Latest reception + today's count from the upload log.
    fetch('/api/upload-log?limit=500').then(function (res) { return parseJsonResponse(res); }).then(function (body) {
      var logs = (body && body.logs) || [];
      if (lv) {
        if (logs.length === 0) { lv.textContent = 'データなし'; if (ls) ls.textContent = ''; }
        else {
          lv.textContent = formatReceivedAt(logs[0].receivedAt);
          if (ls) ls.textContent = '店舗 ' + escapeHtml(logs[0].storeId || '') + ' / 取引日 ' + escapeHtml(logs[0].businessDate || '');
        }
      }
      if (tv) {
        var today = new Date();
        var pad = function (n) { return (n < 10 ? '0' : '') + n; };
        var todayStr = today.getFullYear() + '-' + pad(today.getMonth() + 1) + '-' + pad(today.getDate());
        var count = logs.filter(function (r) {
          var d = r.receivedAt ? String(r.receivedAt).slice(0, 10) : '';
          // receivedAt is UTC; this is a rough local-day count, good enough for a glance.
          return d === todayStr;
        }).length;
        tv.textContent = String(count) + ' 件';
        if (ts) ts.textContent = '本日アップロードされたレポート数';
      }
      if (updated) updated.textContent = '更新: ' + formatReceivedAt(new Date().toISOString());
    }).catch(function () {
      if (lv) lv.textContent = '取得失敗';
      if (tv) tv.textContent = '—';
    });
  }

  var monitorRefreshBtn = document.getElementById('monitor-refresh');
  if (monitorRefreshBtn) monitorRefreshBtn.addEventListener('click', loadMonitoring);

  // ---- Audit log ----
  var auditEntriesCache = [];
  function renderAuditLog() {
    var tbody = document.getElementById('audit-tbody');
    var emptyEl = document.getElementById('audit-empty');
    var actionFilter = document.getElementById('audit-filter-action');
    var searchEl = document.getElementById('audit-search');
    if (!tbody) return;
    var fAction = actionFilter ? actionFilter.value : '';
    var q = searchEl ? searchEl.value.trim().toLowerCase() : '';
    var rows = auditEntriesCache.filter(function (e) {
      if (fAction && e.action !== fAction) return false;
      if (q) {
        var hay = (String(e.actor || '') + ' ' + String(e.action || '') + ' ' + String(e.ip || '') + ' ' + JSON.stringify(e.detail || '')).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
    tbody.innerHTML = rows.map(function (e) {
      var detail = e.detail ? JSON.stringify(e.detail) : '';
      return '<tr>' +
        '<td>' + escapeHtml(formatReceivedAt(e.ts)) + '</td>' +
        '<td>' + escapeHtml(e.actor || '') + '</td>' +
        '<td><span class="audit-action audit-' + escapeHtml(String(e.action || '').replace(/[^a-z_]/gi, '')) + '">' + escapeHtml(e.action || '') + '</span></td>' +
        '<td>' + escapeHtml(e.ip || '') + '</td>' +
        '<td class="audit-detail">' + escapeHtml(detail) + '</td>' +
        '</tr>';
    }).join('');
    if (emptyEl) emptyEl.textContent = rows.length === 0 ? '該当する記録がありません。' : '';
  }

  function loadAuditLog() {
    var emptyEl = document.getElementById('audit-empty');
    if (emptyEl) emptyEl.textContent = '読み込み中…';
    fetch('/api/audit-log?limit=1000').then(function (res) { return parseJsonResponse(res); }).then(function (body) {
      auditEntriesCache = (body && body.entries) || [];
      // Populate the action filter with the distinct actions present.
      var actionFilter = document.getElementById('audit-filter-action');
      if (actionFilter) {
        var actions = {};
        auditEntriesCache.forEach(function (e) { if (e.action) actions[e.action] = true; });
        var cur = actionFilter.value;
        actionFilter.innerHTML = '<option value="">すべて</option>' +
          Object.keys(actions).sort().map(function (a) { return '<option value="' + escapeHtml(a) + '">' + escapeHtml(a) + '</option>'; }).join('');
        actionFilter.value = cur;
      }
      renderAuditLog();
    }).catch(function () {
      var tbody = document.getElementById('audit-tbody');
      if (tbody) tbody.innerHTML = '';
      if (emptyEl) emptyEl.textContent = '読み込みに失敗しました。';
    });
  }

  var auditRefreshBtn = document.getElementById('audit-refresh');
  if (auditRefreshBtn) auditRefreshBtn.addEventListener('click', loadAuditLog);
  var auditActionFilter = document.getElementById('audit-filter-action');
  if (auditActionFilter) auditActionFilter.addEventListener('change', renderAuditLog);
  var auditSearchEl = document.getElementById('audit-search');
  if (auditSearchEl) auditSearchEl.addEventListener('input', renderAuditLog);

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function formatUserDate(createdAt) {
    if (!createdAt) return '—';
    try {
      var d = new Date(createdAt);
      if (isNaN(d.getTime())) return createdAt;
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + ' ' +
        String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    } catch (e) { return createdAt; }
  }

  var currentUserId = null;
  var isExternalAuth = false;

  function getCurrencyLabel(code) {
    if (code === 'JPY') return '円 (JPY)';
    if (code === 'THB') return 'バーツ (THB)';
    return '—';
  }

  function getLanguageLabel(code) {
    if (code === 'ja') return '日本語';
    if (code === 'en') return 'English';
    if (code === 'th') return 'ไทย';
    return '—';
  }

  function syncUserPasswordFieldsVisibility() {
    var groups = document.querySelectorAll('.user-password-group');
    groups.forEach(function (g) { g.style.display = isExternalAuth ? 'none' : ''; });
    var optional = document.getElementById('user-password-optional');
    if (optional) optional.style.display = isExternalAuth ? 'none' : (document.getElementById('user-edit-id').value ? '' : 'none');
  }

  function fillUserStoreSelect(stores) {
    var sel = document.getElementById('user-preferred-store');
    if (!sel) return;
    var currentVal = sel.value;
    sel.innerHTML = '<option value="">— 未設定 —</option>';
    (stores || []).forEach(function (s) {
      var opt = document.createElement('option');
      opt.value = s.id || s.name;
      opt.textContent = s.name || s.id || '';
      sel.appendChild(opt);
    });
    if (currentVal && Array.prototype.some.call(sel.options, function (o) { return o.value === currentVal; })) sel.value = currentVal;
  }

  function loadUsers() {
    var tbody = document.getElementById('users-tbody');
    var emptyEl = document.getElementById('users-empty');
    if (!tbody) return;
    if (emptyEl) emptyEl.textContent = '読み込み中…';
    Promise.all([
      fetch('/api/auth/status').then(function (r) { return r.json(); }),
      fetch('/api/users').then(function (r) { return parseJsonResponse(r); }),
      fetch('/api/stores').then(function (r) { return parseJsonResponse(r); })
    ]).then(function (results) {
      currentUserId = results[0].userId || null;
      isExternalAuth = !!results[0].externalAuth;
      syncUserPasswordFieldsVisibility();
      var body = results[1];
      var users = body.users || [];
      var storesBody = results[2];
      var stores = (storesBody && storesBody.stores) ? storesBody.stores : [];
      fillUserStoreSelect(stores);
      tbody.innerHTML = '';
      users.forEach(function (u) {
        var tr = document.createElement('tr');
        var roleLabel = (u.role === 'admin') ? '管理者' : '一般';
        var isSelf = currentUserId && u.id === currentUserId;
        var storeLabel = (u.preferred_store && stores.length) ? (stores.find(function (s) { return (s.id || s.name) === u.preferred_store; }) || {}).name || u.preferred_store : '—';
        var deptLabel = u.preferred_department || '—';
        var currencyLabel = getCurrencyLabel(u.preferred_currency);
        var languageLabel = getLanguageLabel(u.preferred_language);
        var displayName = u.display_name || u.username || '—';
        tr.innerHTML = '<td>' + escapeHtml(u.username) + '</td>' +
          '<td>' + escapeHtml(displayName) + '</td>' +
          '<td>' + escapeHtml(roleLabel) + '</td>' +
          '<td>' + escapeHtml(storeLabel) + '</td>' +
          '<td>' + escapeHtml(deptLabel) + '</td>' +
          '<td>' + escapeHtml(currencyLabel) + '</td>' +
          '<td>' + escapeHtml(languageLabel) + '</td>' +
          '<td>' + escapeHtml(formatUserDate(u.created_at)) + '</td>' +
          '<td>' + escapeHtml(formatUserDate(u.last_login)) + '</td>' +
          '<td><button type="button" class="btn-edit-user" data-id="' + escapeHtml(u.id) + '" data-username="' + escapeHtml(u.username) + '" data-display-name="' + escapeHtml(u.display_name || '') + '" data-role="' + escapeHtml(u.role) + '">変更</button> ' +
          '<button type="button" class="btn-delete-user" data-id="' + escapeHtml(u.id) + '"' + (isSelf ? ' disabled title="自分自身は削除できません"' : '') + '>削除</button></td>';
        tr.querySelector('.btn-edit-user').addEventListener('click', function () {
          showUserEditForm(u.id, u.username, u.display_name, u.role, u.preferred_store, u.preferred_department, u.preferred_currency, u.preferred_language);
        });
        var delBtn = tr.querySelector('.btn-delete-user');
        if (!delBtn.disabled) {
          delBtn.addEventListener('click', function () {
            if (!window.confirm('ユーザー「' + u.username + '」を削除してもよろしいですか？')) return;
            fetch('/api/users/' + encodeURIComponent(u.id), { method: 'DELETE' })
              .then(function (res) {
                if (res.status === 204) loadUsers();
                else return res.json().then(function (data) { throw new Error(data.error || 'Delete failed'); });
              })
              .catch(function (err) {
                window.alert(err.message || '削除に失敗しました。');
              });
          });
        }
        tbody.appendChild(tr);
      });
      if (emptyEl) emptyEl.textContent = users.length === 0 ? 'ユーザーがありません。' : '';
    }).catch(function () {
      tbody.innerHTML = '';
      if (emptyEl) emptyEl.textContent = '読み込みに失敗しました。';
    });
  }

  function showUserEditForm(id, username, displayName, role, preferredStore, preferredDepartment, preferredCurrency, preferredLanguage) {
    document.getElementById('user-edit-id').value = id || '';
    document.getElementById('user-username').value = username || '';
    document.getElementById('user-display-name').value = displayName || '';
    var pwEl = document.getElementById('user-password');
    var pw2El = document.getElementById('user-password-confirm');
    if (pwEl) pwEl.value = '';
    if (pw2El) pw2El.value = '';
    document.getElementById('user-role').value = (role === 'admin') ? 'admin' : 'user';
    var storeSel = document.getElementById('user-preferred-store');
    if (storeSel) {
      storeSel.value = (preferredStore && Array.prototype.some.call(storeSel.options, function (o) { return o.value === preferredStore; })) ? preferredStore : '';
    }
    var deptSel = document.getElementById('user-preferred-department');
    if (deptSel) deptSel.value = preferredDepartment || 'Total';
    var currencySel = document.getElementById('user-preferred-currency');
    if (currencySel) currencySel.value = (preferredCurrency === 'JPY' || preferredCurrency === 'THB') ? preferredCurrency : 'THB';
    var languageSel = document.getElementById('user-preferred-language');
    if (languageSel) languageSel.value = (preferredLanguage === 'ja' || preferredLanguage === 'en' || preferredLanguage === 'th') ? preferredLanguage : 'ja';
    document.getElementById('users-form-title').textContent = '変更';
    var pwOptionalEl = document.getElementById('user-password-optional');
    if (pwOptionalEl) pwOptionalEl.style.display = isExternalAuth ? 'none' : '';
    document.getElementById('users-form-submit').textContent = '更新';
    document.getElementById('users-form-cancel').style.display = 'inline-block';
    document.getElementById('users-form-error').hidden = true;
    syncUserPasswordFieldsVisibility();
  }

  function showUserNewForm() {
    document.getElementById('user-edit-id').value = '';
    document.getElementById('user-username').value = '';
    document.getElementById('user-display-name').value = '';
    var pwEl = document.getElementById('user-password');
    var pw2El = document.getElementById('user-password-confirm');
    if (pwEl) pwEl.value = '';
    if (pw2El) pw2El.value = '';
    document.getElementById('user-role').value = 'user';
    var storeSel = document.getElementById('user-preferred-store');
    if (storeSel) storeSel.value = '';
    var deptSel = document.getElementById('user-preferred-department');
    if (deptSel) deptSel.value = 'Total';
    var currencySel = document.getElementById('user-preferred-currency');
    if (currencySel) currencySel.value = 'THB';
    var languageSel = document.getElementById('user-preferred-language');
    if (languageSel) languageSel.value = 'ja';
    document.getElementById('users-form-title').textContent = '新規作成';
    var pwOptionalEl = document.getElementById('user-password-optional');
    if (pwOptionalEl) pwOptionalEl.style.display = 'none';
    document.getElementById('users-form-submit').textContent = '作成';
    document.getElementById('users-form-cancel').style.display = 'none';
    document.getElementById('users-form-error').hidden = true;
    syncUserPasswordFieldsVisibility();
  }

  var usersForm = document.getElementById('users-form');
  var usersFormError = document.getElementById('users-form-error');
  if (usersForm) {
    usersForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var id = document.getElementById('user-edit-id').value.trim();
      var username = document.getElementById('user-username').value.trim();
      var displayName = document.getElementById('user-display-name').value.trim();
      var passwordEl = document.getElementById('user-password');
      var passwordConfirmEl = document.getElementById('user-password-confirm');
      var password = passwordEl ? passwordEl.value : '';
      var passwordConfirm = passwordConfirmEl ? passwordConfirmEl.value : '';
      var role = document.getElementById('user-role').value;
      usersFormError.hidden = true;
      usersFormError.textContent = '';
      if (!username) {
        usersFormError.textContent = 'ユーザー名を入力してください。';
        usersFormError.hidden = false;
        return;
      }
      if (!isExternalAuth) {
        if (id) {
          if (password || passwordConfirm) {
            if (password !== passwordConfirm) {
              usersFormError.textContent = 'パスワードとパスワード（確認）が一致しません。';
              usersFormError.hidden = false;
              return;
            }
            if (password.length > 0 && password.length < 6) {
              usersFormError.textContent = 'パスワードは6文字以上で入力してください。';
              usersFormError.hidden = false;
              return;
            }
          }
        } else {
          if (!password || password.length < 6) {
            usersFormError.textContent = '新規作成時はパスワードを6文字以上で入力してください。';
            usersFormError.hidden = false;
            return;
          }
          if (password !== passwordConfirm) {
            usersFormError.textContent = 'パスワードとパスワード（確認）が一致しません。';
            usersFormError.hidden = false;
            return;
          }
        }
      }
      var preferredStore = document.getElementById('user-preferred-store').value || null;
      var preferredDepartment = document.getElementById('user-preferred-department').value || null;
      var preferredCurrency = document.getElementById('user-preferred-currency').value || 'THB';
      var preferredLanguage = document.getElementById('user-preferred-language').value || 'ja';
      if (id) {
        var payload = {
          username: username,
          displayName: displayName,
          role: role,
          preferredStore: preferredStore,
          preferredDepartment: preferredDepartment,
          preferredCurrency: preferredCurrency,
          preferredLanguage: preferredLanguage
        };
        if (!isExternalAuth && password.length >= 6) payload.password = password;
        fetch('/api/users/' + encodeURIComponent(id), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }).then(function (res) { return res.json().then(function (data) { return { res: res, data: data }; }); })
          .then(function (_) {
            if (!_.res.ok) throw new Error(_.data.error || 'Update failed');
            showUserNewForm();
            loadUsers();
          })
          .catch(function (err) {
            usersFormError.textContent = err.message || '更新に失敗しました。';
            usersFormError.hidden = false;
          });
      } else {
        fetch('/api/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: username,
            displayName: displayName,
            role: role,
            preferredStore: preferredStore,
            preferredDepartment: preferredDepartment,
            preferredCurrency: preferredCurrency,
            preferredLanguage: preferredLanguage,
            password: isExternalAuth ? undefined : password
          })
        }).then(function (res) { return res.json().then(function (data) { return { res: res, data: data }; }); })
          .then(function (_) {
            if (!_.res.ok) throw new Error(_.data.error || 'Create failed');
            document.getElementById('user-username').value = '';
            document.getElementById('user-display-name').value = '';
            if (passwordEl) passwordEl.value = '';
            loadUsers();
          })
          .catch(function (err) {
            usersFormError.textContent = err.message || '作成に失敗しました。';
            usersFormError.hidden = false;
          });
      }
    });
  }
  var usersFormCancel = document.getElementById('users-form-cancel');
  if (usersFormCancel) {
    usersFormCancel.addEventListener('click', showUserNewForm);
  }

  var btnAddStore = document.getElementById('btn-add-store');
  var btnSaveStores = document.getElementById('btn-save-stores');
  var storesSaveStatus = document.getElementById('stores-save-status');
  if (btnAddStore) {
    btnAddStore.addEventListener('click', function () {
      var tbody = document.getElementById('stores-tbody');
      if (!tbody) return;
      var tr = document.createElement('tr');
      tr.innerHTML = '<td><input type="text" class="store-id-input" value="" placeholder="e.g. S001" maxlength="32"></td>' +
        '<td><input type="text" class="store-name-input" value="" placeholder="店舗名"></td>' +
        '<td><button type="button" class="btn-delete-store">削除</button></td>';
      tr.querySelector('.btn-delete-store').addEventListener('click', function () {
        if (tbody.querySelectorAll('tr').length <= 1) return;
        tr.remove();
      });
      tbody.appendChild(tr);
    });
  }
  if (btnSaveStores && storesSaveStatus) {
    btnSaveStores.addEventListener('click', function () {
      var list = collectStoresFromTable();
      var ids = {};
      for (var j = 0; j < list.length; j++) {
        if (ids[list[j].id]) {
          storesSaveStatus.textContent = 'ID が重複しています: ' + list[j].id;
          return;
        }
        ids[list[j].id] = true;
      }
      if (list.length === 0) {
        storesSaveStatus.textContent = '少なくとも1件の店舗を登録してください。';
        return;
      }
      var rateEl = document.getElementById('exchange-rate-input');
      var rateVal = rateEl && rateEl.value.trim() !== '' ? parseFloat(rateEl.value) : null;
      var payload = { stores: list };
      if (rateVal != null && Number.isFinite(rateVal) && rateVal > 0) payload.exchange_rate = rateVal;
      storesSaveStatus.textContent = '保存中…';
      fetch('/api/stores', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).then(function (res) {
        return parseJsonResponse(res).then(function (data) {
          if (!res.ok) throw new Error(data.error || 'Save failed');
          return data;
        });
      }).then(function () {
        storesSaveStatus.textContent = '保存しました。';
        loadStoresMaster();
        loadBusinessHoursStoreSelect(getBhStoreId());
      }).catch(function (err) {
        storesSaveStatus.textContent = err.message || '保存に失敗しました。';
      });
    });
  }

  // --- 商品マスター一覧 ---
  var productMasterAll = [];

  function renderProductMasterTable(items) {
    var tbody = document.getElementById('product-master-list-tbody');
    var countEl = document.getElementById('product-master-list-count');
    if (!tbody) return;
    // Format numeric value: blank when null/undefined, locale string with up to 2 decimals otherwise.
    function fmtNum(v) {
      if (v == null || v === '') return '';
      var n = Number(v);
      if (!isFinite(n)) return '';
      return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
    }
    tbody.innerHTML = '';
    items.forEach(function (item) {
      // Brand / size: prefer ENG, fall back to THA so Thai-only rows still show something.
      var brand = item.brandEng || item.brandTha || '';
      var sizeSpec = item.sizeSpecEng || item.sizeSpecTha || '';
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' + escapeHtml(item.itemNo) + '</td>' +
        '<td>' + escapeHtml(item.barcodeNo || '') + '</td>' +
        '<td>' + escapeHtml(item.vendorNo || '') + '</td>' +
        '<td>' + escapeHtml(brand) + '</td>' +
        '<td>' + escapeHtml(item.nameEng || '') + '</td>' +
        '<td>' + escapeHtml(item.nameTha || '') + '</td>' +
        '<td>' + escapeHtml(item.nameJpn || '') + '</td>' +
        '<td>' + escapeHtml(sizeSpec) + '</td>' +
        '<td class="num">' + escapeHtml(fmtNum(item.unitCost)) + '</td>' +
        '<td class="num">' + escapeHtml(fmtNum(item.unitPrice)) + '</td>' +
        '<td>' + escapeHtml(item.deptCode || '') + '</td>' +
        '<td>' + escapeHtml(item.groupCode || '') + '</td>';
      tbody.appendChild(tr);
    });
    if (countEl) countEl.textContent = items.length + ' 件';
  }

  function loadProductMasterList() {
    var emptyEl = document.getElementById('product-master-list-empty');
    if (emptyEl) emptyEl.textContent = '読み込み中…';
    fetch('/api/product-master')
      .then(function (res) { return parseJsonResponse(res); })
      .then(function (body) {
        var master = body.master || {};
        productMasterAll = Object.keys(master).map(function (k) {
          return Object.assign({ itemNo: k }, master[k]);
        });
        renderProductMasterTable(productMasterAll);
        if (emptyEl) emptyEl.textContent = productMasterAll.length === 0 ? 'データがありません。' : '';
      })
      .catch(function () {
        if (emptyEl) emptyEl.textContent = '読み込みに失敗しました。';
      });
  }

  var productMasterSearchEl = document.getElementById('product-master-search');
  if (productMasterSearchEl) {
    productMasterSearchEl.addEventListener('input', function () {
      var q = this.value.toLowerCase().trim();
      var filtered = q ? productMasterAll.filter(function (item) {
        return (item.itemNo || '').toLowerCase().indexOf(q) !== -1 ||
          (item.nameEng || '').toLowerCase().indexOf(q) !== -1 ||
          (item.nameJpn || '').toLowerCase().indexOf(q) !== -1 ||
          (item.nameTha || '').toLowerCase().indexOf(q) !== -1;
      }) : productMasterAll;
      renderProductMasterTable(filtered);
    });
  }

  // --- 分類マスター一覧 ---
  function loadClassificationList() {
    var tbody = document.getElementById('classification-tbody');
    var emptyEl = document.getElementById('classification-empty');
    if (!tbody) return;
    if (emptyEl) emptyEl.textContent = '読み込み中…';
    fetch('/api/product-groups')
      .then(function (res) { return parseJsonResponse(res); })
      .then(function (body) {
        var groups = body.groups || [];
        var levelLabels = { 1: '大分類', 2: '中分類', 3: '小分類', 4: '細分類' };
        tbody.innerHTML = '';
        groups.forEach(function (g) {
          var tr = document.createElement('tr');
          tr.innerHTML =
            '<td>' + escapeHtml(levelLabels[g.level] || ('L' + g.level)) + '</td>' +
            '<td>' + escapeHtml(g.code || '') + '</td>' +
            '<td>' + escapeHtml(g.description || '') + '</td>' +
            '<td>' + escapeHtml(g.description_jpn || '') + '</td>' +
            '<td>' + escapeHtml(g.description_tha || '') + '</td>' +
            '<td>' + escapeHtml(g.parent_code || '—') + '</td>';
          tbody.appendChild(tr);
        });
        if (emptyEl) emptyEl.textContent = groups.length === 0 ? 'データがありません。' : '';
      })
      .catch(function () {
        if (emptyEl) emptyEl.textContent = '読み込みに失敗しました。';
      });
  }

  initBusinessHoursUI();

  var btnSaveBh = document.getElementById('btn-save-business-hours');
  var bhSaveStatus = document.getElementById('bh-save-status');
  if (btnSaveBh) {
    btnSaveBh.addEventListener('click', function () {
      if (bhSaveStatus) bhSaveStatus.textContent = 'Saving…';
      var payload = collectBusinessHoursFromForm();
      var targetStoreId = getBhStoreId();
      fetch('/api/business-hours?storeId=' + encodeURIComponent(targetStoreId), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: payload, storeId: targetStoreId })
      }).then(function (res) {
        return parseJsonResponse(res).then(function (data) {
          if (!res.ok) throw new Error(data.error || 'Save failed');
          return data;
        });
      }).then(function () {
        if (bhSaveStatus) bhSaveStatus.textContent = 'Saved to database.';
      }).catch(function (err) {
        if (bhSaveStatus) bhSaveStatus.textContent = err.message || 'Save failed.';
      });
    });
  }

  function doUpload(files) {
    var errEl = document.getElementById('upload-error');
    errEl.hidden = true;
    errEl.textContent = '';
    if (!files || files.length === 0) return;

    var formData = new FormData();
    for (var i = 0; i < files.length; i++) {
      formData.append('files', files[i]);
    }

    var isFinal = document.getElementById('upload-is-final') && document.getElementById('upload-is-final').checked;
    var uploadUrl = isFinal ? '/api/upload/final' : '/api/upload';

    fetch(uploadUrl, {
      method: 'POST',
      body: formData
    }).then(function (res) {
      var contentType = (res.headers.get('Content-Type') || '').toLowerCase();
      return res.text().then(function (text) {
        if (contentType.indexOf('application/json') === -1) {
          if (text.indexOf('<!DOCTYPE') !== -1 || text.indexOf('<!doctype') !== -1) {
            throw new Error('The API is not responding. Please run the server and open this page from the server URL.');
          }
          throw new Error('Server error: ' + (text || res.status));
        }
        var body = JSON.parse(text);
        if (!res.ok) throw new Error(body.error || 'Upload failed');
        return body;
      });
    }).then(function () {
      window.location.href = '/';
    }).catch(function (err) {
      errEl.textContent = err.message || 'File upload failed.';
      errEl.hidden = false;
    });
  }

  document.getElementById('file-files').addEventListener('change', function () {
    var files = this.files;
    var names = files.length ? Array.prototype.map.call(files, function (f) { return f.name; }).join(', ') : '';
    if (files.length > 1) names = files.length + ' files: ' + names;
    document.getElementById('name-files').textContent = names;
    if (files && files.length > 0) doUpload(files);
  });

  // Product master import
  (function () {
    var fileInput = document.getElementById('product-master-file');
    var fileNameEl = document.getElementById('product-master-file-name');
    var submitBtn = document.getElementById('product-master-submit');
    var statusEl = document.getElementById('product-master-status');
    var errEl = document.getElementById('product-master-error');
    if (!submitBtn) return;

    if (fileInput && fileNameEl) {
      fileInput.addEventListener('change', function () {
        fileNameEl.textContent = this.files.length ? this.files[0].name : '';
      });
    }

    submitBtn.addEventListener('click', function () {
      if (errEl) { errEl.hidden = true; errEl.textContent = ''; }
      if (statusEl) statusEl.textContent = '';
      var file = fileInput && fileInput.files.length ? fileInput.files[0] : null;
      if (!file) {
        if (errEl) { errEl.textContent = 'Excel ファイルを選択してください。'; errEl.hidden = false; }
        return;
      }
      submitBtn.disabled = true;
      if (statusEl) statusEl.textContent = 'インポート中…';
      var formData = new FormData();
      formData.append('file', file);
      fetch('/api/product-master/import', { method: 'POST', body: formData })
        .then(function (res) {
          return parseJsonResponse(res).then(function (body) {
            if (!res.ok) throw new Error(body.error || 'Import failed');
            return body;
          });
        })
        .then(function (body) {
          submitBtn.disabled = false;
          if (statusEl) statusEl.textContent = '完了: ' + (body.count || 0) + ' 件の商品マスターをインポートしました。';
          if (fileInput) fileInput.value = '';
          if (fileNameEl) fileNameEl.textContent = '';
        })
        .catch(function (err) {
          submitBtn.disabled = false;
          if (statusEl) statusEl.textContent = '';
          if (errEl) { errEl.textContent = err.message || 'Import failed.'; errEl.hidden = false; }
        });
    });
  }());

  // Item Sales import
  (function () {
    // Populate store selector
    fetch('/api/stores').then(function (res) { return parseJsonResponse(res); }).then(function (body) {
      var stores = body && body.stores ? body.stores : [];
      var sel = document.getElementById('item-sales-store');
      if (!sel) return;
      sel.innerHTML = '';
      stores.forEach(function (s) {
        var opt = document.createElement('option');
        opt.value = s.id || 'default';
        opt.textContent = s.name || s.id || 'default';
        sel.appendChild(opt);
      });
      if (!stores.length) {
        var opt = document.createElement('option');
        opt.value = 'default';
        opt.textContent = 'Default';
        sel.appendChild(opt);
      }
    }).catch(function () {});

    // Set default date to today in Thailand timezone (UTC+7)
    var dateInput = document.getElementById('item-sales-date');
    if (dateInput) {
      dateInput.value = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
    }

    // File name display
    var fileInput = document.getElementById('item-sales-file');
    var fileNameEl = document.getElementById('item-sales-file-name');
    if (fileInput && fileNameEl) {
      fileInput.addEventListener('change', function () {
        fileNameEl.textContent = this.files.length ? this.files[0].name : '';
      });
    }

    // Submit handler
    var submitBtn = document.getElementById('item-sales-submit');
    if (submitBtn) {
      submitBtn.addEventListener('click', function () {
        var statusEl = document.getElementById('item-sales-status');
        var errEl = document.getElementById('item-sales-error');
        errEl.hidden = true;
        errEl.textContent = '';
        if (statusEl) statusEl.textContent = '';

        var businessDate = dateInput ? dateInput.value.trim() : '';
        var storeId = document.getElementById('item-sales-store') ? document.getElementById('item-sales-store').value : '';
        var file = fileInput && fileInput.files.length ? fileInput.files[0] : null;

        if (!businessDate) {
          errEl.textContent = '営業日を入力してください。';
          errEl.hidden = false;
          return;
        }
        if (!file) {
          errEl.textContent = 'Excel ファイルを選択してください。';
          errEl.hidden = false;
          return;
        }

        submitBtn.disabled = true;
        if (statusEl) statusEl.textContent = 'インポート中…';

        var formData = new FormData();
        formData.append('file', file);
        formData.append('businessDate', businessDate);
        formData.append('storeId', storeId);

        fetch('/api/upload/item-sales', {
          method: 'POST',
          body: formData,
        }).then(function (res) {
          return parseJsonResponse(res).then(function (body) {
            if (!res.ok) throw new Error(body.error || 'Upload failed');
            return body;
          });
        }).then(function (body) {
          submitBtn.disabled = false;
          if (statusEl) statusEl.textContent = '完了: ' + (body.productCount || 0) + ' 件の商品データをインポートしました。';
          if (fileInput) fileInput.value = '';
          if (fileNameEl) fileNameEl.textContent = '';
        }).catch(function (err) {
          submitBtn.disabled = false;
          if (statusEl) statusEl.textContent = '';
          errEl.textContent = err.message || 'Import failed.';
          errEl.hidden = false;
        });
      });
    }
  }());

  // Product groups import
  (function () {
    var fileInput = document.getElementById('product-groups-file');
    var fileNameEl = document.getElementById('product-groups-file-name');
    var submitBtn = document.getElementById('product-groups-submit');
    var statusEl = document.getElementById('product-groups-status');
    var errEl = document.getElementById('product-groups-error');
    if (!submitBtn) return;

    if (fileInput && fileNameEl) {
      fileInput.addEventListener('change', function () {
        fileNameEl.textContent = this.files.length ? this.files[0].name : '';
      });
    }

    submitBtn.addEventListener('click', function () {
      if (errEl) { errEl.hidden = true; errEl.textContent = ''; }
      if (statusEl) statusEl.textContent = '';
      var file = fileInput && fileInput.files.length ? fileInput.files[0] : null;
      if (!file) {
        if (errEl) { errEl.textContent = 'CSV ファイルを選択してください。'; errEl.hidden = false; }
        return;
      }
      submitBtn.disabled = true;
      if (statusEl) statusEl.textContent = 'インポート中…';
      var formData = new FormData();
      formData.append('file', file);
      fetch('/api/product-groups/import', { method: 'POST', body: formData })
        .then(function (res) {
          return parseJsonResponse(res).then(function (body) {
            if (!res.ok) throw new Error(body.error || 'Import failed');
            return body;
          });
        })
        .then(function (body) {
          submitBtn.disabled = false;
          if (statusEl) statusEl.textContent = '完了: ' + (body.count || 0) + ' 件の商品グループをインポートしました。';
          if (fileInput) fileInput.value = '';
          if (fileNameEl) fileNameEl.textContent = '';
        })
        .catch(function (err) {
          submitBtn.disabled = false;
          if (statusEl) statusEl.textContent = '';
          if (errEl) { errEl.textContent = err.message || 'Import failed.'; errEl.hidden = false; }
        });
    });
  }());
})();
