# Sistem Presensi RFID — MA Nurul Huda Mergosono

Sistem absensi siswa berbasis kartu RFID untuk MA Nurul Huda Mergosono, Malang.
Dibangun di atas **ESP32 dual-core** dengan arsitektur **offline-first**: tap kartu
tetap berfungsi saat WiFi atau server mati. Semua tap disimpan ke flash dan dikirim
otomatis ke **Firebase Realtime Database** begitu koneksi kembali.

> **Firmware**: v12.0.1 — file sketch `presensiV2`
> **Hardware**: ESP32 + MFRC522 + LCD I2C 16×2 + Buzzer
> **Backend**: Firebase Realtime Database (paket gratis Spark) lewat REST API HTTPS
> **Lisensi**: Internal — MA Nurul Huda Mergosono

---

## Daftar Isi

1. [Ringkasan](#1-ringkasan)
2. [Fitur Utama](#2-fitur-utama)
3. [Arsitektur](#3-arsitektur)
4. [Hardware & Wiring](#4-hardware--wiring)
5. [Persiapan Software](#5-persiapan-software)
6. [Persiapan Firebase](#6-persiapan-firebase)
7. [Konfigurasi Firmware](#7-konfigurasi-firmware)
8. [Upload & Boot](#8-upload--boot)
9. [Aturan Presensi](#9-aturan-presensi)
10. [Penggunaan Harian](#10-penggunaan-harian)
11. [Perintah Jarak Jauh dari Web](#11-perintah-jarak-jauh-dari-web)
12. [Struktur Data Firebase](#12-struktur-data-firebase)
13. [Penyimpanan Lokal (LittleFS)](#13-penyimpanan-lokal-littlefs)
14. [Memahami Kode](#14-memahami-kode)
15. [Troubleshooting](#15-troubleshooting)
16. [Keamanan](#16-keamanan)
17. [Riwayat Versi](#17-riwayat-versi)

---

## 1. Ringkasan

1. Setiap siswa memiliki **kartu RFID** dengan UID unik.
2. Saat kartu ditempelkan, ESP32 mencari UID di data lokal, mengecek **jadwal**
   (masuk / terlambat / pulang) sesuai kelas dan hari, lalu menampilkan hasil di LCD
   dan membunyikan buzzer.
3. Tap dimasukkan ke antrian di flash, lalu dikirim ke Firebase oleh task terpisah.
4. Admin mengelola siswa, jadwal, dan memantau alat lewat **aplikasi web** yang
   membaca database Firebase yang sama.
5. Data siswa/jadwal yang diubah admin diunduh ulang alat **otomatis** — tanpa restart.

---

## 2. Fitur Utama

| Fitur | Penjelasan |
|---|---|
| **Dual-core** | Satu core khusus RFID + LCD + buzzer (respons < 50 ms), core lain untuk WiFi + NTP + Firebase. Jaringan lambat tidak pernah menahan tap. |
| **Offline-first** | Tap disimpan ke antrian di LittleFS (tahan mati lampu), dikirim saat online. Alat bisa boot tanpa internet bila cache sudah ada. |
| **Jadwal per kelas & hari** | Batas jam masuk/terlambat/pulang diambil dari `config/schedule`; ada nilai default bila jadwal tidak ada atau tidak valid. |
| **Satu koneksi HTTPS keep-alive** | Tap, status, dan perintah memakai satu sesi TLS; handshake hanya saat koneksi putus. |
| **Kirim idempoten** | Tiap tap ditulis ke kunci tetap, sehingga pengiriman ulang tidak membuat data ganda. |
| **Auto-refresh data** | Mengecek `config/version` tiap 60 detik; bila berubah, data siswa & jadwal diunduh ulang. |
| **Heartbeat** | Status alat (IP, RSSI, heap, antrian, versi, uptime, dll.) dikirim tiap 60 detik ke `device/status`. |
| **Perintah dari web** | Restart, sync data, tes buzzer, tampil teks di LCD, diagnostik — dengan balasan (ack). |
| **Dead-letter & ditolak** | Kiriman yang gagal 5× masuk `dead.jsonl` (dicoba ulang tiap 1 jam); yang ditolak server masuk `ditolak.jsonl`. |
| **State harian tahan reboot** | Status tap hari ini disimpan di flash, jadi reboot tidak membuka peluang tap ganda. |
| **Kartu asing dicatat** | UID tak terdaftar dicatat ke `unknown/{tanggal}` (sekali per UID per hari). |
| **Hari Minggu libur** | Tap pada hari Minggu ditolak dengan pesan "Hari Libur". |
| **Catatan gangguan** | Boot, WiFi putus/pulih, jadwal fallback dicatat ke `device/events`. |

---

## 3. Arsitektur

```
┌──────────────────────────────────────────────────────────────┐
│                       ESP32 (Dual-Core)                      │
│                                                              │
│  ┌──────────────────────┐       ┌──────────────────────┐     │
│  │ CORE_PRESENSI (=1)   │       │ CORE_JARINGAN (=0)   │     │
│  │ prioritas 2          │       │ prioritas 1          │     │
│  │ • Baca RFID          │       │ • WiFi reconnect     │     │
│  │ • State machine tap  │       │ • NTP                │     │
│  │ • LCD + buzzer       │       │ • Login Firebase     │     │
│  │ • Tulis antrian      │       │ • Kirim antrian      │     │
│  │ • Self-check RFID/LCD│       │ • Heartbeat, perintah│     │
│  └─────────┬────────────┘       │ • Cek versi data     │     │
│            │ uiQueue (RAM) ◄────┤ • Retry dead-letter  │     │
│            │                    └──────────┬───────────┘     │
│            └────────►┌────────────┐◄────────┘                │
│                      │ LittleFS   │                          │
│                      │ queue.jsonl│                          │
│                      │ induk12.json…                         │
│                      └────────────┘                          │
└───────────────────────────────┬──────────────────────────────┘
                                │ HTTPS (REST)
                                ▼
                ┌───────────────────────────────┐
                │ Firebase Auth (login alat)    │
                │ Firebase Realtime Database    │◄── Aplikasi web admin
                └───────────────────────────────┘
```

Kedua core hanya bertukar data lewat **antrian di flash** (tap) dan **`uiQueue` di RAM**
(perintah LCD/buzzer dari web). LCD dan buzzer hanya disentuh core presensi.

Sinkronisasi memakai tiga mutex: `mutexLCD`, `mutexQueue`, dan `mutexData`
(melindungi `daftarKartu`/`daftarJadwal`/`stateSiswa` saat data dimuat ulang —
tap yang datang saat reload akan menampilkan "Memuat data… Tap lagi").

> Pembagian core bisa dibalik (presensi di core 0) dengan mengubah `CORE_PRESENSI`
> dan `CORE_JARINGAN` di bagian konfigurasi. Default v12: jaringan di core 0 karena
> driver WiFi Arduino-ESP32 berjalan di sana.

---

## 4. Hardware & Wiring

### Daftar komponen

| Komponen | Spesifikasi | Jumlah |
|---|---|---|
| ESP32 DevKit | ESP32-WROOM-32, 38 pin | 1 |
| MFRC522 | RFID 13.56 MHz | 1 |
| LCD 16×2 I2C | Backpack PCF8574, alamat **0x27** | 1 |
| Buzzer aktif | 3–5 V, aktif HIGH | 1 |
| Kartu RFID Mifare | 13.56 MHz (S50/1K) | sebanyak siswa |
| Adaptor 5 V 2 A | + kabel USB | 1 |

### Pin

| Perangkat | Pin perangkat | ESP32 |
|---|---|---|
| MFRC522 | VCC | **3.3V** (JANGAN 5 V) |
| | GND | GND |
| | RST | GPIO 4 |
| | SDA / SS | GPIO 5 |
| | SCK | GPIO 18 |
| | MOSI | GPIO 23 |
| | MISO | GPIO 19 |
| LCD I2C | VCC | **5V (VIN)** |
| | GND | GND |
| | SDA | GPIO 21 |
| | SCL | GPIO 22 |
| Buzzer | + | GPIO 15 |
| | − | GND |

### Checklist sebelum menyalakan

- [ ] MFRC522 ke **3.3V**, bukan 5 V (modul rusak permanen bila salah).
- [ ] Semua GND tersambung.
- [ ] LCD ke **5V**; di 3.3 V layar redup/tidak tampil.
- [ ] MISO/MOSI tidak tertukar.
- [ ] Buzzer **+** ke GPIO 15.

---

## 5. Persiapan Software

1. Install **Arduino IDE 2.x**.
2. Tambahkan board ESP32 di *File → Preferences → Additional Boards Manager URLs*:
   `https://espressif.github.io/arduino-esp32/package_esp32_index.json`
   lalu install **esp32 by Espressif** (core 2.x atau 3.x) lewat Boards Manager.
3. Install driver USB (CP2102 / CH340) bila port COM tidak muncul.

### Library

| Library | Keterangan |
|---|---|
| **MFRC522** (Miguel Balboa) | Driver reader RFID |
| **LiquidCrystal I2C** | Driver LCD 16×2 I2C |
| **ArduinoJson** 6.x / 7.x | Parsing & serialisasi JSON |

Bawaan core ESP32 (tidak perlu install): `WiFi`, `WiFiClientSecure`, `HTTPClient`,
`SPI`, `Wire`, `LittleFS`, `time`.

### Pengaturan board

| Pengaturan | Nilai |
|---|---|
| Board | ESP32 Dev Module |
| Partition Scheme | **Default 4MB with spiffs** (atau lebih besar) — wajib ada partisi FS |
| Upload Speed | 921600 (turunkan ke 115200 bila gagal) |
| Serial Monitor | 115200 baud |

---

## 6. Persiapan Firebase

1. Buat project di [Firebase Console](https://console.firebase.google.com) (paket Spark/gratis).
2. Aktifkan **Realtime Database** dan catat URL-nya
   (contoh: `https://<project>-default-rtdb.<region>.firebasedatabase.app`).
3. Aktifkan **Authentication → Email/Password**.
4. Buat **akun khusus alat** (mis. `esp32-01@device.<project>.local`) beserta password.
5. Catat **Web API Key** di *Project settings → General*.
6. Pasang **Security Rules** yang memberi akun alat hak:
   - baca `config/*` dan `device/inbox`;
   - tulis `attendance`, `log`, `unknown`, `device/status`, `device/ack`, `device/events`.

   Aturan validasi (mis. format tanggal) boleh ditambahkan — alat membedakan penolakan
   validasi (`ditolak.jsonl`) dari akun yang belum diberi peran (dicoba ulang).
7. Isi data awal di `config/students`, `config/schedule`, dan `config/version`
   (lihat [bagian 12](#12-struktur-data-firebase)), biasanya lewat aplikasi web admin.

---

## 7. Konfigurasi Firmware

Buka `presensiV2` dan isi blok `KONFIGURASI — WAJIB DIISI`:

```cpp
const char* WIFI_SSID        = "NAMA_WIFI";
const char* WIFI_PASSWORD    = "PASSWORD_WIFI";
const char* FIREBASE_API_KEY = "WEB_API_KEY";
const char* FIREBASE_DB_URL  = "https://<project>-default-rtdb.<region>.firebasedatabase.app"; // tanpa "/" di akhir
const char* DEVICE_EMAIL     = "esp32-01@device.<project>.local";
const char* DEVICE_PASSWORD  = "PASSWORD_AKUN_ALAT";
```

### Parameter lain

| Konstanta | Default | Penjelasan |
|---|---|---|
| `FIRMWARE_VERSION` | `v12.0.1` | Dilaporkan ke `device/status` |
| `CORE_PRESENSI` / `CORE_JARINGAN` | `1` / `0` | Penempatan task |
| `GMT_OFFSET` | `7*3600` | WIB. WITA `8*3600`, WIT `9*3600` |
| `MAX_KARTU` | `500` | Kapasitas kartu di RAM (kartu berlebih dilewati, ada peringatan) |
| `MAX_JADWAL` | `80` | Kapasitas baris jadwal |
| `MAX_ASING_HARIAN` | `50` | Kartu asing unik yang diingat per hari |
| `BOOT_WIFI_TIMEOUT_MS` | 15 000 | Batas tunggu WiFi saat boot |
| `BOOT_NTP_TIMEOUT_MS` | 8 000 | Batas tunggu NTP saat boot |
| `HTTP_TIMEOUT_MS` | 15 000 | Timeout request HTTPS |
| `INTERVAL_STATUS_MS` | 60 000 | Interval heartbeat |
| `INTERVAL_VERSI_MS` | 60 000 | Interval cek `config/version` |
| `INTERVAL_DEAD_MS` | 1 jam | Interval kirim ulang dead-letter |
| `POLL_CEPAT_MS` / `POLL_NORMAL_MS` | 2 dtk / 10 dtk | Interval cek perintah |
| `WATCHING_BERLAKU_MS` | 90 000 | Masa berlaku tanda "halaman Perangkat dibuka" |
| `PERINTAH_KEDALUWARSA` | 5 menit | Perintah lebih tua dari ini diabaikan |
| Pin | SS 5, RST 4, Buzzer 15, I2C 21/22 | Ubah hanya bila wiring berbeda |

> ⚠️ Jangan commit kredensial asli ke repository publik (lihat [Keamanan](#16-keamanan)).

---

## 8. Upload & Boot

1. Sambungkan ESP32 lewat kabel USB **data**, pilih board & port, lalu **Upload**.
   (Beberapa board perlu menahan tombol BOOT saat `Connecting....`.)
2. Buka Serial Monitor 115200 baud.

### Urutan boot (6 langkah)

| Langkah | Proses |
|---|---|
| 1/6 LCD | Inisialisasi LCD, tampil versi firmware |
| 2/6 RFID | Inisialisasi MFRC522, cek `VersionReg` (`0x00`/`0xFF` = tidak terdeteksi) |
| 3/6 Flash | Mount LittleFS, bersihkan cache format lama & sisa unduhan, hitung antrian |
| 4/6 WiFi | Sambung WiFi (maks. 15 dtk). **Alat tanpa cache wajib online** — LCD "Tap Ditolak / Menunggu Sinyal" |
| 5/6 NTP | Sinkron waktu (maks. 8 dtk), WIB |
| 6/6 Firebase | Login, bandingkan `config/version`; bila sama pakai cache, bila beda unduh `config/students` & `config/schedule` |

Hasil akhirnya:

- **Online** — data terbaru dipakai.
- **Mode cache offline** — server tak terjangkau tapi cache ada; tap tetap diterima.
- **Belum ada data sama sekali** — alat menunggu server (LCD "Tap Ditolak").

Setelah itu dicatat event `Boot` ke `device/events`, dua task dijalankan, dan buzzer
berbunyi 2× pendek. LCD menampilkan `Tap kartu RFID`.

---

## 9. Aturan Presensi

### Batas waktu

Setiap kelas/hari memakai tiga baris jadwal dari `config/schedule`: **Masuk**,
**Terlambat**, **Pulang**. Pencocokan memprioritaskan entri spesifik (kelas **dan**
hari), baru ke entri umum (`"Semua"`).

Jadwal dianggap valid bila urutannya `masuk.mulai ≤ masuk.selesai < terlambat.mulai ≤
terlambat.selesai ≤ pulang.mulai ≤ pulang.selesai`. Bila tidak ada atau tidak valid,
dipakai **default bawaan** dan event `Jadwal_Fallback` dicatat (maks. 1×/menit):

| Fase | Default |
|---|---|
| Masuk (Hadir) | 07:00 – 07:15 |
| Terlambat | 07:16 – 14:10 |
| Pulang | 14:15 – 15:00 |

### Hasil tap

| Kondisi waktu | LCD | Buzzer | Dikirim? |
|---|---|---|---|
| Sebelum jam masuk | `Tap Terlalu Awal` | 3× pendek | Tidak |
| Jam masuk | nama / `Hadir <NIS>` | 1× panjang | Ya — status `Hadir` |
| Jam terlambat | nama / `Telat <NIS>` | 2× sedang | Ya — status `Terlambat` |
| Antara terlambat & pulang | `Akses Ditutup` | 3× pendek | Tidak |
| Jam pulang | nama / `Pulang <NIS>` | 1× panjang | Ya — field `pulang` |
| Setelah jam pulang | `Wkt Pulang Habis` | 3× pendek | Tidak |
| Tap masuk kedua kali | `Sudah Tap Masuk` | 3× pendek | Tidak |
| Tap pulang kedua kali | `Sudah Tap Pulang` | 3× pendek | Tidak |
| Hari Minggu | `Hari Libur` | 3× pendek | Tidak |
| Kartu tak terdaftar | `Tdk Terdaftar` + UID | 3× pendek | Ya — ke `unknown/` (sekali/hari/UID) |
| Waktu belum sinkron | `Waktu Tdk Valid` | 3× pendek | Tidak |

Kartu yang masih menempel tidak dibaca ulang terus-menerus (dideteksi sebagai satu tap
sampai kartu diangkat).

---

## 10. Penggunaan Harian

1. Colok adaptor — alat boot otomatis.
2. Siswa menempelkan kartu ke antena MFRC522.
3. LCD menampilkan hasil ±2 detik, lalu kembali ke `Tap kartu RFID`.

### Baris status LCD (baris ke-2)

| Tampilan | Arti |
|---|---|
| `[Online]` | WiFi & Firebase OK, antrian kosong |
| `[Antri N]` | Ada N tap menunggu kirim |
| `[Kirim N]` | Sedang mengirim, sisa N |
| `[Server?]` / `[Server? N]` | WiFi OK tapi login/server Firebase bermasalah |
| `[Offline]` / `[Offline N]` | WiFi mati; tap tetap tersimpan |
| `[Cache Lokal]` | Boot tanpa server, memakai cache |
| `[Menunggu...]` | Boot belum selesai |

### Menambah / mengubah siswa & jadwal

Lakukan lewat aplikasi web admin (mengubah `config/students`, `config/schedule`, dan
menaikkan `config/version`). Alat mengunduh ulang dalam ±60 detik, atau segera lewat
perintah **sync**. **Tidak perlu restart.**

Untuk mengetahui UID kartu baru: tempelkan ke alat — LCD menampilkan UID pada tampilan
`Tdk Terdaftar`, dan UID juga tertulis di Serial Monitor serta `unknown/`.

---

## 11. Perintah Jarak Jauh dari Web

Alat memeriksa `device/inbox` (tiap 10 dtk; **2 dtk** saat admin membuka halaman
Perangkat, ditandai field `watching`). Perintah yang sama tidak dijalankan dua kali (ID
terakhir disimpan di flash), dan perintah > 5 menit diabaikan. Setiap perintah dibalas
ke `device/ack/{id}`.

| `cmd` | `arg` | Efek |
|---|---|---|
| `buzzer` | — | Memainkan pola tes buzzer |
| `lcd` | `baris1\|baris2\|detik` | Tampilkan teks di LCD (detik 2–120, default 10) |
| `sync` | — | Unduh ulang data siswa & jadwal sekarang |
| `diagnostik` | — | Kirim laporan: RFID, LCD, WiFi, NTP, memori, flash, antrian, dan daftar masalah |
| `restart` | — | Restart ESP32 setelah 2 detik (antrian & state harian aman di flash) |

Diagnostik menandai masalah bila: RFID/LCD tak merespons, NTP belum sinkron, RSSI < −80 dBm,
blok heap terbesar < 40 KB, flash terpakai > 85 %, atau data siswa kosong.

---

## 12. Struktur Data Firebase

```
config/
  version                       ← timestamp (ms); naik saat data diubah admin
  students/{UID}                ← { nis, nama, kelas }
  schedule/{id}                 ← { kelas, hari, jenis, mulai, selesai }
                                   jenis: Masuk | Terlambat | Pulang
                                   kelas/hari boleh "Semua"; jam "HH:MM"
attendance/{NIS}/{yyyy-mm-dd}   ← { masuk, status, pulang }
log/{yyyy-mm-dd}/{UID}_M|_P     ← { jam, nis, nama, kelas, status }
unknown/{yyyy-mm-dd}/{UID}      ← { jam }
device/
  status                        ← heartbeat alat (ditimpa tiap 60 dtk)
  inbox/command                 ← { id, cmd, arg, ts }
  inbox/watching                ← timestamp halaman Perangkat dibuka
  ack/{id}                      ← { ok, hasil, ts, detail? }
  events                        ← log gangguan (push): { ts, jenis, detail }
```

Satu tap dikirim sebagai **satu PATCH multi-path atomik** di root, mengisi
`attendance/...` dan `log/...` sekaligus. `masuk`/`status` diisi saat tap masuk,
`pulang` saat tap pulang.

Field `device/status`: `lastSeen`, `ip`, `rssi`, `ssid`, `heap`, `heapMin`, `antrian`,
`dead`, `ditolak`, `kartu`, `jadwal`, `versiData`, `firmware`, `uptime`, `ntp`, `rfid`,
`flashUsed`, `flashTotal`.

Jenis event gangguan: `Boot`, `WiFi_Disconnect`, `WiFi_Reconnect`, `Jadwal_Fallback`.

### Penanganan hasil kirim

| Respons | Dianggap | Tindakan |
|---|---|---|
| 200 | Sukses | Baris dihapus dari antrian |
| 400 | Ditolak | Pindah ke `ditolak.jsonl` |
| 401 "Permission denied" | Ditolak *atau* akun alat belum berperan | Dibedakan lewat request uji ke `device/inbox` |
| Jaringan / token / 5xx | Sementara | Ulang; gagal 5× → `dead.jsonl` |

Token Firebase diperbarui otomatis (±55 menit). Bila email/password/API key ditolak,
alat berhenti mencoba cepat-cepat (jeda 10 menit) agar tidak membanjiri server.

---

## 13. Penyimpanan Lokal (LittleFS)

| File | Isi |
|---|---|
| `/induk12.json` | Cache `config/students` |
| `/jadwal12.json` | Cache `config/schedule` |
| `/versi12.txt` | Versi data terakhir yang dimuat |
| `/queue.jsonl` | Antrian tap/asing/gangguan (satu JSON per baris, append-only) |
| `/qpos.txt` | Offset baris antrian yang sudah terkirim |
| `/dead.jsonl` | Kiriman gagal 5× (dicoba ulang tiap 1 jam) |
| `/ditolak.jsonl` | Kiriman yang ditolak server |
| `/harian.log` | Status tap hari ini (`D <kodeHari>` + `UID status`) |
| `/lastcmd.txt` | ID perintah web terakhir |
| `/dl.tmp`, `/dl2.tmp` | Berkas unduhan sementara |

Data siswa diparse secara **streaming** dari flash (RAM konstan ±0,5 KB berapa pun
jumlah kartu), dan unduhan ditulis langsung ke flash tanpa ditampung di RAM.
Cache format lama (v10/v11) dihapus otomatis saat boot.

---

## 14. Memahami Kode

```
presensiV2
├── KONFIGURASI                 ← WiFi, Firebase, pin, interval
├── STRUCT & TYPEDEF            ← Kartu, JadwalRow, BatasJamSiswa, StateSiswa, UiPesan
├── OBJEK HARDWARE & STATE      ← mfrc522, lcd, flag volatile, mutex, uiQueue
├── LOGGING · LCD · BUZZER · HELPER
├── FIREBASE AUTH               ← firebaseLogin(), firebaseRefresh(), pastikanToken()
├── RTDB REST                   ← rtdbRequest(), rtdbUnduhKeFile() (keep-alive)
├── STREAMING PARSE             ← streamObject(), onKVInduk(), onKVJadwal()
├── QUEUE (flash)               ← tulisAntrian(), bacaBarisPertama(), hapusBarisPertama()
├── KIRIM ANTRIAN               ← kirimBarisAntrian(), klasifikasi()
├── STATUS & ACK                ← kirimStatus(), kirimAck()
├── STATE HARIAN                ← cekResetHarian(), pulihkanStateHarian()
├── MUAT / RELOAD DATA          ← unduhDataBaru(), pasangDataBaru()
├── STATE MACHINE SISWA         ← resolveBatasJamSiswa(), evaluasiWaktuSiswa(), prosesTapSiswa()
├── taskPresensi()  [CORE_PRESENSI]
├── PERINTAH WEB                ← prosesPerintah(), cekInbox(), jalankanDiagnostik()
├── taskJaringan()  [CORE_JARINGAN]
└── setup() / loop()            ← boot 6 langkah; loop() kosong
```

### Alur tap

```
Kartu ditempel → taskPresensi baca UID
   → waktu valid? (NTP)  → ambil mutexData
   → cekResetHarian → Minggu? → cariKartu(UID)
        ├─ dikenal → evaluasi jadwal → LCD + buzzer → antrekanTap() → /queue.jsonl
        └─ asing   → LCD + buzzer → antrekanAsing()
taskJaringan: antrianSisa > 0 → baca baris → PATCH/PUT ke Firebase
        ├─ OK       → hapus dari antrian
        ├─ Ditolak  → ditolak.jsonl
        └─ Gagal 5× → dead.jsonl (coba ulang tiap jam)
```

Urutan prioritas loop `taskJaringan`: (1) kirim antrian tap, (2) cek perintah web,
(3) heartbeat, (4) cek versi data, (5) requeue dead-letter.

---

## 15. Troubleshooting

| Gejala | Penyebab & solusi |
|---|---|
| LCD menyala tapi kosong | Putar trimpot kontras di modul I2C; pastikan VCC 5 V; coba alamat `0x3F` (`LiquidCrystal_I2C lcd(0x3F,16,2)`). |
| `MFRC522 tidak terdeteksi` | Cek wiring SPI (MISO/MOSI sering tertukar) dan VCC 3.3 V. `0x92`/`0x91` normal; `0x00`/`0xFF` = tidak terhubung/rusak. |
| Kartu tidak terbaca | Tempel rapat ke antena; hanya kartu 13.56 MHz (Mifare) yang didukung, bukan 125 kHz. |
| `Login Alat Gagal / Cek kredensial` | `DEVICE_EMAIL`, `DEVICE_PASSWORD`, atau `FIREBASE_API_KEY` salah; pastikan Email/Password Auth aktif dan akun alat ada. |
| `[Server?]` terus | Login/request gagal: cek internet, `FIREBASE_DB_URL` (tanpa `/` di akhir), dan Security Rules. |
| `Tap Ditolak / Data siswa kosong` | `config/students` / `config/schedule` kosong di Firebase — isi dari web admin. |
| `Waktu Tdk Valid` | NTP belum sinkron; periksa WiFi dan jangan blokir UDP 123. |
| Jam salah | Periksa `GMT_OFFSET` (WIB = `7*3600`). |
| Antrian tidak turun | Lihat log `[RTDB]`/`[NET]` di Serial Monitor; cek Security Rules dan isi `ditolak.jsonl`/`dead.jsonl` lewat diagnostik. |
| Request TLS gagal terus (kode −1) | Pastikan `rtdbClient.setInsecure()` terpanggil sebelum request pertama (sudah diperbaiki di v12.0.1) dan heap cukup (`maxblok` di log). |
| Kartu melebihi kapasitas | Peringatan `kartu melebihi MAX_KARTU`; naikkan `MAX_KARTU` bila RAM mencukupi. |
| Tap hari ini hilang setelah reboot | Seharusnya tidak; state dipulihkan dari `/harian.log`. Cek log `[STATE]`. |

---

## 16. Keamanan

- **Kredensial di kode**: `WIFI_PASSWORD`, `FIREBASE_API_KEY`, dan `DEVICE_PASSWORD` tertulis
  langsung di sketch. Jangan unggah nilai asli ke repository publik; jika sudah terlanjur,
  **ganti password akun alat** dan batasi API key.
- **Hak akses minimal**: akun alat hanya perlu menulis jalur presensi/perangkat dan membaca
  `config`. Atur lewat Security Rules, bukan mengandalkan kerahasiaan API key.
- **TLS**: koneksi memakai `setInsecure()` (sertifikat server tidak diverifikasi) demi hemat
  RAM dan menghindari kedaluwarsa sertifikat. Lalu lintas tetap terenkripsi, namun rentan
  terhadap serangan man-in-the-middle di jaringan yang tidak tepercaya.
- **UID kartu** tidak memiliki autentikasi kriptografi; kartu Mifare dapat di-clone.

---

## 17. Riwayat Versi

| Versi | Perubahan |
|---|---|
| **v12.0.1** | `rtdbClient.setInsecure()` dipanggil sebelum request RTDB pertama di `setup()` (sebelumnya TLS gagal di boot). |
| **v12.0** | Migrasi Google Apps Script → Firebase RTDB (REST). Satu koneksi HTTPS keep-alive; tap multi-path atomik; perintah web + ack; heartbeat; auto-refresh data via `config/version`; perbaikan `requeueDeadLetter` yang bisa menghilangkan tap baru. |
| v7–v11.1 | Versi berbasis Google Apps Script + Google Sheets (arsitektur dual-core, antrian offset, dead-letter, state harian tahan reboot, jadwal per kelas). |

> File `spreadsheet.gs` di repository adalah backend Apps Script versi lama (v8) dan
> **tidak dipakai** oleh firmware v12.

---

**Sekolah**: MA Nurul Huda Mergosono, Malang
**Lisensi**: Internal, untuk keperluan sekolah.
