// Inside a notebook: rename, delete, add / edit / delete sentences, reset progress
/* ---------- Trong sổ tay ---------- */
function openBook(id) {
  currentBook = id; openId = null; editingId = null;
  $("csv-msg").textContent = "";
  stopRename();
  $("form").reset(); $("search").value = "";
  $("form-msg").textContent = "";
  $("save-btn").textContent = "Save sentence"; $("cancel-btn").hidden = true;
  $("view-shelf").hidden = true; $("view-book").hidden = false;
  renderBook();
  window.scrollTo(0, 0);
}
function closeBook() {
  currentBook = null;
  $("view-book").hidden = true; $("view-shelf").hidden = false;
  $("book-msg").textContent = ""; $("lib-msg").textContent = "";
  document.title = "My English Notebooks";
  renderShelf();
  window.scrollTo(0, 0);
}
$("back").addEventListener("click", closeBook);

// Đổi tên ngay tại vị trí tên sổ
function startRename() {
  const b = books.find(x => x.id === currentBook); if (!b) return;
  $("rename-input").value = b.name;
  $("rename-msg").textContent = "";
  $("book-title").hidden = true; $("rename-form").hidden = false;
  $("rename-input").focus(); $("rename-input").select();
}
function stopRename() {
  $("rename-form").hidden = true; $("book-title").hidden = false;
  $("rename-msg").textContent = "";
}
$("rename-book").addEventListener("click", () => {
  if (!canEdit(books.find(x => x.id === currentBook))) return;
  $("rename-form").hidden ? startRename() : stopRename();
});
$("rename-cancel").addEventListener("click", stopRename);
$("rename-input").addEventListener("keydown", (e) => { if (e.key === "Escape") stopRename(); });

$("rename-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const b = books.find(x => x.id === currentBook); if (!b) return;
  const name = $("rename-input").value.trim();
  if (!name) { $("rename-msg").textContent = "Enter a notebook name."; return; }
  if (name === b.name) { stopRename(); return; }
  if (books.some(x => x.id !== b.id && sameSection(x, b) && x.name.toLowerCase() === name.toLowerCase())) {
    $("rename-msg").textContent = "A notebook with this name already exists."; return;
  }
  const oldName = b.name;
  b.name = name;
  try {
    await persist();
    stopRename();
    renderBook();
  } catch {
    b.name = oldName;
    $("rename-msg").textContent = saveFail("the notebook name");
  }
});

$("delete-book").addEventListener("click", async () => {
  const b = books.find(x => x.id === currentBook); if (!canEdit(b)) return;
  const inBook = items.filter(it => it.notebookId === b.id);
  const n = inBook.length;
  const ok = await showModal({
    title: "Delete this notebook?",
    html: `<span class="quote">${esc(b.name)}</span><span class="warn">${n ? `The ${n} ${n === 1 ? "sentence" : "sentences"} inside will also be deleted. ` : ""}This can't be undone.</span>`,
    okText: "Delete notebook",
  });
  if (!ok) return;
  items = items.filter(it => it.notebookId !== b.id);
  books = books.filter(x => x.id !== b.id);
  try {
    await persist();
    closeBook();
  } catch {
    items = [...items, ...inBook];
    books = [...books, b];
    await showModal({ title: "Could not delete", html: "The notebook could not be deleted. Try again.", okText: "OK", alert: true });
  }
});


function showMsg(text, isError = false) {
  $("form-msg").textContent = text;
  $("form-msg").classList.toggle("error", isError);
}
function resetForm() {
  $("form").reset(); editingId = null;
  $("save-btn").textContent = "Save sentence"; $("cancel-btn").hidden = true;
}

$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const term = $("f-sentence").value.trim();
  const meaning = $("f-meaning").value.trim();
  if (!canEdit(books.find(x => x.id === currentBook))) return;
  if (!term || !meaning) { showMsg("Enter both a sentence and its meaning.", true); return; }
  let createdItem = null;
  let oldTerm = null;
  let oldMeaning = null;
  if (editingId) {
    const it = items.find(x => x.id === editingId);
    if (!it) return;
    oldTerm = it.term;
    oldMeaning = it.meaning;
    it.term = term; it.meaning = meaning;
    openId = it.id; showMsg("Sentence updated.");
  } else {
    if (items.some(x => x.notebookId === currentBook && x.term.toLowerCase() === term.toLowerCase())) {
      showMsg("This sentence is already in the notebook.", true); return;
    }
    createdItem = { id: uid(), term, meaning, notebookId: currentBook, createdAt: Date.now() };
    items.push(createdItem);
    showMsg("Sentence saved.");
  }
  try {
    await persist();
    resetForm(); renderBook(); $("f-sentence").focus();
  } catch {
    if (editingId) {
      const it = items.find(x => x.id === editingId);
      if (it) {
        it.term = oldTerm;
        it.meaning = oldMeaning;
      }
    } else if (createdItem) {
      items = items.filter(x => x.id !== createdItem.id);
    }
    showMsg(saveFail("the sentence"), true);
  }
});
$("cancel-btn").addEventListener("click", () => { resetForm(); showMsg(""); });

