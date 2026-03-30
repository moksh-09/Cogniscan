/* ══════════════════════════════════
   CogniScan — app.js (UPGRADED)
   Features:
   - Gemini AI audio analysis for memory
   - Emergency contacts with auto-call
   - Image + word memory cards
   - Voice assistant (TTS)
   - Audio waveform visualizer
   ══════════════════════════════════ */

// ── State ──────────────────────────────────────────────────────────────────────
var API_KEY        = '';
var alertOn        = true;
var voiceScore     = 0;
var memScore       = 0;
var faceScore      = 68;
var userName       = 'Robert';
var profileImage   = null;

var appSettings = {
  darkMode: false,
  notificationsEnabled: true,
  voiceAssistantEnabled: true
};

var cameraStream   = null;
var voiceRec       = null;
var memRecog       = null;
var voiceIsListening = false;
var voiceFullText  = '';
var voiceSentenceIdx = 0;
var voiceSentences = [
  '"The quick brown fox jumps over the lazy dog near the river bank."',
  '"She sells sea shells by the sea shore on sunny afternoons."',
  '"Peter Piper picked a peck of pickled peppers from the garden."'
];

// ── Memory words with emoji images ─────────────────────────────────────────────
var memItems = [
  { word: 'Apple',   emoji: '🍎', color: '#E07B6A', light: '#fde8e5' },
  { word: 'River',   emoji: '🌊', color: '#1A6B72', light: '#e0f4f5' },
  { word: 'Candle',  emoji: '🕯️', color: '#f5a623', light: '#fef3e0' },
  { word: 'Mirror',  emoji: '🪞', color: '#7B5EA7', light: '#f0ebfa' },
  { word: 'Garden',  emoji: '🌸', color: '#4CAF7D', light: '#e8f5ee' }
];
var memWords    = memItems.map(function(i){ return i.word; });
var memColors   = memItems.map(function(i){ return i.color; });
var memFound    = [false, false, false, false, false];
var memWordIdx  = 0;
var memTimerInterval = null;
var memSecondsLeft   = 6;

// ── Gemini recording state ──────────────────────────────────────────────────────
var geminiMediaRecorder  = null;
var geminiAudioChunks    = [];
var geminiIsRecording    = false;
var geminiAudioBase64    = null;

// ── Audio context for waveform ──────────────────────────────────────────────────
var audioCtx      = null;
var analyserNode  = null;
var waveAnimFrame = null;
var voiceStream   = null;

// ── Voice Assistant (TTS) ───────────────────────────────────────────────────────
function vaSpeak(text, updateUI) {
  if (!appSettings.voiceAssistantEnabled) return; // Silent if disabled
  
  if (updateUI) {
    var el = document.getElementById('vaText');
    if (el) el.textContent = text;
  }
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    var utt = new SpeechSynthesisUtterance(text);
    utt.rate  = 0.92;
    utt.pitch = 1.05;
    utt.lang  = 'en-US';
    // Pick a natural voice if available
    var voices = window.speechSynthesis.getVoices();
    var preferred = voices.find(function(v){
      return v.name.toLowerCase().includes('samantha') ||
             v.name.toLowerCase().includes('karen') ||
             v.name.toLowerCase().includes('daniel');
    });
    if (preferred) utt.voice = preferred;
    window.speechSynthesis.speak(utt);
  }
}

// Preload voices on page load
if ('speechSynthesis' in window) {
  window.speechSynthesis.getVoices();
  window.speechSynthesis.onvoiceschanged = function(){};
}

// ── Setup ───────────────────────────────────────────────────────────────────────
function startApp() {
  var k = document.getElementById('apiKeyInput').value.trim();
  if (k) API_KEY = k;
  var n = document.getElementById('userName').value.trim();
  if (n) {
    userName = n;
    updateProfileOnHome();
  }
  initHome();
  goto('s1');
  
  // Save initial name to backend
  saveProfile();
}

function skipSetup() {
  initHome();
  goto('s1');
}

// ── Settings Logic ─────────────────────────────────────────────────────────────
function initSettings() {
  fetch('/api/user/settings')
    .then(function(r) { return r.json(); })
    .then(function(s) {
      appSettings = {
        darkMode: s.darkMode,
        notificationsEnabled: s.notificationsEnabled,
        voiceAssistantEnabled: s.voiceAssistantEnabled
      };
      userName = s.name || userName;
      profileImage = s.profileImage || profileImage;
      
      applyDarkMode(appSettings.darkMode);
      updateSettingsUI();
      updateProfileOnHome();
      
      // Update inputs if they exist
      var nameInp = document.getElementById('profileNameInput');
      var urlInp = document.getElementById('profileImageUrlInput');
      if (nameInp) nameInp.value = userName;
      if (urlInp) urlInp.value = profileImage || '';
      updateProfilePreview();
    });
}

function updateSettingsUI() {
  // Sync the UI toggles
  syncToggle('darkToggleBg', 'darkToggleThumb', appSettings.darkMode);
  syncToggle('notifyToggleBg', 'notifyToggleThumb', appSettings.notificationsEnabled);
  syncToggle('vaToggleBg', 'vaToggleThumb', appSettings.voiceAssistantEnabled);
  
  // Also sync the "Auto-Call" toggle in Contacts if it exists
  var acBg = document.getElementById('toggleBg');
  var acTh = document.getElementById('toggleThumb');
  if (acBg && acTh) syncToggle('toggleBg', 'toggleThumb', appSettings.notificationsEnabled);
}

function syncToggle(bgId, thumbId, state) {
  var bg = document.getElementById(bgId);
  var th = document.getElementById(thumbId);
  if (!bg || !th) return;
  bg.style.background = state ? '#1A6B72' : '#d0d5dd';
  th.style.left = state ? '25px' : '3px';
  // If it's the right-aligned one (original), use right property
  if (thumbId === 'toggleThumb') {
    th.style.left = 'auto';
    th.style.right = state ? '3px' : '25px';
  }
}

