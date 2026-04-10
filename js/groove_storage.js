/*
 * groove_storage.js — Client-side groove storage with server persistence
 *
 * Manages saving/loading/deleting user grooves via the server API,
 * auto-saves to localStorage for crash protection, and tracks dirty state.
 */

if (typeof(grooveStorage) === "undefined")
	var grooveStorage = {};

(function () {
	"use strict";

	var root = grooveStorage;

	var AUTOSAVE_KEY = "grooveScribe_autosave";
	var cachedData = null;
	var lastSavedGroove = null;
	var serverAvailable = true;

	// Tracks which saved groove is currently loaded (null if new/unsaved)
	var currentGrooveRef = null; // { category: "Saved", id: "groove_123" }

	// ── Server API ──────────────────────────────────────────────

	root.fetchFromServer = function (callback) {
		var xhr = new XMLHttpRequest();
		xhr.open("GET", "/api/grooves", true);
		xhr.onload = function () {
			if (xhr.status === 200) {
				try {
					cachedData = JSON.parse(xhr.responseText);
					serverAvailable = true;
				} catch (e) {
					console.error("Failed to parse grooves JSON:", e);
					cachedData = { version: 1, categories: {} };
				}
			} else {
				console.error("GET /api/grooves failed:", xhr.status);
				cachedData = { version: 1, categories: {} };
				serverAvailable = false;
			}
			if (callback) callback(cachedData);
		};
		xhr.onerror = function () {
			console.error("GET /api/grooves network error");
			cachedData = { version: 1, categories: {} };
			serverAvailable = false;
			if (callback) callback(cachedData);
		};
		xhr.send();
	};

	root.saveToServer = function (commitMessage, callback) {
		var payload = JSON.parse(JSON.stringify(cachedData));
		payload._commitMessage = commitMessage;

		var xhr = new XMLHttpRequest();
		xhr.open("PUT", "/api/grooves", true);
		xhr.setRequestHeader("Content-Type", "application/json");
		xhr.onload = function () {
			if (xhr.status === 200) {
				serverAvailable = true;
				if (callback) callback(null);
			} else {
				var msg = "PUT /api/grooves failed: " + xhr.status;
				console.error(msg);
				serverAvailable = false;
				if (callback) callback(new Error(msg));
			}
		};
		xhr.onerror = function () {
			var msg = "PUT /api/grooves network error";
			console.error(msg);
			serverAvailable = false;
			if (callback) callback(new Error(msg));
		};
		xhr.send(JSON.stringify(payload));
	};

	// ── CRUD ────────────────────────────────────────────────────

	root.addGroove = function (category, name, grooveQueryString, callback) {
		if (!cachedData) cachedData = { version: 1, categories: {} };
		if (!cachedData.categories[category]) cachedData.categories[category] = {};

		var id = "groove_" + Date.now();
		cachedData.categories[category][id] = {
			name: name,
			groove: grooveQueryString,
			createdAt: Date.now()
		};

		currentGrooveRef = { category: category, id: id };

		var commitMsg = 'groove: save "' + name + '" in ' + category;
		root.saveToServer(commitMsg, function (err) {
			if (err) {
				console.error("Failed to save groove to server:", err);
			}
			if (callback) callback(err);
		});
	};

	root.updateGroove = function (grooveQueryString, callback) {
		if (!currentGrooveRef) {
			if (callback) callback(new Error("No groove loaded to update"));
			return;
		}
		var cat = currentGrooveRef.category;
		var id = currentGrooveRef.id;
		if (!cachedData || !cachedData.categories[cat] || !cachedData.categories[cat][id]) {
			if (callback) callback(new Error("Groove reference is stale"));
			return;
		}

		var name = cachedData.categories[cat][id].name;
		cachedData.categories[cat][id].groove = grooveQueryString;

		var commitMsg = 'groove: update "' + name + '" in ' + cat;
		root.saveToServer(commitMsg, function (err) {
			if (err) {
				console.error("Failed to update groove on server:", err);
			}
			if (callback) callback(err);
		});
	};

	root.deleteGroove = function (category, grooveId, callback) {
		if (!cachedData || !cachedData.categories[category] || !cachedData.categories[category][grooveId]) {
			if (callback) callback(new Error("Groove not found"));
			return;
		}

		var name = cachedData.categories[category][grooveId].name;
		delete cachedData.categories[category][grooveId];

		// Clear ref if we just deleted the currently loaded groove
		if (currentGrooveRef && currentGrooveRef.category === category && currentGrooveRef.id === grooveId) {
			currentGrooveRef = null;
		}

		// Remove empty categories
		if (Object.keys(cachedData.categories[category]).length === 0) {
			delete cachedData.categories[category];
		}

		var commitMsg = 'groove: delete "' + name + '" from ' + category;
		root.saveToServer(commitMsg, function (err) {
			if (err) {
				console.error("Failed to delete groove on server:", err);
			}
			if (callback) callback(err);
		});
	};

	root.getCachedData = function () {
		return cachedData;
	};

	root.setCurrentGrooveRef = function (category, id) {
		currentGrooveRef = { category: category, id: id };
	};

	root.clearCurrentGrooveRef = function () {
		currentGrooveRef = null;
	};

	root.getCurrentGrooveRef = function () {
		return currentGrooveRef;
	};

	// ── localStorage auto-save ──────────────────────────────────

	root.autosave = function (grooveQueryString) {
		try {
			localStorage.setItem(AUTOSAVE_KEY, grooveQueryString);
		} catch (e) {
			// localStorage full or unavailable — not critical
		}
	};

	root.getAutosave = function () {
		try {
			return localStorage.getItem(AUTOSAVE_KEY);
		} catch (e) {
			return null;
		}
	};

	root.clearAutosave = function () {
		try {
			localStorage.removeItem(AUTOSAVE_KEY);
		} catch (e) {
			// ignore
		}
	};

	// ── Dirty state ─────────────────────────────────────────────

	root.setLastSaved = function (grooveQueryString) {
		lastSavedGroove = grooveQueryString;
	};

	root.getLastSaved = function () {
		return lastSavedGroove;
	};

	root.isDirty = function (currentGrooveQueryString) {
		if (lastSavedGroove === null) return false;
		return currentGrooveQueryString !== lastSavedGroove;
	};

	root.isServerAvailable = function () {
		return serverAvailable;
	};

	// ── HTML generation for groove dropdown ─────────────────────

	function escapeHTML(str) {
		return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
	}

	function escapeJS(str) {
		return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
	}

	root.getUserGroovesAsHTML = function () {
		if (!cachedData || !cachedData.categories) return "";

		var categoryNames = Object.keys(cachedData.categories);
		if (categoryNames.length === 0) return "";

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
				HTML += '<span class="savedGrooveName" onclick="myGrooveWriter.loadSavedGroove(\'' + escapeJS(catName) + '\', \'' + escapeJS(gid) + '\', \'' + escapeJS(groove.groove) + '\')">';
				HTML += escapeHTML(groove.name);
				HTML += '</span>';
				HTML += '<span class="savedGrooveDelete" onclick="event.stopPropagation(); myGrooveWriter.deleteSavedGroove(\'' + escapeJS(catName) + '\', \'' + escapeJS(gid) + '\');">';
				HTML += '<i class="fa fa-times"></i>';
				HTML += '</span>';
				HTML += '</li>\n';
			}

			HTML += '</ul>\n';
		}

		HTML += '</ul>\n';
		return HTML;
	};

})();
