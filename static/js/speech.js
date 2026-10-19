// Speak mode: recording and speech-to-text (Whisper on the server, or the browser's own)
/* ---------- Nói: ghi âm rồi gửi lên server (Whisper) để chuyển thành chữ ---------- */
// Nói thử bao nhiêu lần cũng được; Whisper nghe nhầm thì bấm "Mark correct" để tính là đúng và qua câu
const MAX_RECORD_MS = 15000;
let recorder = null, recStream = null, recTimer = null, recState = "idle"; // idle | recording | working
let recStarting = false;
// Server không cài faster-whisper (vd. Vercel) thì dùng nhận dạng giọng nói có sẵn của trình duyệt (Chrome, Edge, Safari)
const WHISPER_AVAILABLE = window.APP_CONFIG.whisperAvailable;
const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
let speechRec = null;

function setSpeakMsg(text, isError = false) {
  $("speak-msg").textContent = text;
  $("speak-msg").classList.toggle("error", isError);
}
function setRecordButton() {
  const b = $("learn-record");
  b.classList.toggle("rec", recState === "recording");
  b.disabled = recState === "working";
  b.innerHTML = recState === "recording" ? `<span class="rec-dot" aria-hidden="true"></span>Stop (Enter)`
    : recState === "working" ? "Listening…"
    : "🎤 Record (Enter)";
}

function startBrowserRecognition() {
  const it = queue[qIndex];
  if (synth) synth.cancel();
  const sr = new SpeechRec();
  sr.lang = "en-US";
  sr.interimResults = false;
  sr.maxAlternatives = 5;
  let alternatives = [], error = "";
  sr.onresult = (e) => { alternatives = Array.from(e.results[0], a => a.transcript.trim()); };
  sr.onerror = (e) => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed") error = "Microphone access was blocked. Allow the microphone for this page and try again.";
    else if (e.error === "network") error = "Speech recognition needs an internet connection. Try again.";
    else if (e.error !== "no-speech" && e.error !== "aborted") error = `Speech recognition failed: ${e.error}`;
  };
  sr.onend = () => {
    clearTimeout(recTimer);
    if (speechRec === sr) speechRec = null;
    if (sr.discard) return;
    recState = "idle";
    setRecordButton();
    if (answered || queue[qIndex] !== it || $("view-learn").hidden) return;
    if (error) { setSpeakMsg(error, true); return; }
    // Trình duyệt trả về vài cách nghe; cách nào khớp câu thì lấy cách đó
    showTranscript(alternatives.find(a => isCorrect(a, it.term)) ?? alternatives[0] ?? "", it);
  };
  speechRec = sr;
  try {
    sr.start();
  } catch {
    speechRec = null;
    setSpeakMsg("Speech recognition can't start. Try again.", true);
    return;
  }
  recState = "recording";
  setRecordButton();
  setSpeakMsg("Listening… say the sentence.");
  recTimer = setTimeout(() => stopRecording(), MAX_RECORD_MS);
}

async function startRecording() {
  if (!WHISPER_AVAILABLE) {
    if (SpeechRec) startBrowserRecognition();
    else setSpeakMsg("This browser has no speech recognition. Open the app in Chrome, Edge or Safari.", true);
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    setSpeakMsg("This browser can't record. Open the app at http://localhost:5000 (microphones need localhost or https).", true);
    return;
  }
  const it = queue[qIndex];
  recStarting = true;
  try {
    recStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    setSpeakMsg("Microphone access was blocked. Allow the microphone for this page and try again.", true);
    return;
  } finally {
    recStarting = false;
  }
  // Trong lúc chờ cho phép micro mà đã chuyển câu / thoát thì thôi
  if (answered || queue[qIndex] !== it || $("view-learn").hidden) { releaseMic(); return; }
  if (synth) synth.cancel();
  const chunks = [];
  const rec = new MediaRecorder(recStream);
  recorder = rec;
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  rec.onstop = () => {
    releaseMic();
    if (rec.discard) return;
    transcribe(new Blob(chunks, { type: rec.mimeType || "audio/webm" }));
  };
  rec.start();
  recState = "recording";
  setRecordButton();
  setSpeakMsg("Recording… say the sentence, then press Enter.");
  recTimer = setTimeout(() => stopRecording(), MAX_RECORD_MS);
}

function releaseMic() {
  clearTimeout(recTimer);
  recStream?.getTracks().forEach(t => t.stop());
  recStream = null;
}

// discard = true: dừng mà không gửi đi (chuyển câu, thoát chế độ học)
function stopRecording(discard = false) {
  const sr = speechRec;
  if (sr) {
    speechRec = null;
    sr.discard = discard;
    if (discard) { sr.abort(); recState = "idle"; }
    else { sr.stop(); recState = "working"; } // kết quả về trong onend
    setRecordButton();
    return;
  }
  const rec = recorder;
  recorder = null;
  if (rec && rec.state !== "inactive") { rec.discard = discard; rec.stop(); }
  else releaseMic();
  if (discard) { recState = "idle"; setRecordButton(); }
}

function toggleRecording() {
  if (answered || recStarting || recState === "working") return;
  if (recState === "recording") stopRecording();
  else startRecording();
}
$("learn-record").addEventListener("click", () => { toggleRecording(); $("learn-input").focus(); });

async function transcribe(blob) {
  const it = queue[qIndex];
  recState = "working";
  setRecordButton();
  setSpeakMsg("Checking what you said…");
  let text = null, error = "";
  try {
    const fd = new FormData();
    fd.append("audio", blob, "speech.webm");
    const res = await fetch("/transcribe", { method: "POST", body: fd });
    const data = await res.json().catch(() => ({}));
    if (res.ok) text = data.text || "";
    else error = data.error || "Speech recognition failed.";
  } catch {
    error = "Could not reach the server. Try again.";
  }
  recState = "idle";
  setRecordButton();
  // Đã chuyển sang câu khác / thoát trong lúc chờ thì bỏ qua kết quả
  if (answered || queue[qIndex] !== it || $("view-learn").hidden) return;
  if (text === null) { setSpeakMsg(error, true); return; }
  showTranscript(text, it);
}

function showTranscript(text, it) {
  if (!text) { setSpeakMsg("I didn't hear anything. Try again a little louder.", true); return; }

  $("learn-input").value = text;
  if (isCorrect(text, it.term)) { setSpeakMsg(""); reveal(true); return; }
  setSpeakMsg("Not quite. Check “What you said” and try again, or tap “Mark correct” if you said it right.", true);
}