function toggleDarkModeUI() {
  appSettings.darkMode = !appSettings.darkMode;
  applyDarkMode(appSettings.darkMode);
  saveSettings();
  showToast(appSettings.darkMode ? 'Dark mode enabled' : 'Light mode enabled');
}

function applyDarkMode(enabled) {
  var phone = document.querySelector('.phone');
  if (phone) phone.classList.toggle('dark-theme', enabled);
  localStorage.setItem('darkMode', enabled);
}

function toggleNotificationsUI() {
  appSettings.notificationsEnabled = !appSettings.notificationsEnabled;
  alertOn = appSettings.notificationsEnabled;
  saveSettings();
  updateSettingsUI();
  showToast(appSettings.notificationsEnabled ? 'Smart alerts enabled' : 'Smart alerts disabled');
}

function toggleVoiceAssistantUI() {
  appSettings.voiceAssistantEnabled = !appSettings.voiceAssistantEnabled;
  saveSettings();
  updateSettingsUI();
  showToast(appSettings.voiceAssistantEnabled ? 'Voice assistant enabled' : 'Voice assistant disabled');
}

function saveSettings() {
  fetch('/api/user/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(appSettings)
  });
}

function saveProfile() {
  var name = document.getElementById('profileNameInput')?.value.trim() || userName;
  var url = document.getElementById('profileImageUrlInput')?.value.trim() || profileImage;
  
  fetch('/api/user/profile', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name, profileImage: url })
  })
  .then(function(r) { return r.json(); })
  .then(function(data) {
    userName = data.profile.name;
    profileImage = data.profile.profileImage;
    updateProfileOnHome();
    showToast('Profile updated successfully');
  });
}

function updateProfileOnHome() {
  var greet = document.getElementById('greetName');
  if (greet) greet.innerHTML = userName + ' 👋';
  
  // Update Profile Icon if it exists
  var profIcon = document.getElementById('homeProfileIcon');
  if (profIcon && profileImage) {
    profIcon.innerHTML = '<img src="' + profileImage + '" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">';
  }
}

function updateProfilePreview() {
  var url = document.getElementById('profileImageUrlInput')?.value.trim();
  var preview = document.getElementById('profileImagePreview');
  if (!preview) return;
  if (url) {
    preview.innerHTML = '<img src="' + url + '" style="width:100%;height:100%;object-fit:cover;" onerror="this.parentElement.innerHTML=\'👤\'">';
  } else {
    preview.innerHTML = '👤';
  }
}

function showToast(msg) {
  var t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.style.display = 'block';
  t.style.opacity = '1';
  setTimeout(function() {
    t.style.opacity = '0';
    setTimeout(function() { t.style.display = 'none'; }, 500);
  }, 3000);
}

function initHome() {
  updateTime();
  var prefix = document.getElementById('greetPrefix');
  if (prefix) prefix.textContent = getTimeGreeting() + ',';
  
  var el = document.getElementById('greetName');
  if (el) el.textContent = userName + ' 👋';
  loadLastSession();
  loadContacts();

  var greeting = getTimeGreeting() + ', ' + userName + '! I\'m ready to help with your cognitive health check. Tap a test below to begin! 🌟';
  setTimeout(function(){
    vaSpeak(greeting, true);
  }, 600);
}

function getTimeGreeting() {
  var h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function updateTime() {
  var now  = new Date();
  var h    = now.getHours();
  var m    = now.getMinutes();
  var ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  var ms = m < 10 ? '0' + m : m;
  var el = document.getElementById('homeTime');
  if (el) el.textContent = h + ':' + ms + ' ' + ampm;

  var days   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var d = document.getElementById('homeDate');
  if (d) d.textContent = days[now.getDay()] + ', ' + months[now.getMonth()] + ' ' + now.getDate();
}
setInterval(updateTime, 30000);

// ── Navigation ──────────────────────────────────────────────────────────────────
function goto(id) {
  document.querySelectorAll('.screen').forEach(function(s){ s.classList.remove('active'); });
  var target = document.getElementById(id);
  if (target) { target.classList.add('active'); target.scrollTop = 0; }
  if (id === 's_face') startCamera();
  if (id === 's4')     showResults();
  if (id === 's5')     { loadContacts(); loadHistory(); }
}

// ── Voice Test ──────────────────────────────────────────────────────────────────
function startVoiceTest() {
  voiceFullText = '';
  voiceScore = 0;
  goto('s2');
  vaSpeak('Please read the sentence on screen clearly. Tap the microphone when ready.', false);
}

function toggleVoiceRec() {
  if (voiceIsListening) stopVoiceRec();
  else startVoiceRec();
}

function startVoiceRec() {
  var SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRec) {
    document.getElementById('voiceStatusText').textContent = 'Speech recognition needs Chrome. Please use Chrome browser.';
    return;
  }
  voiceRec = new SpeechRec();
  voiceRec.continuous     = true;
  voiceRec.interimResults = true;
  voiceRec.lang           = 'en-US';
  voiceIsListening        = true;

  var micBtn = document.getElementById('micBtn');
  if (micBtn) micBtn.classList.add('rec-btn-active');
  document.getElementById('voiceStatusText').textContent = '🔴 Listening... Speak now!';
  document.getElementById('voiceStatus').style.background = '#fff0f0';

  // Start audio waveform
  startWaveform();

  var wave = document.getElementById('audioWave');
  if (wave) wave.style.opacity = '1';

  // --- ADDED: MediaRecorder for audio emotion ---
  navigator.mediaDevices.getUserMedia({ audio: true }).then(function(stream) {
    voiceAudioChunks = [];
    voiceMediaRecorder = new MediaRecorder(stream);
    voiceMediaRecorder.ondataavailable = function(e) { if (e.data.size > 0) voiceAudioChunks.push(e.data); };
    voiceMediaRecorder.onstop = function() {
      var blob = new Blob(voiceAudioChunks, { type: 'audio/webm' });
      var reader = new FileReader();
      reader.onloadend = function() { voiceAudioBase64 = reader.result.split(',')[1]; };
      reader.readAsDataURL(blob);
    };
    voiceMediaRecorder.start();
  });

  voiceRec.onresult = function(e) {
    var interim = '', final = '';
    for (var i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) final  += e.results[i][0].transcript;
      else                      interim += e.results[i][0].transcript;
    }
    if (final) voiceFullText += final + ' ';
    document.getElementById('voiceResult').textContent = (voiceFullText + interim) || '—';
    computeVoiceScore();
  };

  voiceRec.onerror = function(e) {
    document.getElementById('voiceStatusText').textContent = 'Mic error: ' + e.error + '. Check permissions.';
    stopVoiceRec();
  };

  voiceRec.start();
}

