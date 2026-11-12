// Client-side groove storage with server persistence.
//
// Manages saving/loading/deleting user grooves via the server API (server.js),
// auto-saves to localStorage for crash protection, and tracks dirty state.

const AUTOSAVE_KEY = 'grooveScribe_autosave';
let cachedData = null;
let lastSavedGroove = null;

// Tracks which saved groove is currently loaded (null if new/unsaved)
let currentGrooveRef = null; // { category: "Saved", id: "groove_123" }

// ── Server API ──────────────────────────────────────────────

// Saving is refused until the saved grooves have loaded: a save sends the whole list,
// so saving on top of a list that failed to load would replace every saved groove.
var NOT_LOADED = 'your saved grooves have not loaded, so saving is off to avoid overwriting them';

// The server's own error message from a failed request, or the status when it sent none.
function serverError(xhr, what) {
  var detail = 'HTTP ' + xhr.status;
  try {
    detail = JSON.parse(xhr.responseText).error || detail;
  } catch (e) {
    // not a JSON error body (e.g. a proxy's page); the status is all there is
  }
  return new Error(what + ': ' + detail);
}

// callback(err): cachedData is set only when the grooves loaded.
export function fetchFromServer(callback) {
  var xhr = new XMLHttpRequest();
  xhr.open('GET', '/api/grooves', true);
  xhr.onload = function () {
    if (xhr.status !== 200) {
      callback(serverError(xhr, 'Loading saved grooves failed'));
      return;
    }
    try {
      cachedData = JSON.parse(xhr.responseText);
    } catch (e) {
      callback(new Error('Saved grooves are not valid JSON: ' + e.message));
      return;
    }
    callback(null);
  };
  xhr.onerror = function () {
    callback(new Error('Loading saved grooves failed: the server did not answer'));
  };
  xhr.send();
}

// callback(err, unpushed): how many saves the server has that GitHub doesn't yet.
export function fetchBackupStatus(callback) {
  var xhr = new XMLHttpRequest();
  xhr.open('GET', '/api/grooves/backup', true);
  xhr.onload = function () {
    if (xhr.status !== 200) {
      callback(serverError(xhr, 'Checking the groove backup failed'));
      return;
    }
    callback(null, JSON.parse(xhr.responseText).unpushed);
  };
  xhr.onerror = function () {
    callback(new Error('Checking the groove backup failed: the server did not answer'));
  };
  xhr.send();
}

// callback(err, backupWarning): err when the save didn't happen; backupWarning when it
// was saved on the server but not backed up to GitHub (HTTP 502).
function saveToServer(commitMessage, callback) {
  var payload = JSON.parse(JSON.stringify(cachedData));
  payload._commitMessage = commitMessage;

  var xhr = new XMLHttpRequest();
  xhr.open('PUT', '/api/grooves', true);
  xhr.setRequestHeader('Content-Type', 'application/json');
  xhr.onload = function () {
    if (xhr.status === 200) {
      callback(null, null);
    } else if (xhr.status === 502) {
      callback(null, serverError(xhr, 'Backup failed').message);
    } else {
      callback(serverError(xhr, 'Saving failed'));
    }
  };
  xhr.onerror = function () {
    callback(new Error('Saving failed: the server did not answer'));
  };
  xhr.send(JSON.stringify(payload));
}

// ── CRUD ────────────────────────────────────────────────────

export function addGroove(category, name, grooveQueryString, callback) {
  if (!cachedData) {
    callback(new Error(NOT_LOADED));
    return;
  }
  if (!cachedData.categories[category]) cachedData.categories[category] = {};

  var id = 'groove_' + Date.now();
  cachedData.categories[category][id] = {
    name: name,
    groove: grooveQueryString,
    createdAt: Date.now(),
  };

  currentGrooveRef = { category: category, id: id };

  var commitMsg = 'groove: save "' + name + '" in ' + category;
  saveToServer(commitMsg, callback);
}

