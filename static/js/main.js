// Start-up: show sign-in, or load the data and show the dashboard
(async () => {
  function renderAll() { currentBook ? renderBook() : renderShelf(); }

  // Chưa đăng nhập: chỉ hiện trang giới thiệu (toàn màn hình)
  const session = sb ? (await sb.auth.getSession()).data.session : null;
  if (!session) {
    document.body.classList.add("signed-out");
    $("view-login").hidden = false;
    if (!sb) {
      signinButtons.forEach(b => { b.disabled = true; });
      $("login-msg").textContent = CONFIG_PROBLEM || "Sign-in could not load. Check your connection and reload the page.";
    }
    return;
  }
  showSignedIn(session.user);
  // Đăng xuất ở tab khác thì tab này cũng về trang đăng nhập
  sb.auth.onAuthStateChange((event) => { if (event === "SIGNED_OUT") location.reload(); });

  await loadData();
  if (loadFailed) {
    showModal({ title: "Could not load your data", html: `${esc(loadError || "Your notebooks could not be loaded.")} Nothing will be saved. Reload the page to try again.`, okText: "OK", alert: true });
  }
  $("view-shelf").hidden = false;
  if (currentBook && !books.some(b => b.id === currentBook)) currentBook = null;
  renderAll();
})();
