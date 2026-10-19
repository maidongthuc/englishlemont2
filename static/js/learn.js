// Learn, Listen & type, Speak: questions, answer checking, hints, results
/* ---------- Học ---------- */
// Nhạc khi trả lời đúng: 3 nốt đi lên (Đô - Mi - Sol), tạo bằng Web Audio, không cần file mp3
let audioCtx = null, sayTimer = null;
function playCorrect() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
    const t0 = audioCtx.currentTime;
    [523.25, 659.25, 783.99].forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "triangle";
      osc.frequency.value = freq;
      const t = t0 + i * 0.11;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + (i === 2 ? 0.5 : 0.18));
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t);
      osc.stop(t + 0.55);
    });
  } catch {}
}

let learnMode = "meaning"; // "meaning": xem nghĩa rồi gõ câu; "listen": nghe rồi gõ câu; "speak": đọc to câu tiếng Anh
let queue = [], qIndex = 0, total = 0, done = 0, score = 0, mistakes = [], answered = false;

// So sánh không phân biệt hoa thường, dấu câu và khoảng trắng thừa
// Ký tự đặc biệt (dấu câu, ', -, ...) không bắt lỗi: bỏ đi rồi mới so sánh.
// sep = "" : "don't" -> "dont";  sep = " " : "well-known" -> "well known"
const normalize = (s, sep = "") => String(s).toLowerCase()
  .replace(/[^\p{L}\p{N}\s]/gu, sep)
  .replace(/\s+/g, " ").trim();
// Số viết bằng chữ số hay bằng chữ đều đúng: nhận dạng giọng nói nghe "one minute" sẽ viết "1 minute"
const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven",
  "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const ORDINALS = { one: "first", two: "second", three: "third", five: "fifth", eight: "eighth", nine: "ninth", twelve: "twelfth" };
function numberWords(n) {
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? " " + ONES[n % 10] : "");
  if (n < 1000) return ONES[Math.floor(n / 100)] + " hundred" + (n % 100 ? " " + numberWords(n % 100) : "");
  for (const [size, name] of [[1e9, "billion"], [1e6, "million"], [1e3, "thousand"]]) {
    if (n >= size) return numberWords(Math.floor(n / size)) + " " + name + (n % size ? " " + numberWords(n % size) : "");
  }
}
// "21st" -> "twenty first", "1,000" (đã bỏ dấu phẩy) -> "one thousand"; "one hundred and five" = "one hundred five"
const spellNumbers = (s) => s
  .replace(/\b(\d{1,12})(st|nd|rd|th)?\b/g, (m, digits, suffix) => {
    const words = numberWords(Number(digits));
    if (!suffix) return words;
    return words.replace(/\w+$/, (w) => ORDINALS[w] || (w.endsWith("y") ? w.slice(0, -1) + "ieth" : w + "th"));
  })
  .replace(/\b(hundred|thousand|million|billion) and\b/g, "$1");
// Khoảng trắng cũng không bắt lỗi: "school work" = "schoolwork"
const squash = (s) => spellNumbers(normalize(s)).replace(/ /g, "");
const isCorrect = (ans, term) => squash(ans) === squash(term);

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Thứ tự học: ngẫu nhiên hoặc theo thứ tự thêm vào, nhớ lựa chọn trên trình duyệt này
let learnOrder = "random";
try { if (localStorage.getItem("learnOrder") === "added") learnOrder = "added"; } catch {}
$("learn-random").checked = learnOrder === "random";
// Thứ tự thêm vào = vị trí trong items (giữ đúng thứ tự dòng của file CSV)
const arrange = (list) => learnOrder === "added"
  ? [...list].sort((a, b) => items.indexOf(a) - items.indexOf(b))
  : shuffle(list);
$("learn-random").addEventListener("change", (e) => {
  learnOrder = e.target.checked ? "random" : "added";
  try { localStorage.setItem("learnOrder", learnOrder); } catch {}
});

function startLearn(list, mode = learnMode) {
  const b = books.find(x => x.id === currentBook); if (!b) return;
  if (!list.length) { alert("This notebook has no sentences to learn yet."); return; }
  learnMode = mode;
  const listen = mode === "listen", speaking = mode === "speak";
  $("learn-intro").textContent = listen ? "Listen to the sentence, then type what you hear."
    : speaking ? "Read the English sentence out loud."
    : "Read the meaning, then type the English sentence.";
  $("learn-input").readOnly = speaking;
  $("learn-input-label").textContent = speaking ? "What you said" : "Your answer (English)";
  $("learn-check").hidden = speaking;
  $("learn-record").hidden = !speaking;
  $("speak-box").hidden = !speaking;
  $("learn-label").textContent = listen ? "Listen" : speaking ? "Say this sentence" : "Meaning";
  $("learn-skip").textContent = speaking ? "Skip" : "Show answer";
  applyHint();
  $("learn-prompt").hidden = listen;
  $("learn-audio").hidden = !listen;
  queue = arrange(list); qIndex = 0; total = list.length; done = 0; score = 0; mistakes = [];
  $("learn-title").innerHTML = `<span class="hl" style="background:linear-gradient(transparent 55%, ${esc(b.color)} 55%)">${MODE_NAMES[mode]}: ${esc(b.name)}</span>`;
  $("view-book").hidden = true; $("view-learn").hidden = false;
  $("learn-card").hidden = false; $("learn-done").hidden = true;
  showQuestion();
  window.scrollTo(0, 0);
}