export function updateGroove(grooveQueryString, callback) {
  if (!cachedData) {
    callback(new Error(NOT_LOADED));
    return;
  }
  if (!currentGrooveRef) {
    if (callback) callback(new Error('No groove loaded to update'));
    return;
  }
  var cat = currentGrooveRef.category;
  var id = currentGrooveRef.id;
  if (!cachedData || !cachedData.categories[cat] || !cachedData.categories[cat][id]) {
    if (callback) callback(new Error('Groove reference is stale'));
    return;
  }

  var name = cachedData.categories[cat][id].name;
  cachedData.categories[cat][id].groove = grooveQueryString;

  var commitMsg = 'groove: update "' + name + '" in ' + cat;
  saveToServer(commitMsg, callback);
}

export function deleteGroove(category, grooveId, callback) {
  if (!cachedData) {
    callback(new Error(NOT_LOADED));
    return;
  }
  if (
    !cachedData ||
    !cachedData.categories[category] ||
    !cachedData.categories[category][grooveId]
  ) {
    if (callback) callback(new Error('Groove not found'));
    return;
  }

  var name = cachedData.categories[category][grooveId].name;
  delete cachedData.categories[category][grooveId];

  // Clear ref if we just deleted the currently loaded groove
  if (
    currentGrooveRef &&
    currentGrooveRef.category === category &&
    currentGrooveRef.id === grooveId
  ) {
    currentGrooveRef = null;
  }

  // Remove empty categories
  if (Object.keys(cachedData.categories[category]).length === 0) {
    delete cachedData.categories[category];
  }

  var commitMsg = 'groove: delete "' + name + '" from ' + category;
  saveToServer(commitMsg, callback);
}

export function getCachedData() {
  return cachedData;
}

export function setCurrentGrooveRef(category, id) {
  currentGrooveRef = { category: category, id: id };
}

export function clearCurrentGrooveRef() {
  currentGrooveRef = null;
}

export function getCurrentGrooveRef() {
  return currentGrooveRef;
}

// ── localStorage auto-save ──────────────────────────────────

export function autosave(grooveQueryString) {
  try {
    localStorage.setItem(AUTOSAVE_KEY, grooveQueryString);
  } catch (e) {
    // localStorage full or unavailable — not critical
  }
}

// ── Dirty state ─────────────────────────────────────────────

export function setLastSaved(grooveQueryString) {
  lastSavedGroove = grooveQueryString;
}

export function isDirty(currentGrooveQueryString) {
  if (lastSavedGroove === null) return false;
  return currentGrooveQueryString !== lastSavedGroove;
}

// ── HTML generation for groove dropdown ─────────────────────

function escapeHTML(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeJS(str) {
  return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export function getUserGroovesAsHTML() {
  if (!cachedData || !cachedData.categories) return '';

  var categoryNames = Object.keys(cachedData.categories);
  if (categoryNames.length === 0) return '';

  var HTML = '<ul class="grooveListUL">\n';

  for (var ci = 0; ci < categoryNames.length; ci++) {
    var catName = categoryNames[ci];
    var groovesInCat = cachedData.categories[catName];
    var grooveIds = Object.keys(groovesInCat);
    if (grooveIds.length === 0) continue;

    HTML += '<li class="grooveListHeaderLI">' + escapeHTML(catName) + '</li>\n';
    HTML += '<ul class="grooveListUL">\n';

    for (var gi = 0; gi < grooveIds.length; gi++) {
      var gid = grooveIds[gi];
      var groove = groovesInCat[gid];
      HTML += '<li class="grooveListLI savedGrooveLI">';
      HTML +=
        '<span class="savedGrooveName" onclick="myGrooveWriter.loadSavedGroove(\'' +
        escapeJS(catName) +
        "', '" +
        escapeJS(gid) +
        "', '" +
        escapeJS(groove.groove) +
        '\')">';
      HTML += escapeHTML(groove.name);
      HTML += '</span>';
      HTML +=
        '<span class="savedGrooveDelete" onclick="event.stopPropagation(); myGrooveWriter.deleteSavedGroove(\'' +
        escapeJS(catName) +
        "', '" +
        escapeJS(gid) +
        '\');">';
      HTML += '<i class="fa fa-times"></i>';
      HTML += '</span>';
      HTML += '</li>\n';
    }

    HTML += '</ul>\n';
  }

  HTML += '</ul>\n';
  return HTML;
}
