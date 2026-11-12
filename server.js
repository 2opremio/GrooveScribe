import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const PORT = 3337;
const ROOT = path.dirname(fileURLToPath(import.meta.url));
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

const gitEnv = Object.assign({}, process.env, {
  GIT_SSH_COMMAND: `ssh -i ${DEPLOY_KEY_PATH} -o StrictHostKeyChecking=accept-new`,
});

function git(args) {
  return execFileAsync('git', args, { cwd: ROOT, env: gitEnv });
}

// Commits the grooves file and pushes every commit GitHub doesn't have yet, so a
// save that failed to push earlier goes out with the next one.
async function commitAndPush(message) {
  await git(['add', 'data/grooves.json']);
  // exit code 1 means there are staged changes; a save that changed nothing commits nothing
  const changed = await git(['diff', '--cached', '--quiet']).then(
    () => false,
    (err) => {
      if (err.code === 1) return true;
      throw err;
    }
  );
  if (changed) await git(['commit', '-m', message]);
  await git(['push']);
}

// Saves this server has committed that GitHub doesn't have yet.
async function unpushedSaves() {
  const { stdout } = await git(['rev-list', '--count', '@{u}..HEAD']);
  return Number(stdout.trim());
}

// Saves run one at a time: concurrent ones would race on the file and on git's index.
let saveQueue = Promise.resolve();
function serialized(task) {
  const run = saveQueue.then(task);
  // the next save waits for this one whether it failed or not; the caller gets the failure
  saveQueue = run.then(
    () => {},
    () => {}
  );
  return run;
}

async function saveGrooves(pretty, commitMsg) {
  try {
    await fs.promises.writeFile(GROOVES_PATH, pretty, 'utf8');
  } catch (err) {
    return { status: 500, body: { error: 'Failed to write grooves: ' + err.message } };
  }
  try {
    await commitAndPush(commitMsg);
  } catch (err) {
    console.error('Groove backup failed:', err.message);
    // git's first error line is the reason; the full output is in the log above
    const reason = (err.stderr || err.message).trim().split('\n')[0];
    return {
      status: 502,
      body: { error: 'Saved on the server, but not backed up to GitHub: ' + reason },
    };
  }
  return { status: 200, body: { ok: true } };
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

  // API: GET /api/grooves/backup - how many saves GitHub doesn't have yet
  if (req.method === 'GET' && req.url === '/api/grooves/backup') {
    serialized(unpushedSaves).then(
      (unpushed) => sendJSON(res, 200, { unpushed }),
      (err) => sendJSON(res, 500, { error: 'Failed to check the backup: ' + err.message })
    );
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
      serialized(() => saveGrooves(pretty, commitMsg)).then((result) =>
        sendJSON(res, result.status, result.body)
      );
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
  // retry saves a previous run committed but couldn't push
  serialized(async () => {
    const unpushed = await unpushedSaves();
    if (unpushed === 0) return;
    console.log(`Pushing ${unpushed} groove save(s) GitHub doesn't have yet`);
    await git(['push']);
    console.log('Groove backup caught up');
  }).catch((err) => console.error('Groove backup still failing:', err.message));
});