// Gợi ý: mỗi chữ cái là *, gõ đúng từ đầu từ đến đâu thì hiện chữ đến đó
const isLetter = (ch) => /[\p{L}\p{N}]/u.test(ch);
const sameChar = (a, b) => a != null && a.toLowerCase() === b.toLowerCase();

// Ẩn/hiện gợi ý, nhớ lựa chọn trên trình duyệt này
let hintOn = true;
try { hintOn = localStorage.getItem("hintOn") !== "0"; } catch {}
// Chế độ Speak đã hiện sẵn câu tiếng Anh nên không cần gợi ý
function applyHint() {
  const noHint = learnMode === "speak";
  $("learn-hint-head").hidden = noHint;
  $("learn-mask").hidden = noHint || !hintOn;
  $("learn-hint-text").hidden = !hintOn;
  $("learn-mask-count").hidden = !hintOn;
  $("learn-hint-letter").hidden = !hintOn;
  $("learn-hint-toggle").textContent = hintOn ? "Hide hint" : "Show hint";
  $("learn-hint-toggle").setAttribute("aria-expanded", hintOn);
}
$("learn-hint-toggle").addEventListener("click", () => {
  hintOn = !hintOn;
  try { localStorage.setItem("hintOn", hintOn ? "1" : "0"); } catch {}
  applyHint();
  $("learn-input").focus();
});
applyHint();

// Các chữ được mở bằng nút "Hint a letter" của câu đang làm, dạng "từ:chữ"
let hinted = new Set();

// Trả về từng từ, mỗi chữ cái có: ch, key, shown (đã gõ đúng hoặc đã được gợi ý)
function maskCells(showAll = false) {
  const words = queue[qIndex].term.trim().split(/\s+/);
  const typed = $("learn-input").value.trim().split(/\s+/).map(w => Array.from(w).filter(isLetter));
  return words.map((w, wi) => {
    let li = 0, ok = true; // gặp chữ sai thì các chữ sau trong từ đó không hiện nữa
    return Array.from(w).map(ch => {
      if (!isLetter(ch)) return { ch, letter: false };
      ok = ok && sameChar(typed[wi]?.[li], ch);
      const key = `${wi}:${li++}`;
      return { ch, letter: true, key, typed: ok, shown: showAll || ok || hinted.has(key) };
    });
  });
}

function renderMask(showAll = false) {
  const cells = maskCells(showAll);
  $("learn-mask-count").textContent = `${cells.length} ${cells.length === 1 ? "word" : "words"}`;
  $("learn-mask").innerHTML = cells.map(w => `<span class="w">${w.map(c =>
    !c.letter ? `<span class="sp">${esc(c.ch)}</span>`
    : !c.shown ? "*"
    : `<span class="${c.typed || showAll ? "hit" : "hinted"}">${esc(c.ch)}</span>`
  ).join("")}</span>`).join("");
}

// Mở chữ cái tiếp theo chưa hiện (tính từ đầu câu)
$("learn-hint-letter").addEventListener("click", () => {
  if (!answered) {
    const next = maskCells().flat().find(c => c.letter && !c.shown);
    if (next) { hinted.add(next.key); renderMask(); }
  }
  $("learn-input").focus();
});
$("learn-input").addEventListener("input", () => { if (!answered) renderMask(); });


function updateStatus() {
  $("learn-progress").textContent = `Learned ${done} / ${total}`;
  $("learn-score").textContent = `First try: ${score}`;
}

function showQuestion() {
  clearTimeout(sayTimer);
  const it = queue[qIndex];
  answered = false;
  hinted = new Set();
  updateStatus();
  $("learn-again-tag").hidden = !mistakes.includes(it);
  $("learn-prompt").textContent = learnMode === "speak" ? it.term : it.meaning;
  $("learn-input").value = ""; $("learn-input").disabled = false;
  $("learn-check").hidden = learnMode === "speak"; $("learn-skip").hidden = false; $("learn-next").hidden = true;
  $("learn-record").hidden = learnMode !== "speak";
  $("learn-mark-ok").hidden = learnMode !== "speak";
  $("learn-feedback").hidden = true;
  stopRecording(true);
  setSpeakMsg(learnMode === "speak" ? "Press Enter or tap “Record” and say the sentence." : "");
  setRecordButton();
  renderMask();
  $("learn-input").focus();
  if (learnMode === "listen") speak(it.term);
}

