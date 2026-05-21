# Sistem Presensi RFID — MA Nurul Huda Mergosono

Sistem absensi berbasis kartu RFID untuk MA Nurul Huda Mergosono, Malang.
Dibangun di atas **ESP32 dual-core** dengan arsitektur **offline-first**:
tap kartu tetap berfungsi meskipun WiFi atau Google Sheets sedang mati,
semua tap disimpan ke flash dan dikirim otomatis saat koneksi kembali.

> **Versi**: 7 (Dual-Core FreeRTOS, clean rewrite)
> **Hardware**: ESP32 + MFRC522 + LCD I2C 16×2 + Buzzer
> **Backend**: Google Apps Script + Google Sheets
> **Lisensi**: Internal — MA Nurul Huda Mergosono

---

## Daftar Isi

1. [Apa yang Dilakukan Sistem Ini](#1-apa-yang-dilakukan-sistem-ini)
2. [Fitur Utama](#2-fitur-utama)
3. [Arsitektur Sistem](#3-arsitektur-sistem)
4. [Daftar Hardware (Bill of Materials)](#4-daftar-hardware-bill-of-materials)
5. [Skema Wiring](#5-skema-wiring)
6. [Persiapan Software (Arduino IDE)](#6-persiapan-software-arduino-ide)
7. [Library yang Wajib Di-install](#7-library-yang-wajib-di-install)
8. [Setup Google Sheets + Google Apps Script](#8-setup-google-sheets--google-apps-script)
9. [Konfigurasi Kode Sebelum Upload](#9-konfigurasi-kode-sebelum-upload)
10. [Cara Upload Program ke ESP32](#10-cara-upload-program-ke-esp32)
11. [Booting Pertama Kali](#11-booting-pertama-kali)
12. [Cara Penggunaan Harian](#12-cara-penggunaan-harian)
13. [Memahami Kode Program](#13-memahami-kode-program)
14. [Troubleshooting](#14-troubleshooting)
15. [Maintenance & Backup](#15-maintenance--backup)
16. [Frequently Asked Questions](#16-frequently-asked-questions)
17. [Glosarium](#17-glosarium)

---

## 1. Apa yang Dilakukan Sistem Ini

Sistem ini adalah **alat absensi elektronik** yang menggantikan absensi manual:

1. Setiap siswa/guru memiliki **kartu RFID** dengan UID unik.
2. Saat kartu ditempelkan ke alat, sistem membaca UID, mencari di database lokal,
   menampilkan nama di LCD, dan membunyikan buzzer sebagai konfirmasi.
3. Data tap kemudian dikirim ke **Google Sheets** melalui Google Apps Script
   sehingga rekap absensi langsung tersedia online untuk admin sekolah.
4. Jika internet mati, tap tetap diterima — disimpan di flash memory ESP32,
   dan otomatis dikirim begitu internet kembali. **Tidak ada data yang hilang.**

---

## 2. Fitur Utama

| Fitur | Penjelasan |
|---|---|
| **Dual-core** | Core 0 menangani RFID + LCD + Buzzer (super responsif <50ms). Core 1 menangani WiFi + sinkronisasi (background). Tap kartu **tidak pernah lag** meskipun WiFi lemot. |
| **Offline-first** | Tap disimpan ke `LittleFS` (flash internal ESP32) sebagai antrian, dikirim otomatis saat online. Tahan mati lampu. |
| **NTP otomatis** | Jam disinkronkan ke `pool.ntp.org` dengan zona WIB (UTC+7). |
| **Cache data induk** | Daftar kartu di-download sekali dan disimpan ke flash. Setelah itu sistem bisa boot offline. |
| **Logging serial lengkap** | Setiap langkah boot dan tap dicatat di Serial Monitor untuk debugging. |
| **Kartu asing dicatat** | Kartu yang belum terdaftar tetap dicatat (dengan flag `asing=1`) untuk audit. |
| **Anti-double-tap** | Debounce 2 detik mencegah satu kartu terbaca dua kali secara tidak sengaja. |
| **LCD status real-time** | Baris ke-2 LCD menunjukkan status: `[Online]`, `[Offline 3]`, `[Kirim 2]`, `[Antri 5]`. |

---

## 3. Arsitektur Sistem

```
┌─────────────────────────────────────────────────────────────┐
│                         ESP32 (Dual-Core)                   │
│                                                             │
│  ┌──────────────────────┐      ┌──────────────────────┐     │
│  │  CORE 0 — Presensi   │      │  CORE 1 — Sinkron    │     │
│  │  Prioritas: TINGGI   │      │  Prioritas: NORMAL   │     │
│  │                      │      │                      │     │
│  │  • Baca RFID         │      │  • WiFi keepalive    │     │
│  │  • Tampil LCD        │      │  • NTP retry         │     │
│  │  • Bunyi buzzer      │      │  • Cek Google Script │     │
│  │  • Simpan ke antrian │      │  • Kirim antrian     │     │
│  └──────────┬───────────┘      └──────────┬───────────┘     │
│             │                              │                │
│             │      ┌──────────────┐        │                │
│             └─────►│  LittleFS    │◄───────┘                │
│                    │  (Flash)     │                         │
│                    │              │                         │
│                    │ • induk.json │                         │
│                    │ • queue.jsonl│                         │
│                    └──────────────┘                         │
└────────────────────────────┬────────────────────────────────┘
                             │ HTTPS GET
                             ▼
              ┌────────────────────────────┐
              │   Google Apps Script       │
              │   (script.google.com)      │
              └──────────────┬─────────────┘
                             │
                             ▼
              ┌────────────────────────────┐
              │   Google Sheets            │
              │   • Sheet "Data_Induk"     │
              │   • Sheet "Log_Presensi"   │
              └────────────────────────────┘
```

**Filosofi inti**: Core 0 tidak boleh tahu apa-apa tentang jaringan. Kalau jaringan
mati, Core 0 tetap menerima tap dengan cepat. Core 1 yang berurusan dengan dunia
luar dan retry sendiri.

---

## 4. Daftar Hardware (Bill of Materials)

| No | Komponen | Spesifikasi | Jumlah | Catatan |
|---|---|---|---|---|
| 1 | **ESP32 DevKit** | ESP32-WROOM-32, 38-pin | 1 | DOIT DevKit V1 atau sejenisnya |
| 2 | **MFRC522** | Modul RFID 13.56 MHz | 1 | Pastikan dengan antena PCB onboard |
| 3 | **LCD 16×2 I2C** | Backpack PCF8574, alamat 0x27 | 1 | Beberapa varian beralamat 0x3F |
| 4 | **Buzzer aktif** | 3-5V, aktif HIGH | 1 | Bukan buzzer pasif |
| 5 | **Kartu RFID Mifare** | 13.56 MHz, S50/1K | sebanyak siswa | Bisa kartu atau gantungan kunci |
| 6 | **Kabel jumper female-female** | Min. 20 cm | ±15 buah | |
| 7 | **Power supply** | Adaptor 5V 2A + micro-USB / type-C | 1 | Sesuaikan port ESP32 |
| 8 | **Casing** | Opsional, plastik atau akrilik | 1 | Lubang depan untuk antena RFID & LCD |

**Estimasi biaya total**: ±Rp 250.000 – Rp 350.000 (per Mei 2026).

> ⚠️ **Penting**: Beli MFRC522 dari penjual yang reputable. Modul KW sering punya
> antena lemah sehingga kartu harus benar-benar menempel.

---

## 5. Skema Wiring

### 5.1. MFRC522 → ESP32 (SPI)

| MFRC522 | ESP32 GPIO | Nama Sinyal |
|---|---|---|
| **VCC** | **3.3V** | ⚠️ JANGAN 5V — modul akan rusak |
| GND | GND | Ground |
| RST | GPIO 4 | Reset |
| SDA / SS | GPIO 5 | SPI Chip Select |
| MOSI | GPIO 23 | SPI Master Out |
| MISO | GPIO 19 | SPI Master In |
| SCK | GPIO 18 | SPI Clock |
| IRQ | — | Tidak dipakai |

### 5.2. LCD 16×2 I2C → ESP32

| LCD I2C | ESP32 | Catatan |
|---|---|---|
| **VCC** | **5V (VIN)** | LCD butuh 5V agar terang |
| GND | GND | |
| SDA | GPIO 21 | I2C Data |
| SCL | GPIO 22 | I2C Clock |

### 5.3. Buzzer → ESP32

| Buzzer | ESP32 |
|---|---|
| + (panjang) | GPIO 15 |
| − (pendek) | GND |

### 5.4. Diagram Visual

```
                          ┌──────────────────┐
                          │   ESP32 DevKit   │
                          │                  │
       ┌─────────[3.3V]──►│ 3V3       VIN ◄──┼─── [5V] ───┐
       │     ┌───[GND ]──►│ GND       GND ◄──┼─── [GND]─┐ │
       │     │            │                  │          │ │
       │     │  ┌──[ 4]──►│ GPIO 4    GPIO 21├─[SDA]──┐ │ │
       │     │  │ ┌─[ 5]──►│ GPIO 5    GPIO 22├─[SCL]─┐│ │ │
       │     │  │ │┌─[18]──►│ GPIO 18           │     ││ │ │
       │     │  │ ││┌[19]──►│ GPIO 19   GPIO 15─┼─[+]─┐│ │ │
       │     │  │ │││[23]──►│ GPIO 23           │     ││ │ │
       │     │  │ │││       └──────────────────┘     ││ │ │
       │     │  │ │││                                ▼│ │ │
       │     │  │ │││                          ┌────────────┐
       │     │  │ │││                          │  BUZZER +  │
       │     │  │ │││                          │  ──── GND ─┼──┐
       │     │  │ │││                          └────────────┘  │
       │     │  │ │││                                          │
       │  ┌──┴──┴─┴─┴┴┴────┐               ┌────────────────┐  │
       │  │ VCC GND RST SS │               │  LCD 16x2 I2C  │  │
       │  │ SCK MISO MOSI  │               │  VCC GND SDA SCL│  │
       │  │   MFRC522      │               └────┬───┬───┬──┬─┘  │
       │  └────────────────┘                    │   │   │  │    │
       │                                        ▲   ▲   ▲  ▲    │
       └──── VCC                                │   │   │  │    │
             (3.3V)                            5V  GND SDA SCL  │
                                                                │
                                                              GND
```

### 5.5. Checklist Wiring (cek sebelum nyalakan)

- [ ] MFRC522 VCC ke **3.3V** (BUKAN 5V) — kalau salah, modul rusak permanen
- [ ] Semua GND tersambung (ESP32, MFRC522, LCD, buzzer)
- [ ] LCD VCC ke **5V** (VIN), bukan 3.3V — kalau 3.3V layar redup/tidak nyala
- [ ] Kabel SPI tidak tertukar (MISO/MOSI sering ketukar)
- [ ] Buzzer kaki **+** ke GPIO 15, **−** ke GND
- [ ] Tidak ada solder/jumper yang short

---

## 6. Persiapan Software (Arduino IDE)

### 6.1. Install Arduino IDE

1. Download Arduino IDE 2.x dari <https://www.arduino.cc/en/software>.
2. Install seperti aplikasi biasa.
3. Buka Arduino IDE.

### 6.2. Tambahkan Board ESP32

1. Buka **File → Preferences**.
2. Di kolom **Additional Boards Manager URLs**, tambahkan:
   ```
   https://espressif.github.io/arduino-esp32/package_esp32_index.json
   ```
3. Klik **OK**.
4. Buka **Tools → Board → Boards Manager**.
5. Cari `esp32` (by Espressif Systems), klik **Install**.
   - Versi yang disarankan: **3.0.x** atau **2.0.14+**.
6. Tunggu sampai selesai (download ±100 MB).

### 6.3. Install Driver USB (kalau perlu)

ESP32 DevKit biasanya pakai chip **CP2102** atau **CH340**:

- **CP2102** → download driver dari Silicon Labs:
  <https://www.silabs.com/developers/usb-to-uart-bridge-vcp-drivers>
- **CH340** → driver dari WCH atau cari "CH340 driver" di Google.

Setelah install driver, cabut-pasang USB ESP32, lalu di Arduino IDE pilih:
- **Tools → Board → ESP32 Arduino → ESP32 Dev Module**
- **Tools → Port → COM3** (atau COM berapa pun yang muncul)

---

## 7. Library yang Wajib Di-install

Buka **Sketch → Include Library → Manage Libraries** (atau ikon buku di sidebar),
lalu install satu per satu:

| Library | Author | Versi Minimum | Fungsi |
|---|---|---|---|
| **MFRC522** | GithubCommunity / Miguel Balboa | 1.4.10 | Driver reader RFID |
| **LiquidCrystal_I2C** | Frank de Brabander | 1.1.2 | Driver LCD 16×2 I2C |
| **ArduinoJson** | Benoit Blanchon | **7.0.0+** | Parsing JSON dari Google |

Library berikut **sudah bawaan** ESP32 core, tidak perlu install manual:

- `WiFi.h`, `WiFiClientSecure.h`, `HTTPClient.h`
- `SPI.h`, `Wire.h`
- `LittleFS.h`
- `time.h`

> ⚠️ **Catatan ArduinoJson**: kode ini menggunakan API ArduinoJson v6/v7
> (`DynamicJsonDocument`, `StaticJsonDocument`, `deserializeJson`). Jangan pakai
> ArduinoJson v5 — API-nya beda total dan kode tidak akan compile.

### Cara verifikasi library terinstall

Di Arduino IDE: **Sketch → Include Library** — semua library di atas harus tampil
di daftar "Contributed libraries".

---

## 8. Setup Google Sheets + Google Apps Script

Bagian ini adalah **backend** sistem. Tanpa ini, ESP32 tidak bisa kirim data online.

### 8.1. Buat Google Spreadsheet baru

1. Login ke akun Google sekolah.
2. Buka <https://sheets.google.com> → **Blank spreadsheet**.
3. Ganti nama jadi `Presensi MA Nurul Huda`.
4. Buat **2 sheet** (tab di bawah):

#### Sheet 1: `Data_Induk`

Baris 1 sebagai header:

| A | B | C | D |
|---|---|---|---|
| UID | Nama | Jabatan | Kelas |

Isi data mulai baris 2. Contoh:

| UID | Nama | Jabatan | Kelas |
|---|---|---|---|
| A1B2C3D4 | Ahmad Fauzi | Siswa | XII-IPA |
| E5F6G7H8 | Bu Siti | Guru | - |
| 12345678 | Pak Budi | Guru | - |

> UID kartu bisa didapat dengan menempelkan kartu ke alat — UID akan
> muncul di LCD (jika belum terdaftar) dan di Serial Monitor.

#### Sheet 2: `Log_Presensi`

Baris 1 sebagai header:

| A | B | C | D | E | F |
|---|---|---|---|---|---|
| Timestamp | UID | Nama | Jabatan | Kelas | Asing |

Sisanya kosong — akan diisi otomatis oleh Apps Script setiap kali ada tap.

### 8.2. Buat Apps Script

1. Di spreadsheet, klik **Extensions → Apps Script**.
2. Hapus semua kode `Code.gs` default.
3. Paste kode berikut:

```javascript
// ===== KONFIGURASI =====
const SS_ID = SpreadsheetApp.getActiveSpreadsheet().getId();
const SHEET_INDUK = "Data_Induk";
const SHEET_LOG   = "Log_Presensi";

// ===== ENTRY POINT =====
function doGet(e) {
  const aksi = (e.parameter.aksi || "").toLowerCase();

  try {
    if (aksi === "versi") return jsonResp({ ok: true, v: "v6-2026-05" });
    if (aksi === "induk") return aksiInduk();
    if (aksi === "tap")   return aksiTap(e.parameter);
    return textResp("ERROR aksi tidak dikenali");
  } catch (err) {
    return textResp("ERROR " + err.message);
  }
}

// ===== ?aksi=induk =====
function aksiInduk() {
  const sh = SpreadsheetApp.openById(SS_ID).getSheetByName(SHEET_INDUK);
  const data = sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues();
  // Filter baris kosong, paksa UID jadi uppercase
  const clean = data
    .filter(r => r[0] && r[0].toString().trim() !== "")
    .map(r => [
      r[0].toString().toUpperCase().trim(),
      r[1].toString().trim(),
      r[2].toString().trim(),
      r[3].toString().trim()
    ]);
  return jsonResp({ ok: true, data: clean });
}

// ===== ?aksi=tap =====
function aksiTap(p) {
  const sh = SpreadsheetApp.openById(SS_ID).getSheetByName(SHEET_LOG);
  sh.appendRow([
    p.tap || new Date(),
    (p.uid || "").toUpperCase(),
    p.nama || "",
    p.jabatan || "",
    p.kelas || "",
    p.asing === "1" ? "ASING" : ""
  ]);
  return textResp("OK");
}

// ===== HELPERS =====
function jsonResp(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
function textResp(s) {
  return ContentService.createTextOutput(s)
    .setMimeType(ContentService.MimeType.TEXT);
}
```

4. **Save** (Ctrl+S), beri nama project `Presensi_API`.

### 8.3. Deploy sebagai Web App

1. Klik tombol **Deploy → New deployment**.
2. Klik ikon roda gigi → pilih **Web app**.
3. Isi:
   - **Description**: `v1`
   - **Execute as**: **Me** (akun Anda)
   - **Who has access**: **Anyone** ⚠️ wajib, biar ESP32 bisa akses
4. Klik **Deploy**.
5. Pertama kali deploy, Google akan minta authorize — klik **Authorize access**
   → pilih akun → **Advanced → Go to Presensi_API (unsafe)** → **Allow**.
6. Setelah deploy, akan muncul **Web app URL**, contoh:
   ```
   https://script.google.com/macros/s/AKfycbz2I072wPz-uDBi71D4xUyhEfRzUkulrMQWZ0XfuwIGvzPWsI6Eypa0sKNj4crcKPtb2Q/exec
   ```
7. **COPY** bagian setelah `/s/` dan sebelum `/exec` — itu yang disebut **GSCRIPT_ID**.
   Pada contoh di atas, GSCRIPT_ID-nya adalah:
   ```
   AKfycbz2I072wPz-uDBi71D4xUyhEfRzUkulrMQWZ0XfuwIGvzPWsI6Eypa0sKNj4crcKPtb2Q
   ```

### 8.4. Tes Apps Script di browser

Buka URL berikut di browser (ganti GSCRIPT_ID dengan milik Anda):

```
https://script.google.com/macros/s/GSCRIPT_ID/exec?aksi=versi
```

Harus muncul:
```json
{"ok":true,"v":"v6-2026-05"}
```

Kalau tidak muncul, **deploy tidak berhasil** — cek lagi langkah 8.3.

### 8.5. Update deployment di masa depan

⚠️ Setiap kali kode Apps Script diubah, **TIDAK CUKUP** klik Save. Harus:

- **Deploy → Manage deployments → ikon pensil → Version: New version → Deploy**.

Atau bikin **New deployment** baru (tapi URL/ID akan berubah, ESP32 harus
diupload ulang dengan GSCRIPT_ID baru).

---

## 9. Konfigurasi Kode Sebelum Upload

Buka file `Presensi_RFID_v7.ino` di Arduino IDE, lalu **ubah 3 baris** di bagian
`KONFIGURASI`:

```cpp
const char* WIFI_SSID     = "CCTV MA";          // ← Nama WiFi sekolah
const char* WIFI_PASSWORD = "MAnuha1234";       // ← Password WiFi sekolah
const char* GSCRIPT_ID    = "AKfycbz..."; // ← Hasil copy dari langkah 8.3
```

Ketiga nilai inilah yang **harus disesuaikan** dengan deployment Anda.
Sisanya jangan diubah kecuali paham.

### Parameter opsional lain

| Konstanta | Default | Penjelasan |
|---|---|---|
| `GMT_OFFSET` | `7*3600` | Zona waktu (WIB = UTC+7). Indonesia Tengah: `8*3600`. Indonesia Timur: `9*3600`. |
| `MAX_KARTU` | `500` | Maks. jumlah kartu yang muat di RAM. Naikkan kalau sekolah lebih besar. |
| Pin GPIO | 4, 5, 15, 18, 19, 21, 22, 23 | Hanya ubah kalau wiring berbeda. |

---

## 10. Cara Upload Program ke ESP32

1. Hubungkan ESP32 ke komputer via kabel USB (kabel **data**, bukan charger saja).
2. Di Arduino IDE:
   - **Tools → Board → ESP32 Arduino → ESP32 Dev Module**
   - **Tools → Port → COMx** (cek di Device Manager / `ls /dev/tty.*`)
   - **Tools → Partition Scheme → Default 4MB with spiffs (1.2MB APP/1.5MB SPIFFS)**
     atau **Default 4MB with FFat** — yang penting ada partisi FS.
   - **Tools → Flash Size → 4MB (32Mb)**
   - **Tools → Upload Speed → 921600** (kalau gagal, turunkan ke 115200)
3. Klik tombol **Verify** (✓) untuk compile. Tunggu sampai selesai tanpa error.
4. Klik tombol **Upload** (→). Tunggu sampai muncul `Hash of data verified` di bawah.
   - Beberapa ESP32 perlu **tekan tombol BOOT** saat muncul `Connecting....`
5. Buka **Tools → Serial Monitor**, atur baud rate **115200**.
6. Tekan tombol **EN** (Reset) di ESP32. Sistem akan mulai booting.

---

## 11. Booting Pertama Kali

Saat pertama nyala, sistem akan menampilkan log boot lengkap di Serial Monitor.
Berikut alur idealnya:

```
==========================================================
  SISTEM PRESENSI RFID
  MA Nurul Huda Mergosono, Malang
  Dual-Core FreeRTOS v7
==========================================================

----------------------------------------------------------
  [1/7] LCD I2C 16x2
----------------------------------------------------------
  [OK] LCD menyala, backlight ON
       Alamat I2C: 0x27  SDA=GPIO21  SCL=GPIO22

----------------------------------------------------------
  [2/7] RFID Reader MFRC522
----------------------------------------------------------
  [OK] MFRC522 terdeteksi
       VersionReg : 0x92
       Wiring     : SS=5  SCK=18  MOSI=23  MISO=19  RST=4  VCC=3.3V

----------------------------------------------------------
  [3/7] Buzzer
----------------------------------------------------------
  [OK] Buzzer aktif HIGH GPIO15
       Tes buzzer...
       Buzzer OK

----------------------------------------------------------
  [4/7] Flash Storage — LittleFS
----------------------------------------------------------
  [OK] LittleFS mounted
       Cache  : BELUM ADA
       Antrian: 0 tap offline tersimpan

----------------------------------------------------------
  [5/7] WiFi
----------------------------------------------------------
       SSID : CCTV MA
       Connecting....
  [OK] WiFi terhubung
       IP     : 192.168.1.45
       Signal : -52 dBm

----------------------------------------------------------
  [6/7] Internet Services (NTP + Google)
----------------------------------------------------------
       Sync NTP (pool.ntp.org + time.google.com)...
       Menunggu NTP...
  [OK] NTP sync berhasil — 2026-05-21 08:30:15

       Menghubungi Google Apps Script...
       URL : https://script.google.com/macros/s/AKfycbz...
  [OK] Google Apps Script aktif
       Versi data : v6-2026-05

----------------------------------------------------------
  [7/7] Data Induk
----------------------------------------------------------
       Download Data_Induk dari Google Sheets...
  [OK] 47 kartu diunduh & disimpan ke flash (1842ms)

----------------------------------------------------------
  DATA KARTU AKTIF
----------------------------------------------------------
  No  UID                    Nama                 Jabatan  Kelas
----------------------------------------------------------
  1   A1B2C3D4               Ahmad Fauzi          Siswa    XII-IPA
  2   E5F6G7H8               Bu Siti              Guru     -
  ...

==========================================================
  RINGKASAN STATUS SISTEM
==========================================================
  LCD I2C              : OK
  RFID MFRC522         : OK
  Buzzer               : OK
  Flash LittleFS       : OK
  WiFi                 : ONLINE
  NTP                  : 2026-05-21 08:30:15
  Google Script        : OK
  Data Induk           : OK
----------------------------------------------------------
  Jumlah kartu         : 47 kartu
  Antrian offline      : 0 tap
  Heap bebas           : 235432 byte
  Mode                 : ONLINE
==========================================================

==========================================================
  SISTEM SIAP — DUAL-CORE AKTIF
  Core 0 : RFID + LCD + Buzzer (tap responsif <50ms)
  Core 1 : WiFi + NTP + Google + Antrian (background)
==========================================================
```

Setelah ini, LCD akan menampilkan:

```
Tap kartu RFID
[Online]
```

Sistem siap dipakai.

---

## 12. Cara Penggunaan Harian

### 12.1. Pengoperasian normal

1. Colok adaptor — sistem booting otomatis (5–20 detik).
2. Setelah LCD muncul `Tap kartu RFID`, alat siap.
3. Siswa/guru menempelkan kartu ke antena MFRC522.
4. LCD menampilkan nama + kelas, buzzer berbunyi `BEEEEP` panjang sekali.
5. Setelah 2 detik, LCD kembali ke `Tap kartu RFID`.

### 12.2. Indikator status LCD

Baris ke-2 LCD selalu menampilkan status terkini:

| Tampilan LCD | Arti |
|---|---|
| `[Online]` | WiFi OK, Google OK, semua tap langsung terkirim. |
| `[Antri 3]` | Online tapi sedang ada antrian 3 tap yang menunggu giliran kirim. |
| `[Kirim 2]` | Sedang mengirim tap, sisa 2 di antrian. |
| `[Offline]` | WiFi mati. Tap tetap diterima dan disimpan ke flash. |
| `[Offline 5]` | WiFi mati, ada 5 tap menunggu di antrian flash. |

### 12.3. Bunyi buzzer

| Pola buzzer | Arti |
|---|---|
| **BEEEEP** (panjang ±350 ms, 1x) | Kartu dikenal, presensi sukses. |
| **beep-beep-beep** (3x pendek cepat) | Kartu ASING (tidak terdaftar). Tetap dicatat. |
| **beep-beep** (2x sedang) | Bunyi boot — sistem selesai siap. |

### 12.4. Menambah kartu baru

1. Buka Google Sheets → sheet `Data_Induk`.
2. Tambahkan baris baru: UID, Nama, Jabatan, Kelas.
3. **Reboot ESP32** (cabut-colok USB / tekan tombol EN).
   Saat booting, sistem akan otomatis download data terbaru.

> Belum ada fitur reload data tanpa reboot. Reboot membutuhkan <10 detik.

### 12.5. Cara dapat UID kartu baru

1. Tempelkan kartu yang belum terdaftar ke alat.
2. LCD akan menampilkan `Kartu tdk dftr` di baris atas, dan **UID kartu** di
   baris bawah.
3. Catat UID tersebut, lalu daftarkan di Google Sheets seperti langkah 12.4.

Cara lain: cek **Serial Monitor** — UID akan tertulis di sana setiap tap.

---

## 13. Memahami Kode Program

Bagian ini untuk orang yang ingin **memodifikasi** kode. Untuk pengguna biasa
bisa di-skip.

### 13.1. Struktur file

```
Presensi_RFID_v7.ino
├── KONFIGURASI                  ← WIFI, GSCRIPT_ID, pin
├── STRUCT Kartu                 ← 1 kartu = 22+32+12+16 byte
├── OBJEK HARDWARE               ← mfrc522, lcd
├── STATE GLOBAL                 ← wifiOnline, ntpSynced, antrianSisa
├── LOGGING HELPER               ← sep(), logOK(), logWARN()
├── LCD                          ← lcdShow(), lcdStatus()
├── BUZZER                       ← buzzerHadir(), buzzerAsing(), buzzerBoot()
├── HELPER                       ← formatUID(), waktuSekarang(), urlEncode()
├── HTTP                         ← httpGet()
├── PARSE JSON                   ← parseJSON() — load data ke RAM
├── QUEUE (flash)                ← antrekanTap(), bacaBarisPertama(), dst.
├── KIRIM TAP                    ← kirimTap() ke Google
├── VERIFIKASI GOOGLE            ← cekGoogle()
├── taskPresensi()  [Core 0]     ← Loop utama RFID
├── taskSinkron()   [Core 1]     ← Loop background network
├── setup()                      ← Boot sequence 7 langkah
└── loop()                       ← Kosong, semua kerja di task
```

### 13.2. Alur tap

```
   [User tempel kartu]
           │
           ▼
   Core 0 baca UID
           │
           ▼
   Cek di array daftarKartu[] (di RAM)
           │
           ├── Dikenal → tampil nama+kelas, buzzer 1x panjang
           └── Asing   → tampil UID, buzzer 3x pendek
           │
           ▼
   Tulis ke /queue.jsonl (flash)
           │
           ▼
   antrianSisa++
           │
           ▼
   [Core 1 melihat antrianSisa > 0]
           │
           ▼
   Baca baris pertama queue
           │
           ▼
   HTTP GET ke Google Apps Script
           │
           ├── Sukses → hapus baris dari queue
           └── Gagal  → coba lagi 5 detik, max 5x
```

### 13.3. Format file di flash

**`/induk.json`** — cache data kartu (di-download saat boot online pertama):
```json
{
  "ok": true,
  "data": [
    ["A1B2C3D4", "Ahmad Fauzi", "Siswa", "XII-IPA"],
    ["E5F6G7H8", "Bu Siti",     "Guru",  "-"]
  ]
}
```

**`/queue.jsonl`** — antrian tap (1 baris = 1 tap, format JSONL):
```jsonl
{"uid":"A1B2C3D4","nama":"Ahmad Fauzi","jabatan":"Siswa","kelas":"XII-IPA","tap":"2026-05-21 08:30:15"}
{"uid":"FFFFFFFF","nama":"","jabatan":"","kelas":"","tap":"2026-05-21 08:32:01","asing":true}
```

### 13.4. Pembagian tugas dual-core

| Tugas | Core 0 (Presensi) | Core 1 (Sinkron) |
|---|---|---|
| Baca RFID | ✅ | ❌ |
| Tampil LCD | ✅ | ❌ (kecuali lewat `lcdStatus()` via mutex) |
| Bunyi buzzer | ✅ | ❌ |
| Tulis ke queue.jsonl | ✅ | ❌ |
| WiFi connect | ❌ | ✅ |
| NTP sync | ❌ | ✅ |
| HTTP GET ke Google | ❌ | ✅ |
| Baca/hapus queue.jsonl | ❌ | ✅ |

Sinkronisasi pakai 2 mutex (`mutexLCD`, `mutexQueue`) supaya tidak bentrok
saat kedua core mau pakai resource yang sama.

### 13.5. Endpoint Google Apps Script

| URL | Dipanggil oleh | Respons |
|---|---|---|
| `?aksi=versi` | Boot & retry verifikasi | `{"ok":true,"v":"v6-..."}` |
| `?aksi=induk` | Boot (download data) | `{"ok":true,"data":[[uid,nama,jbt,kls],...]}` |
| `?aksi=tap&uid=...&nama=...&jabatan=...&kelas=...&tap=...&asing=0/1` | Tiap kirim tap | `OK` |

Kalau Apps Script Anda hilang, **API contract di atas adalah satu-satunya yang
perlu dijaga** supaya ESP32 tetap kompatibel.

---

## 14. Troubleshooting

### LCD menyala tapi blank / kotak hitam saja

- Kontras LCD perlu disesuaikan: putar **trimpot biru** di belakang modul I2C.
- Pastikan VCC LCD ke **5V**, bukan 3.3V.
- Cek alamat I2C — beberapa modul beralamat **0x3F**, bukan 0x27.
  Ubah di kode: `LiquidCrystal_I2C lcd(0x3F, 16, 2);`

### Serial Monitor: `MFRC522 TIDAK TERDETEKSI`

- Cek wiring SPI — paling sering MISO/MOSI ketukar.
- Pastikan VCC ke **3.3V**, bukan 5V (modul rusak permanen kalau 5V).
- Coba MFRC522 di breakout board lain — modul KW kadang DOA (dead on arrival).
- VersionReg `0x92` = MFRC522 v2.0 (paling umum). `0x91` = v1.0. `0x00`/`0xFF` = rusak.

### Serial Monitor: `WiFi GAGAL`

- Cek `WIFI_SSID` dan `WIFI_PASSWORD` (case-sensitive).
- ESP32 hanya support **WiFi 2.4 GHz**, tidak bisa 5 GHz.
- Sinyal terlalu lemah (di Serial Monitor: `Signal: -85 dBm` ke atas = lemah).
  Pindahkan ESP32 dekat router, atau pakai router yang lebih kuat.
- Beberapa WiFi sekolah pakai captive portal — tidak compatible, pakai
  WiFi router biasa.

### Serial Monitor: `Google Script tidak bisa dijangkau`

- Cek `GSCRIPT_ID` — pastikan **copy lengkap** tanpa terpotong.
- Buka URL `https://script.google.com/macros/s/GSCRIPT_ID/exec?aksi=versi`
  di browser. Harus return JSON `{"ok":true,...}`.
- Pastikan deploy Apps Script **Who has access = Anyone**.
- Setelah ubah kode Apps Script, **WAJIB re-deploy** (lihat langkah 8.5).
- Cek apakah router/firewall sekolah blokir `script.google.com`.

### Tap kartu tidak terdeteksi sama sekali

- Tempelkan kartu **rapat** ke antena (sisi PCB MFRC522 yang ada coil-nya).
- Cek jenis kartu — sistem hanya support Mifare 13.56 MHz. Kartu 125 kHz
  (EM4100, kartu hotel lama) **tidak akan terbaca**.
- Cek di Serial Monitor — kalau VersionReg OK tapi tap tidak masuk, modul
  mungkin loose. Re-solder pin headernya.

### Setelah tap, LCD pasif lama / lag

- Heap habis. Cek `Heap bebas` di log boot — kalau di bawah 50 KB, kurangi
  `MAX_KARTU` atau ukuran `DynamicJsonDocument`.
- Banyak antrian numpuk + WiFi lemot. Tunggu sampai antrian habis terkirim.

### Jam (timestamp) salah

- Cek `GMT_OFFSET` — WIB harus `7*3600`, bukan `8*3600` atau `0`.
- NTP belum sync. Tunggu beberapa menit; Core 1 retry tiap 10 detik.
- Router blokir UDP port 123 (NTP). Sangat jarang, tapi mungkin.

### Antrian terus naik tidak pernah turun

- Cek log Core 1 di Serial Monitor. Harus muncul `[SYNC] Sukses` setiap kirim.
- Kalau muncul `[SYNC] Gagal` terus, biasanya ID Apps Script salah atau
  deploy belum di-update setelah edit kode.
- Coba akses URL `?aksi=versi` di browser — kalau gagal di browser, jelas
  ESP32 juga akan gagal.

---

## 15. Maintenance & Backup

### 15.1. Backup berkala (sangat penting)

| Item | Frekuensi | Cara |
|---|---|---|
| **Google Sheets** | Otomatis oleh Google | — |
| **Sketch `.ino`** | Setiap modifikasi | Push ke GitHub repository |
| **Apps Script** | Setiap modifikasi | Copy seluruh kode ke file backup `apps_script.gs` di repo |
| **Daftar UID kartu** | Setiap akhir semester | Download `Data_Induk` sebagai CSV → simpan di repo `/data/` |

### 15.2. Update firmware

1. Edit sketch di komputer.
2. Re-upload via Arduino IDE (langkah 10).
3. Saat firmware baru boot pertama, data cache lama akan ter-load lagi.
4. Antrian yang belum terkirim akan dilanjutkan dari titik terakhir.

### 15.3. Format ulang flash (kalau cache korup)

1. Buka Arduino IDE.
2. **Tools → ESP32 Sketch Data Upload** (kalau ada plugin), atau:
3. Tambahkan baris berikut di `setup()`, upload, lalu hapus baris ini dan
   upload lagi:
   ```cpp
   LittleFS.format();
   ```

### 15.4. Restart hardware berkala

Disarankan **restart sekali seminggu** untuk membersihkan memory.
Bisa dijadwalkan dengan timer otomatis di kode (belum tersedia di v7).

---

## 16. Frequently Asked Questions

**Q: Bisa pakai ESP8266 (NodeMCU/Wemos D1) sebagai pengganti ESP32?**
A: Tidak. Kode ini pakai dual-core FreeRTOS yang hanya ada di ESP32. Selain itu
ESP8266 RAM-nya tidak cukup untuk 500 kartu + queue.

**Q: Bisa pakai LCD 20×4 atau OLED?**
A: Bisa, tapi perlu modifikasi kode di bagian `lcdShow()` dan inisialisasi
LCD. Untuk OLED ganti `LiquidCrystal_I2C` dengan `Adafruit_SSD1306`.

**Q: Bagaimana kalau mau pakai 2 alat di sekolah yang sama?**
A: Bisa, asal masing-masing alat di-upload kode yang sama. Semua alat akan
kirim ke `Log_Presensi` yang sama. Kalau perlu identifikasi alat, tambahkan
parameter `&alat=A` atau `&alat=B` di `kirimTap()`.

**Q: Maksimal berapa siswa yang bisa diakomodasi?**
A: Saat ini 500 kartu (lihat `MAX_KARTU`). Bisa dinaikkan sampai ±1000 tergantung
RAM yang tersisa. Setiap kartu memakan ±82 byte di RAM.

**Q: Apakah aman? Kartu RFID Mifare bisa dipalsukan tidak?**
A: Sistem ini hanya membaca **UID** (tidak ada autentikasi kriptografi). UID
Mifare standar bisa di-clone dengan kartu UID-changeable. Untuk sekolah,
risiko ini biasanya bisa diabaikan. Kalau butuh security tinggi, perlu pakai
mutual authentication AES (di luar scope dokumen ini).

**Q: Apakah bisa dipakai untuk presensi guru saja, atau siswa saja?**
A: Bisa. Cukup isi `Data_Induk` dengan kategori yang diinginkan. Kolom
`Jabatan` berguna untuk filter di rekap.

**Q: Berapa lama baterai bertahan kalau pakai power bank?**
A: ESP32 + MFRC522 + LCD menarik ±150 mA. Power bank 10000 mAh = ±60 jam.
Tapi tidak disarankan — pakai adaptor 5V/2A untuk operasi 24/7.

**Q: Bisa dipakai untuk akses pintu (door lock)?**
A: Bisa dengan modifikasi. Tambahkan relay di GPIO yang lain, dan trigger
HIGH selama 3 detik saat tap dikenal. Hubungi developer untuk konsultasi.

---

## 17. Glosarium

| Istilah | Arti |
|---|---|
| **UID** | Unique Identifier — nomor unik tiap kartu RFID (8 digit hex umumnya). |
| **RFID** | Radio Frequency Identification — teknologi kartu kontak-less. |
| **Mifare** | Standar RFID 13.56 MHz dari NXP. Yang umum: Mifare Classic 1K (S50). |
| **NTP** | Network Time Protocol — sinkronisasi jam via internet. |
| **WIB** | Waktu Indonesia Barat — UTC+7. |
| **GPIO** | General Purpose Input Output — pin ESP32 yang bisa diprogram. |
| **I2C** | Inter-Integrated Circuit — protokol komunikasi 2-kabel (SDA, SCL). |
| **SPI** | Serial Peripheral Interface — protokol komunikasi 4-kabel. |
| **LittleFS** | Filesystem khusus flash chip ESP32, tahan power-loss. |
| **JSONL** | JSON Lines — satu objek JSON per baris file. |
| **FreeRTOS** | Real-Time OS yang berjalan di ESP32, mendukung multi-task. |
| **Mutex** | Mutual Exclusion — penjaga supaya 2 task tidak akses resource sama bersamaan. |
| **Apps Script** | Bahasa scripting Google (mirip JavaScript) untuk otomasi Sheets/Docs. |
| **Endpoint** | URL HTTP yang menerima request dan mengembalikan respons. |
| **GSCRIPT_ID** | Bagian unik dari URL Apps Script web app deployment. |

---

## Kredit & Kontak

**Sekolah**: MA Nurul Huda Mergosono, Malang
**Versi firmware**: v7 (2026)
**Lisensi**: Internal, untuk keperluan sekolah.

Untuk pertanyaan teknis, hubungi pengembang sistem atau buka issue di
repository GitHub.

---

## Lampiran A: Perintah Cepat (Cheat Sheet)

```text
# Tes Apps Script
https://script.google.com/macros/s/GSCRIPT_ID/exec?aksi=versi

# Tes download data induk
https://script.google.com/macros/s/GSCRIPT_ID/exec?aksi=induk

# Simulasi tap dari browser (untuk debug)
https://script.google.com/macros/s/GSCRIPT_ID/exec?aksi=tap&uid=TEST123&nama=Tes&jabatan=Siswa&kelas=XII-A&tap=2026-05-21+10:00:00&asing=0
```

```text
# Arduino IDE settings
Board            : ESP32 Dev Module
Upload Speed     : 921600 (turun ke 115200 kalau gagal)
CPU Frequency    : 240MHz (default)
Flash Frequency  : 80MHz
Flash Mode       : QIO
Flash Size       : 4MB (32Mb)
Partition Scheme : Default 4MB with spiffs (atau FFat)
Core Debug Level : None
```

```text
# Pin map ESP32
GPIO 4   → MFRC522 RST
GPIO 5   → MFRC522 SS/SDA
GPIO 15  → Buzzer +
GPIO 18  → MFRC522 SCK
GPIO 19  → MFRC522 MISO
GPIO 21  → LCD SDA
GPIO 22  → LCD SCL
GPIO 23  → MFRC522 MOSI
3.3V     → MFRC522 VCC  ⚠️ JANGAN 5V
5V/VIN   → LCD VCC
GND      → semua GND
```

---

*Dokumen ini sebaiknya disimpan bersama file `.ino` di repository GitHub
yang sama, supaya siapapun yang clone repo langsung dapat petunjuk lengkap.*
