// Loading and saving notebooks through /api/data
/* ---------- Lưu trữ ---------- */
function normalizeData(data) {
  const nextItems = Array.isArray(data?.items) ? data.items : [];
  const nextBooks = Array.isArray(data?.books) ? data.books : [];
  items = nextItems;
  books = nextBooks;
  isAdmin = data?.isAdmin === true;
}

async function loadData() {
  try {
    const response = await fetch("/api/data", { headers: { Authorization: `Bearer ${await accessToken()}` } });
    if (!response.ok) {
      loadError = (await response.json().catch(() => ({}))).error || "";
      throw new Error("Failed to load data");
    }
    normalizeData(await response.json());
  } catch {
    // Tải không được thì không cho lưu: lưu danh sách rỗng sẽ xoá hết dữ liệu trên server
    loadFailed = true;
    normalizeData({ items: [], books: [] });
  }
}

let loadFailed = false, loadError = "";
let saveError = "";  // lý do server trả về khi lưu lỗi, hiện cho người dùng xem
const saveFail = (what) => `Could not save ${what}. ${saveError || "Try again."}`;
async function saveData() {
  saveError = loadFailed ? "Your data was not loaded. Reload the page." : "";
  if (loadFailed) throw new Error(saveError);
  let response;
  try {
    response = await fetch("/api/data", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${await accessToken()}` },
      body: JSON.stringify({ items, books }),
    });
  } catch {
    saveError = "Could not reach the server.";
    throw new Error(saveError);
  }
  if (!response.ok) {
    saveError = (await response.json().catch(() => ({}))).error || `Server error ${response.status}.`;
    throw new Error(saveError);
  }
}

async function persist() {
  await saveData();
}
