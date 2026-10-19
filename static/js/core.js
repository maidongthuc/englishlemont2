// Shared state and helpers used by every other script (they are loaded in order, see index.html)
const COLORS = ["#ffd84d", "#9cc9f5", "#f5b0b0", "#a8dcc1", "#c9b6f2", "#ffb877"];

let items = [];   // {id, term, meaning, notebookId, createdAt, progress?: {meaning?, listen?: "done"|"wrong"}}
let books = [];   // {id, kind:"notebook", name, color, createdAt, library?: true}
let isAdmin = false;
let currentBook = null, editingId = null, openId = null;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
// Sổ trong Library chỉ admin sửa được; ai đăng nhập cũng học được
const canEdit = (b) => !!b && (!b.library || isAdmin);

/* ---------- Đọc ---------- */
const synth = window.speechSynthesis;
function speak(text, rate = 0.9) {
  if (!synth || !text) return;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const vs = synth.getVoices();
  const v = vs.find(v => v.lang === "en-GB") || vs.find(v => /^en/i.test(v.lang));
  if (v) u.voice = v;
  u.lang = v ? v.lang : "en-GB";
  u.rate = rate;
  synth.speak(u);
}
if (synth) synth.getVoices();

/* ---------- Popup (thay cho confirm/alert của trình duyệt) ---------- */
// Trả về true nếu bấm nút OK, false nếu Cancel / Esc / bấm ra ngoài
function showModal({ title, html, okText = "OK", alert = false, danger = !alert }) {
  const dlg = $("modal");
  $("modal-title").textContent = title;
  $("modal-text").innerHTML = html;
  $("modal-ok").textContent = okText;
  $("modal-ok").classList.toggle("danger-btn", danger);
  $("modal-cancel").hidden = alert;
  dlg.returnValue = "";
  return new Promise(resolve => {
    dlg.addEventListener("close", () => resolve(dlg.returnValue === "ok"), { once: true });
    dlg.showModal();
    (alert ? $("modal-ok") : $("modal-cancel")).focus();
  });
}
$("modal").addEventListener("click", (e) => {
  const r = $("modal").getBoundingClientRect();
  const outside = e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
  if (e.target === $("modal") && outside) $("modal").close("cancel");
});

/* ---------- Tiến độ ---------- */
// Mỗi câu có trạng thái riêng cho Learn (meaning), Listen và Speak: "done" = đúng ngay lần đầu, "wrong" = sai, không có = chưa làm
const MODES = ["meaning", "listen", "speak"];
const MODE_NAMES = { meaning: "Learn", listen: "Listen", speak: "Speak" };
const stateOf = (it, mode) => it.progress?.[mode];
const isPending = (it, mode) => stateOf(it, mode) !== "done";
function bookStatus(list) {
  const slots = list.flatMap(it => MODES.map(m => stateOf(it, m)));
  if (list.length && slots.every(x => x === "done")) return { cls: "done", text: "Done" };
  if (slots.some(Boolean)) return { cls: "doing", text: "In progress" };
  return { cls: "todo", text: "Not started" };
}