// ── Voice Test MediaRecorder state ───────────────────────────────────────────
var voiceAudioChunks = [];
var voiceMediaRecorder = null;
var voiceAudioBase64 = null;

function stopVoiceRec() {
  if (voiceRec) try { voiceRec.stop(); } catch(e){}
  if (voiceMediaRecorder && voiceMediaRecorder.state !== 'inactive') {
    voiceMediaRecorder.stop();
  }
  voiceIsListening = false;
  stopWaveform();

  var micBtn = document.getElementById('micBtn');
  if (micBtn) micBtn.classList.remove('rec-btn-active');
  var wave = document.getElementById('audioWave');
  if (wave) wave.style.opacity = '0';
  var el = document.getElementById('voiceStatusText');
  if (el) el.textContent = '✅ Recorded! Tap mic to redo, or tap Next.';
  var vs = document.getElementById('voiceStatus');
  if (vs) vs.style.background = '#f0f9f5';
}

function computeVoiceScore() {
  var target  = voiceSentences[voiceSentenceIdx].replace(/[^a-z\s]/gi,'').toLowerCase().split(/\s+/);
  var said    = voiceFullText.toLowerCase().split(/\s+/);
  var matches = 0;
  target.forEach(function(w){ if(said.indexOf(w) !== -1) matches++; });
  voiceScore = Math.round((matches / target.length) * 100);
}

function finishVoiceTest() {
  stopVoiceRec();
  if (voiceScore === 0) voiceScore = 75;
  
  // Analize audio emotion if we have recording
  if (voiceAudioBase64) {
    fetch('/api/analyse-audio-emotion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audioBase64: voiceAudioBase64 })
    })
    .then(function(r){ return r.json(); })
    .then(function(res){
      console.log('Voice emotion:', res.emotion, res.confidence);
      // We could store this or show it in results
    })
    .catch(function(e){ console.error('Audio emotion error:', e); });
  }

  vaSpeak('Great job! Now let\'s test your memory. Look at each word and image carefully!', false);
  startMemoryGame();
}

// ── Audio Waveform Visualizer ───────────────────────────────────────────────────
function startWaveform() {
  try {
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function(stream) {
      voiceStream = stream;
      audioCtx   = new (window.AudioContext || window.webkitAudioContext)();
      var source  = audioCtx.createMediaStreamSource(stream);
      analyserNode = audioCtx.createAnalyser();
      analyserNode.fftSize = 64;
      source.connect(analyserNode);
      animateWave();
    }).catch(function(){});
  } catch(e){}
}

function animateWave() {
  if (!analyserNode) return;
  var data = new Uint8Array(analyserNode.frequencyBinCount);
  analyserNode.getByteFrequencyData(data);
  for (var i = 1; i <= 12; i++) {
    var bar = document.getElementById('wb' + i);
    if (bar) {
      var val = data[Math.floor(i * data.length / 14)] || 0;
      bar.style.height = Math.max(6, Math.min(44, val * 0.4)) + 'px';
    }
  }
  waveAnimFrame = requestAnimationFrame(animateWave);
}

function stopWaveform() {
  if (waveAnimFrame) cancelAnimationFrame(waveAnimFrame);
  if (voiceStream) { voiceStream.getTracks().forEach(function(t){ t.stop(); }); voiceStream = null; }
  if (audioCtx) { try { audioCtx.close(); } catch(e){} audioCtx = null; }
  analyserNode = null;
}

// ── Memory Game — Memorize Phase ────────────────────────────────────────────────
function startMemoryGame() {
  memWordIdx = 0;
  memFound   = [false, false, false, false, false];
  document.getElementById('memList').innerHTML = '';
  goto('s3');
  showMemWord();
}

function showMemWord() {
  var item = memItems[memWordIdx];
  document.getElementById('memWord').textContent = item.word;
  document.getElementById('memWord').style.color = item.color;
  document.getElementById('memProgress').textContent = 'Word ' + (memWordIdx + 1) + ' of ' + memItems.length;
  document.getElementById('memBar').style.width = ((memWordIdx + 1) / memItems.length * 100) + '%';

  // Show emoji image
  var imgCont = document.getElementById('memImgContainer');
  if (imgCont) {
    imgCont.className = 'mem-img-placeholder';
    imgCont.style.background = item.light;
    imgCont.textContent = item.emoji;
  }

  // Add badge to list
  var badge = document.createElement('span');
  badge.className = 'word-badge';
  badge.style.background = item.light;
  badge.style.color = item.color;
  badge.innerHTML = item.emoji + ' ' + item.word;
  document.getElementById('memList').appendChild(badge);

  // Speak the word
  vaSpeak(item.word + '. ' + item.emoji, false);

  // Timer
  memSecondsLeft = 6;
  document.getElementById('memTimerNum').textContent = memSecondsLeft;
  document.getElementById('memTimerArc').style.strokeDashoffset = '0';

  if (memTimerInterval) clearInterval(memTimerInterval);
  memTimerInterval = setInterval(function() {
    memSecondsLeft--;
    var el = document.getElementById('memTimerNum');
    if (el) el.textContent = memSecondsLeft;
    var arc = document.getElementById('memTimerArc');
    if (arc) arc.style.strokeDashoffset = String((1 - memSecondsLeft / 6) * 188);
    if (memSecondsLeft <= 0) {
      clearInterval(memTimerInterval);
      memWordIdx++;
      if (memWordIdx < memItems.length) showMemWord();
      else startRecallPhase();
    }
  }, 1000);
}

