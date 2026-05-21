# Backend Apps Script — Sistem Presensi RFID MA Nurul Huda

Dokumentasi lengkap untuk **Google Apps Script** backend yang menerima data dari
ESP32 dan menyimpannya ke **Google Sheets**. Berpasangan dengan firmware ESP32
(`README.md`).

> **Versi**: v8 — Dashboard Simpel + Filter Langsung
> **File utama**: `Code.gs` (di Apps Script Editor)
> **Tipe deployment**: Web App (HTTPS endpoint publik)

---

## Daftar Isi

1. [Peran Backend dalam Sistem](#1-peran-backend-dalam-sistem)
2. [Arsitektur Data](#2-arsitektur-data)
3. [Struktur 6 Sheet di Spreadsheet](#3-struktur-6-sheet-di-spreadsheet)
4. [Prasyarat Sebelum Deploy](#4-prasyarat-sebelum-deploy)
5. [Setup Awal dari Nol — Step by Step](#5-setup-awal-dari-nol--step-by-step)
6. [Deploy sebagai Web App](#6-deploy-sebagai-web-app)
7. [API Endpoint — Spesifikasi Lengkap](#7-api-endpoint--spesifikasi-lengkap)
8. [Cara Pakai Dashboard](#8-cara-pakai-dashboard)
9. [Menambah / Mengedit Data Kartu](#9-menambah--mengedit-data-kartu)
10. [Memahami Kode Apps Script](#10-memahami-kode-apps-script)
11. [Mekanisme Versi & Trigger onEdit](#11-mekanisme-versi--trigger-onedit)
12. [Fungsi Utilitas](#12-fungsi-utilitas)
13. [Troubleshooting](#13-troubleshooting)
14. [Known Issues & Patch](#14-known-issues--patch)
15. [Maintenance & Update](#15-maintenance--update)
16. [FAQ](#16-faq)

---

## 1. Peran Backend dalam Sistem

```
┌──────────────┐  HTTPS GET   ┌──────────────────────┐   read/write   ┌────────────────┐
│   ESP32      │ ───────────► │   Apps Script        │ ─────────────► │ Google Sheets  │
│   (alat)     │              │   (Code.gs)          │                │ (6 sheet)      │
│              │ ◄─────────── │   doGet(e)           │ ◄───────────── │                │
└──────────────┘  JSON / OK   └──────────────────────┘                └────────────────┘
                                         ▲                                     ▲
                                         │                                     │
                                         │ trigger onEdit                      │ admin buka
                                         │                                     │ dari browser
                                         │                                     │
                                  ┌──────┴──────┐                       ┌──────┴──────┐
                                  │ Edit kartu  │                       │   Admin     │
                                  │ di Sheets   │                       │  Sekolah    │
                                  └─────────────┘                       └─────────────┘
```

Apps Script berperan sebagai **jembatan** antara ESP32 dan Google Sheets:

- ESP32 tidak bisa langsung tulis ke Google Sheets API (terlalu rumit untuk
  microcontroller). Maka kita pakai Apps Script yang punya akses native ke
  spreadsheet.
- Saat ESP32 kirim HTTP GET, Apps Script `doGet()` yang dipanggil.
- Apps Script juga otomatis update **versi data** setiap ada perubahan di
  `Data_Induk`, sehingga ESP32 tahu kapan perlu download ulang.

---

## 2. Arsitektur Data

```
                          ┌─────────────────┐
                          │  Data_Mentah    │  ← ESP32 tulis di sini
                          │  (raw tap log)  │     (1 row = 1 tap)
                          └────────┬────────┘
                                   │
                                   │ QUERY (1x masuk per orang per hari)
                                   ▼
                          ┌─────────────────┐
                          │ Laporan_Harian  │  ← otomatis dari Data_Mentah
                          │ (1 row/hari/org)│
                          └────────┬────────┘
                                   │
              ┌────────────────────┴────────────────────┐
              │                                         │
              ▼                                         ▼
     ┌─────────────────┐                       ┌─────────────────┐
     │  Laporan_Siswa  │                       │    Rekapan      │
     │ (siswa saja)    │                       │ (rekap bulanan) │
     └─────────────────┘                       └────────┬────────┘
                                                        │
                                                        ▼
                                              ┌─────────────────┐
                                              │   Dashboard     │  ← user lihat di sini
                                              │ (4 kartu+tabel) │
                                              └─────────────────┘

         ┌─────────────────┐
         │   Data_Induk    │  ← admin edit manual
         │ (master kartu)  │     dipakai semua sheet sebagai referensi
         └─────────────────┘
```

**Prinsip**: hanya `Data_Mentah` dan `Data_Induk` yang berisi data **mentah**.
Empat sheet sisanya (`Laporan_Harian`, `Laporan_Siswa`, `Rekapan`, `Dashboard`)
adalah **derived data** — isinya rumus saja, dihitung otomatis. Jangan pernah
edit manual di 4 sheet derived ini.

---

## 3. Struktur 6 Sheet di Spreadsheet

### 3.1. `Data_Mentah` — Log mentah tiap tap

| Kolom | Header | Isi | Catatan |
|---|---|---|---|
| A | Timestamp_Server | Jam server menerima request | format `dd/MM/yyyy HH:mm:ss` |
| B | Tap_Asli | Jam tap di ESP32 (timezone WIB) | bisa berbeda dengan A kalau offline |
| C | Hari | `Senin`, `Selasa`, ... | otomatis dari kolom B |
| D | Tanggal | `2026-05-21` | hanya tanggal, untuk QUERY |
| E | Jam | `08:30:15` | hanya jam, untuk QUERY |
| F | UID | `A1B2C3D4` | uppercase, dari ESP32 |
| G | Nama | dari `Data_Induk` | kosong kalau kartu asing |
| H | Jabatan | `Guru` / `Siswa` | kosong kalau asing |
| I | Kelas / Bidang | misal `XII-IPA` atau `Informatika` | kosong kalau asing |

**Urutan baris**: tap terbaru selalu di **atas** (baris 2). Apps Script pakai
`insertRowAfter(1)` setiap kali ada tap baru. Ini lebih nyaman dibaca admin
dibanding append biasa.

### 3.2. `Data_Induk` — Master daftar kartu

| Kolom | Header | Isi | Wajib? |
|---|---|---|---|
| A | UID | `0586995161D100` (uppercase) | ✅ |
| B | Nama | `Isma Izha Utama` | ✅ |
| C | Jabatan | `Guru` / `Siswa` | ✅ — case-sensitive |
| D | Kelas / Bidang | `Informatika`, `XII-IPA`, dll | ✅ |
| Y1, Z1 | (helper) | Label "Versi:" + nilai versi | ⚠️ Jangan diubah |

> **Penting**: Kolom C (Jabatan) **case-sensitive** dan dipakai untuk logic:
> - `Guru` → status default `Hadir` (jam kapan saja)
> - `Siswa` → kalau tap > 07:00 → status `Terlambat`
>
> Pastikan ejaannya persis `Guru` atau `Siswa` (huruf besar di awal).

### 3.3. `Laporan_Harian` — Rekap harian (otomatis)

Satu baris = satu orang yang tap di satu hari (tap pertama saja kalau ada
multiple tap di hari yang sama).

| Kolom | Header | Sumber |
|---|---|---|
| A | Tanggal | dari Data_Mentah |
| B | Jam Masuk | tap paling awal hari itu |
| C | UID | |
| D | Nama | |
| E | Jabatan | |
| F | Kelas / Bidang | |
| G | Status | `Hadir` / `Terlambat` (logic di atas) |

Diisi dengan **satu rumus QUERY** di sel A2:

```sql
QUERY(Data_Mentah!D:I,
  "SELECT D, MIN(E), F, G, H, I
   WHERE D IS NOT NULL AND G IS NOT NULL AND G != ''
   GROUP BY D, F, G, H, I
   ORDER BY D DESC, MIN(E) ASC", 0)
```

Status di kolom G dihitung dengan `ARRAYFORMULA`:
```
IF Jabatan = "Guru" → "Hadir"
IF Jam <= 07:00:00  → "Hadir"
ELSE                → "Terlambat"
```

### 3.4. `Laporan_Siswa` — Khusus siswa (otomatis)

Versi filter dari `Laporan_Harian` yang hanya menampilkan baris dengan
`Jabatan = Siswa`. Tampilan lebih bersih untuk audit kehadiran siswa.

Sel A3 berisi:
```sql
QUERY(Laporan_Harian!A:G,
  "SELECT A, B, C, D, F, G
   WHERE A IS NOT NULL AND E = 'Siswa'
   ORDER BY A DESC, B ASC", 0)
```

### 3.5. `Rekapan` — Rekap bulanan (otomatis)

Per orang yang terdaftar di `Data_Induk`, hitung selama bulan terpilih:

| Kolom | Header | Logic |
|---|---|---|
| A | No | row number |
| B | Nama | dari `Data_Induk` |
| C | Jabatan | dari `Data_Induk` |
| D | Kelas / Bidang | dari `Data_Induk` |
| E | Total Hadir | jumlah hari hadir di bulan terpilih |
| F | Total Terlambat | jumlah hari terlambat (N/A untuk Guru) |
| G | Hari Efektif | hari unik yang ada minimal 1 tap di bulan itu |
| H | % Kehadiran | `E / G` |

**Sel helper** di kolom Z (tersembunyi) yang dipakai semua rumus:

| Sel | Isi | Sumber |
|---|---|---|
| Z2 | bulan filter | `=Dashboard!B4` ⚠️ lihat [Known Issues](#14-known-issues--patch) |
| Z3 | tahun filter | `=Dashboard!D4` |
| Z4 | override hari efektif | `=Dashboard!F4` (opsional, kosongkan = otomatis) |

**Conditional formatting % kehadiran**:
- ≥90% → hijau (`#c8e6c9`)
- 75–89% → kuning (`#fff9c4`)
- <75% → merah (`#ffcdd2`)

### 3.6. `Dashboard` — Tampilan utama (otomatis)

Layout per baris:

```
┌─────────────────────────────────────────────────────────────┐
│ 📋 DASHBOARD KEHADIRAN · MA NURUL HUDA MERGOSONO            │ ← Baris 1
├─────────────────────────────────────────────────────────────┤
│ Menampilkan data: Mei 2026                                  │ ← Baris 2
├─────────────────────────────────────────────────────────────┤
│                  ✏️ GANTI PERIODE DI BAWAH INI               │ ← Baris 4
│   BULAN    │   TAHUN   │  HARI EFEKTIF   │  Keterangan      │ ← Baris 5
│    [5]     │   [2026]  │       [ ]       │  contoh teks     │ ← Baris 6  ← INPUT
├─────────────────────────────────────────────────────────────┤
│ TOTAL TRDTR │ HADIR INI │ RATA-RATA      │ TERLAMBAT BLN INI│ ← Baris 8
│  47 Orang   │ 35 Orang  │   89.2%        │   12 Kejadian    │ ← Baris 9
├─────────────────────────────────────────────────────────────┤
│ No │ Nama │ Jabatan │ Kelas │ Hadir │ Telat │ Efektif │ %   │ ← Baris 12
│  1 │ ...  │   ...   │  ...  │  ...  │  ...  │   ...   │ ... │ ← Baris 13+
└─────────────────────────────────────────────────────────────┘
```

**Sel input yang bisa diedit**:

| Sel (terlihat) | Sel sebenarnya | Edit jadi |
|---|---|---|
| Kotak kuning "BULAN" | `A6` (merge A6:B6) | angka 1–12 |
| Kotak kuning "TAHUN" | `C6` (merge C6:D6) | angka tahun (2025, 2026, ...) |
| Kotak kuning "HARI EFEKTIF" | `E6` (merge E6:G6) | angka, atau kosongkan |

> Ketik nilai di kotak kuning bertepi titik-titik oranye. Karena cell ter-merge,
> mengetik di B6 atau A6 sama-sama mengubah nilai input bulan.

---

## 4. Prasyarat Sebelum Deploy

- [ ] Akun **Google** (Gmail biasa atau Workspace sekolah).
- [ ] Browser modern (Chrome / Edge / Firefox terbaru).
- [ ] Hak edit penuh ke spreadsheet yang akan dipakai.
- [ ] **GSCRIPT_ID lama (kalau migrasi)** — kalau ini deploy ulang, catat dulu
      ID lama agar bisa rollback.

---

## 5. Setup Awal dari Nol — Step by Step

### Langkah 1 — Buat Spreadsheet baru

1. Buka <https://sheets.google.com>.
2. Klik **Blank spreadsheet**.
3. Ganti nama jadi `Presensi MA Nurul Huda` (atau bebas).

### Langkah 2 — Buka Apps Script Editor

1. Menu **Extensions → Apps Script**.
2. Akan terbuka tab baru: `Code.gs` dengan fungsi `myFunction()` default.

### Langkah 3 — Paste seluruh Code.gs

1. **Hapus** semua isi `Code.gs`.
2. **Paste** seluruh isi file `Code.gs` (yang sudah Anda backup).
3. **Save** dengan Ctrl+S. Beri nama project: `Presensi_API`.

### Langkah 4 — Jalankan `setupSpreadsheet()`

1. Di Apps Script Editor, pilih dropdown function di toolbar atas:
   pilih `setupSpreadsheet`.
2. Klik tombol **Run** (►).
3. Pertama kali run, Google akan minta authorize:
   - **Review permissions** → pilih akun Google Anda
   - **Advanced** → **Go to Presensi_API (unsafe)**
   - **Allow**
4. Tunggu 5–15 detik. Setelah selesai, akan muncul popup:
   > ✅ Setup selesai!
   >
   > Cara pakai Dashboard:
   > • Ganti bulan → ketik angka di sel B4 (contoh: 5)
   > ...

5. Buka kembali tab spreadsheet — sekarang sudah ada **6 sheet baru**:
   `Dashboard`, `Rekapan`, `Laporan_Harian`, `Laporan_Siswa`, `Data_Mentah`,
   `Data_Induk`.

### Langkah 5 — Jalankan `pasangTriggerOnEdit()`

1. Di Apps Script Editor, pilih function `pasangTriggerOnEdit`.
2. Klik **Run**.
3. Muncul popup:
   > ✅ Trigger onEdit terpasang.

   Ini memasang trigger yang otomatis update angka versi `Data_Induk` setiap
   ada perubahan di sheet itu.

### Langkah 6 — Jalankan `buatChartDashboard()`

1. Pilih function `buatChartDashboard`.
2. Klik **Run**.
3. Muncul popup:
   > ✅ Chart berhasil dibuat di Dashboard.

   Chart batang "Total Kehadiran per Orang" sekarang ada di sebelah kanan
   tabel Dashboard.

### Langkah 7 — Isi `Data_Induk`

1. Buka tab **Data_Induk** di spreadsheet.
2. Baris 2 sudah ada contoh `0586995161D100` (Isma Izha Utama). Edit atau hapus.
3. Tambahkan kartu Anda mulai dari baris 2 ke bawah. Kolom A (UID) wajib
   uppercase, contoh: `A1B2C3D4`.
4. Setiap kali Anda Save, **versi otomatis bertambah** (terlihat di sel Z1).

### Langkah 8 — Deploy sebagai Web App

Lihat bagian [§6 Deploy sebagai Web App](#6-deploy-sebagai-web-app) untuk
panduan detail.

---

## 6. Deploy sebagai Web App

Deploy = mempublikasikan Apps Script Anda sebagai URL HTTPS yang bisa diakses
ESP32.

### 6.1. Deploy pertama kali

1. Di Apps Script Editor, klik tombol **Deploy** (kanan atas) → **New deployment**.
2. Klik ikon **roda gigi** ⚙️ di sebelah "Select type" → pilih **Web app**.
3. Isi form:

| Field | Isi |
|---|---|
| **Description** | `v8 - Dashboard simpel` (bebas) |
| **Execute as** | **Me (alamatemail@gmail.com)** |
| **Who has access** | **Anyone** ⚠️ wajib agar ESP32 bisa akses |

4. Klik **Deploy**.
5. Akan muncul:
   - **Deployment ID** (string panjang)
   - **Web app URL**, contoh:
     ```
     https://script.google.com/macros/s/AKfycbz2I072wPz-uDBi71D4xUyhEfRzUkulrMQWZ0XfuwIGvzPWsI6Eypa0sKNj4crcKPtb2Q/exec
     ```
6. **Salin** bagian setelah `/s/` dan sebelum `/exec` — itulah **GSCRIPT_ID**
   yang harus di-paste ke kode ESP32:
   ```cpp
   const char* GSCRIPT_ID = "AKfycbz2I072wPz-uDBi71D4xUyhEfRzUkulrMQWZ0XfuwIGvzPWsI6Eypa0sKNj4crcKPtb2Q";
   ```

### 6.2. Test deployment dari browser

Buka URL berikut di browser baru (ganti `GSCRIPT_ID`):

```
https://script.google.com/macros/s/GSCRIPT_ID/exec?aksi=versi
```

Harus muncul JSON seperti:
```json
{"ok":true,"v":"1716297615"}
```

Kalau muncul HTML login Google → deploy belum **Anyone**, ulangi step 6.1.

### 6.3. Update deployment (setelah edit kode)

⚠️ **PERINGATAN BESAR**: Save kode TIDAK otomatis mengupdate deployment.
URL deployment akan tetap menjalankan kode **lama** sampai Anda re-deploy.

Cara update:
1. **Deploy → Manage deployments**.
2. Cari deployment Anda → klik ikon **pensil** ✏️.
3. Field **Version**: pilih **New version**.
4. (Opsional) tambahkan deskripsi perubahan.
5. Klik **Deploy**.

URL/GSCRIPT_ID **tetap sama**, ESP32 tidak perlu di-upload ulang. ✅

### 6.4. Kalau bikin New deployment (bukan New version)

URL/GSCRIPT_ID **akan berubah**, dan deployment lama tetap aktif. Ini berguna
kalau ingin testing pakai 2 versi paralel, tapi normalnya gunakan
**New version** dari deployment yang sama.

---

## 7. API Endpoint — Spesifikasi Lengkap

Apps Script ini meng-expose **3 endpoint** (semuanya GET).

Base URL:
```
https://script.google.com/macros/s/GSCRIPT_ID/exec
```

### 7.1. `?aksi=versi` — Cek versi Data_Induk

**Request**:
```
GET /exec?aksi=versi
```

**Response (200 OK, JSON)**:
```json
{
  "ok": true,
  "v": "1716297615"
}
```

Field `v` adalah Unix timestamp (detik) saat `Data_Induk` terakhir diubah.
ESP32 pakai ini untuk cek apakah perlu download ulang data kartu.

**Penggunaan oleh ESP32**:
- Saat boot, untuk verifikasi Apps Script aktif
- Saat retry konektivitas

### 7.2. `?aksi=induk` — Download seluruh Data_Induk

**Request**:
```
GET /exec?aksi=induk
```

**Response (200 OK, JSON)**:
```json
{
  "ok": true,
  "v": "1716297615",
  "n": 3,
  "data": [
    ["0586995161D100", "Isma Izha Utama", "Guru", "Informatika"],
    ["A1B2C3D4",       "Ahmad Fauzi",     "Siswa", "XII-IPA"],
    ["E5F6G7H8",       "Bu Siti",         "Guru",  "Matematika"]
  ]
}
```

Field:
- `v` — versi (sama seperti `?aksi=versi`)
- `n` — jumlah kartu
- `data` — array of `[uid, nama, jabatan, kelas]`

**Penggunaan oleh ESP32**:
- Saat boot pertama (cache kosong) atau setiap boot kalau perlu refresh

### 7.3. `?aksi=tap` — Catat tap presensi

**Request**:
```
GET /exec?aksi=tap
   &uid=A1B2C3D4
   &nama=Ahmad+Fauzi
   &jabatan=Siswa
   &kelas=XII-IPA
   &tap=2026-05-21+08:30:15
   &asing=0
```

**Parameter**:

| Nama | Tipe | Wajib | Catatan |
|---|---|---|---|
| `uid` | string | ✅ | Akan di-uppercase otomatis |
| `nama` | string | hanya jika asing=0 | URL-encoded (spasi → `+` atau `%20`) |
| `jabatan` | string | hanya jika asing=0 | `Guru` atau `Siswa` |
| `kelas` | string | hanya jika asing=0 | |
| `tap` | string | ✅ | Format `YYYY-MM-DD HH:mm:ss`, asumsi WIB |
| `asing` | `0` / `1` | ✅ | `1` = kartu tidak terdaftar |

**Response (200 OK, text/plain)**:
- `OK` — tap kartu dikenal berhasil tercatat
- `OK-ASING` — tap kartu asing berhasil tercatat (kolom Nama/Jabatan/Kelas dikosongkan)
- `ERROR: ...` — gagal (misal: parameter UID kosong, sheet tidak ditemukan)

**Validasi waktu**:
- Kalau `tap` = `0000-00-00 00:00:00` (artinya NTP gagal di ESP32),
  server pakai `new Date()` saat itu juga
- Kalau tap valid, server konversi ke timezone Asia/Jakarta dengan `+07:00`
- Hari Senin/Selasa/... otomatis dihitung dari tanggal

### 7.4. Endpoint tidak dikenali

**Request**:
```
GET /exec?aksi=tidakada
```

**Response**:
```json
{
  "ok": false,
  "info": "Presensi RFID MA Nurul Huda",
  "aksi": ["versi", "induk", "tap"]
}
```

---

## 8. Cara Pakai Dashboard

### 8.1. Ganti periode (bulan/tahun yang ditampilkan)

1. Buka sheet **Dashboard**.
2. Lihat panel kuning di baris 6:
   - Kotak bertulis **BULAN** (sel A6/B6) — klik, hapus angka lama, ketik
     angka 1–12, tekan **Enter**.
   - Kotak bertulis **TAHUN** (sel C6/D6) — sama, ketik tahun (misal `2026`).
3. Tunggu 1–2 detik. Semua angka di kartu ringkasan dan tabel di bawah akan
   ter-update otomatis.

> **Lihat catatan**: kalau ganti bulan/tahun tapi data Rekapan tidak berubah,
> lihat [§14 Known Issues](#14-known-issues--patch) untuk fix.

### 8.2. Override "Hari Efektif"

Secara default sistem menghitung hari efektif = jumlah hari unik yang ada
minimal satu tap di bulan tersebut. Kalau Anda ingin pakai angka manual
(misal: hari efektif sekolah = 22 hari menurut kalender pendidikan):

- Ketik angka `22` di kotak **HARI EFEKTIF** (sel E6/F6/G6).
- Persen kehadiran akan dihitung ulang berdasarkan 22 itu.

Untuk kembali ke otomatis: **kosongkan** sel itu (klik → Delete).

### 8.3. Membaca 4 kartu ringkasan

| Kartu | Arti |
|---|---|
| **TOTAL TERDAFTAR** | Jumlah orang di `Data_Induk` yang punya nama (UID terisi tapi nama kosong tidak dihitung). |
| **HADIR HARI INI** | Jumlah orang yang sudah tap hari ini (sampai jam saat dilihat). |
| **RATA-RATA KEHADIRAN BULAN INI** | Rata-rata `% Kehadiran` semua orang di Rekapan bulan terpilih. |
| **TERLAMBAT BULAN INI** | Total kejadian siswa terlambat di bulan terpilih. |

### 8.4. Membaca tabel bawah

Tabel di baris 13+ adalah duplikat dari `Rekapan` dengan tampilan lebih cantik.
Warna baris diselang-seling, % kehadiran berwarna sesuai threshold (hijau/
kuning/merah).

### 8.5. Chart

Chart batang di sebelah kanan menunjukkan **Total Hadir per Orang** untuk bulan
terpilih. Update otomatis saat data berubah.

---

## 9. Menambah / Mengedit Data Kartu

### 9.1. Menambah kartu baru

1. Tempelkan kartu baru ke alat ESP32 (kartu akan terbaca sebagai ASING).
2. UID akan muncul di LCD alat & di Serial Monitor.
3. Buka sheet **Data_Induk**.
4. Tambahkan baris baru:

| A (UID) | B (Nama) | C (Jabatan) | D (Kelas / Bidang) |
|---|---|---|---|
| `A1B2C3D4` | Ahmad Fauzi | Siswa | XII-IPA |

5. Save (Ctrl+S). Sel Z1 (versi) akan otomatis ter-update.
6. **Reboot ESP32** (cabut-colok USB) — saat boot, ESP32 akan download data
   terbaru.

### 9.2. Mengedit nama/kelas/jabatan

Edit langsung sel di `Data_Induk`. Versi auto-update, ESP32 akan baca data
baru saat boot berikutnya.

> Catatan: **data yang sudah terlanjur tercatat di Data_Mentah dengan nama lama
> TIDAK ikut berubah**. Yang berubah hanya tap-tap setelah edit.

### 9.3. Menghapus kartu

Hapus baris di `Data_Induk`. Tap berikutnya dengan UID itu akan terdeteksi
sebagai **ASING**.

### 9.4. Kartu asing yang sudah ditandai kuning

Saat ada tap asing, kalau Anda mau, Anda bisa **promote** UID itu jadi kartu
terdaftar: cukup edit kolom Nama/Jabatan/Kelas di `Data_Induk` (kalau UID-nya
belum ada di sana, tambahkan manual dulu).

Fungsi `tambahkanUIDBaru_()` di kode sebenarnya menambahkan UID asing otomatis
ke `Data_Induk` dengan baris kuning — **tetapi fungsi ini tidak dipanggil
dari `catatTap_()` di v8** (sengaja, agar admin yang memutuskan). Kalau ingin
auto-add, tambahkan panggilan `tambahkanUIDBaru_(uid)` di blok `if (asing)`
pada fungsi `catatTap_`.

---

## 10. Memahami Kode Apps Script

### 10.1. Struktur file

```
Code.gs
├── KONSTANTA                              ← TIMEZONE, nama sheet, VERSI_CELL
├── HELPER OUTPUT
│   ├── jsonOut_(obj)                     ← bungkus JSON response
│   └── textOut_(s)                       ← bungkus plain text response
├── doGet(e)                              ← ENTRY POINT (dipanggil ESP32)
├── catatTap_(params)                     ← handler ?aksi=tap
├── tambahkanUIDBaru_(uid)                ← (helper, tidak otomatis dipanggil)
├── kirimDataInduk_()                     ← handler ?aksi=induk
├── updateVersi_() / bacaVersi_()         ← manage cell Z1
├── pasangTriggerOnEdit()                 ← install trigger
├── handleEditInduk(e)                    ← trigger handler
├── setupSpreadsheet()                    ← bikin semua 6 sheet
├── buatSheet_DataMentah(ss)              ← builder per sheet
├── buatSheet_DataInduk(ss)
├── buatSheet_LaporanHarian(ss)
├── buatSheet_LaporanSiswa(ss)
├── buatSheet_Rekapan(ss)
├── buatSheet_Dashboard(ss)
├── columnLetterToNumber(letter)          ← helper kecil
├── buatChartDashboard()                  ← bikin chart
└── UTILITAS
    ├── bersihkanDataMentah()
    ├── paksaUpdateVersi()
    ├── resetFilterBulanIni()
    └── balikUrutanDataMentah()
```

### 10.2. Alur eksekusi tap

```
ESP32 kirim:
  GET /exec?aksi=tap&uid=A1B2C3D4&nama=Ahmad+Fauzi&jabatan=Siswa
            &kelas=XII-IPA&tap=2026-05-21+08:30:15&asing=0
                            │
                            ▼
                    doGet(e) dipanggil
                            │
                            ▼
              aksi === 'tap' → catatTap_(e.parameter)
                            │
                            ▼
        Parse parameter, uppercase UID, parse tap → tapDate
                            │
                            ▼
              Hitung hari dalam bahasa Indonesia (Senin/Selasa/...)
                            │
                            ├── asing=1 → tulis ke Data_Mentah
                            │             dengan nama/jabatan/kelas kosong
                            │             return "OK-ASING"
                            │
                            └── asing=0 → tulis ke Data_Mentah
                                          dengan data lengkap
                                          return "OK"
                            │
                            ▼
        Apps Script otomatis mengembalikan response ke ESP32
                            │
                            ▼
              ESP32 baca response, kalau "OK..." → hapus dari antrian
```

### 10.3. Mengapa pakai `insertRowAfter(1)`?

```javascript
sheetMentah.insertRowAfter(1);
sheetMentah.getRange(2, 1, 1, 9).setValues([[...]]);
```

Ini menyisipkan baris baru di **posisi 2** (tepat di bawah header), sehingga
tap terbaru selalu di atas. Lebih nyaman untuk admin yang lihat — tidak perlu
scroll ke baris terakhir.

Alternatif `appendRow()` lebih cepat tapi tap baru akan di bawah.

### 10.4. Format kolom

Setiap tap juga set number format kolom A, B, D, E supaya tampilan rapi:

```javascript
sheetMentah.getRange(2, 1).setNumberFormat('dd/MM/yyyy HH:mm:ss');
sheetMentah.getRange(2, 2).setNumberFormat('dd/MM/yyyy HH:mm:ss');
sheetMentah.getRange(2, 4).setNumberFormat('yyyy-MM-dd');
sheetMentah.getRange(2, 5).setNumberFormat('HH:mm:ss');
```

Tanpa ini, Google Sheets bisa nge-tampilin sebagai angka serial (45000.354221).

---

## 11. Mekanisme Versi & Trigger onEdit

### 11.1. Kenapa perlu versi?

ESP32 cache data kartu di flash supaya boot cepat. Tapi kalau admin edit
`Data_Induk` di Sheets, ESP32 tidak tahu. Solusinya:

- Setiap perubahan `Data_Induk` → trigger `handleEditInduk` jalan → update sel
  Z1 dengan timestamp baru.
- ESP32 di-cek tiap boot: panggil `?aksi=versi`, bandingkan dengan versi yang
  tersimpan. Kalau beda, panggil `?aksi=induk` untuk re-download.

> Di v7 firmware ESP32, perbandingan versi belum diimplementasi — ESP32 selalu
> re-download setiap boot online. Tapi mekanisme versi tetap berguna untuk
> ekspansi di firmware berikutnya.

### 11.2. Cara kerja trigger onEdit

```javascript
function handleEditInduk(e) {
  if (!e || !e.range) return;
  if (e.range.getSheet().getName() !== SHEET_INDUK) return;  // hanya Data_Induk
  var col = e.range.getColumn();
  if (col < 1 || col > 4 || col >= 26) return;               // hanya kolom A-D
  if (e.range.getRow() < 2) return;                          // skip header
  updateVersi_();                                            // set Z1 = now
}
```

Filter ketat: hanya edit di kolom A-D baris 2+ yang men-trigger update versi.
Ini menghindari false trigger saat admin edit kolom helper di Y/Z.

### 11.3. Pasang trigger manual

Trigger tidak terinstall otomatis saat paste kode. Harus jalankan
`pasangTriggerOnEdit()` minimal sekali.

Untuk lihat / hapus trigger manual:
- Apps Script Editor → ikon jam ⏰ (Triggers) di sidebar kiri.

---

## 12. Fungsi Utilitas

Fungsi-fungsi berikut bisa dijalankan **manual** dari Apps Script Editor untuk
maintenance.

### `bersihkanDataMentah()`
Menghapus seluruh isi `Data_Mentah` (kecuali header). Berguna di awal semester
atau setelah testing.

**Cara jalankan**: dropdown function → `bersihkanDataMentah` → Run.

### `paksaUpdateVersi()`
Set ulang sel Z1 = timestamp now. Pakai kalau Anda yakin data sudah berubah
tapi trigger gagal jalan.

### `resetFilterBulanIni()`
Mengembalikan filter Dashboard ke bulan dan tahun saat ini, dan kosongkan
override hari efektif.

> Catatan: fungsi ini menulis ke sel `A6:B6` dan `C6:D6` di Dashboard, yang
> merupakan sel input. Lihat [§14 Known Issues](#14-known-issues--patch)
> tentang Rekapan yang membaca dari B4/D4 — kalau Anda apply patch tersebut,
> fungsi ini akan otomatis bekerja dengan benar.

### `balikUrutanDataMentah()`
Membalik urutan baris di `Data_Mentah` — yang lama jadi di atas, yang baru di
bawah. Jarang dipakai, hanya kalau Anda butuh urutan kronologis untuk export.

> Setelah balik, tap berikutnya tetap akan ditulis di baris 2 (paling atas),
> jadi sebaiknya jalankan ini di waktu non-aktif (sekolah libur).

---

## 13. Troubleshooting

### Apps Script: tombol "Run" loading terus / timeout

- Apps Script punya batas eksekusi **6 menit** per request (Workspace) atau
  **30 detik** untuk doGet/doPost.
- Setup awal kadang lama karena bikin banyak sheet sekaligus.
- Solusi: tunggu, atau jalankan builder per sheet manual (`buatSheet_DataInduk`,
  dst) satu per satu.

### "Authorization required" terus

- Klik **Review permissions**, pilih akun, **Advanced → Go to ... (unsafe)**,
  **Allow**.
- Kalau workspace sekolah memblokir, coba akun Gmail pribadi dulu untuk
  testing.

### Setup selesai tapi sheet `Dashboard` blank / error

- Pastikan urutan jalankan: `setupSpreadsheet` **dulu**, baru
  `buatChartDashboard`. Kalau dibalik, Dashboard belum ada, chart akan error.
- Cek log: Apps Script Editor → **View → Logs** (atau Cmd/Ctrl+Enter).

### Tap masuk ke Data_Mentah tapi tidak muncul di Laporan_Harian

- Rumus QUERY di Laporan_Harian!A2 sensitif terhadap kolom kosong.
- Cek apakah kolom **D, F, G, H, I** di Data_Mentah terisi semua untuk tap itu.
- Kalau tap ASING, kolom G/H/I kosong → tidak akan masuk Laporan_Harian
  (sesuai desain — kartu asing tidak masuk laporan).

### Status di Laporan_Harian salah (semua "Terlambat" atau semua "Hadir")

- Cek format kolom B (Jam Masuk) — harus `HH:mm:ss`, bukan teks.
- Kalau tap_asli di Data_Mentah berformat aneh (kolom E), rumus
  `TIMEVALUE(TEXT(B2,...))` akan gagal dan default ke "Terlambat".

### Rekapan kosong / 0 semua padahal ada data

Ini berhubungan dengan [Known Issues §14](#14-known-issues--patch). Singkat:
sel filter Rekapan!Z2 = `Dashboard!B4`, tapi input filter di Dashboard ada di
baris 6, bukan baris 4. Apply patch di §14 untuk fix.

### Dashboard menampilkan periode salah

Edit di sel input yang tepat:
- **A6** atau **B6** (merge) untuk bulan
- **C6** atau **D6** (merge) untuk tahun

Jangan edit di baris 4 atau 5 — itu cuma label & instruksi.

### ESP32 tap berhasil tapi response "ERROR..."

Buka URL deployment manual di browser:
```
https://script.google.com/macros/s/GSCRIPT_ID/exec?aksi=tap&uid=TES&tap=2026-05-21+10:00:00&asing=1
```

- Kalau response "OK-ASING" → backend sehat, masalah di ESP32.
- Kalau "ERROR: sheet Data_Mentah tidak ada" → setup belum dijalankan, atau
  sheet sudah dihapus manual.

### Setelah edit kode, ESP32 tetap dapat hasil lama

Anda lupa **re-deploy** (lihat §6.3). Save saja tidak cukup untuk Web App.

### Quota exceeded

Google Workspace gratis punya kuota:
- **20.000 execution / day**
- **6 menit / execution**
- **HTML/JSON service requests: 20.000 / day**

Untuk sekolah ±500 tap/hari + cek versi tiap 5 detik dari ESP32, masih aman.
Tapi kalau ada 10+ ESP32 yang ramai polling, bisa kena limit.

---

## 14. Known Issues & Patch

### Issue #1: Rekapan baca filter dari sel yang salah

**Masalah**: Fungsi `buatSheet_Rekapan()` menulis rumus:
```javascript
s.getRange('Z2').setFormula('=Dashboard!B4');  // bulan
s.getRange('Z3').setFormula('=Dashboard!D4');  // tahun
s.getRange('Z4').setFormula('=Dashboard!F4');  // override
```

Tapi fungsi `buatSheet_Dashboard()` meletakkan **sel input filter** di:
- **A6:B6** (merge) untuk bulan
- **C6:D6** (merge) untuk tahun
- **E6:G6** (merge) untuk override

Sel `B4`, `D4`, `F4` di Dashboard berada di dalam merge `A4:J4` yang berisi
teks instruksi (`✏️ GANTI PERIODE DI BAWAH INI ...`), bukan angka.

**Akibat**: `VALUE("")` error → SUMPRODUCT di Rekapan return 0 → semua
"Total Hadir" jadi 0 meskipun data ada.

**Patch (mudah, 2 menit)**:

Buka Apps Script Editor, ubah 3 baris di `buatSheet_Rekapan()`:

```javascript
// SEBELUM (salah):
s.getRange('Z2').setFormula('=Dashboard!B4');
s.getRange('Z3').setFormula('=Dashboard!D4');
s.getRange('Z4').setFormula('=Dashboard!F4');

// SESUDAH (benar):
s.getRange('Z2').setFormula('=Dashboard!A6');
s.getRange('Z3').setFormula('=Dashboard!C6');
s.getRange('Z4').setFormula('=Dashboard!E6');
```

Lalu jalankan ulang `setupSpreadsheet()` (akan recreate semua sheet) **atau**
buka manual sheet Rekapan, ke sel Z2, ganti rumusnya ke `=Dashboard!A6`,
lakukan sama untuk Z3 dan Z4.

### Issue #2: Pesan popup setup masih sebut "B4/D4/F4"

Pesan alert di `setupSpreadsheet()` berkata:
> • Ganti bulan → ketik angka di sel B4 (contoh: 5)

Padahal input sebenarnya di **B6** (baris 6, bukan 4). Sekedar typo di pesan,
tidak ada efek fungsional — tapi membingungkan pengguna baru.

**Patch (opsional)**: di `setupSpreadsheet()`, ganti `B4`→`B6`, `D4`→`D6`,
`F4`→`F6` di string alert.

### Issue #3: Kartu ASING tidak otomatis masuk Data_Induk

Fungsi `tambahkanUIDBaru_()` ada di kode, tapi **tidak dipanggil** dari
`catatTap_()`. Jadi kartu ASING hanya tercatat di Data_Mentah dan tidak
muncul di Data_Induk untuk admin edit.

**Apakah ini bug?** Sengaja dibuat begini di v8 — keputusan admin apakah
UID asing mau didaftarkan. Tapi kalau ingin auto-add:

```javascript
// Di dalam catatTap_(), block "if (asing)", tambahkan baris:
if (asing) {
  tambahkanUIDBaru_(uid);   // ← tambahkan baris ini
  sheetMentah.insertRowAfter(1);
  // ... sisanya tetap sama
}
```

---

## 15. Maintenance & Update

### Backup berkala (sangat penting)

| Item | Frekuensi | Cara |
|---|---|---|
| **Spreadsheet** | Otomatis oleh Google | Versi history: File → Version history |
| **Code.gs** | Setiap edit | Copy seluruh isi → simpan ke file `Code.gs` di repo GitHub |
| **Deployment ID** | Saat deploy pertama | Catat di README internal |
| **Export CSV** | Akhir semester / akhir tahun | File → Download → CSV, simpan di Drive |

### Update kode

1. Edit di Apps Script Editor.
2. **Save** (Ctrl+S).
3. **Deploy → Manage deployments → ikon pensil → Version: New version → Deploy**.
4. URL tetap sama, ESP32 tidak perlu di-upload ulang.

### Migrasi ke spreadsheet baru

1. Buat spreadsheet baru, ulangi §5 (Setup Awal).
2. **Copy isi** sheet `Data_Induk` lama ke yang baru (Ctrl+C → Ctrl+V).
3. **Copy isi** sheet `Data_Mentah` lama kalau ingin retain history.
4. Deploy script baru, dapat GSCRIPT_ID baru.
5. Upload ulang ESP32 dengan GSCRIPT_ID baru.

### Performa & kebersihan

`Data_Mentah` akan terus membesar. Tip:
- **Akhir tahun ajaran**: jalankan `bersihkanDataMentah()`. Sebelumnya
  download CSV dulu untuk arsip.
- **Per semester**: filter manual di sheet, copy baris semester selesai
  ke spreadsheet arsip terpisah.

Rumus QUERY di Laporan_Harian akan **melambat** kalau Data_Mentah > 10.000 baris.
Untuk sekolah ±500 orang × 200 hari tap, ini setara ~2 tahun penuh.

---

## 16. FAQ

**Q: Apakah Apps Script bisa diakses tanpa internet?**
A: Tidak. Apps Script berjalan di server Google. Tapi ESP32 punya cache lokal
untuk Data_Induk, dan antrian tap, sehingga sistem tetap berfungsi tanpa
internet — tap akan tersinkronisasi nanti.

**Q: Bisakah saya pakai Sheets API langsung dari ESP32, tanpa Apps Script?**
A: Secara teknis bisa, tapi butuh OAuth2 token refresh, yang memberatkan
ESP32. Apps Script Web App jauh lebih sederhana untuk skala ini.

**Q: Apakah aman? Endpoint kan "Anyone can access".**
A: "Anyone" artinya siapa saja yang **tahu URL** bisa kirim request. URL berisi
GSCRIPT_ID yang panjang (60+ karakter random) — praktis tidak ditebak. Risiko
nyata: kalau GSCRIPT_ID bocor (misal terlihat di Serial Monitor publik),
orang lain bisa kirim tap palsu. Untuk meningkatkan keamanan, tambahkan
parameter `&secret=KODE_RAHASIA` dan validasi di `doGet()`.

**Q: Berapa orang maksimal yang bisa diakomodasi?**
A: Spreadsheet dibatasi **10 juta sel total**. Untuk 50 orang × 200 hari ×
30 tap = 300.000 cells di Data_Mentah — masih jauh dari batas.

**Q: Apakah ada batas pemanggilan API?**
A: Iya, kuota Google Apps Script:
- 20.000 URL Fetch / hari (per akun gratis)
- Setiap ESP32 boot = ±3 panggilan (versi + induk + tes), tap = 1 panggilan
- 500 tap/hari + 5 reboot = 505 panggilan/hari → masih sangat jauh dari batas

**Q: Bisa kirim notifikasi WhatsApp/Email saat ada tap?**
A: Bisa, tambahkan di `catatTap_()`. Untuk email: `MailApp.sendEmail(...)`.
Untuk WhatsApp: butuh integrasi pihak ketiga (CallMeBot, Fonnte, dll) via
`UrlFetchApp.fetch()`.

**Q: Apakah Apps Script bisa otomatis bikin laporan PDF mingguan?**
A: Bisa, dengan time-based trigger + `DriveApp` untuk export PDF. Di luar
scope v8 tapi straightforward untuk ditambah.

**Q: Apakah bisa pakai database lain (MySQL, Firebase)?**
A: Bisa, tapi perlu rewrite seluruh `Code.gs` + arsitektur. Apps Script paling
mudah untuk pemula karena tidak perlu server sendiri.

---

## Lampiran A: Quick Reference

### URL endpoints

```text
# Cek versi (untuk uji deployment)
https://script.google.com/macros/s/GSCRIPT_ID/exec?aksi=versi

# Download daftar kartu
https://script.google.com/macros/s/GSCRIPT_ID/exec?aksi=induk

# Simulasi tap (untuk debug)
https://script.google.com/macros/s/GSCRIPT_ID/exec?aksi=tap&uid=TES&nama=Tes&jabatan=Siswa&kelas=XII-A&tap=2026-05-21+10:00:00&asing=0

# Simulasi tap asing
https://script.google.com/macros/s/GSCRIPT_ID/exec?aksi=tap&uid=UNKNOWN&tap=2026-05-21+10:00:00&asing=1
```

### Order of operations (urutan jalankan fungsi)

```text
1. setupSpreadsheet()          ← bikin 6 sheet, sekali saja
2. pasangTriggerOnEdit()       ← install trigger versi
3. buatChartDashboard()        ← bikin chart di Dashboard
4. Deploy → New Deployment → Web App (Anyone)
5. Copy GSCRIPT_ID ke ESP32 firmware
```

### Sel-sel penting

```text
Dashboard!A6 (atau B6)    → filter BULAN (1-12)
Dashboard!C6 (atau D6)    → filter TAHUN (2025, 2026, ...)
Dashboard!E6 (atau F6/G6) → override HARI EFEKTIF (kosongkan = otomatis)

Data_Induk!Z1             → angka versi (otomatis, jangan diedit)

Rekapan!Z2                → bulan (mirror Dashboard) — lihat Known Issue #1
Rekapan!Z3                → tahun
Rekapan!Z4                → override
```

### Tabel referensi sheet

```text
Data_Mentah     ← ditulis oleh ESP32 (paling baru di atas)
Data_Induk      ← diedit manual oleh admin
Laporan_Harian  ← otomatis (QUERY dari Data_Mentah)
Laporan_Siswa   ← otomatis (filter Laporan_Harian, Jabatan=Siswa)
Rekapan         ← otomatis (per orang dari Data_Induk, count tap di bulan)
Dashboard       ← otomatis (4 kartu + tabel duplikat Rekapan + chart)
```

---

## Kredit

**Sekolah**: MA Nurul Huda Mergosono, Malang
**Versi backend**: v8 (Dashboard Simpel)
**File**: `Code.gs` (Google Apps Script)
**Pasangan firmware**: `Presensi_RFID_v7.ino` (ESP32)

Untuk pertanyaan teknis tentang backend ini, lihat komentar inline di
`Code.gs` atau buka issue di repository GitHub.

---

*Dokumen ini bersifat hidup — update setiap kali ada perubahan di Code.gs
atau struktur sheet. Simpan bersama `README.md` (ESP32) dan file `Code.gs`
di repository yang sama.*
