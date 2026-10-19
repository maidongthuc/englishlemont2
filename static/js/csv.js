// Importing sentences from a CSV file
/* ---------- Nhập câu từ file CSV ---------- */
// Đọc CSV chuẩn: hỗ trợ ô có dấu phẩy trong ngoặc kép, "" là một dấu ", xuống dòng trong ô
function parseCSV(text) {
  text = text.replace(/^\uFEFF/, "");
  const firstLine = text.split(/\r?\n/, 1)[0];
  const sep = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ";" : ",";
  const rows = [];
  let row = [], cell = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else cell += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === sep) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const HEADER_WORDS = ["sentence", "term", "english", "word", "câu", "tiếng anh"];

$("csv-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = ""; // cho phép chọn lại cùng một file
  if (!file || !canEdit(books.find(x => x.id === currentBook))) return;
  const msg = $("csv-msg");
  msg.classList.remove("error");
  let rows;
  try { rows = parseCSV(await file.text()); }
  catch { msg.textContent = "Could not read this file."; msg.classList.add("error"); return; }

  if (rows.length && HEADER_WORDS.includes((rows[0][0] || "").trim().toLowerCase())) rows.shift();

  const existing = new Set(items.filter(x => x.notebookId === currentBook).map(x => x.term.toLowerCase()));
  const added = [];
  let dup = 0, bad = 0;
  for (const r of rows) {
    const term = (r[0] || "").trim(), meaning = (r[1] || "").trim();
    if (!term && !meaning) continue; // dòng trống
    if (!term || !meaning) { bad++; continue; }
    if (existing.has(term.toLowerCase())) { dup++; continue; }
    existing.add(term.toLowerCase());
    added.push({ id: uid(), term, meaning, notebookId: currentBook, createdAt: Date.now() });
  }

  const notes = [];
  if (dup) notes.push(`${dup} already in the notebook`);
  if (bad) notes.push(`${bad} missing a sentence or meaning`);
  const skipped = notes.length ? ` Skipped: ${notes.join(", ")}.` : "";
  if (!added.length) {
    msg.textContent = `No new sentences found in “${file.name}”.${skipped}`;
    msg.classList.add("error");
    return;
  }
  items.push(...added);
  try {
    await persist();
    msg.textContent = `Added ${added.length} ${added.length === 1 ? "sentence" : "sentences"} from “${file.name}”.${skipped}`;
    renderBook();
  } catch {
    const ids = new Set(added.map(x => x.id));
    items = items.filter(x => !ids.has(x.id));
    msg.textContent = saveFail("the imported sentences");
    msg.classList.add("error");
  }
});
