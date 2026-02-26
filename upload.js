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

  function initBusinessHoursUI() {
    for (var d = 0; d <= 6; d++) {
      var startEl = document.getElementById('bh-start-' + d);
      var endEl = document.getElementById('bh-end-' + d);
      if (startEl) fillTimeOptions(startEl, false);
      if (endEl) fillTimeOptions(endEl, true);
    }
    fetch('/api/business-hours').then(function (res) { return parseJsonResponse(res); }).then(function (settings) {
      if (settings && typeof settings === 'object') applySettingsToForm(settings);
      else applySettingsToForm(getDefaultBusinessHours());
    }).catch(function () { applySettingsToForm(getDefaultBusinessHours()); });
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

  document.querySelectorAll('.tabs .tab').forEach(function (btn) {
    btn.addEventListener('click', function () {
      switchUploadTab(btn.getAttribute('data-tab'));
    });
  });

  function loadStoresMaster() {
    var tbody = document.getElementById('stores-tbody');
    if (!tbody) return;
    fetch('/api/stores').then(function (res) { return parseJsonResponse(res); }).then(function (body) {
      var stores = body.stores || [];
      if (stores.length === 0) stores = [{ id: 'default', name: 'Default' }];
      tbody.innerHTML = '';
      stores.forEach(function (s) {
        var tr = document.createElement('tr');
        tr.innerHTML = '<td><input type="text" class="store-id-input" value="' + (s.id || '').replace(/"/g, '&quot;') + '" placeholder="e.g. default" maxlength="32"></td>' +
          '<td><input type="text" class="store-name-input" value="' + (s.name || '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '" placeholder="店舗名"></td>' +
          '<td><button type="button" class="btn-delete-store">削除</button></td>';
        var deleteBtn = tr.querySelector('.btn-delete-store');
        var idInput = tr.querySelector('.store-id-input');
        if (deleteBtn) deleteBtn.addEventListener('click', function () {
          if (tbody.querySelectorAll('tr').length <= 1) return;
          tr.remove();
        });
        tbody.appendChild(tr);
      });
    }).catch(function () {
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
    });
  });

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
      storesSaveStatus.textContent = '保存中…';
      fetch('/api/stores', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stores: list })
      }).then(function (res) {
        return parseJsonResponse(res).then(function (data) {
          if (!res.ok) throw new Error(data.error || 'Save failed');
          return data;
        });
      }).then(function () {
        storesSaveStatus.textContent = '保存しました。';
      }).catch(function (err) {
        storesSaveStatus.textContent = err.message || '保存に失敗しました。';
      });
    });
  }

  initBusinessHoursUI();

  var btnSaveBh = document.getElementById('btn-save-business-hours');
  var bhSaveStatus = document.getElementById('bh-save-status');
  if (btnSaveBh) {
    btnSaveBh.addEventListener('click', function () {
      if (bhSaveStatus) bhSaveStatus.textContent = 'Saving…';
      var payload = collectBusinessHoursFromForm();
      fetch('/api/business-hours', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
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

    fetch('/api/upload', {
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
})();