// ── Memory Game — Recall Phase (Gemini) ────────────────────────────────────────
function startRecallPhase() {
  clearInterval(memTimerInterval);
  geminiAudioBase64 = null;
  geminiAudioChunks = [];
  geminiIsRecording = false;
  document.getElementById('analyseGeminiBtn').style.display = 'none';
  document.getElementById('geminiAnalysisResult').style.display = 'none';
  goto('s3b');
  buildRecallList();
  startMemRecog(); // Browser fallback
  vaSpeak('Now say all five words you just memorised. Tap the microphone and speak clearly!', false);
}

function buildRecallList() {
  var list = document.getElementById('recallList');
  list.innerHTML = '';
  memItems.forEach(function(item, i) {
    var row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:12px;padding:10px 14px;background:#f8f9fa;border-radius:16px;transition:background .3s;';
    row.id = 'recall_row_' + i;
    row.innerHTML =
      '<div id="recall_check_' + i + '" style="width:32px;height:32px;border-radius:50%;background:#e8ecef;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:background .3s;">' +
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ccc" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>' +
      '</div>' +
      '<span style="font-size:22px;">' + item.emoji + '</span>' +
      '<span style="font-size:18px;font-weight:700;color:' + item.color + ';">' + item.word + '</span>';
    list.appendChild(row);
  });
}

// ── Gemini Audio Recording ──────────────────────────────────────────────────────
function toggleGeminiRec() {
  if (geminiIsRecording) stopGeminiRec();
  else startGeminiRec();
}

function startGeminiRec() {
  navigator.mediaDevices.getUserMedia({ audio: true }).then(function(stream) {
    geminiAudioChunks = [];
    geminiIsRecording = true;
    document.getElementById('geminiRecBtn').classList.add('rec-btn-active');
    document.getElementById('recStatus').textContent = '🔴 Recording... Say all 5 words!';
    document.getElementById('recStatus').style.color = '#E07B6A';
    document.getElementById('geminiWave').style.opacity = '1';
    document.getElementById('analyseGeminiBtn').style.display = 'none';

    try {
      var mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
      geminiMediaRecorder = new MediaRecorder(stream, { mimeType: mimeType });
    } catch(e) {
      geminiMediaRecorder = new MediaRecorder(stream);
    }

    geminiMediaRecorder.ondataavailable = function(e) {
      if (e.data.size > 0) geminiAudioChunks.push(e.data);
    };

    geminiMediaRecorder.onstop = function() {
      var blob = new Blob(geminiAudioChunks, { type: geminiMediaRecorder.mimeType || 'audio/webm' });
      var reader = new FileReader();
      reader.onloadend = function() {
        geminiAudioBase64 = reader.result.split(',')[1];
        document.getElementById('analyseGeminiBtn').style.display = 'flex';
      };
      reader.readAsDataURL(blob);
      stream.getTracks().forEach(function(t){ t.stop(); });
    };

    geminiMediaRecorder.start(250);
  }).catch(function(err) {
    document.getElementById('recStatus').textContent = 'Mic error: ' + err.message;
  });
}

function stopGeminiRec() {
  if (geminiMediaRecorder && geminiIsRecording) {
    geminiIsRecording = false;
    geminiMediaRecorder.stop();
    document.getElementById('geminiRecBtn').classList.remove('rec-btn-active');
    document.getElementById('recStatus').textContent = '✅ Recording saved — tap Analyse!';
    document.getElementById('recStatus').style.color = '#4CAF7D';
    document.getElementById('geminiWave').style.opacity = '0';
  }
}

function analyseWithGemini() {
  if (!geminiAudioBase64) {
    alert('Please record your voice first!');
    return;
  }

  var btn = document.getElementById('analyseGeminiBtn');
  btn.textContent = '⏳ Gemini is analysing...';
  btn.disabled = true;
  document.getElementById('recStatus').textContent = '🤖 Gemini AI is checking your words...';

  fetch('/api/analyse-full-speech-gemini', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      audioBase64: geminiAudioBase64,
      mimeType: 'audio/webm',
      words: memWords
    })
  })
  .then(function(r){ return r.json(); })
  .then(function(data) {
    if (data.results) {
      var found = 0;
      memWords.forEach(function(w, i) {
        if (data.results[w] === true) {
          memFound[i] = true;
          found++;
          var chk = document.getElementById('recall_check_' + i);
          if (chk) {
            chk.style.background = '#4CAF7D';
            chk.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>';
          }
          var row = document.getElementById('recall_row_' + i);
          if (row) row.style.background = '#e8f5ee';
        }
      });

      memScore = Math.round(found / memWords.length * 100);

      var resultEl = document.getElementById('geminiAnalysisResult');
      var textEl   = document.getElementById('geminiResultText');
      resultEl.style.display = 'block';
      textEl.textContent = 'Gemini detected ' + found + ' out of ' + memWords.length + ' words. Score: ' + memScore + '%';

      var msg = found === 5 ? 'Excellent! You remembered all 5 words perfectly!' :
                found >= 3 ? 'Good job! You recalled ' + found + ' out of 5 words.' :
                'You recalled ' + found + ' words. Keep practising!';
      vaSpeak(msg, false);

      btn.textContent = '✅ Analysis Complete';
      document.getElementById('recStatus').textContent = '✅ Done! ' + found + '/' + memWords.length + ' words detected';

      if (found === memWords.length) setTimeout(finishRecall, 1500);
    } else {
      throw new Error(data.error || 'No results');
    }
  })
  .catch(function(err) {
    console.error('Gemini error:', err);
    document.getElementById('recStatus').textContent = '⚠ Gemini unavailable — using browser recognition';
    btn.textContent = 'Retry Gemini Analysis';
    btn.disabled = false;
    // Fall back to browser score
    memScore = memFound.filter(Boolean).length / memWords.length * 100;
  });
}

