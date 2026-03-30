const http = require('http');
const data = JSON.stringify({ voiceScore: 30, memScore: 40, faceScore: 50, overall: 40 });
const options = { hostname: 'localhost', port: 3000, path: '/api/sessions', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': data.length } };
const req = http.request(options, (res) => {
  let body = '';
  res.on('data', (chunk) => body += chunk);
  res.on('end', () => console.log('Response:', body));
});
req.on('error', (e) => console.error(e.message));
req.write(data);
req.end();
