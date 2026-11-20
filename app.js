/*
 * UI versi web dari script/cookie_converter_app.py (Streamlit). Semua logika konversi ada di
 * cookie_convert.js; file ini hanya merangkai DOM. Nilai cookies selalu dipasang lewat
 * textContent (tidak pernah innerHTML) supaya isi cookie tidak bisa menyuntik HTML.
 */
(function () {
  "use strict";

  var CC = window.CookieConvert;
  var PLATFORM_NAMES = Object.keys(CC.PLATFORMS);

  var state = {
    files: [], // [{name, text}]
    pasted: "",
    // Pilihan platform & status "rincian" dikunci per ISI (bukan urutan), seperti versi Streamlit,
    // supaya pilihan tidak "nyangkut" ke file lain saat daftar berubah.
    platformChoice: new Map(),
    detailsOpen: new Map(),
  };

  // ---------- helper DOM ----------
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === undefined || v === null || v === false) return;
      if (k === "text") node.textContent = v;
      else if (k.slice(0, 2) === "on") node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? "" : v);
    });
    (children || []).forEach(function (c) {
      if (c) node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return node;
  }

  function alertBox(kind, text) {
    return el("div", { class: "alert " + kind, role: kind === "err" ? "alert" : "status", text: text });
  }

  function metric(label, value) {
    return el("div", { class: "metric" }, [el("span", { text: label }), el("strong", { text: value })]);
  }

  function copyText(text, button) {
    function done(ok) {
      var old = button.dataset.label || button.textContent;
      button.dataset.label = old;
      button.textContent = ok ? "Tersalin" : "Gagal menyalin";
      setTimeout(function () {
        button.textContent = old;
      }, 1500);
    }
    function fallback() {
      var ta = el("textarea", { style: "position:fixed;opacity:0" });
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try {
        ok = document.execCommand("copy");
      } catch (e) {
        ok = false;
      }
      ta.remove();
      done(ok);
    }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function () {
        done(true);
      }, fallback);
    } else {
      fallback();
    }
  }

  function download(text, filename) {
    var url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    var a = el("a", { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);
  }

  // ---------- render ----------
  function collectSources() {
    // Map menjaga urutan sisip; isi yang sama dari unggahan & tempelan otomatis digabung.
    var sources = new Map();
    state.files.forEach(function (f) {
      sources.set(f.text, f.name);
    });
    if (state.pasted.trim()) sources.set(state.pasted, "JSON yang ditempel");
    return sources;
  }

  function renderCookiesTable(cookies) {
    var rows = CC.describeCookies(cookies);
    var cols = ["name", "domain", "path", "expires", "secure", "httpOnly", "sameSite"];
    var thead = el("thead", {}, [
      el("tr", {}, cols.map(function (c) {
        return el("th", { text: c });
      })),
    ]);
    var tbody = el("tbody", {}, rows.map(function (r) {
      return el("tr", {}, cols.map(function (c) {
        return el("td", { text: String(r[c]) });
      }));
    }));
    return el("div", { class: "table-wrap" }, [el("table", {}, [thead, tbody])]);
  }

  function renderSource(key, name, idx) {
    var card = el("article", { class: "card" }, [el("h2", { text: name })]);

    var cookies;
    try {
      cookies = CC.parseCookieJson(key);
    } catch (e) {
      card.appendChild(alertBox("err", "Tidak bisa dibaca: " + e.message));
      return card;
    }

    var platform = state.platformChoice.has(key)
      ? state.platformChoice.get(key)
      : CC.detectPlatform(cookies);

    var selectId = "platform-" + idx;
    var select = el(
      "select",
      {
        id: selectId,
        onchange: function (ev) {
          state.platformChoice.set(key, ev.target.value || null);
          render();
        },
      },
      [el("option", { value: "", text: "Pilih platform", selected: !platform })].concat(
        PLATFORM_NAMES.map(function (p) {
          return el("option", { value: p, text: p, selected: p === platform });
        })
      )
    );
    card.appendChild(el("label", { class: "field", for: selectId, text: "Platform" }));
    card.appendChild(select);

    if (!platform) {
      card.appendChild(alertBox("warn", "Platform tidak terdeteksi dari domain cookies. Pilih secara manual."));
      return card;
    }

    var payload = CC.buildPayload(cookies, platform);
    var missing = CC.missingSessionCookies(cookies, platform);
    var expired = CC.expiredCookies(cookies);

    card.appendChild(
      el("div", { class: "metrics" }, [
        metric("Jumlah cookies", String(cookies.length)),
        metric("Domain", payload.domain),
        metric("Sesi login", payload.logged_in ? "Ada" : "Tidak ada"),
      ])
    );

    if (missing.length) {
      card.appendChild(
        alertBox(
          "warn",
          "Cookie sesi " + platform + " belum lengkap, kurang: " + missing.join(", ") +
            ". Crawler bisa gagal login."
        )
      );
    } else {
      card.appendChild(alertBox("ok", "Cookie sesi lengkap: " + CC.PLATFORMS[platform].session.join(", ")));
    }
    if (expired.length) {
      card.appendChild(
        alertBox("warn", expired.length + " cookie sudah kedaluwarsa: " + expired.join(", "))
      );
    }

    var payloadJson = JSON.stringify(payload, null, 2);
    var filename = platform.toLowerCase() + "_cookies_for_simpasi.json";
    var copyBtn = el("button", { type: "button", class: "btn primary", text: "Salin" });
    copyBtn.addEventListener("click", function () {
      copyText(payloadJson, copyBtn);
    });
    card.appendChild(
      el("div", { class: "payload-head" }, [
        el("strong", { text: "Payload untuk kolom Cookies JSON di SIMPASI" }),
        el("div", { class: "actions" }, [
          copyBtn,
          el("button", {
            type: "button",
            class: "btn",
            text: "Unduh JSON",
            onclick: function () {
              download(payloadJson, filename);
            },
          }),
        ]),
      ])
    );
    card.appendChild(el("pre", {}, [el("code", { text: payloadJson })]));

    var details = el("details", { open: state.detailsOpen.get(key) === true }, [
      el("summary", { text: "Rincian cookies (tanpa nilai)" }),
      renderCookiesTable(cookies),
    ]);
    details.addEventListener("toggle", function () {
      state.detailsOpen.set(key, details.open);
    });
    card.appendChild(details);
    return card;
  }

  function renderFileList() {
    var list = document.getElementById("file-list");
    list.replaceChildren.apply(
      list,
      state.files.map(function (f, i) {
        return el("li", {}, [
          el("span", { text: f.name }),
          el("button", {
            type: "button",
            title: "Hapus " + f.name,
            "aria-label": "Hapus " + f.name,
            text: "×",
            onclick: function () {
              state.files.splice(i, 1);
              render();
            },
          }),
        ]);
      })
    );
  }

  function render() {
    renderFileList();
    var results = document.getElementById("results");
    var sources = collectSources();
    if (!sources.size) {
      results.replaceChildren(alertBox("info", "Belum ada cookies. Unggah file atau tempel JSON di atas."));
      return;
    }
    var cards = [];
    var idx = 0;
    sources.forEach(function (name, key) {
      cards.push(renderSource(key, name, idx++));
    });
    results.replaceChildren.apply(results, cards);
  }

  // ---------- input ----------
  function addFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    Promise.all(
      files.map(function (f) {
        return f.text().then(function (text) {
          return { name: f.name, text: text };
        });
      })
    ).then(function (loaded) {
      state.files = state.files.concat(loaded);
      render();
    });
  }

  function selectTab(which) {
    ["upload", "paste"].forEach(function (name) {
      var on = name === which;
      var tab = document.getElementById("tab-" + name);
      tab.setAttribute("aria-selected", String(on));
      tab.tabIndex = on ? 0 : -1;
      document.getElementById("panel-" + name).hidden = !on;
    });
  }

  document.getElementById("tab-upload").addEventListener("click", function () {
    selectTab("upload");
  });
  document.getElementById("tab-paste").addEventListener("click", function () {
    selectTab("paste");
    document.getElementById("paste").focus();
  });

  var fileInput = document.getElementById("file-input");
  fileInput.addEventListener("change", function () {
    addFiles(fileInput.files);
    fileInput.value = ""; // supaya file yang sama bisa dipilih lagi setelah dihapus
  });

  var drop = document.getElementById("drop");
  ["dragenter", "dragover"].forEach(function (t) {
    drop.addEventListener(t, function (ev) {
      ev.preventDefault();
      drop.classList.add("over");
    });
  });
  ["dragleave", "drop"].forEach(function (t) {
    drop.addEventListener(t, function () {
      drop.classList.remove("over");
    });
  });
  drop.addEventListener("drop", function (ev) {
    ev.preventDefault();
    addFiles(ev.dataTransfer && ev.dataTransfer.files);
  });

  var paste = document.getElementById("paste");
  var timer = null;
  paste.addEventListener("input", function () {
    clearTimeout(timer);
    timer = setTimeout(function () {
      state.pasted = paste.value;
      render();
    }, 150);
  });

  document.getElementById("clear").addEventListener("click", function () {
    clearTimeout(timer);
    state.files = [];
    state.pasted = "";
    state.platformChoice.clear();
    state.detailsOpen.clear();
    paste.value = "";
    fileInput.value = "";
    render();
  });

  render();
})();