function reveal(correct) {
  const it = queue[qIndex];
  answered = true;
  // Lần trả lời đầu tiên của câu trong lượt này quyết định trạng thái lưu lại
  if (!mistakes.includes(it)) {
    it.progress = { ...it.progress, [learnMode]: correct ? "done" : "wrong" };
    persist().catch(() => {});
  }
  if (correct) {
    playCorrect();
    // Nhạc xong thì đọc câu
    sayTimer = setTimeout(() => { if (!$("view-learn").hidden) speak(it.term); }, 650);
    done++;
    if (!mistakes.includes(it)) score++;
  } else {
    if (!mistakes.includes(it)) mistakes.push(it);
    // Sai thì câu này quay lại sau ở vị trí ngẫu nhiên (không ngay câu kế tiếp), đến khi làm đúng
    const rest = queue.length - (qIndex + 1);
    const min = rest > 0 ? qIndex + 2 : qIndex + 1;
    queue.splice(min + Math.floor(Math.random() * (queue.length - min + 1)), 0, it);
  }
  updateStatus();
  renderMask(true);
  const fb = $("learn-feedback");
  fb.className = "feedback " + (correct ? "ok" : "bad");
  fb.innerHTML = correct
    ? `<div>✓ Correct!</div><div class="answer">${esc(it.term)}</div>`
    : `<div>✗ The answer is:</div><div class="answer">${esc(it.term)}</div><div class="hint">This sentence will come back later until you get it right.</div>`;
  if (learnMode === "listen") fb.insertAdjacentHTML("beforeend", `<div class="hint">${esc(it.meaning)}</div>`);
  if (learnMode === "speak" && !correct && $("learn-input").value) fb.insertAdjacentHTML("beforeend", `<div class="hint">You said: ${esc($("learn-input").value)}</div>`);
  fb.insertAdjacentHTML("beforeend", `<div class="row"><button type="button" class="icon-btn" id="learn-listen">Listen</button></div>`);
  $("learn-listen").addEventListener("click", () => speak(it.term));
  fb.hidden = false;
  $("learn-input").disabled = true;
  $("learn-check").hidden = true; $("learn-skip").hidden = true; $("learn-next").hidden = false;
  $("learn-record").hidden = true; $("learn-mark-ok").hidden = true;
  stopRecording(true);
  setSpeakMsg("");
  $("learn-next").textContent = qIndex + 1 < queue.length ? "Next ›" : "See result";
  $("learn-next").focus();
}

$("learn-form").addEventListener("submit", (e) => {
  e.preventDefault();
  if (answered) { nextQuestion(); return; }
  if (learnMode === "speak") { toggleRecording(); return; }
  const ans = $("learn-input").value;
  if (!ans.trim()) { $("learn-input").focus(); return; }
  reveal(isCorrect(ans, queue[qIndex].term));
});
$("learn-skip").addEventListener("click", () => { if (!answered) reveal(false); });
$("learn-mark-ok").addEventListener("click", () => { if (!answered) reveal(true); });

function nextQuestion() {
  qIndex++;
  if (qIndex < queue.length) { showQuestion(); return; }
  $("learn-card").hidden = true; $("learn-done").hidden = false;
  $("learn-result").textContent = mistakes.length
    ? `Done! You learned all ${total} sentences. ${score} of ${total} were right on the first try.`
    : `Perfect! All ${total} sentences were right on the first try.`;
  $("learn-retry").hidden = !mistakes.length;
}
$("learn-next").addEventListener("click", nextQuestion);

// Chỉ làm các câu chưa làm hoặc làm sai; xong hết thì hỏi có muốn làm lại tất cả không
async function startPending(mode) {
  const mine = items.filter(it => it.notebookId === currentBook);
  const pending = mine.filter(it => isPending(it, mode));
  if (mine.length && !pending.length) {
    const ok = await showModal({
      title: "All done!",
      html: `You have finished all ${mine.length} sentences in ${MODE_NAMES[mode]}. Practice them all again?`,
      okText: "Practice all",
      danger: false,
    });
    if (ok) startLearn(mine, mode);
    return;
  }
  startLearn(pending, mode);
}
$("learn-book").addEventListener("click", () => startPending("meaning"));
$("listen-book").addEventListener("click", () => startPending("listen"));
$("speak-book").addEventListener("click", () => startPending("speak"));
$("learn-play").addEventListener("click", () => { speak(queue[qIndex].term); $("learn-input").focus(); });
$("learn-play-slow").addEventListener("click", () => { speak(queue[qIndex].term, 0.6); $("learn-input").focus(); });
// Nhấn Tab để nghe lại câu (chế độ Listen, hoặc sau khi đã hiện đáp án); Shift+Tab vẫn chuyển ô như thường
document.addEventListener("keydown", (e) => {
  if (e.key !== "Tab" || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
  if ($("view-learn").hidden || $("learn-card").hidden) return;
  if (learnMode !== "listen" && !answered) return;
  e.preventDefault();
  clearTimeout(sayTimer);
  speak(queue[qIndex].term);
});
$("learn-again").addEventListener("click", () => startLearn(items.filter(it => it.notebookId === currentBook)));
$("learn-retry").addEventListener("click", () => startLearn(mistakes));
$("learn-back").addEventListener("click", () => {
  if (synth) synth.cancel();
  stopRecording(true);
  $("view-learn").hidden = true; $("view-book").hidden = false;
  renderBook();
  window.scrollTo(0, 0);
});