// ── Browser fallback recognition ────────────────────────────────────────────────
function startMemRecog() {
  var SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRec) return;
  memRecog = new SpeechRec();
  memRecog.continuous     = true;
  memRecog.interimResults = true;
  memRecog.lang           = 'en-US';

  memRecog.onresult = function(e) {
    var allText = '';
    for (var i = 0; i < e.results.length; i++) allText += e.results[i][0].transcript + ' ';
    document.getElementById('recallLive').textContent = allText.trim() || 'Waiting...';
    checkRecalledWords(allText.toLowerCase());
  };

  memRecog.onerror = function(){};
  memRecog.onend = function() {
    if (document.getElementById('s3b').classList.contains('active')) {
      try { memRecog.start(); } catch(e){}
    }
  };

  try { memRecog.start(); } catch(e){}
}

function checkRecalledWords(text) {
  memWords.forEach(function(w, i) {
    if (!memFound[i] && text.indexOf(w.toLowerCase()) !== -1) {
      memFound[i] = true;
      var chk = document.getElementById('recall_check_' + i);
      if (chk) {
        chk.style.background = '#4CAF7D';
        chk.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>';
      }
      var row = document.getElementById('recall_row_' + i);
      if (row) row.style.background = '#e8f5ee';
    }
  });
  memScore = Math.round(memFound.filter(Boolean).length / memWords.length * 100);
  if (memFound.every(Boolean)) setTimeout(finishRecall, 800);
}

function finishRecall() {
  if (memRecog) try { memRecog.stop(); } catch(e){}
  if (memScore === 0) memScore = 60;
  goto('s4');
}

// ── Facial Scan ─────────────────────────────────────────────────────────────────
function startCamera() {
  if (!navigator.mediaDevices) {
    document.getElementById('faceStatusText').textContent = 'Camera not available in this browser.';
    return;
  }
  navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } } })
  .then(function(stream) {
    cameraStream = stream;
    var vid = document.getElementById('camFeed');
    vid.srcObject = stream;
    document.getElementById('faceStatusText').textContent = 'Camera ready — position your face and capture!';
  })
  .catch(function(err) {
    document.getElementById('faceStatusText').textContent = 'Camera error: ' + err.message + '. Allow camera access.';
  });
}

function stopCamera() {
  if (cameraStream) { cameraStream.getTracks().forEach(function(t){ t.stop(); }); cameraStream = null; }
}

function captureFace() {
  var vid    = document.getElementById('camFeed');
  var canvas = document.getElementById('camCanvas');
  canvas.width  = vid.videoWidth  || 640;
  canvas.height = vid.videoHeight || 480;
  canvas.getContext('2d').drawImage(vid, 0, 0, canvas.width, canvas.height);
  var base64 = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];

  document.getElementById('captureBtn').textContent = 'Analysing...';
  document.getElementById('captureBtn').disabled    = true;
  document.getElementById('faceStatusText').textContent = '🤖 AI is analysing your expression...';

  fetch('/api/analyse-face', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: base64 })
  })
  .then(function(r){ return r.json(); })
  .then(function(result){ showFaceResult(result); })
  .catch(function(err) {
    showFaceResult({ emotion: 'neutral', confidence: 72, expressiveness: 65, notes: 'Could not reach analysis server — showing demo result.' });
  });
}

function showFaceResult(r) {
  faceScore = r.expressiveness || 68;
  document.getElementById('faceResultCard').style.display = 'block';
  document.getElementById('faceStatusText').textContent   = '✅ Analysis complete!';
  document.getElementById('captureBtn').textContent       = 'Capture Again';
  document.getElementById('captureBtn').disabled          = false;

  var emojiMap = { happy:'😊', neutral:'😐', sad:'😔', confused:'😕', anxious:'😟', alert:'👀' };
  var colorMap = { happy:'#4CAF7D', neutral:'#1A6B72', sad:'#E07B6A', confused:'#f5a623', anxious:'#E07B6A', alert:'#1A6B72' };
  var emo = (r.emotion || 'neutral').toLowerCase();

  document.getElementById('faceResultGrid').innerHTML =
    '<div style="background:#f0f9f5;border-radius:16px;padding:14px;text-align:center;">' +
      '<div style="font-size:32px;">' + (emojiMap[emo] || '😐') + '</div>' +
      '<p style="font-size:13px;font-weight:700;color:#888;margin:6px 0 2px;">Emotion</p>' +
      '<p style="font-size:16px;font-weight:800;color:' + (colorMap[emo] || '#1A6B72') + ';">' + capitalise(emo) + '</p>' +
    '</div>' +
    '<div style="background:#f0f4ff;border-radius:16px;padding:14px;text-align:center;">' +
      '<div style="font-size:32px;">✨</div>' +
      '<p style="font-size:13px;font-weight:700;color:#888;margin:6px 0 2px;">Expressiveness</p>' +
      '<p style="font-size:16px;font-weight:800;color:#1A6B72;">' + (r.expressiveness || '—') + '%</p>' +
    '</div>';

  document.getElementById('faceNotes').innerHTML = '<strong>Note:</strong> ' + (r.notes || 'Expression looks calm.');
}

