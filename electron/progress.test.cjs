const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { progressBody, CHUNK } = require('./progress.cjs');

function server(onRequest) {
  return new Promise((resolve) => {
    const srv = http.createServer(onRequest).listen(0, '127.0.0.1', () => resolve({ srv, url: `http://127.0.0.1:${srv.address().port}` }));
  });
}

test('the body arrives whole, with its length, and progress climbs to the total', async () => {
  const size = CHUNK * 5 + 123;
  const buffer = Buffer.alloc(size, 7);
  let got;
  const { srv, url } = await server((req, res) => {
    const parts = [];
    req.on('data', (d) => parts.push(d));
    req.on('end', () => {
      got = { length: req.headers['content-length'], body: Buffer.concat(parts) };
      res.setHeader('content-type', 'application/json');
      res.end('{}');
    });
  });
  try {
    const seen = [];
    const streamed = progressBody(buffer, (sent, total) => seen.push([sent, total]));
    const res = await fetch(url, { method: 'PUT', headers: streamed.headers, body: streamed.body, ...streamed.init });
    assert.equal(res.status, 200);
    assert.equal(got.length, String(size));
    assert.equal(got.body.length, size);
    assert.ok(got.body.equals(buffer));
    assert.equal(seen.length, 6);
    assert.deepEqual(seen.at(-1), [size, size]);
    assert.ok(seen.every(([sent, total], i) => total === size && (i === 0 || sent > seen[i - 1][0])), 'sent only grows');
  } finally {
    srv.close();
  }
});

test('works on a view into a larger buffer (a Buffer from the pool)', async () => {
  const pool = Buffer.alloc(1000, 1);
  const view = pool.subarray(100, 400);
  view.fill(9);
  let body;
  const { srv, url } = await server((req, res) => {
    const parts = [];
    req.on('data', (d) => parts.push(d));
    req.on('end', () => {
      body = Buffer.concat(parts);
      res.end('ok');
    });
  });
  try {
    const streamed = progressBody(view, () => {});
    await fetch(url, { method: 'PUT', headers: streamed.headers, body: streamed.body, ...streamed.init });
    assert.ok(body.equals(view));
  } finally {
    srv.close();
  }
});