function badges(it) {
  const html = MODES.map(m => [m, MODE_NAMES[m]]).map(([m, name]) => {
    const x = stateOf(it, m);
    return x === "done" ? `<span class="badge done">${name} ✓</span>`
      : x === "wrong" ? `<span class="badge wrong">${name} ✗</span>` : "";
  }).join("");
  return html ? `<span class="badges">${html}</span>` : "";
}

function renderBook() {
  const b = books.find(x => x.id === currentBook);
  if (!b) { closeBook(); return; }
  $("book-title").innerHTML = `<span class="hl" style="background:linear-gradient(transparent 55%, ${esc(b.color)} 55%)">${esc(b.name)}</span>`;
  document.title = b.name + " · My English Notebooks";
  const editable = canEdit(b);
  $("book-library-tag").hidden = !b.library;
  $("book-actions").hidden = !editable;
  $("book-editor").hidden = !editable;
  if (!editable) stopRename();

  const mine = items.filter(it => it.notebookId === b.id);
  const q = $("search").value.trim().toLowerCase();
  const shown = mine
    .filter(it => !q || it.term.toLowerCase().includes(q) || it.meaning.toLowerCase().includes(q));
  $("count").textContent = mine.length ? `${mine.length} ${mine.length === 1 ? "sentence" : "sentences"}` : "";
  const doneIn = (m) => mine.filter(it => stateOf(it, m) === "done").length;
  const wrong = mine.filter(it => MODES.some(m => stateOf(it, m) === "wrong")).length;
  const st = bookStatus(mine);
  $("book-progress").innerHTML = mine.length
    ? `<span class="status ${st.cls}">${st.text}</span> Learn ${doneIn("meaning")}/${mine.length} · Listen ${doneIn("listen")}/${mine.length} · Speak ${doneIn("speak")}/${mine.length}${wrong ? ` · ${wrong} to retry` : ""}`
    : "";
  $("reset-progress").hidden = !mine.some(it => it.progress);

  if (!mine.length) {
    $("list").innerHTML = `<p class="empty">${editable ? "This notebook is empty. Add your first sentence above." : "This notebook has no sentences yet."}</p>`;
    return;
  }
  if (!shown.length) { $("list").innerHTML = `<p class="empty">No sentences match. Try a different search.</p>`; return; }

  $("list").innerHTML = `
    <ul class="items">
      ${shown.map(it => {
        const open = it.id === openId;
        return `
        <li class="item${open ? " open" : ""}" data-id="${it.id}">
          <button class="sentence" aria-expanded="${open}"><span class="text">${esc(it.term)}</span>${badges(it)}</button>
          <div class="detail" ${open ? "" : "hidden"}>
            <p class="meaning">${esc(it.meaning)}</p>
            <div class="row">
              <button class="icon-btn" data-act="speak">Listen</button>
              ${editable ? `<button class="icon-btn" data-act="edit">Edit</button>
              <button class="icon-btn danger" data-act="delete">Delete</button>` : ""}
            </div>
          </div>
        </li>`;
      }).join("")}
    </ul>`;
}

$("list").addEventListener("click", (e) => {
  const li = e.target.closest(".item"); if (!li) return;
  const it = items.find(x => x.id === li.dataset.id); if (!it) return;
  if (e.target.closest("button.sentence")) { openId = openId === it.id ? null : it.id; renderBook(); return; }
  const act = e.target.closest("button[data-act]")?.dataset.act;
  if (act === "speak") speak(it.term);
  if (!canEdit(books.find(b => b.id === it.notebookId))) return;
  if (act === "edit") {
    editingId = it.id;
    $("f-sentence").value = it.term; $("f-meaning").value = it.meaning;
    $("save-btn").textContent = "Save changes"; $("cancel-btn").hidden = false; showMsg("");
    $("form").scrollIntoView({ behavior: "smooth", block: "start" });
    $("f-sentence").focus({ preventScroll: true });
  }
  if (act === "delete") deleteSentence(it);
});
$("search").addEventListener("input", renderBook);

$("reset-progress").addEventListener("click", async () => {
  const b = books.find(x => x.id === currentBook); if (!b) return;
  const ok = await showModal({
    title: "Reset progress?",
    html: `All sentences in this notebook will be marked as not done, for Learn, Listen and Speak.<span class="quote">${esc(b.name)}</span>`,
    okText: "Reset",
  });
  if (!ok) return;
  const mine = items.filter(it => it.notebookId === currentBook);
  const saved = mine.map(it => it.progress);
  mine.forEach(it => delete it.progress);
  try { await persist(); }
  catch {
    mine.forEach((it, i) => { if (saved[i]) it.progress = saved[i]; });
    await showModal({ title: "Could not reset", html: "The progress could not be reset. Try again.", okText: "OK", alert: true });
  }
  renderBook();
});

async function deleteSentence(it) {
  const ok = await showModal({
    title: "Delete this sentence?",
    html: `This will remove it from the notebook.<span class="quote">${esc(it.term)}</span>`,
    okText: "Delete",
  });
  if (!ok) return;
  const before = items;
  items = items.filter(x => x.id !== it.id);
  try {
    await persist();
    if (editingId === it.id) resetForm();
    if (openId === it.id) openId = null;
  } catch {
    items = before;
    await showModal({ title: "Could not delete", html: "The sentence could not be deleted. Try again.", okText: "OK", alert: true });
  }
  renderBook();
}
