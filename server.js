/**
 * CogniScan — server.js (UPGRADED)
 *
 * New features:
 *  - Gemini audio analysis for memory word verification
 *  - Emergency contact management with auto-call trigger
 *  - Enhanced session storage with emergency events
 */

'use strict';

const express  = require('express');
const cors     = require('cors');
const path     = require('path');
const fs       = require('fs');
const https    = require('https');
const http     = require('http');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ─────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '20mb' }));  // audio/images arrive as base64
app.use(express.static(path.join(__dirname)));

// ── File paths ─────────────────────────────────────────────────────────────────
const SESSIONS_FILE  = path.join(__dirname, 'sessions.json');
const CONTACTS_FILE  = path.join(__dirname, 'contacts.json');
const EMERGENCY_FILE = path.join(__dirname, 'emergency_events.json');
const SETTINGS_FILE  = path.join(__dirname, 'settings.json');
const SMS_LOGS_FILE  = path.join(__dirname, 'sms_logs.json');

// ── Generic JSON helpers ───────────────────────────────────────────────────────
function loadJSON(file, def) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) { console.error('Load error', file, e.message); }
  return def;
}

function saveJSON(file, data) {
  try { fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8'); }
  catch (e) { console.error('Save error', file, e.message); }
}

// ── POST /api/sessions ─────────────────────────────────────────────────────────
app.post('/api/sessions', (req, res) => {
  const { voiceScore, memScore, faceScore, overall } = req.body;
  if ([voiceScore, memScore, faceScore, overall].some(v => typeof v !== 'number'))
    return res.status(400).json({ error: 'Invalid session data' });

  const session = { id: Date.now(), timestamp: new Date().toISOString(), voiceScore, memScore, faceScore, overall };
  const sessions = loadJSON(SESSIONS_FILE, []);
  sessions.push(session);
  if (sessions.length > 90) sessions.splice(0, sessions.length - 90);
  saveJSON(SESSIONS_FILE, sessions);

  // Auto-trigger emergency if overall is HIGH RISK (< 45)
  const settings = loadJSON(SETTINGS_FILE, { darkMode: false, notificationsEnabled: true, voiceAssistantEnabled: true });
  
  if (overall < 45 && settings.notificationsEnabled) {
    const contacts = loadJSON(CONTACTS_FILE, []);
    const primary  = contacts.find(c => c.isPrimary);
    if (primary) {
      const events = loadJSON(EMERGENCY_FILE, []);
      const eventId = Date.now();
      events.push({ id: eventId, timestamp: new Date().toISOString(), score: overall, contactNotified: primary.name, phone: primary.phone });
      if (events.length > 50) events.splice(0, events.length - 50);
      saveJSON(EMERGENCY_FILE, events);
      
      // 📱 Automate SMS
      const smsLogs = loadJSON(SMS_LOGS_FILE, []);
      const smsBody = `🚨 COGNISCAN ALERT: High Risk detected for Robert. Score: ${overall}. View details at: http://localhost:3000/cp - Harsh Agarwal`;
      smsLogs.push({ id: eventId, timestamp: new Date().toISOString(), to: primary.name, phone: primary.phone, message: smsBody, status: 'SENT' });
      if (smsLogs.length > 50) smsLogs.splice(0, smsLogs.length - 50);
      saveJSON(SMS_LOGS_FILE, smsLogs);

      console.log(`🚨 EMERGENCY ALERT: Score ${overall} — Notifying ${primary.name} at ${primary.phone}`);
      console.log(`📱 SMS SENT: ${smsBody}`);
    }
  }

  const latestSms = loadJSON(SMS_LOGS_FILE, []).reverse().find(s => Date.now() - new Date(s.timestamp).getTime() < 5000);

  res.json({ success: true, session, emergencyTriggered: (overall < 45 && settings.notificationsEnabled), smsSent: !!latestSms });
});

// ── GET /api/sessions ──────────────────────────────────────────────────────────
app.get('/api/sessions', (req, res) => {
  res.json(loadJSON(SESSIONS_FILE, []).reverse());
});

// ── Emergency Contacts CRUD ────────────────────────────────────────────────────
app.get('/api/contacts', (req, res) => {
  let contacts = loadJSON(CONTACTS_FILE, []);
  
  // Ensure Harsh Agarwal exists if no primary is set or if he's missing
  const hasHarsh = contacts.find(c => c.name === 'Harsh Agarwal' || c.phone === '7304082775');
  if (!hasHarsh) {
    const harsh = { id: 101, name: 'Harsh Agarwal', phone: '7304082775', relation: 'Caregiver', isPrimary: true, addedAt: new Date().toISOString(), photoUrl: '' };
    if (contacts.length === 0) {
      contacts.push(harsh);
    } else {
      // If we already have contacts but none is Harsh, we can add him if there's no primary
      if (!contacts.find(c => c.isPrimary)) contacts.push(harsh);
    }
    saveJSON(CONTACTS_FILE, contacts);
  }
  
  res.json(contacts);
});

app.post('/api/contacts', (req, res) => {
  const { name, phone, relation, isPrimary, photoUrl } = req.body;
  if (!name || !phone) return res.status(400).json({ error: 'name and phone required' });

  const contacts = loadJSON(CONTACTS_FILE, []);
  if (isPrimary) contacts.forEach(c => c.isPrimary = false); // only one primary
  const contact = { id: Date.now(), name, phone, relation: relation || 'Contact', isPrimary: !!isPrimary, photoUrl: photoUrl || null, addedAt: new Date().toISOString() };
  contacts.push(contact);
  saveJSON(CONTACTS_FILE, contacts);
  res.json({ success: true, contact });
});

app.put('/api/contacts/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const contacts = loadJSON(CONTACTS_FILE, []);
  const idx = contacts.findIndex(c => c.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  if (req.body.isPrimary) contacts.forEach(c => c.isPrimary = false);
  contacts[idx] = { ...contacts[idx], ...req.body, id };
  saveJSON(CONTACTS_FILE, contacts);
  res.json({ success: true, contact: contacts[idx] });
});

app.delete('/api/contacts/:id', (req, res) => {
  const id = parseInt(req.params.id);
  let contacts = loadJSON(CONTACTS_FILE, []);
  contacts = contacts.filter(c => c.id !== id);
  saveJSON(CONTACTS_FILE, contacts);
  res.json({ success: true });
});

// ── POST /api/emergency-call ───────────────────────────────────────────────────
// Logs an emergency call event (actual calling done via tel: link on client)
app.post('/api/emergency-call', (req, res) => {
  const { contactId, reason, score } = req.body;
  const contacts = loadJSON(CONTACTS_FILE, []);
  const contact  = contacts.find(c => c.id === contactId);
  if (!contact) return res.status(404).json({ error: 'Contact not found' });

  const events = loadJSON(EMERGENCY_FILE, []);
  events.push({ id: Date.now(), timestamp: new Date().toISOString(), contactNotified: contact.name, phone: contact.phone, reason: reason || 'Manual trigger', score: score || null });
  if (events.length > 50) events.splice(0, events.length - 50);
  saveJSON(EMERGENCY_FILE, events);

  console.log(`📞 Emergency call logged: ${contact.name} (${contact.phone}) — Reason: ${reason}`);
  res.json({ success: true, contact });
});

// ── GET /api/emergency-events ──────────────────────────────────────────────────
app.get('/api/emergency-events', (req, res) => {
  res.json(loadJSON(EMERGENCY_FILE, []).reverse());
});

app.get('/api/sms-logs', (req, res) => {
  res.json(loadJSON(SMS_LOGS_FILE, []).reverse());
});

app.get('/cp', (req, res) => {
  res.sendFile(path.join(__dirname, 'cp.html'));
});

app.get('/api/caregiver-summary', (req, res) => {
  const sessions = loadJSON(SESSIONS_FILE, []);
  const latest   = sessions[sessions.length - 1] || null;
  const contacts = loadJSON(CONTACTS_FILE, []);
  const events   = loadJSON(EMERGENCY_FILE, []);
  
  res.json({
    latestScore: latest ? latest.overall : '--',
    latestStatus: latest ? (latest.overall < 45 ? 'HIGH RISK' : 'NORMAL') : 'NO DATA',
    primaryContact: contacts.find(c => c.isPrimary) || null,
    recentAlerts: events.slice(0, 5)
  });
});

app.post('/api/caregiver/wellness-check', (req, res) => {
  const smsLogs = loadJSON(SMS_LOGS_FILE, []);
  const smsBody = `🚨 WELLNESS CHECK: Harsh Agarwal is requesting an update on Robert's status. Please open CogniScan to perform a quick check.`;
  
  const logEntry = { 
    id: Date.now(), 
    timestamp: new Date().toISOString(), 
    to: 'Robert (Patient)', 
    phone: 'SYSTEM', 
    message: smsBody, 
    status: 'SENT' 
  };
  
  smsLogs.push(logEntry);
  if (smsLogs.length > 50) smsLogs.splice(0, smsLogs.length - 50);
  saveJSON(SMS_LOGS_FILE, smsLogs);
  
  console.log(`📱 WELLNESS CHECK SENT: ${smsBody}`);
  res.json({ success: true, message: 'Wellness check request sent to Robert.' });
});

// ── User Settings & Profile ────────────────────────────────────────────────────
app.get('/api/user/settings', (req, res) => {
  res.json(loadJSON(SETTINGS_FILE, { darkMode: false, notificationsEnabled: true, voiceAssistantEnabled: true, name: 'Robert', profileImage: null }));
});

app.post('/api/user/settings', (req, res) => {
  const settings = loadJSON(SETTINGS_FILE, { darkMode: false, notificationsEnabled: true, voiceAssistantEnabled: true, name: 'Robert', profileImage: null });
  const newSettings = { ...settings, ...req.body };
  saveJSON(SETTINGS_FILE, newSettings);
  res.json({ success: true, settings: newSettings });
});

app.put('/api/user/profile', (req, res) => {
  const { name, profileImage } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  
  const settings = loadJSON(SETTINGS_FILE, { darkMode: false, notificationsEnabled: true, voiceAssistantEnabled: true, name: 'Robert', profileImage: null });
  settings.name = name;
  if (profileImage !== undefined) settings.profileImage = profileImage;
  
  saveJSON(SETTINGS_FILE, settings);
  res.json({ success: true, profile: { name: settings.name, profileImage: settings.profileImage } });
});

// ── POST /api/analyse-face ─────────────────────────────────────────────────────
// Proxies face image to local Python ML service
app.post('/api/analyse-face', (req, res) => {
  const { image } = req.body;
  if (!image) return res.status(400).json({ error: 'No image provided' });

  const body = JSON.stringify({ image_base64: image });

  const options = {
    hostname: 'localhost',
    port: 8000,
    path: '/analyse-face',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body)
    }
  };

  const mlReq = http.request(options, (mlRes) => {
    let data = '';
    mlRes.on('data', chunk => data += chunk);
    mlRes.on('end', () => {
      try {
        const result = JSON.parse(data);
        res.json(result);
      } catch (e) {
        console.error('Face parse error:', e.message);
        res.status(502).json({ error: 'Failed to parse ML response' });
      }
    });
  });

  mlReq.on('error', e => {
    console.error('ML service error:', e.message);
    res.status(502).json({ error: 'ML service unavailable: ' + e.message });
  });
  mlReq.write(body);
  mlReq.end();
});

