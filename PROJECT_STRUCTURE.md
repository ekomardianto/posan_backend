# Struktur project POSAN Backend

```text
.
├── middleware/          # Express middleware, termasuk autentikasi
├── migrations/          # Migrasi skema yang dijalankan CI/CD
│   ├── legacy/          # Migrasi lama yang sudah digantikan; tidak dijalankan CI/CD
│   └── 001_initial_schema.js
├── routes/              # Endpoint API
├── scripts/
│   ├── admin/           # Skrip operasi akun administratif
│   └── data/            # Perbaikan/pembaruan data satu kali
├── seeds/               # Data awal: role, menu, dan konfigurasi pembayaran
├── tests/               # Skrip uji API
├── db.js                # Koneksi PostgreSQL
├── server.js            # Entry point Express
└── package.json         # Perintah npm
```

## Perintah umum

- `npm start` menjalankan API.
- `npm run migrate:deploy` menjalankan semua migrasi bernomor yang belum diterapkan.
- `npm run seed:roles`, `npm run seed:menu`, dan `npm run seed:payment-config` menjalankan seed secara manual.
- `npm run test:rbac` dan `npm run test:multi-tenant` menjalankan skrip uji secara manual.
- `npm run admin:reset-cafe2` menjalankan skrip yang menghapus data operasional Merchant ID 2 sebelum membuat akun admin baru; gunakan dengan hati-hati.

Setiap perubahan skema baru harus dibuat sebagai file migrasi bernomor berikutnya, misalnya `002_add_column_name.js`. Migrasi lama disimpan untuk referensi saja dan tidak dijalankan oleh workflow.
