# Migrasi lama

Skrip di folder ini adalah migrasi satu kali dari versi aplikasi sebelumnya. Skema saat ini ditangani oleh `../001_initial_schema.js`, sehingga file-file lama ini tidak dipanggil oleh `npm run migrate:deploy` dan tidak boleh dijalankan ulang pada database produksi.