// ── POST /api/analyse-audio-emotion ───────────────────────────────────────────
// Proxies audio to local Python ML service for emotion detection
app.post('/api/analyse-audio-emotion', (req, res) => {
  const { audioBase64 } = req.body;
  if (!audioBase64) return res.status(400).json({ error: 'No audio provided' });

  const body = JSON.stringify({ audio_base64: audioBase64 });

  const options = {
    hostname: 'localhost',
    port: 8000,
    path: '/analyse-audio-emotion',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body)
    }
  };

  const mlReq = http.request(options, (mlRes) => {
    let data = '';
    mlRes.on('data', chunk => data += chunk);
    mlRes.on('end', () => {
      try {
        const result = JSON.parse(data);
        res.json(result);
      } catch (e) {
        console.error('Audio emotion parse error:', e.message);
        res.status(502).json({ error: 'Failed to parse ML response' });
      }
    });
  });

  mlReq.on('error', e => {
    console.error('ML service error:', e.message);
    res.status(502).json({ error: 'ML service unavailable: ' + e.message });
  });
  mlReq.write(body);
  mlReq.end();
});

// ── POST /api/analyse-voice-gemini ────────────────────────────────────────────
// Uses Gemini to analyse if a specific word was spoken in audio
// Body: { audioBase64, mimeType, targetWord }
app.post('/api/analyse-voice-gemini', (req, res) => {
  const { audioBase64, mimeType, targetWord } = req.body;
  const GEMINI_KEY = process.env.GEMINI_API_KEY || 'AIzaSyCdyOv-YUlOQW1NnqRtEbAAbsv4-afvcWQ';

  if (!audioBase64 || !targetWord) {
    return res.status(400).json({ error: 'audioBase64 and targetWord required' });
  }

  const body = JSON.stringify({
    contents: [{
      parts: [
        {
          inline_data: {
            mime_type: mimeType || 'audio/webm',
            data: audioBase64
          }
        },
        {
          text: `Did the speaker say the word "${targetWord}"? Answer with only "Yes" or "No".`
        }
      ]
    }]
  });

  const path_url = `/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`;

  const options = {
    hostname: 'generativelanguage.googleapis.com',
    path: path_url,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body)
    }
  };

  const apiReq = https.request(options, (apiRes) => {
    let data = '';
    apiRes.on('data', chunk => data += chunk);
    apiRes.on('end', () => {
      try {
        const parsed   = JSON.parse(data);
        const text     = parsed.candidates?.[0]?.content?.parts?.[0]?.text || 'No';
        const detected = text.trim().toLowerCase().startsWith('yes');
        res.json({ detected, word: targetWord, raw: text.trim() });
      } catch (e) {
        console.error('Gemini parse error:', e.message, data);
        res.status(502).json({ error: 'Gemini parse error', raw: data });
      }
    });
  });

  apiReq.on('error', e => res.status(502).json({ error: 'Gemini request error: ' + e.message }));
  apiReq.write(body);
  apiReq.end();
});

