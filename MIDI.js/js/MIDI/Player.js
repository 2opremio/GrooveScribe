/*
	-------------------------------------
	MIDI.Player : 0.3
	-------------------------------------
	https://github.com/mudcube/MIDI.js
	-------------------------------------
	#jasmid
	-------------------------------------
*/

if (typeof (MIDI) === "undefined") var MIDI = {};
if (typeof (MIDI.Player) === "undefined") MIDI.Player = {};

(function() { "use strict";

var root = MIDI.Player;
root.callback = undefined; // your custom callback goes here!
root.currentTime = 0;
root.endTime = 0; 
root.restart = 0; 
root.playing = false;
root.timeWarp = 1;
root.shouldLoop = 0;

//
root.start =
root.resume = function () {
	if (root.currentTime < -1) root.currentTime = -1;
	startAudio(root.currentTime);
};

root.pause = function () {
	var tmp = root.restart;
	stopAudio();
	root.restart = tmp;
};

root.loop = function (doOrDont) {
	root.shouldLoop = doOrDont;
}

root.stop = function () {
	stopAudio();
	root.restart = 0;
	root.currentTime = 0;
};

root.addListener = function(callback) {
	onMidiEvent = callback;
};

root.removeListener = function() {
	onMidiEvent = undefined;
};

root.clearAnimation = function() {
	if (root.interval)  {
		window.clearInterval(root.interval);
	}
};

root.setAnimation = function(config) {
	var callback = (typeof(config) === "function") ? config : config.callback;
	var interval = config.interval || 30;
	var currentTime = 0;
	var tOurTime = 0;
	var tTheirTime = 0;
	//
	root.clearAnimation();
	root.interval = window.setInterval(function () {
		if (root.endTime === 0) return;
		if (root.playing) {
			currentTime = (tTheirTime === root.currentTime) ? tOurTime - (new Date).getTime() : 0;
			if (root.currentTime === 0) {
				currentTime = 0;
			} else {
				currentTime = root.currentTime - currentTime;
			}
			if (tTheirTime !== root.currentTime) {
				tOurTime = (new Date).getTime();
				tTheirTime = root.currentTime;
			}
		} else { // paused
			currentTime = root.currentTime;
		}
		var endTime = root.endTime;
		var percent = currentTime / endTime;
		var total = currentTime / 1000;
		var minutes = total / 60;
		var seconds = total - (minutes * 60);
		var t1 = minutes * 60 + seconds;
		var t2 = (endTime / 1000);
		if (t2 - t1 < -1) return;
		callback({
			now: t1,
			end: t2,
			events: noteRegistrar
		});
	}, interval);
};

// helpers

root.loadMidiFile = function() { // reads midi into javascript array of events
	var tune = parseTune(root.currentData);
	root.replayer = tune.replayer;
	root.data = tune.data;
	root.endTime = tune.endTime;
};

// Plays the tune in a base64 data URL as the next pass of a looping tune instead of repeating the
// current one. It is queued ahead like any next pass, so it starts exactly on the bar line.
// Loading a tune drops it.
root.setNextTune = function (file) {
	if (file.indexOf("base64,") === -1) {
		throw new Error("MIDI.Player.setNextTune takes a base64 data URL");
	}
	if (nextPassStartContextTime !== null) {
		throw new Error("MIDI.Player.setNextTune: the next pass is already queued");
	}
	nextTune = parseTune(window.atob(file.split(",")[1]));
};

root.loadFile = function (file, callback) {
	root.stop();
	nextTune = null;
	if (file.indexOf("base64,") !== -1) {
		var data = window.atob(file.split(",")[1]);
		root.currentData = data;
		root.loadMidiFile();
		if (callback) callback(data);
		return;
	}
	///
	var fetch = new XMLHttpRequest();
	fetch.open('GET', file);
	fetch.overrideMimeType("text/plain; charset=x-user-defined");
	fetch.onreadystatechange = function () {
		if (this.readyState === 4 && this.status === 200) {
			var t = this.responseText || "";
			var ff = [];
			var mx = t.length;
			var scc = String.fromCharCode;
			for (var z = 0; z < mx; z++) {
				ff[z] = scc(t.charCodeAt(z) & 255);
			}
			var data = ff.join("");
			root.currentData = data;
			root.loadMidiFile();
			if (callback) callback(data);
		}
	};
	fetch.send();
};

// Playing the audio

// The song's first tick plays this long after a pass starts; the song's length doesn't include it.
var LEAD_IN_MS = 0.5;

var eventQueue = []; // hold events to be triggered
var queuedTime; // 
var startTime = 0; // to measure time elapse
// The audio time, in seconds, that the song's time 0 sits at in the pass being played. Every
// batch of a pass is scheduled against it, and each loop starts exactly one song length after
// the last: scheduling from the moment a timer fires instead would push the audio later by that
// timer's lateness at every batch and every loop.
var passStartContextTime = 0;
// The next pass of a looping tune is queued as soon as the last batch of the pass before it is,
// so the work done when a pass ends (the callbacks, a late timer) can't delay its first notes;
// null until it is queued. A short tune that fits in one batch is then always a pass ahead.
var nextPassStartContextTime = null;
var nextPassFullyQueued = false;
// While the callback for the end of a looping pass runs: the audio time the next pass starts at.
// A tune (re)started from that callback starts there, on the bar line, however late the callback
// runs; null otherwise.
var passBoundaryContextTime = null;
// The tune the next pass plays (see root.setNextTune); null when it repeats the current one.
var nextTune = null;
// Counts the times the queue was emptied. A note's timer takes its own entry off the front of the
// queue only if the queue it was scheduled in is still there: a callback that stops or reloads
// the tune has already removed it, and taking another would leave a note of the new tune
// unqueued, so stopping couldn't silence it.
var queueGeneration = 0;

var parseTune = function (fileData) {
	var replayer = new Replayer(MidiFile(fileData), root.timeWarp);
	var data = replayer.getData();
	return { currentData: fileData, replayer: replayer, data: data, endTime: getLength(data) };
};

// The next tune becomes the one being played.
var startNextTune = function () {
	root.currentData = nextTune.currentData;
	root.replayer = nextTune.replayer;
	root.data = nextTune.data;
	root.endTime = nextTune.endTime;
	nextTune = null;
};

// Queues the pass after the one starting at fromContextTime.
var queueNextPass = function (fromContextTime) {
	nextPassStartContextTime = fromContextTime + (root.endTime - LEAD_IN_MS) / 1000;
	nextPassFullyQueued = startAudio(0, true, nextPassStartContextTime,
		nextTune === null ? root.data : nextTune.data);
};

// Drops everything still queued: the notes, their timers, and any pass queued ahead.
var clearQueue = function () {
	queueGeneration++;
	while (eventQueue.length) {
		var o = eventQueue.pop();
		window.clearTimeout(o.interval);
		if (o.source && typeof (o.source) !== "number") o.source.disconnect(0);
	}
	nextPassStartContextTime = null;
};

// The audio time, in seconds, the song's first tick plays at in the pass being played, for
// anything timed against the audio.
root.passStartContextTime = function () {
	return passStartContextTime + LEAD_IN_MS / 1000;
};
var noteRegistrar = {}; // get event for requested note
var onMidiEvent = undefined; // listener callback
var scheduleTracking = function (channel, note, currentTime, delayMs, message, velocity) {
	var generation = queueGeneration;
	var interval = window.setTimeout(function () {
		var data = {
			channel: channel,
			note: note,
			now: currentTime,
			end: root.endTime,
			message: message,
			velocity: velocity
		};
		//
		if (message === 128) {
			delete noteRegistrar[note];
		} else {
			noteRegistrar[note] = data;
		}
		// the last event of a pass: the next pass, already queued, becomes the one being played,
		// set before the callback so a repeat callback sees the pass it starts
		var atEnd = currentTime == root.endTime;
		var switched = atEnd && nextPassStartContextTime !== null;
		if (switched) {
			passStartContextTime = nextPassStartContextTime;
			nextPassStartContextTime = null;
		}
		// looping was turned on too late to queue the next pass ahead: it starts one song length
		// after this one. The queue is empty once this event leaves it.
		var loops = !switched && root.shouldLoop && atEnd && eventQueue.length === 1;
		if (loops) {
			passStartContextTime += (root.endTime - LEAD_IN_MS) / 1000;
		}
		// the pass starting is the next tune's (set before its pass was queued ahead, if it was)
		data.startsNextTune = (switched || loops) && nextTune !== null;
		if (data.startsNextTune) startNextTune();
		if (switched && nextPassFullyQueued) queueNextPass(passStartContextTime);
		if (switched || loops) passBoundaryContextTime = passStartContextTime;
		if (onMidiEvent) {
			onMidiEvent(data);
		}
		passBoundaryContextTime = null;
		root.currentTime = currentTime;
		
		// remove this event from the queue, unless the callback emptied it
		if (generation === queueGeneration) eventQueue.shift();
		
		// the callback turned looping off: the pass queued ahead isn't played
		if (switched && !root.shouldLoop) {
			clearQueue();
			return;
		}
		// the callback may have turned looping off, or reloaded the tune and started it again
		if(loops && root.shouldLoop && eventQueue.length == 0 ) {
			// at the end of the current tune.   If we are repeating we need to requeue
			// we check to make sure the eventQueue is empty since we may have reloaded the tune
			// in the callback and have essentially already caused the loop
			startAudio(0, true);
		} else if (root.currentTime === queuedTime && queuedTime < root.endTime && eventQueue.length == 0) {
			// grab next sequence of a long midi
			startAudio(queuedTime + .001, true);
		} 
		
	}, Math.max(0, delayMs));
	return interval;
};

var getContext = function() {
	if (MIDI.lang === 'WebAudioAPI') {
		return MIDI.Player.ctx;
	} else if (!root.ctx) {
		root.ctx = { currentTime: 0 };
	}
	return root.ctx;
};

var getLength = function(data) {
	var length = data.length;
	var totalTime = LEAD_IN_MS;
	for (var n = 0; n < length; n++) {
		totalTime += data[n][1];
	}
	return totalTime;
};

// Queues the next batch of a pass (100 notes at most), from song time currentTime on; a fresh
// start (not fromCache) begins a pass now. passContextTime, when given, is the start of a pass
// queued ahead, and passData that pass's song (the next tune's, or the current one's). Returns
// whether the batch reaches the end of the song.
var startAudio = function (currentTime, fromCache, passContextTime, passData) {
	if (!root.replayer) return false;
	if (!fromCache) {
		if (typeof (currentTime) === "undefined") currentTime = root.restart;
		if (root.playing) stopAudio();
		root.playing = true;
		root.data = root.replayer.getData();
		root.endTime = getLength(root.data);
	}
	var note;
	var offset = 0;
	var messages = 0;
	var data = passData === undefined ? root.data : passData;
	var ctx = getContext();
	var length = data.length;
	var passStartSet = fromCache;
	// a tune restarted when a looping pass ends starts on the bar line, where the pass queued
	// ahead has already sounded whatever was due by now
	var restartsOnBarLine = !fromCache && passBoundaryContextTime !== null;
	var reachedEnd = true;
	//
	queuedTime = LEAD_IN_MS;
	startTime = ctx.currentTime;
	//
	for (var n = 0; n < length; n++) {
		
		// stop at a maximum number of queued messages
		// if there are multiple notes at 0 delay
		// queue them all together, regardless of queue size
		if(data[n][1] != 0 && messages >= 100) {
			reachedEnd = false;
			break;
		}
		
		queuedTime += data[n][1];
		if (queuedTime < currentTime) {
			offset = queuedTime;
			continue;
		}	    
		
		currentTime = queuedTime - offset;
		if (!passStartSet) {
			// a fresh start (or resume): the first event plays now, or, for a tune started when a
			// looping pass ends, on the bar line the next pass starts at
			passStartContextTime = passBoundaryContextTime !== null
				? passBoundaryContextTime
				: ctx.currentTime - offset / 1000;
			passStartSet = true;
		}
		var passBase = passContextTime === undefined ? passStartContextTime : passContextTime;
		var eventContextTime = passBase + queuedTime / 1000;
		var delayMs = (eventContextTime - ctx.currentTime) * 1000;
		// a note whose time has passed plays now (the WebAudio plugin takes a time in the past as a
		// delay from now, so passing it on would play the note that much later again), unless the
		// tune restarted on the bar line: the queued pass played that moment, so it isn't repeated
		var due = eventContextTime < ctx.currentTime;
		var sounds = !(due && restartsOnBarLine);
		var audioTime = due ? 0 : eventContextTime;
		var event = data[n][0].event;
		if (event.type !== "channel") continue;
		var channel = event.channel;
		switch (event.subtype) {
			case 'noteOn':
				if (MIDI.channels[channel].mute) break;
				note = event.noteNumber - (root.MIDIOffset || 0);
				eventQueue.push({
					event: event,
					contextTime: eventContextTime,
					source: sounds ? MIDI.noteOn(channel, event.noteNumber, event.velocity, audioTime) : undefined,
					interval: scheduleTracking(channel, note, queuedTime, delayMs, 144, event.velocity)
				});
				messages ++;
				break;
			case 'noteOff':
				if (MIDI.channels[channel].mute) break;
				note = event.noteNumber - (root.MIDIOffset || 0);
				eventQueue.push({
					event: event,
					source: sounds ? MIDI.noteOff(channel, event.noteNumber, audioTime) : undefined,
					interval: scheduleTracking(channel, note, queuedTime, delayMs, 128)
				});
				break;
			default:
				break;
		}
	}
	// the batch with a looping pass's last note: queue the next pass now, ahead of time
	if (reachedEnd && root.shouldLoop && nextPassStartContextTime === null && passContextTime === undefined) {
		queueNextPass(passStartContextTime);
	}
	return reachedEnd;
};

var stopAudio = function () {
	var ctx = getContext();
	root.playing = false;
	nextPassStartContextTime = null;
	root.restart += (ctx.currentTime - startTime) * 1000;
	queueGeneration++;
	// stop the audio, and intervals
	while (eventQueue.length) {
		var o = eventQueue.pop();
		window.clearInterval(o.interval);
		if (!o.source) continue; // is not webaudio
		if (typeof(o.source) === "number") {
			window.clearTimeout(o.source);
		} else if (passBoundaryContextTime === null || o.contextTime > ctx.currentTime) { // webaudio
			// a tune restarted on the bar line lets a note already sounding there ring out
			o.source.disconnect(0);
		}
	}
	// run callback to cancel any notes still playing
	for (var key in noteRegistrar) {
		var o = noteRegistrar[key]
		if (noteRegistrar[key].message === 144 && onMidiEvent) {
			onMidiEvent({
				channel: o.channel,
				note: o.note,
				now: o.now,
				end: o.end,
				message: 128,
				velocity: o.velocity
			});
		}
	}
	// reset noteRegistrar
	noteRegistrar = {};
};

})();