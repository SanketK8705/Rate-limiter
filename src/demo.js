const http = require('http');

const PORT = process.env.PORT || 3000;
const BASE_URL = `http://localhost:${PORT}`;

// Console styling helpers
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const MAGENTA = '\x1b[35m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

function log(color, text) {
  console.log(`${color}${text}${RESET}`);
}

// Helper to make HTTP POST requests
function post(urlPath, payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const options = {
      hostname: 'localhost',
      port: PORT,
      path: urlPath,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        let json = {};
        try { json = JSON.parse(body); } catch (e) {}
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: json
        });
      });
    });

    req.on('error', (err) => reject(err));
    req.write(data);
    req.end();
  });
}

// Helper to make HTTP GET requests
function get(urlPath) {
  return new Promise((resolve, reject) => {
    http.get(`${BASE_URL}${urlPath}`, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        let json = {};
        try { json = JSON.parse(body); } catch (e) {}
        resolve({
          status: res.statusCode,
          body: json
        });
      });
    }).on('error', (err) => reject(err));
  });
}

async function runDemo() {
  log(BOLD + BLUE, '=== Starting Rate Limiter Demonstration ===\n');

  // Test 1: Verify Health Check
  log(BOLD + CYAN, 'Test 1: Health Check verification...');
  try {
    const res = await get('/health');
    if (res.status === 200 && res.body.status === 'UP') {
      log(GREEN, `✔ Health Check succeeded! Status: ${res.status}, Body: ${JSON.stringify(res.body)}`);
    } else {
      log(RED, `✘ Health Check failed. Status: ${res.status}, Body: ${JSON.stringify(res.body)}`);
    }
  } catch (err) {
    log(RED, `✘ Health Check failed to connect: ${err.message}`);
  }
  console.log();

  // Test 2: Input Validation Verification
  log(BOLD + CYAN, 'Test 2: Config Input Validation verification...');
  const invalidPayload = {
    clientId: '',
    algorithm: 'invalidAlgo',
    limit: -5,
    refillRate: 0,
    burstSize: 2
  };
  const valRes = await post('/admin/config', invalidPayload);
  if (valRes.status === 400) {
    log(GREEN, `✔ Validation rejected invalid configuration as expected (Status 400).`);
    log(YELLOW, `Details returned: ${JSON.stringify(valRes.body.details, null, 2)}`);
  } else {
    log(RED, `✘ Validation test failed. Status: ${valRes.status}, Body: ${JSON.stringify(valRes.body)}`);
  }
  console.log();

  // Test 3: Token Bucket Rate Limiting & Retry-After Headers
  log(BOLD + CYAN, 'Test 3: Token Bucket Rate Limiter + Retry-After headers...');
  const clientId = 'demo_user';
  
  // Set up config: 3 requests capacity, refill rate of 0.5 per second (1 token every 2 seconds)
  log(BLUE, 'Configuring demo_user: limit=3, refillRate=0.5, burstSize=3...');
  await post('/admin/config', {
    clientId,
    algorithm: 'tokenBucket',
    limit: 3,
    refillRate: 0.5,
    burstSize: 3
  });

  // Clear existing bucket to start fresh
  const client = require('./redis/client');
  await client.del(`bucket:${clientId}`);

  log(BLUE, 'Sending 5 checks in rapid succession (Burst size = 3):');
  for (let i = 1; i <= 5; i++) {
    const res = await post('/check', { clientId });
    const allowed = res.body.allowed;
    const remaining = res.body.remaining;
    
    if (allowed) {
      log(GREEN, `  Request ${i}: ALLOWED (Remaining: ${remaining}, HTTP: ${res.status})`);
    } else {
      const retryAfter = res.headers['retry-after'];
      log(RED, `  Request ${i}: BLOCKED (HTTP: ${res.status}, Retry-After: ${retryAfter}s)`);
    }
    // sleep 50ms
    await new Promise((r) => setTimeout(r, 50));
  }

  // Wait 4.1 seconds (should refill 2 tokens)
  log(BLUE, '\nWaiting 4 seconds to allow tokens to refill...');
  await new Promise((r) => setTimeout(r, 4100));

  log(BLUE, 'Sending 1 more check:');
  const refillCheck = await post('/check', { clientId });
  if (refillCheck.body.allowed) {
    log(GREEN, `  Request 6: ALLOWED (Remaining: ${refillCheck.body.remaining}, HTTP: ${refillCheck.status})`);
  } else {
    log(RED, `  Request 6: BLOCKED (HTTP: ${refillCheck.status})`);
  }
  console.log();

  // Test 4: Per-Endpoint Limiting
  log(BOLD + CYAN, 'Test 4: Per-Endpoint Limiting verification...');
  const endpoint = '/checkout';
  
  log(BLUE, `Configuring general demo_user: limit=10`);
  await post('/admin/config', {
    clientId,
    algorithm: 'tokenBucket',
    limit: 10,
    refillRate: 1,
    burstSize: 10
  });

  log(BLUE, `Configuring strict endpoint /checkout for demo_user: limit=1, burstSize=1`);
  await post('/admin/config', {
    clientId,
    endpoint,
    algorithm: 'tokenBucket',
    limit: 1,
    refillRate: 0.1,
    burstSize: 1
  });

  // Clean redis states
  await client.del(`bucket:${clientId}`);
  await client.del(`bucket:${clientId}:${endpoint}`);

  log(BLUE, 'Checking general endpoint twice:');
  const gen1 = await post('/check', { clientId });
  const gen2 = await post('/check', { clientId });
  log(gen1.body.allowed ? GREEN : RED, `  General check 1: ${gen1.body.allowed ? 'ALLOWED' : 'BLOCKED'} (Rem: ${gen1.body.remaining})`);
  log(gen2.body.allowed ? GREEN : RED, `  General check 2: ${gen2.body.allowed ? 'ALLOWED' : 'BLOCKED'} (Rem: ${gen2.body.remaining})`);

  log(BLUE, 'Checking strict /checkout endpoint twice:');
  const strict1 = await post('/check', { clientId, endpoint });
  const strict2 = await post('/check', { clientId, endpoint });
  log(strict1.body.allowed ? GREEN : RED, `  /checkout check 1: ${strict1.body.allowed ? 'ALLOWED' : 'BLOCKED'} (Rem: ${strict1.body.remaining})`);
  log(strict2.body.allowed ? RED : GREEN, `  /checkout check 2: ${strict2.body.allowed ? 'ALLOWED' : 'BLOCKED'} (HTTP status: ${strict2.status})`);

  log(BOLD + BLUE, '\n=== Demonstration Completed ===');
  process.exit(0);
}

runDemo().catch((err) => {
  console.error('Error during demo run:', err);
  process.exit(1);
});