// ── Results Screen ───────────────────────────────────────────────────────────────
function showResults() {
  var vs      = voiceScore || 0;
  var ms      = memScore   || 0;
  var fs      = faceScore  || 68;
  var overall = Math.round(vs * 0.35 + ms * 0.40 + fs * 0.25);

  document.getElementById('resultScore').textContent = overall;

  var label = overall >= 75 ? 'LOW RISK' : overall >= 55 ? 'MODERATE' : 'HIGH RISK';
  var col   = overall >= 75 ? '#4CAF7D'  : overall >= 55 ? '#f5a623'  : '#E07B6A';
  document.getElementById('resultLabel').textContent = label;
  document.getElementById('resultLabel').style.color = col;

  document.getElementById('voiceScoreLabel').textContent = vs + '%';
  document.getElementById('memScoreLabel').textContent   = ms + '%';
  document.getElementById('faceScoreLabel').textContent  = fs + '%';
  document.getElementById('voiceScoreBar').style.width   = vs + '%';
  document.getElementById('memScoreBar').style.width     = ms + '%';
  document.getElementById('faceScoreBar').style.width    = fs + '%';
  document.getElementById('voiceScoreBar').style.background = vs >= 70 ? '#4CAF7D' : '#f5a623';
  document.getElementById('memScoreBar').style.background   = ms >= 70 ? '#4CAF7D' : '#f5a623';

  var ringEl = document.getElementById('scoreDialFill');
  if (ringEl) {
    var dashArr = Math.round(overall * 4.08);
    ringEl.setAttribute('stroke-dasharray', dashArr + ' ' + (408 - dashArr));
    ringEl.setAttribute('stroke', col);
  }

  var homeRing = document.getElementById('mainRingFill');
  if (homeRing) homeRing.style.strokeDashoffset = String(440 * (1 - overall / 100));

  var homeScore = document.getElementById('homeScore');
  if (homeScore) homeScore.textContent = overall;
  var homeRisk = document.getElementById('homeRiskLabel');
  if (homeRisk) { homeRisk.textContent = label; homeRisk.style.color = col; }

  var tips = [
    'Try a short walk and describe what you see aloud — great brain exercise!',
    'Read a short story aloud daily to improve speech clarity.',
    'Practice recalling your daily events before bed to boost memory.',
    'Gentle breathing exercises help expressiveness and reduce anxiety.'
  ];
  var tipIdx = ms < 70 ? 2 : vs < 70 ? 1 : fs < 70 ? 3 : 0;
  document.getElementById('resultTip').textContent = tips[tipIdx];

  // Save session
  saveSession({ voiceScore: vs, memScore: ms, faceScore: fs, overall: overall });

  // Check for emergency
  if (overall < 45 && alertOn) {
    triggerAutoEmergency(overall);
  }

  // Voice assistant result
  var resultMsg = 'Your overall cognitive score today is ' + overall + ' — ' + label.toLowerCase().replace('_', ' ') + '. ' + tips[tipIdx];
  setTimeout(function(){ vaSpeak(resultMsg, false); }, 500);
}

function saveSession(data) {
  fetch('/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  })
  .then(function(r){ return r.json(); })
  .then(function(resp) {
    if (resp.smsSent) {
      var banner = document.getElementById('smsStatusBanner');
      if (banner) banner.style.display = 'flex';
    }
    if (resp.emergencyTriggered) showEmergencyAlert(resp);
  })
  .catch(function(){});
}

function loadLastSession() {
  fetch('/api/sessions').then(function(r){ return r.json(); }).then(function(sessions) {
    var el = document.getElementById('lastSessionText');
    if (!sessions || !sessions.length) {
      if (el) el.textContent = 'No sessions yet — start a test!';
      return;
    }
    var s = sessions[0];
    var timeAgo = getTimeAgo(new Date(s.timestamp));
    var risk = s.overall >= 75 ? 'Low Risk' : s.overall >= 55 ? 'Moderate' : 'High Risk';
    if (el) el.textContent = timeAgo + ' · ' + risk + ' · Score: ' + s.overall;

    // Update home ring
    var homeRing = document.getElementById('mainRingFill');
    if (homeRing) homeRing.style.strokeDashoffset = String(440 * (1 - s.overall / 100));
    var homeScore = document.getElementById('homeScore');
    if (homeScore) homeScore.textContent = s.overall;
  }).catch(function(){});
}

function getTimeAgo(date) {
  var diff = Date.now() - date.getTime();
  var mins  = Math.floor(diff / 60000);
  var hours = Math.floor(mins / 60);
  var days  = Math.floor(hours / 24);
  if (days > 0)  return days + ' day' + (days > 1 ? 's' : '') + ' ago';
  if (hours > 0) return hours + ' hr ago';
  if (mins > 0)  return mins + ' min ago';
  return 'Just now';
}

// ── Emergency Contacts ───────────────────────────────────────────────────────────
var contacts = [];

function loadContacts() {
  fetch('/api/contacts').then(function(r){ return r.json(); }).then(function(data) {
    contacts = data || [];
    renderContacts();
  }).catch(function(){
    contacts = JSON.parse(localStorage.getItem('contacts') || '[]');
    renderContacts();
  });
}

function renderContacts() {
  var list = document.getElementById('contactsList');
  var msg  = document.getElementById('noContactsMsg');
  if (!list) return;
  list.innerHTML = '';

  if (!contacts.length) {
    if (msg) msg.style.display = 'block';
    return;
  }
  if (msg) msg.style.display = 'none';

  contacts.forEach(function(c) {
    var card = document.createElement('div');
    card.className = 'emergency-card';
    card.style.margin = '0 20px 12px';

    var avatarHtml;
    if (c.photoUrl) {
      avatarHtml = '<img src="' + c.photoUrl + '" class="contact-avatar" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\';">' +
        '<div class="contact-avatar-placeholder" style="display:none;background:' + getAvatarColor(c.name) + ';">' + getInitials(c.name) + '</div>';
    } else {
      avatarHtml = '<div class="contact-avatar-placeholder" style="background:' + getAvatarColor(c.name) + ';">' + getInitials(c.name) + '</div>';
    }

    card.innerHTML =
      '<div style="display:flex;align-items:center;gap:14px;">' +
        '<div style="position:relative;flex-shrink:0;">' +
          avatarHtml +
          (c.isPrimary ? '<div style="position:absolute;bottom:0;right:0;width:18px;height:18px;border-radius:50%;background:#E07B6A;border:2px solid #fff;display:flex;align-items:center;justify-content:center;font-size:8px;color:#fff;font-weight:800;">★</div>' : '') +
        '</div>' +
        '<div style="flex:1;">' +
          '<div style="display:flex;align-items:center;gap:8px;">' +
            '<p style="font-size:18px;font-weight:800;color:#2C2C2C;margin:0;">' + c.name + '</p>' +
            (c.isPrimary ? '<span style="background:#fff0f0;color:#E07B6A;font-size:10px;font-weight:800;padding:3px 8px;border-radius:10px;border:1px solid #fde8e5;">PRIMARY</span>' : '') +
          '</div>' +
          '<p style="font-size:14px;color:#888;font-weight:600;margin:3px 0 0;">' + c.relation + ' · ' + c.phone + '</p>' +
        '</div>' +
        '<div style="display:flex;gap:8px;">' +
          '<button onclick="callContact(\'' + c.phone + '\', ' + c.id + ')" style="width:48px;height:48px;border-radius:50%;background:#4CAF7D;border:none;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 2px 8px rgba(76,175,125,0.35);">' +
            '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 014.82 12 19.79 19.79 0 011.77 3.4 2 2 0 013.74 1h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L7.91 8.9a16 16 0 006.29 6.29l1.06-1.06a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z"/></svg>' +
          '</button>' +
          '<button onclick="deleteContact(' + c.id + ')" style="width:48px;height:48px;border-radius:50%;background:#f8f9fa;border:none;display:flex;align-items:center;justify-content:center;cursor:pointer;">' +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#E07B6A" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>' +
          '</button>' +
        '</div>' +
      '</div>';

    list.appendChild(card);
  });
}

function getInitials(name) {
  return name.split(' ').map(function(w){ return w[0]; }).slice(0,2).join('').toUpperCase();
}

function getAvatarColor(name) {
  var colors = ['#1A6B72','#4CAF7D','#E07B6A','#f5a623','#7B5EA7','#2196F3'];
  var idx = name.charCodeAt(0) % colors.length;
  return colors[idx];
}

function saveContact() {
  var name     = document.getElementById('contactName').value.trim();
  var phone    = document.getElementById('contactPhone').value.trim();
  var relation = document.getElementById('contactRelation').value;
  var isPrimary = document.getElementById('contactPrimary').checked;
  var photoUrl = document.getElementById('contactPhoto').value.trim();

  if (!name || !phone) { alert('Please fill in name and phone number!'); return; }

  fetch('/api/contacts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, phone, relation, isPrimary, photoUrl })
  })
  .then(function(r){ return r.json(); })
  .then(function(data) {
    // Clear form
    document.getElementById('contactName').value  = '';
    document.getElementById('contactPhone').value = '';
    document.getElementById('contactPhoto').value = '';
    document.getElementById('contactPrimary').checked = false;
    document.getElementById('photoPreview').innerHTML = '👤';
    switchTab('contacts');
    loadContacts();
    vaSpeak(name + ' has been added as an emergency contact!', false);
  })
  .catch(function(err) {
    // Offline fallback: store in memory
    var c = { id: Date.now(), name, phone, relation, isPrimary: isPrimary, photoUrl, addedAt: new Date().toISOString() };
    if (isPrimary) contacts.forEach(function(x){ x.isPrimary = false; });
    contacts.push(c);
    renderContacts();
    switchTab('contacts');
  });
}

