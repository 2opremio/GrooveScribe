'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const PORT = 3337;
const ROOT = __dirname;
const GROOVES_PATH = path.join(ROOT, 'data', 'grooves.json');
const DEPLOY_KEY_PATH = path.join(ROOT, 'credentials', 'deploy-key');

const MIME_TYPES = {
	'.html': 'text/html',
	'.css': 'text/css',
	'.js': 'application/javascript',
	'.json': 'application/json',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.gif': 'image/gif',
	'.ico': 'image/x-icon',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2',
	'.ttf': 'font/ttf',
	'.eot': 'application/vnd.ms-fontobject',
	'.otf': 'font/otf',
	'.mp3': 'audio/mpeg',
	'.ogg': 'audio/ogg',
	'.wav': 'audio/wav',
	'.mid': 'audio/midi',
};

function gitCommitAndPush(message) {
	const sshCmd = `ssh -i ${DEPLOY_KEY_PATH} -o StrictHostKeyChecking=accept-new`;
	const env = Object.assign({}, process.env, { GIT_SSH_COMMAND: sshCmd });

	execFile('git', ['add', 'data/grooves.json'], { cwd: ROOT, env }, (addErr) => {
		if (addErr) {
			console.error('git add failed:', addErr.message);
			return;
		}
		execFile('git', ['commit', '-m', message], { cwd: ROOT, env }, (commitErr) => {
			if (commitErr) {
				console.error('git commit failed:', commitErr.message);
				return;
			}
			execFile('git', ['push'], { cwd: ROOT, env }, (pushErr) => {
				if (pushErr) {
					console.error('git push failed:', pushErr.message);
					return;
				}
				console.log('git push OK:', message);
			});
		});
	});
}

function readBody(req, callback) {
	const chunks = [];
	req.on('data', (chunk) => chunks.push(chunk));
	req.on('end', () => callback(null, Buffer.concat(chunks).toString()));
	req.on('error', (err) => callback(err));
}

function sendJSON(res, statusCode, data) {
	const body = JSON.stringify(data);
	res.writeHead(statusCode, {
		'Content-Type': 'application/json',
		'Content-Length': Buffer.byteLength(body),
	});
	res.end(body);
}

const server = http.createServer((req, res) => {
	// API: GET /api/grooves
	if (req.method === 'GET' && req.url === '/api/grooves') {
		fs.readFile(GROOVES_PATH, 'utf8', (err, data) => {
			if (err) {
				sendJSON(res, 500, { error: 'Failed to read grooves: ' + err.message });
				return;
			}
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(data);
		});
		return;
	}

	// API: PUT /api/grooves
	if (req.method === 'PUT' && req.url === '/api/grooves') {
		readBody(req, (err, body) => {
			if (err) {
				sendJSON(res, 400, { error: 'Failed to read request body: ' + err.message });
				return;
			}
			let parsed;
			try {
				parsed = JSON.parse(body);
			} catch (e) {
				sendJSON(res, 400, { error: 'Invalid JSON: ' + e.message });
				return;
			}
			if (!parsed.version || !parsed.categories) {
				sendJSON(res, 400, { error: 'Invalid grooves format: missing version or categories' });
				return;
			}
			// Extract commit message before writing to disk
			const commitMsg = parsed._commitMessage || 'groove: update';
			delete parsed._commitMessage;
			const pretty = JSON.stringify(parsed, null, 2) + '\n';
			fs.writeFile(GROOVES_PATH, pretty, 'utf8', (writeErr) => {
				if (writeErr) {
					sendJSON(res, 500, { error: 'Failed to write grooves: ' + writeErr.message });
					return;
				}
				sendJSON(res, 200, { ok: true });
				// Fire-and-forget git commit + push
				gitCommitAndPush(commitMsg);
			});
		});
		return;
	}

	// Static file serving
	if (req.method !== 'GET' && req.method !== 'HEAD') {
		res.writeHead(405);
		res.end('Method not allowed');
		return;
	}

	let urlPath = decodeURIComponent(req.url.split('?')[0]);
	if (urlPath === '/') urlPath = '/index.html';

	// Prevent directory traversal
	const filePath = path.join(ROOT, urlPath);
	if (!filePath.startsWith(ROOT)) {
		res.writeHead(403);
		res.end('Forbidden');
		return;
	}

	fs.stat(filePath, (statErr, stats) => {
		if (statErr || !stats.isFile()) {
			res.writeHead(404);
			res.end('Not found');
			return;
		}
		const ext = path.extname(filePath).toLowerCase();
		const contentType = MIME_TYPES[ext] || 'application/octet-stream';
		res.writeHead(200, {
			'Content-Type': contentType,
			'Content-Length': stats.size,
			'Cache-Control': 'no-cache, no-store, must-revalidate',
		});
		if (req.method === 'HEAD') {
			res.end();
			return;
		}
		fs.createReadStream(filePath).pipe(res);
	});
});

server.listen(PORT, () => {
	console.log(`GrooveScribe server listening on http://localhost:${PORT}`);
});
