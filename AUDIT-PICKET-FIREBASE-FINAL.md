# Audit Final — Piket Direct Firebase

## Paket
- `index-piket-firebase-final.html`
- `piket-firebase.js`
- `firebase-config.js`
- `firebase.rules.piket-required.patch.json`

## Pemeriksaan yang dilakukan
1. Syntax check Node.js untuk `piket-firebase.js`: PASS.
2. Syntax check seluruh inline JavaScript pada HTML: PASS.
3. Semua `call('...')` dari HTML memiliki method di adapter: PASS.
4. Tidak ada URL GAS pada HTML: PASS.
5. Tidak ada `google.script.run` yang digunakan oleh HTML: PASS.
6. Semua referensi `$()` pada HTML memiliki elemen ID: PASS.
7. Penulisan Absensi Siswa/Guru menggunakan `update()`, bukan `set()` untuk record yang sudah ada: PASS.
8. Realtime Absensi Siswa/Guru dibatasi ke key tanggal hari ini: PASS.
9. Laporan memakai tanggal yang dipilih pengguna: PASS.
10. Password pengguna Piket tidak ditulis ke Realtime Database: PASS.

## Perubahan penting
- Login mencoba format akun `piket`, `petugas`, `guru`, dan `admin` untuk username yang bukan email.
- Absensi siswa menampilkan seluruh siswa aktif dan memberi tombol `Lengkapi` untuk siswa yang belum absen.
- Absensi siswa yang sudah hadir dapat dilengkapi jam pulang.
- Absensi guru tetap dapat ditambahkan/dilengkapi melalui menu Kehadiran.
- Record Absensi Siswa/Guru yang sudah ada tidak diganti seluruhnya; field yang ada dipertahankan dan hanya field yang diperlukan diperbarui.
- Halaman absensi realtime menampilkan hari ini. Pemilihan tanggal historis dilakukan melalui Laporan Harian.
- Query data Piket menggunakan `orderByChild('tanggal')` untuk menghindari pembacaan seluruh riwayat.

## Prasyarat Rules
File `firebase.rules.piket-required.patch.json` berisi perubahan minimum yang perlu MERGE ke rules lama.
Jangan mengganti rules lama dengan file patch tersebut.

Khusus akun Petugas:
- role `petugas` harus diizinkan pada validasi profil security user.
- role `petugas` harus mendapat izin write pada attendance Absensi Siswa dan Absensi Guru.

Khusus performa:
Tambahkan `.indexOn: ["tanggal"]` pada node Piket yang menggunakan query tanggal. Untuk `absensiPetugas`, field lama menggunakan `Tanggal`, sehingga index mengikuti field tersebut.

## Yang belum dapat diverifikasi dari static audit
- Login Firebase Authentication aktual di browser.
- UID akun Petugas/Guru/Admin yang sebenarnya.
- Rules yang sedang DEPLOY di Firebase Console.
- Data produksi aktual pada `shared/students`, `shared/teachers`, dan attendance.
- Transaksi jaringan realtime di browser.

Jadi paket ini sudah lulus audit kode/static, tetapi tetap perlu satu uji integrasi di Firebase produksi sebelum GAS dimatikan.