function deleteContact(id) {
  if (!confirm('Remove this contact?')) return;
  fetch('/api/contacts/' + id, { method: 'DELETE' })
  .then(function(){ loadContacts(); })
  .catch(function(){
    contacts = contacts.filter(function(c){ return c.id !== id; });
    renderContacts();
  });
}

function callContact(phone, id) {
  // Log the call
  fetch('/api/emergency-call', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contactId: id, reason: 'Manual call', score: null })
  }).catch(function(){});

  // Actually initiate call via tel: link
  window.location.href = 'tel:' + phone;
}

// ── Emergency SOS ────────────────────────────────────────────────────────────────
function triggerEmergency() {
  var primary = contacts.find(function(c){ return c.isPrimary; }) || contacts[0];
  if (!primary) {
    vaSpeak('No emergency contact set up. Please add a contact in the Contacts screen first.', true);
    goto('s5');
    return;
  }

  // Flash effect
  document.body.style.background = '#ffeeee';
  setTimeout(function(){ document.body.style.background = '#e8ecef'; }, 500);

  vaSpeak('Calling ' + primary.name + ' now. Please stay calm.', false);

  fetch('/api/emergency-call', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contactId: primary.id, reason: 'SOS button pressed', score: null })
  }).catch(function(){});

  setTimeout(function(){ window.location.href = 'tel:' + primary.phone; }, 800);
}

function triggerAutoEmergency(score) {
  var primary = contacts.find(function(c){ return c.isPrimary; }) || contacts[0];
  if (!primary) return;

  var alertEl = document.getElementById('emergencyResultAlert');
  var msgEl   = document.getElementById('emergencyResultMsg');
  if (alertEl) { alertEl.style.display = 'flex'; alertEl.classList.add('shake'); }
  if (msgEl) msgEl.textContent = 'Score ' + score + ' — ' + primary.name + ' (' + primary.phone + ') has been alerted.';

  vaSpeak('Your score is very low. I am alerting ' + primary.name + ' now. Please stay calm.', false);

  fetch('/api/emergency-call', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contactId: primary.id, reason: 'Auto-alert: Low score', score: score })
  }).catch(function(){});

  // Auto-call after 3 seconds
  setTimeout(function(){
    window.location.href = 'tel:' + primary.phone;
  }, 3000);
}

function showEmergencyAlert(resp) {
  var alertEl = document.getElementById('emergencyResultAlert');
  if (alertEl) alertEl.style.display = 'flex';
}

// ── Emergency History ────────────────────────────────────────────────────────────
function loadHistory() {
  fetch('/api/emergency-events').then(function(r){ return r.json(); }).then(function(events) {
    renderHistory(events);
  }).catch(function(){ renderHistory([]); });
  
  loadSmsLogs();
}

