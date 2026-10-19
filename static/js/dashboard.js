// Dashboard: the Library and My notebooks shelves
/* ---------- Giá sổ tay ---------- */
function renderShelf() {
  $("lib-form").hidden = !isAdmin;
  $("admin-tag").hidden = !isAdmin;
  $("library-help").textContent = isAdmin
    ? "Notebooks for everyone. You are an admin: add and edit them here. Everyone learns them with their own progress."
    : "Notebooks prepared for everyone. Your progress on them is your own.";
  fillShelf($("shelf-library"), books.filter(b => b.library),
    isAdmin ? "The Library is empty. Add the first notebook above." : "The Library is empty for now.");
  fillShelf($("shelf"), books.filter(b => !b.library),
    "You don't have any notebooks yet. Enter a name and tap “Create notebook” to start.");
}

function fillShelf(shelf, list, emptyText) {
  if (!list.length) {
    shelf.innerHTML = `<p class="empty" style="grid-column:1/-1">${emptyText}</p>`;
    return;
  }
  const sorted = [...list].sort((a, b) => a.name.localeCompare(b.name, "vi", { sensitivity: "base", numeric: true }));
  shelf.innerHTML = sorted.map(b => {
    const mine = items.filter(it => it.notebookId === b.id), n = mine.length;
    const st = bookStatus(mine);
    return `
      <button class="book" data-id="${b.id}" style="background:${esc(b.color)}" aria-label="Open notebook ${esc(b.name)}">
        <span class="label">
          <span class="label-title">${esc(b.name)}</span>
          <span class="label-count" style="display:block">${n} ${n === 1 ? "sentence" : "sentences"}</span>
          <span class="status ${st.cls}">${st.text}</span>
        </span>
      </button>`;
  }).join("");
}

// Tên sổ không trùng trong cùng một khu (Library hoặc My notebooks)
const sameSection = (a, b) => !!a.library === !!b.library;

async function createBook(form, input, msg, library) {
  const name = input.value.trim();
  msg.classList.remove("error");
  if (!name) return;
  if (books.some(b => sameSection(b, { library }) && b.name.toLowerCase() === name.toLowerCase())) {
    msg.textContent = "A notebook with this name already exists."; msg.classList.add("error"); return;
  }
  const b = { id: uid(), kind: "notebook", name, color: COLORS[books.length % COLORS.length], createdAt: Date.now() };
  if (library) b.library = true;
  books.push(b);
  try {
    await persist();
    form.reset();
    msg.textContent = `Created “${name}”.`;
    renderShelf();
  } catch {
    books = books.filter(x => x.id !== b.id);
    msg.textContent = saveFail("the notebook");
    msg.classList.add("error");
  }
}
$("book-form").addEventListener("submit", (e) => {
  e.preventDefault();
  createBook($("book-form"), $("b-name"), $("book-msg"), false);
});
$("lib-form").addEventListener("submit", (e) => {
  e.preventDefault();
  if (isAdmin) createBook($("lib-form"), $("lib-name"), $("lib-msg"), true);
});

for (const shelf of [$("shelf"), $("shelf-library")]) {
  shelf.addEventListener("click", (e) => {
    const btn = e.target.closest(".book");
    if (btn) openBook(btn.dataset.id);
  });
}
