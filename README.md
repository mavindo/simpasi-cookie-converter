# Konversi cookies SIMPASI

Halaman statis untuk mengubah hasil export ekstensi browser (mis. Cookie-Editor) menjadi
payload cookies SIMPASI.

**Buka:** https://mavindo.github.io/simpasi-cookie-converter/

- Semua konversi berjalan di browser. Halaman dikunci Content-Security-Policy
  (`connect-src 'none'`, `img-src data:`, `form-action 'none'`) sehingga tidak bisa mengirim
  data ke mana pun; cookies tidak disimpan.
- Bisa juga dipakai offline: unduh repo ini lalu buka `index.html`.
