/*
 * Port JavaScript dari script/cookie_convert.py untuk versi web statis (GitHub Pages /
 * buka langsung dari file). Logikanya HARUS identik dengan versi Python; kesamaannya
 * dijaga oleh tests/test_cookie_convert_web.py (menjalankan file ini lewat node).
 *
 * Murni: tanpa DOM, tanpa jaringan. Di browser tersedia sebagai `window.CookieConvert`,
 * di node lewat `require(...)`.
 */
(function (root) {
  "use strict";

  // platform -> domain yang dikenali + cookie penanda sesi login (sama dengan PLATFORMS di Python).
  var PLATFORMS = {
    X: { domains: ["x.com", "twitter.com"], session: ["auth_token", "ct0"] },
    Instagram: { domains: ["instagram.com"], session: ["sessionid", "ds_user_id"] },
    Threads: { domains: ["threads.net", "threads.com"], session: ["sessionid"] },
    Facebook: { domains: ["facebook.com"], session: ["c_user", "xs"] },
    TikTok: { domains: ["tiktok.com"], session: ["sessionid", "sid_tt"] },
    YouTube: { domains: ["youtube.com"], session: ["SID", "SAPISID", "LOGIN_INFO"] },
  };

  var SAME_SITE = {
    no_restriction: "None",
    none: "None",
    lax: "Lax",
    strict: "Strict",
    unspecified: "Lax",
  };

  function isPlainObject(v) {
    return v !== null && typeof v === "object" && !Array.isArray(v);
  }

  // Kebenaran ala Python (`[]`/`{}` kosong = salah) supaya `if not x` di Python dan di sini sama.
  function truthy(v) {
    if (Array.isArray(v)) return v.length > 0;
    if (isPlainObject(v)) return Object.keys(v).length > 0;
    if (typeof v === "number" && isNaN(v)) return true;
    return Boolean(v);
  }

  function has(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
  }

  /** Ubah satu cookie hasil export ekstensi menjadi cookie berbentuk Playwright. */
  function normalizeCookie(raw) {
    var name = raw.name;
    var value = raw.value;
    var domain = raw.domain;
    if (!truthy(name) || value === undefined || value === null) {
      throw new Error("cookie tanpa `name`/`value`");
    }
    if (!truthy(domain)) throw new Error("cookie `" + name + "` tanpa `domain`");

    var expires = has(raw, "expires") ? raw.expires : raw.expirationDate;
    if (truthy(raw.session) || expires === undefined || expires === null || expires === "") {
      expires = -1;
    }

    var secure = truthy(raw.secure);
    var sameSite = SAME_SITE[String(truthy(raw.sameSite) ? raw.sameSite : "").toLowerCase()] || "Lax";
    if (sameSite === "None" && !secure) {
      // Chrome menolak SameSite=None tanpa Secure.
      sameSite = "Lax";
    }

    var cookie = {
      name: String(name),
      value: String(value),
      domain: String(domain),
      path: truthy(raw.path) ? raw.path : "/",
      expires: expires,
      httpOnly: truthy(raw.httpOnly),
      secure: secure,
      sameSite: sameSite,
    };

    // Cookie-Editor menulis partitionKey sebagai objek; Playwright memakai string top-level site.
    var partition = raw.partitionKey;
    if (isPlainObject(partition)) partition = partition.topLevelSite;
    if (typeof partition === "string" && partition) cookie.partitionKey = partition;
    return cookie;
  }

  /**
   * Baca teks JSON export cookies -> array cookie Playwright.
   * Menerima array cookie langsung, atau objek {"cookies": [...]} (storage_state / payload SIMPASI).
   * Melempar Error bila tidak valid.
   */
  function parseCookieJson(text) {
    var data;
    try {
      data = JSON.parse(String(text).replace(/^﻿+/, ""));
    } catch (e) {
      throw new Error("JSON tidak valid (" + e.message + ")");
    }
    if (isPlainObject(data) && Array.isArray(data.cookies)) data = data.cookies;
    if (!Array.isArray(data) || data.length === 0) {
      throw new Error("JSON harus berupa array cookie yang tidak kosong");
    }

    return data.map(function (raw, idx) {
      var i = idx + 1;
      if (!isPlainObject(raw)) throw new Error("item ke-" + i + " bukan objek cookie");
      try {
        return normalizeCookie(raw);
      } catch (e) {
        throw new Error("item ke-" + i + ": " + e.message);
      }
    });
  }

  function domainMatches(cookieDomain, platformDomain) {
    var d = cookieDomain.toLowerCase().replace(/^\.+/, "");
    return d === platformDomain || d.slice(-(platformDomain.length + 1)) === "." + platformDomain;
  }

  /** Tebak platform dari domain cookie terbanyak (null bila tidak dikenali). */
  function detectPlatform(cookies) {
    var best = null;
    var bestCount = 0;
    Object.keys(PLATFORMS).forEach(function (platform) {
      var domains = PLATFORMS[platform].domains;
      var count = cookies.filter(function (c) {
        return domains.some(function (d) {
          return domainMatches(c.domain, d);
        });
      }).length;
      if (count > bestCount) {
        best = platform;
        bestCount = count;
      }
    });
    return best;
  }

  /** Nama cookie penanda sesi platform yang tidak ada di export. */
  function missingSessionCookies(cookies, platform) {
    var names = {};
    cookies.forEach(function (c) {
      names[c.name.toLowerCase()] = true;
    });
    return PLATFORMS[platform].session.filter(function (h) {
      return !has(names, h.toLowerCase());
    });
  }

  /** Cukup salah satu cookie penanda sesi ada (sama dengan `logged_in` di cookie helper). */
  function hasSession(cookies, platform) {
    return missingSessionCookies(cookies, platform).length < PLATFORMS[platform].session.length;
  }

  /** Nama cookie yang sudah lewat masa berlakunya (cookie sesi `-1` tidak dihitung). */
  function expiredCookies(cookies, now) {
    if (now === undefined || now === null) now = Date.now() / 1000;
    return cookies
      .filter(function (c) {
        return c.expires !== -1 && c.expires < now;
      })
      .map(function (c) {
        return c.name;
      });
  }

  /** Payload union SIMPASI — bentuknya identik dengan hasil `_capture` di cookie helper. */
  function buildPayload(cookies, platform, domain) {
    // Object.create(null): cookie bernama "__proto__" tetap jadi kunci biasa, bukan prototipe.
    var simple = Object.create(null);
    var withMeta = Object.create(null);
    cookies.forEach(function (c) {
      simple[c.name] = c.value;
      withMeta[c.name] = {
        value: c.value,
        domain: c.domain,
        path: c.path,
        secure: c.secure,
        httpOnly: c.httpOnly,
        sameSite: c.sameSite,
      };
    });
    var longest = cookies.reduce(function (acc, c) {
      return c.domain.length > acc.length ? c.domain : acc;
    }, "");
    return {
      cookies: cookies,
      format_array: cookies,
      format_simple: simple,
      format_with_metadata: withMeta,
      origins: [],
      platform: platform,
      domain: domain || longest,
      logged_in: hasSession(cookies, platform),
    };
  }

  function formatExpiry(exp) {
    if (exp === -1) return "sesi";
    var d = new Date(Number(exp) * 1000);
    if (isNaN(d.getTime())) return String(exp);
    var iso = d.toISOString(); // YYYY-MM-DDTHH:MM:SS.sssZ (UTC), sama dengan time.gmtime di Python
    return iso.slice(0, 10) + " " + iso.slice(11, 16) + " UTC";
  }

  /** Ringkasan per cookie untuk tabel di GUI — sengaja TANPA nilai cookie. */
  function describeCookies(cookies) {
    return cookies.map(function (c) {
      return {
        name: c.name,
        domain: c.domain,
        path: c.path,
        expires: formatExpiry(c.expires),
        secure: c.secure,
        httpOnly: c.httpOnly,
        sameSite: c.sameSite,
      };
    });
  }

  var api = {
    PLATFORMS: PLATFORMS,
    normalizeCookie: normalizeCookie,
    parseCookieJson: parseCookieJson,
    detectPlatform: detectPlatform,
    missingSessionCookies: missingSessionCookies,
    hasSession: hasSession,
    expiredCookies: expiredCookies,
    buildPayload: buildPayload,
    describeCookies: describeCookies,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.CookieConvert = api;
  }
})(typeof window !== "undefined" ? window : this);