// ── POST /api/analyse-full-speech-gemini ──────────────────────────────────────
// Full speech analysis: checks all memory words at once
app.post('/api/analyse-full-speech-gemini', (req, res) => {
  const { audioBase64, mimeType, words } = req.body;
  const GEMINI_KEY = process.env.GEMINI_API_KEY || 'AIzaSyCdyOv-YUlOQW1NnqRtEbAAbsv4-afvcWQ';

  if (!audioBase64 || !words || !words.length) {
    return res.status(400).json({ error: 'audioBase64 and words[] required' });
  }

  const wordList = words.map(w => `"${w}"`).join(', ');
  const body = JSON.stringify({
    contents: [{
      parts: [
        {
          inline_data: {
            mime_type: mimeType || 'audio/webm',
            data: audioBase64
          }
        },
        {
          text: `Listen to this audio carefully. The speaker is trying to recall these specific words: ${wordList}. For each word, determine if the speaker said it. Return ONLY a JSON object like: {"Apple":true,"River":false,...} with true if the word was spoken, false if not. No other text.`
        }
      ]
    }]
  });

  const path_url = `/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`;
  const options  = {
    hostname: 'generativelanguage.googleapis.com',
    path: path_url,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
  };

  const apiReq = https.request(options, (apiRes) => {
    let data = '';
    apiRes.on('data', chunk => data += chunk);
    apiRes.on('end', () => {
      try {
        const parsed = JSON.parse(data);
        const text   = parsed.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
        const clean  = text.replace(/```json|```/g, '').trim();
        const result = JSON.parse(clean);
        res.json({ results: result });
      } catch (e) {
        console.error('Gemini full parse error:', e.message);
        res.status(502).json({ error: 'Gemini parse error' });
      }
    });
  });

  apiReq.on('error', e => res.status(502).json({ error: 'Gemini error: ' + e.message }));
  apiReq.write(body);
  apiReq.end();
});

// ── Health check ───────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), features: ['voice', 'memory-gemini', 'face-claude', 'emergency-contacts'] });
});

// ── Start ──────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`CogniScan server → http://localhost:${PORT}`);
  console.log(`Claude key: ${process.env.ANTHROPIC_API_KEY ? '✓ env var' : '⚠ client-supplied'}`);
  console.log(`Gemini key: ${process.env.GEMINI_API_KEY ? '✓ env var' : '✓ hardcoded (memory game)'}`);
});
