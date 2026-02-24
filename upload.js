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
