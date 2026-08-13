# Monitoring Stok ATL Energy

Dashboard monitoring stok bergaya SCADA untuk ATL Energy. Semua data (bahan baku
dan produk) berasal 100% dari **Mekari Jurnal API** — **tidak ada database
lokal**. Backend (Node.js + Express) adalah satu-satunya pihak yang
berkomunikasi dengan Mekari; frontend (HTML/CSS/JS murni) hanya memanggil
endpoint internal `/api/...` dan tidak pernah menyimpan credential.

## ⚠️ Yang wajib Anda lengkapi sebelum digunakan

1. **`server.cjs` → `TANK_CONFIG`**: isi `mekariItemId` dan/atau `sku` untuk
   setiap kode tank (ST1–ST5, ETC, FST1, FST2, TK1–TK4) sesuai item di akun
   Mekari Jurnal Anda. Selama kosong, kartu terkait akan tampil sebagai
   "Data belum tersedia" (bukan angka palsu).
2. **`server.cjs` → `MEKARI_ENDPOINTS`**: path inventory list, product list,
   stock detail, dan stock adjustment ditandai `TODO` karena requirement
   tidak menyertakan dokumentasi resmi Inventory/Stock Adjustment API Mekari
   Jurnal. Sesuaikan dengan dokumentasi resmi Anda.
3. **`createMekariHmac()`**: mengikuti pola HMAC yang Anda deskripsikan
   (HMAC-SHA256, Base64, header `date` + `request-line`). Jika project lama
   Anda memakai variasi string-to-sign yang berbeda, samakan fungsi ini
   dengan implementasi yang sudah terbukti berhasil.
4. **`adjustStock()`**: payload yang dikirim ke endpoint stock adjustment
   masih bersifat asumsi (`inventory_id`, `physical_quantity`, `note`).
   Sesuaikan dengan payload yang benar-benar diterima oleh API Mekari Anda.

## Struktur project

```
ATL-Monitoring-Stok/
├── server.cjs
├── package.json
├── package-lock.json      (dibuat otomatis oleh `npm install`)
├── .gitignore
├── .env.example
└── public/
    ├── index.html
    ├── style.css
    └── app.js
```

## 1. Install Node.js

Pastikan Node.js versi 18 ke atas terpasang (`node -v`).

## 2. Install dependency

```bash
npm install
```

Perintah ini akan membuat `package-lock.json` secara otomatis.

## 3. Setup environment variable

Salin `.env.example` menjadi `.env`:

```bash
cp .env.example .env
```

Isi `.env`:

```
MEKARI_HMAC_USERNAME=isi_username_anda
MEKARI_HMAC_SECRET=isi_secret_anda
PORT=3000
```

`.env` sudah masuk `.gitignore` — jangan pernah commit file ini.

## 4. Jalankan (development)

```bash
npm start
```

## 5. Test di localhost

Buka:

```
http://localhost:3000
```

## 6. Push ke GitHub

```bash
git init
git add .
git commit -m "Initial commit: ATL Energy stock monitoring"
git branch -M main
git remote add origin <URL_REPO_ANDA>
git push -u origin main
```

Pastikan `.env` **tidak ikut ter-commit** (cek dengan `git status`).

## 7. Buat Render Web Service

1. Login ke [Render](https://render.com), pilih **New → Web Service**.
2. Hubungkan repository GitHub project ini.

## 8. Build Command

```
npm install
```

## 9. Start Command

```
npm start
```

## 10. Environment Variables di Render

Tambahkan di tab **Environment**:

| Key                     | Value                        |
|--------------------------|-------------------------------|
| `MEKARI_HMAC_USERNAME`   | username HMAC Mekari Anda    |
| `MEKARI_HMAC_SECRET`     | secret HMAC Mekari Anda      |

`PORT` **tidak perlu diisi manual** — Render mengaturnya otomatis dan server
sudah menggunakan `process.env.PORT || 3000`.

## Endpoint internal (frontend ↔ backend)

| Method | Endpoint             | Keterangan                                  |
|--------|-----------------------|----------------------------------------------|
| GET    | `/api/inventory`      | Gabungan bahan baku + produk                 |
| GET    | `/api/raw-materials`  | Data bahan baku (ST1–ST5, ETC)               |
| GET    | `/api/products`       | Data produk (FST1, FST2, TK1–TK4)            |
| GET    | `/api/stock/:id`      | Detail satu tank berdasarkan kode            |
| POST   | `/api/stock-adjust`   | Kirim stock opname/adjustment ke Mekari      |

Semua endpoint di atas dipanggil oleh `public/app.js`; frontend tidak pernah
memanggil `api.mekari.com` secara langsung dan tidak pernah menyimpan
credential.

## Catatan tentang Log Bahan / Log Produksi

Mekari Jurnal API belum dipastikan menyediakan endpoint histori mutasi stok
yang dibutuhkan. Selama belum tersedia, panel "LOG BAHAN" dan "LOG PRODUKSI"
menampilkan pesan "Data histori tidak tersedia dari API Mekari" — **bukan**
data buatan. Jangan menambahkan database lokal hanya untuk fitur ini.