function loadSmsLogs() {
  fetch('/api/sms-logs').then(function(r){ return r.json(); }).then(function(logs) {
    renderSmsLogs(logs);
  }).catch(function(){ renderSmsLogs([]); });
}

function renderSmsLogs(logs) {
  var list = document.getElementById('smsLogList');
  if (!list) return;
  list.innerHTML = '';

  if (!logs || !logs.length) {
    list.innerHTML = '<div style="text-align:center;padding:32px 20px;color:#888;"><p style="font-size:14px;font-weight:600;">No SMS alerts sent yet.</p></div>';
    return;
  }

  logs.slice(0, 15).forEach(function(log) {
    var d = new Date(log.timestamp);
    var timeStr = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    var card = document.createElement('div');
    card.style.cssText = 'margin:0 20px 10px;padding:14px 18px;background:#fff;border-radius:20px;box-shadow:0 2px 8px rgba(0,0,0,.06);border-left:4px solid #4CAF7D;';
    card.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;">' +
        '<div style="flex:1;">' +
          '<p style="font-size:15px;font-weight:800;color:#2C2C2C;margin:0;">📱 SMS Alert Sent</p>' +
          '<p style="font-size:13px;color:#888;font-weight:600;margin:4px 0 0;">To: ' + log.to + ' · ' + log.phone + '</p>' +
          '<p style="font-size:12px;color:#444;font-weight:600;margin:8px 0 0;font-style:italic;">"' + log.message + '"</p>' +
        '</div>' +
        '<span style="font-size:11px;color:#888;font-weight:600;white-space:nowrap;margin-left:8px;">' + timeStr + '</span>' +
      '</div>';
    list.appendChild(card);
  });
}

function toggleHistorySubTab(type) {
  var isSms = (type === 'sms');
  document.getElementById('historyList').style.display = isSms ? 'none' : 'flex';
  document.getElementById('smsLogList').style.display = isSms ? 'flex' : 'none';
  
  var btnEvents = document.getElementById('btnHistEvents');
  var btnSms = document.getElementById('btnHistSms');
  
  if (isSms) {
    btnEvents.style.background = 'transparent'; btnEvents.style.color = '#888'; btnEvents.style.boxShadow = 'none';
    btnSms.style.background = '#fff'; btnSms.style.color = '#2C2C2C'; btnSms.style.boxShadow = '0 2px 4px rgba(0,0,0,0.05)';
  } else {
    btnSms.style.background = 'transparent'; btnSms.style.color = '#888'; btnSms.style.boxShadow = 'none';
    btnEvents.style.background = '#fff'; btnEvents.style.color = '#2C2C2C'; btnEvents.style.boxShadow = '0 2px 4px rgba(0,0,0,0.05)';
  }
}

function renderHistory(events) {
  var list = document.getElementById('historyList');
  var msg  = document.getElementById('noHistoryMsg');
  if (!list) return;
  list.innerHTML = '';

  if (!events || !events.length) {
    if (msg) msg.style.display = 'block';
    return;
  }
  if (msg) msg.style.display = 'none';

  events.slice(0, 10).forEach(function(ev) {
    var d = new Date(ev.timestamp);
    var timeStr = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    var card = document.createElement('div');
    card.style.cssText = 'margin:0 20px 10px;padding:14px 18px;background:#fff;border-radius:20px;box-shadow:0 2px 8px rgba(0,0,0,.06);border-left:4px solid #E07B6A;';
    card.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;">' +
        '<div>' +
          '<p style="font-size:15px;font-weight:800;color:#2C2C2C;margin:0;">🚨 ' + ev.reason + '</p>' +
          '<p style="font-size:13px;color:#888;font-weight:600;margin:4px 0 0;">Notified: ' + ev.contactNotified + ' · ' + ev.phone + '</p>' +
          (ev.score ? '<p style="font-size:13px;color:#E07B6A;font-weight:700;margin:4px 0 0;">Score: ' + ev.score + '</p>' : '') +
        '</div>' +
        '<span style="font-size:11px;color:#888;font-weight:600;white-space:nowrap;margin-left:8px;">' + timeStr + '</span>' +
      '</div>';
    list.appendChild(card);
  });
}

// ── Tab Switcher ─────────────────────────────────────────────────────────────────
function switchTab(tab) {
  ['contacts','add','history','settings'].forEach(function(t) {
    var btn   = document.getElementById('tab' + capitalise(t));
    var panel = document.getElementById('tabPanel' + capitalise(t));
    if (btn) btn.classList.toggle('active', t === tab);
    if (panel) panel.style.display = (t === tab) ? 'block' : 'none';
  });
  if (tab === 'history') loadHistory();
  if (tab === 'contacts') loadContacts();
  if (tab === 'settings') {
    // Refresh preview and inputs
    var nameInp = document.getElementById('profileNameInput');
    var urlInp = document.getElementById('profileImageUrlInput');
    if (nameInp) nameInp.value = userName;
    if (urlInp) urlInp.value = profileImage || '';
    updateProfilePreview();
  }
}

// ── Photo preview ────────────────────────────────────────────────────────────────
var contactPhotoInput = document.getElementById('contactPhoto');
if (contactPhotoInput) {
  contactPhotoInput.addEventListener('input', function() {
    var url = this.value.trim();
    var preview = document.getElementById('photoPreview');
    if (!preview) return;
    if (url) {
      preview.innerHTML = '<img src="' + url + '" style="width:100%;height:100%;object-fit:cover;" onerror="this.parentElement.innerHTML=\'👤\'">';
    } else {
      preview.innerHTML = '👤';
    }
  });
}

// ── Toggle ───────────────────────────────────────────────────────────────────────
function toggleAlert() {
  toggleNotificationsUI();
}

// ── Helpers ───────────────────────────────────────────────────────────────────────
function capitalise(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// Initialize settings on load
window.addEventListener('DOMContentLoaded', function() {
  initSettings();
  
  // Listen for image URL changes
  var urlInp = document.getElementById('profileImageUrlInput');
  if (urlInp) urlInp.addEventListener('input', updateProfilePreview);
});
