// ====================================================
//  SISTEM PRESENSI RFID — MA NURUL HUDA MERGOSONO
//  Apps Script v8 — Dashboard Simpel + Filter Langsung
//
//  CARA DEPLOY:
//  1. REPLACE seluruh Code.gs dengan file ini
//  2. Run: setupSpreadsheet()
//  3. Run: pasangTriggerOnEdit()
//  4. Run: buatChartDashboard()
//  5. Deploy → New Deployment → Web App
//     Execute as: Me | Who has access: Anyone
//  6. Salin Deployment ID → isi GSCRIPT_ID di ESP32
//
//  ENDPOINT ESP32 (semua via GET):
//  ?aksi=versi  → cek versi Data_Induk
//  ?aksi=induk  → download seluruh Data_Induk
//  ?aksi=tap    → catat tap presensi
//
//  CHANGELOG v8:
//  - Dashboard: filter Bulan & Tahun langsung di sel B4 & D4
//    (tidak perlu buka sheet Rekapan lagi)
//  - Rekapan: membaca filter dari Dashboard!B4 & Dashboard!D4
//  - Label filter dibuat lebih jelas untuk pengguna awam
//  - Hari Efektif (fix v7): COUNTUNIQUE+FILTER (hari unik)
// ====================================================

var TIMEZONE        = 'Asia/Jakarta';
var SHEET_MENTAH    = 'Data_Mentah';
var SHEET_INDUK     = 'Data_Induk';
var SHEET_LAPORAN   = 'Laporan_Harian';
var SHEET_REKAP     = 'Rekapan';
var SHEET_DASHBOARD = 'Dashboard';
var SHEET_SISWA     = 'Laporan_Siswa';
var VERSI_CELL      = 'Z1';


// ====================================================
//  HELPER OUTPUT
// ====================================================
function jsonOut_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function textOut_(s) {
  return ContentService
    .createTextOutput(s)
    .setMimeType(ContentService.MimeType.TEXT);
}


// ====================================================
//  doGet — endpoint utama ESP32
// ====================================================
function doGet(e) {
  try {
    var aksi = (e && e.parameter && e.parameter.aksi) || '';
    if (aksi === 'versi') return jsonOut_({ ok: true, v: bacaVersi_() });
    if (aksi === 'induk') return kirimDataInduk_();
    if (aksi === 'tap')   return catatTap_(e.parameter);
    return jsonOut_({
      ok: false,
      info: 'Presensi RFID MA Nurul Huda',
      aksi: ['versi', 'induk', 'tap']
    });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err) });
  }
}


// ====================================================
//  HANDLER: ?aksi=tap
// ====================================================
function catatTap_(params) {
  var uid     = String(params.uid     || '').trim().toUpperCase();
  var nama    = String(params.nama    || '').trim();
  var jabatan = String(params.jabatan || '').trim();
  var kelas   = String(params.kelas   || '').trim();
  var tapStr  = String(params.tap     || '').trim();
  var asing   = (params.asing === '1');

  if (!uid) return textOut_('ERROR: uid kosong');

  var ss          = SpreadsheetApp.getActiveSpreadsheet();
  var sheetMentah = ss.getSheetByName(SHEET_MENTAH);
  if (!sheetMentah) return textOut_('ERROR: sheet Data_Mentah tidak ada');

  var tapDate;
  if (tapStr && tapStr !== '0000-00-00 00:00:00') {
    tapDate = new Date(tapStr.replace(' ', 'T') + '+07:00');
    if (isNaN(tapDate.getTime())) tapDate = new Date();
  } else {
    tapDate = new Date();
  }

  var hariEN = Utilities.formatDate(tapDate, TIMEZONE, 'EEEE');
  var hariID = {
    Sunday:'Minggu', Monday:'Senin', Tuesday:'Selasa',
    Wednesday:'Rabu', Thursday:'Kamis', Friday:'Jumat', Saturday:'Sabtu'
  }[hariEN] || hariEN;

  if (asing) {
    sheetMentah.insertRowAfter(1);
    sheetMentah.getRange(2, 1, 1, 9).setValues([[
      new Date(), tapDate, hariID, tapDate, tapDate, uid, '', '', ''
    ]]);
    sheetMentah.getRange(2, 1).setNumberFormat('dd/MM/yyyy HH:mm:ss');
    sheetMentah.getRange(2, 2).setNumberFormat('dd/MM/yyyy HH:mm:ss');
    sheetMentah.getRange(2, 4).setNumberFormat('yyyy-MM-dd');
    sheetMentah.getRange(2, 5).setNumberFormat('HH:mm:ss');
    return textOut_('OK-ASING');
  }

  sheetMentah.insertRowAfter(1);
  sheetMentah.getRange(2, 1, 1, 9).setValues([[
    new Date(), tapDate, hariID, tapDate, tapDate, uid, nama, jabatan, kelas
  ]]);
  sheetMentah.getRange(2, 1).setNumberFormat('dd/MM/yyyy HH:mm:ss');
  sheetMentah.getRange(2, 2).setNumberFormat('dd/MM/yyyy HH:mm:ss');
  sheetMentah.getRange(2, 4).setNumberFormat('yyyy-MM-dd');
  sheetMentah.getRange(2, 5).setNumberFormat('HH:mm:ss');

  return textOut_('OK');
}


// ====================================================
//  Tambah UID asing ke Data_Induk
// ====================================================
function tambahkanUIDBaru_(uid) {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_INDUK);
  if (!sheet) return false;

  var lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    var existing = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < existing.length; i++) {
      if (String(existing[i][0] || '').trim().toUpperCase() === uid) return false;
    }
  }

  sheet.appendRow([uid, '', '', '']);
  var newRow = sheet.getLastRow();
  sheet.getRange(newRow, 1, 1, 4).setBackground('#fff59d');
  updateVersi_();
  return true;
}


// ====================================================
//  HANDLER: ?aksi=induk
// ====================================================
function kirimDataInduk_() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_INDUK);
  if (!sheet) return jsonOut_({ ok: false, error: 'Sheet Data_Induk tidak ada' });

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return jsonOut_({ ok: true, v: bacaVersi_(), n: 0, data: [] });

  var values = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
  var data = [];
  for (var i = 0; i < values.length; i++) {
    var uid = String(values[i][0] || '').trim().toUpperCase();
    if (!uid) continue;
    data.push([uid,
      String(values[i][1] || '').trim(),
      String(values[i][2] || '').trim(),
      String(values[i][3] || '').trim()
    ]);
  }
  return jsonOut_({ ok: true, v: bacaVersi_(), n: data.length, data: data });
}


// ====================================================
//  VERSI DATA_INDUK
// ====================================================
function updateVersi_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_INDUK);
  if (sheet) sheet.getRange(VERSI_CELL).setValue(Math.floor(Date.now() / 1000));
}

function bacaVersi_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_INDUK);
  if (!sheet) return '0';
  var v = sheet.getRange(VERSI_CELL).getValue();
  return v ? String(v) : '0';
}

function pasangTriggerOnEdit() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'handleEditInduk')
      ScriptApp.deleteTrigger(triggers[i]);
  }
  ScriptApp.newTrigger('handleEditInduk')
    .forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet())
    .onEdit().create();
  SpreadsheetApp.getUi().alert('✅ Trigger onEdit terpasang.');
}

function handleEditInduk(e) {
  try {
    if (!e || !e.range) return;
    if (e.range.getSheet().getName() !== SHEET_INDUK) return;
    var col = e.range.getColumn();
    if (col < 1 || col > 4 || col >= 26) return;
    if (e.range.getRow() < 2) return;
    updateVersi_();
  } catch (err) {
    Logger.log('handleEditInduk: ' + err);
  }
}


// ====================================================
//  SETUP AWAL
// ====================================================
function setupSpreadsheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var dummy = ss.insertSheet('_tmp_setup_');
  SpreadsheetApp.flush();
  Utilities.sleep(500);

  var namaHapus = ['Dashboard','Rekapan','Laporan_Harian','Data_Mentah',
                   'Data_Induk','Kalender_Akademik','Sheet1','_tmp_setup_','Laporan_Siswa'];
  namaHapus.forEach(function(nama) {
    try {
      var s = ss.getSheetByName(nama);
      if (s) { ss.deleteSheet(s); SpreadsheetApp.flush(); Utilities.sleep(200); }
    } catch(e) { Logger.log('Skip hapus ' + nama + ': ' + e); }
  });

  try { buatSheet_DataMentah(ss);    SpreadsheetApp.flush(); Utilities.sleep(300); } catch(e) { Logger.log('DataMentah: '+e); }
  try { buatSheet_DataInduk(ss);     SpreadsheetApp.flush(); Utilities.sleep(300); } catch(e) { Logger.log('DataInduk: '+e); }
  try { buatSheet_LaporanHarian(ss); SpreadsheetApp.flush(); Utilities.sleep(300); } catch(e) { Logger.log('LaporanHarian: '+e); }
  try { buatSheet_LaporanSiswa(ss);  SpreadsheetApp.flush(); Utilities.sleep(300); } catch(e) { Logger.log('LaporanSiswa: '+e); }
  try { buatSheet_Rekapan(ss);       SpreadsheetApp.flush(); Utilities.sleep(300); } catch(e) { Logger.log('Rekapan: '+e); }
  try { buatSheet_Dashboard(ss);     SpreadsheetApp.flush(); Utilities.sleep(300); } catch(e) { Logger.log('Dashboard: '+e); }

  updateVersi_();

  try { ss.deleteSheet(dummy); SpreadsheetApp.flush(); } catch(e) {}

  var urutan = ['Dashboard','Rekapan','Laporan_Harian','Laporan_Siswa','Data_Mentah','Data_Induk'];
  urutan.forEach(function(nama, idx) {
    try {
      var s = ss.getSheetByName(nama);
      if (s) { ss.setActiveSheet(s); ss.moveActiveSheet(idx + 1); }
    } catch(e) {}
  });

  try { ss.setActiveSheet(ss.getSheetByName('Dashboard')); } catch(e) {}

  SpreadsheetApp.getUi().alert(
    '✅ Setup selesai!\n\n' +
    'Cara pakai Dashboard:\n' +
    '• Ganti bulan → ketik angka di sel B4  (contoh: 5)\n' +
    '• Ganti tahun → ketik angka di sel D4  (contoh: 2026)\n' +
    '• Override hari efektif → ketik di sel F4 (kosongkan = otomatis)\n\n' +
    'Langkah berikutnya:\n' +
    '1. Run pasangTriggerOnEdit()\n' +
    '2. Run buatChartDashboard()\n' +
    '3. Deploy → New Deployment → Web App\n' +
    '   Execute as: Me | Access: Anyone\n' +
    '4. Salin Deployment ID ke ESP32'
  );
}


// ====================================================
//  BUILDER: Data_Mentah
// ====================================================
function buatSheet_DataMentah(ss) {
  var s = ss.insertSheet(SHEET_MENTAH);
  s.getRange('A1:I1')
    .setValues([['Timestamp_Server','Tap_Asli','Hari','Tanggal','Jam',
                 'UID','Nama','Jabatan','Kelas / Bidang']])
    .setBackground('#1a73e8').setFontColor('#ffffff')
    .setFontWeight('bold').setHorizontalAlignment('center');
  [170,170,80,110,90,130,180,100,150].forEach(function(w,i){ s.setColumnWidth(i+1,w); });
  s.getRange('A2:A').setNumberFormat('dd/MM/yyyy HH:mm:ss');
  s.getRange('B2:B').setNumberFormat('dd/MM/yyyy HH:mm:ss');
  s.getRange('D2:D').setNumberFormat('yyyy-MM-dd');
  s.setFrozenRows(1);
}


// ====================================================
//  BUILDER: Data_Induk
// ====================================================
function buatSheet_DataInduk(ss) {
  var s = ss.insertSheet(SHEET_INDUK);
  s.getRange('A1:D1')
    .setValues([['UID','Nama','Jabatan','Kelas / Bidang']])
    .setBackground('#0f9d58').setFontColor('#ffffff')
    .setFontWeight('bold').setHorizontalAlignment('center');
  [160,200,120,160].forEach(function(w,i){ s.setColumnWidth(i+1,w); });
  s.setFrozenRows(1);
  s.getRange('Y1').setValue('Versi:').setFontWeight('bold')
    .setHorizontalAlignment('right').setFontColor('#9e9e9e').setFontSize(10);
  s.getRange(VERSI_CELL).setFontColor('#9e9e9e').setFontSize(10).setNumberFormat('0');
  s.setColumnWidth(25, 60); s.setColumnWidth(26, 130);
  s.getRange(2, 1, 1, 4).setValues([['0586995161D100','Isma Izha Utama','Guru','Informatika']]);
  s.getRange('A2:D2').setBackground('#e8f5e9');
}


// ====================================================
//  BUILDER: Laporan_Harian
// ====================================================
function buatSheet_LaporanHarian(ss) {
  var s = ss.insertSheet(SHEET_LAPORAN);
  s.getRange('A1:G1')
    .setValues([['Tanggal','Jam Masuk','UID','Nama','Jabatan','Kelas / Bidang','Status']])
    .setBackground('#37474f').setFontColor('#ffffff')
    .setFontWeight('bold').setHorizontalAlignment('center').setFontSize(11);
  [110,90,140,180,90,140,110].forEach(function(w,i){ s.setColumnWidth(i+1,w); });
  s.setFrozenRows(1);

  s.getRange('A2').setFormula(
    '=IFERROR(QUERY(Data_Mentah!D:I,' +
    '"SELECT D, MIN(E), F, G, H, I ' +
    'WHERE D IS NOT NULL AND G IS NOT NULL AND G != \'\' ' +
    'GROUP BY D, F, G, H, I ' +
    'ORDER BY D DESC, MIN(E) ASC ' +
    'LABEL D \'\', MIN(E) \'\', F \'\', G \'\', H \'\', I \'\'", 0),"")'
  );

  s.getRange('G2').setFormula(
    '=ARRAYFORMULA(IF(A2:A="","",IF(E2:E="Guru","Hadir",' +
    'IF(IFERROR(TIMEVALUE(TEXT(B2:B,"HH:mm:ss")),B2:B)<=TIME(7,0,0),"Hadir","Terlambat"))))'
  );

  s.getRange('A2:A').setNumberFormat('dd/MM/yyyy');
  s.getRange('B2:B').setNumberFormat('HH:mm:ss');

  var r = s.getConditionalFormatRules();
  r.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('Hadir').setBackground('#e8f5e9').setFontColor('#2e7d32').setBold(true)
    .setRanges([s.getRange('G2:G')]).build());
  r.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('Terlambat').setBackground('#fff3e0').setFontColor('#e65100').setBold(true)
    .setRanges([s.getRange('G2:G')]).build());
  s.setConditionalFormatRules(r);
}


// ====================================================
//  BUILDER: Laporan_Siswa
// ====================================================
function buatSheet_LaporanSiswa(ss) {
  var s = ss.insertSheet(SHEET_SISWA);
  s.getRange('A1:G1')
    .setValues([['Tanggal','Jam Masuk','UID','Nama','Kelas / Bidang','Status','']])
    .setBackground('#1b5e20').setFontColor('#ffffff')
    .setFontWeight('bold').setHorizontalAlignment('center').setFontSize(11);
  s.getRange('G1').setValue('').setBackground('#1b5e20');
  [110,90,140,200,160,110,10].forEach(function(w,i){ s.setColumnWidth(i+1,w); });
  s.setFrozenRows(1);
  s.setTabColor('#1b5e20');

  s.insertRowBefore(1);
  s.getRange('A1:F1').merge()
    .setValue('LAPORAN KEHADIRAN SISWA — MA NURUL HUDA MERGOSONO')
    .setBackground('#1b5e20').setFontColor('#ffffff')
    .setFontSize(13).setFontWeight('bold')
    .setHorizontalAlignment('center').setVerticalAlignment('middle');
  s.setRowHeight(1, 36);

  s.getRange('A3').setFormula(
    '=IFERROR(QUERY(Laporan_Harian!A:G,' +
    '"SELECT A, B, C, D, F, G ' +
    'WHERE A IS NOT NULL AND E = \'Siswa\' ' +
    'ORDER BY A DESC, B ASC ' +
    'LABEL A \'\', B \'\', C \'\', D \'\', F \'\', G \'\'", 0),"")'
  );

  s.getRange('A3:A').setNumberFormat('dd/MM/yyyy');
  s.getRange('B3:B').setNumberFormat('HH:mm:ss');

  var r = s.getConditionalFormatRules();
  r.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('Hadir').setBackground('#e8f5e9').setFontColor('#2e7d32').setBold(true)
    .setRanges([s.getRange('F3:F')]).build());
  r.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('Terlambat').setBackground('#fff3e0').setFontColor('#e65100').setBold(true)
    .setRanges([s.getRange('F3:F')]).build());
  s.setConditionalFormatRules(r);
  s.hideColumns(7);
}


// ====================================================
//  BUILDER: Rekapan
//  [v8] Filter bulan & tahun dibaca dari Dashboard!B4 & D4
//       (bukan dari Rekapan!B2 & D2 lagi)
//  [v7] Hari Efektif: COUNTUNIQUE+FILTER (hari unik)
// ====================================================
function buatSheet_Rekapan(ss) {
  var s = ss.insertSheet(SHEET_REKAP);

  // Header
  s.getRange('A1:H1').merge().setValue('REKAPAN KEHADIRAN — MA NURUL HUDA MERGOSONO')
    .setBackground('#1a237e').setFontColor('#ffffff')
    .setFontWeight('bold').setHorizontalAlignment('center').setFontSize(13);
  s.setRowHeight(1, 40);

  // Baris 2: sinkronisasi dari Dashboard (baca otomatis, tidak perlu diedit di sini)
  s.getRange('A2:H2').merge()
    .setValue('⚠️ Jangan edit di sini. Ganti bulan/tahun langsung di sheet Dashboard (sel B4 & D4).')
    .setBackground('#fff3e0').setFontColor('#e65100')
    .setFontSize(10).setHorizontalAlignment('center').setVerticalAlignment('middle')
    .setFontStyle('italic');
  s.setRowHeight(2, 28);

  // Sel helper tersembunyi: B2=bulan, D2=tahun, F2=override (sinkron dari Dashboard)
  // Diletakkan di kolom Z agar tidak mengganggu tampilan
  s.getRange('Z2').setFormula('=Dashboard!B4');  // bulan
  s.getRange('Z3').setFormula('=Dashboard!D4');  // tahun
  s.getRange('Z4').setFormula('=Dashboard!F4');  // override hari efektif
  s.hideColumns(26); // sembunyikan kolom Z

  // Spacer
  s.getRange('A3:H3').setBackground('#e0e0e0'); s.setRowHeight(3, 4);

  // Header tabel
  s.getRange('A4:H4')
    .setValues([['No','Nama','Jabatan','Kelas / Bidang',
                 'Total Hadir','Total Terlambat','Hari Efektif','% Kehadiran']])
    .setBackground('#283593').setFontColor('#ffffff')
    .setFontWeight('bold').setHorizontalAlignment('center').setFontSize(11);
  s.setRowHeight(4, 36);
  s.setFrozenRows(4);
  [40,180,90,150,110,130,110,110].forEach(function(w,i){ s.setColumnWidth(i+1,w); });

  // Data dari Data_Induk
  s.getRange('B5').setFormula('=IFERROR(FILTER(Data_Induk!B2:B,Data_Induk!A2:A<>""),"")');
  s.getRange('C5').setFormula('=IFERROR(FILTER(Data_Induk!C2:C,Data_Induk!A2:A<>""),"")');
  s.getRange('D5').setFormula('=IFERROR(FILTER(Data_Induk!D2:D,Data_Induk!A2:A<>""),"")');

  var MAX_ORANG = 50;
  for (var baris = 5; baris < 5 + MAX_ORANG; baris++) {
    var b = baris;

    // Nomor urut
    s.getRange(b, 1).setFormula('=IF(B' + b + '="","",ROW()-4)');

    // Total Hadir — referensi ke Z2 (bulan) dan Z3 (tahun) dari Dashboard
    s.getRange(b, 5).setFormula(
      '=IFERROR(SUMPRODUCT(' +
      '(Laporan_Harian!D$2:D$500=B' + b + ')' +
      '*(MONTH(Laporan_Harian!A$2:A$500)=VALUE(Rekapan!$Z$2))' +
      '*(YEAR(Laporan_Harian!A$2:A$500)=VALUE(Rekapan!$Z$3))),0)'
    );

    // Total Terlambat
    s.getRange(b, 6).setFormula(
      '=IF(B' + b + '="","",IF(C' + b + '="Guru","N/A",' +
      'IFERROR(SUMPRODUCT(' +
      '(Laporan_Harian!D$2:D$500=B' + b + ')' +
      '*(MONTH(Laporan_Harian!A$2:A$500)=VALUE(Rekapan!$Z$2))' +
      '*(YEAR(Laporan_Harian!A$2:A$500)=VALUE(Rekapan!$Z$3))' +
      '*(Laporan_Harian!G$2:G$500="Terlambat")),0)))'
    );

    // Hari Efektif: COUNTUNIQUE hari unik (fix v7), override dari Dashboard!F4
    s.getRange(b, 7).setFormula(
      '=IF(B' + b + '="","",IF(Rekapan!$Z$4<>"",VALUE(Rekapan!$Z$4),' +
      'IFERROR(COUNTUNIQUE(FILTER(' +
      'Laporan_Harian!A$2:A$500,' +
      'MONTH(Laporan_Harian!A$2:A$500)=VALUE(Rekapan!$Z$2),' +
      'YEAR(Laporan_Harian!A$2:A$500)=VALUE(Rekapan!$Z$3),' +
      'Laporan_Harian!A$2:A$500<>""' +
      ')),0)))'
    );

    // % Kehadiran
    s.getRange(b, 8).setFormula(
      '=IF(B' + b + '="","",IF(G' + b + '=0,"-",TEXT(E' + b + '/G' + b + ',"0.0%")))'
    );
  }

  // Conditional formatting
  var rf = s.getConditionalFormatRules();
  var rp = s.getRange('H5:H100');
  rf.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=AND(H5<>"-",H5<>"",VALUE(SUBSTITUTE(H5,"%",""))>=90)')
    .setBackground('#c8e6c9').setFontColor('#1b5e20').setBold(true).setRanges([rp]).build());
  rf.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=AND(H5<>"-",H5<>"",VALUE(SUBSTITUTE(H5,"%",""))>=75,VALUE(SUBSTITUTE(H5,"%",""))<90)')
    .setBackground('#fff9c4').setFontColor('#e65100').setBold(true).setRanges([rp]).build());
  rf.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=AND(H5<>"-",H5<>"",VALUE(SUBSTITUTE(H5,"%",""))<75)')
    .setBackground('#ffcdd2').setFontColor('#b71c1c').setBold(true).setRanges([rp]).build());
  var rc = s.getRange('C5:C100');
  rf.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('Guru').setBackground('#e3f2fd').setFontColor('#0d47a1').setBold(true).setRanges([rc]).build());
  rf.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('Siswa').setBackground('#e8f5e9').setFontColor('#1b5e20').setBold(true).setRanges([rc]).build());
  s.setConditionalFormatRules(rf);
}


// ====================================================
//  BUILDER: Dashboard (v8 — Simpel & Ramah Awam)
//
//  STRUKTUR:
//  Baris 1    : Judul
//  Baris 2    : Tanggal update otomatis
//  Baris 3    : Spacer
//  Baris 4-6  : Panel filter — LANGSUNG DIEDIT DI SINI
//               B4 = Bulan (ketik 1-12)
//               D4 = Tahun (ketik 2025/2026/dst)
//               F4 = Override Hari Efektif (opsional, kosongkan = otomatis)
//  Baris 7    : Spacer
//  Baris 8-10 : 4 kartu ringkasan (Total, Hadir, Rata-rata, Terlambat)
//  Baris 11   : Spacer
//  Baris 12   : Header tabel
//  Baris 13+  : Data rekapan
// ====================================================
function buatSheet_Dashboard(ss) {
  var s = ss.insertSheet(SHEET_DASHBOARD);
  s.setTabColor('#1a237e');
  s.setHiddenGridlines(true);

  var bulanIni = new Date().getMonth() + 1;
  var tahunIni = new Date().getFullYear();

  // ── BARIS 1: Judul ──────────────────────────────────────────
  s.getRange('A1:J1').merge()
    .setValue('📋  DASHBOARD KEHADIRAN  ·  MA NURUL HUDA MERGOSONO')
    .setBackground('#1a237e').setFontColor('#ffffff')
    .setFontSize(15).setFontWeight('bold')
    .setHorizontalAlignment('center').setVerticalAlignment('middle');
  s.setRowHeight(1, 50);

  // ── BARIS 2: Periode otomatis ────────────────────────────────
  s.getRange('A2:J2').merge()
    .setFormula('="Menampilkan data: "&TEXT(DATE(VALUE(B4),VALUE(D4),1),"MMMM YYYY")')
    .setBackground('#283593').setFontColor('#c5cae9')
    .setFontSize(11).setHorizontalAlignment('center').setVerticalAlignment('middle');
  s.setRowHeight(2, 26);

  // ── BARIS 3: Spacer ──────────────────────────────────────────
  s.getRange('A3:J3').setBackground('#e8eaf6'); s.setRowHeight(3, 8);

  // ── BARIS 4-6: PANEL FILTER ─────────────────────────────────
  // Label instruksi
  s.getRange('A4:J4').merge()
    .setValue('✏️  GANTI PERIODE DI BAWAH INI  —  Ketik angka lalu tekan Enter')
    .setBackground('#FFF8E1').setFontColor('#F57F17')
    .setFontSize(10).setFontWeight('bold')
    .setHorizontalAlignment('center').setVerticalAlignment('middle');
  s.setRowHeight(4, 24);

  // Baris 5: label kolom filter
  s.setRowHeight(5, 22);
  s.getRange('A5:B5').merge().setValue('BULAN')
    .setBackground('#37474f').setFontColor('#ffffff')
    .setFontSize(10).setFontWeight('bold')
    .setHorizontalAlignment('center').setVerticalAlignment('middle');
  s.getRange('C5:D5').merge().setValue('TAHUN')
    .setBackground('#37474f').setFontColor('#ffffff')
    .setFontSize(10).setFontWeight('bold')
    .setHorizontalAlignment('center').setVerticalAlignment('middle');
  s.getRange('E5:G5').merge().setValue('HARI EFEKTIF  (kosongkan = otomatis)')
    .setBackground('#37474f').setFontColor('#ffffff')
    .setFontSize(10).setFontWeight('bold')
    .setHorizontalAlignment('center').setVerticalAlignment('middle');
  s.getRange('H5:J5').merge().setValue('Keterangan')
    .setBackground('#37474f').setFontColor('#ffffff')
    .setFontSize(10).setFontWeight('bold')
    .setHorizontalAlignment('center').setVerticalAlignment('middle');

  // Baris 6: INPUT FILTER — inilah sel yang diedit pengguna
  s.setRowHeight(6, 46);

  // B6 = BULAN ← EDIT DI SINI
  s.getRange('A6:B6').merge()
    .setNumberFormat('@STRING@')
    .setValue(String(bulanIni))
    .setBackground('#FFFDE7').setFontColor('#1a237e')
    .setFontSize(22).setFontWeight('bold')
    .setHorizontalAlignment('center').setVerticalAlignment('middle')
    .setBorder(true, true, true, true, false, false,
      '#F9A825', SpreadsheetApp.BorderStyle.MEDIUM_DASHED);

  // D6 = TAHUN ← EDIT DI SINI
  s.getRange('C6:D6').merge()
    .setNumberFormat('@STRING@')
    .setValue(String(tahunIni))
    .setBackground('#FFFDE7').setFontColor('#1a237e')
    .setFontSize(22).setFontWeight('bold')
    .setHorizontalAlignment('center').setVerticalAlignment('middle')
    .setBorder(true, true, true, true, false, false,
      '#F9A825', SpreadsheetApp.BorderStyle.MEDIUM_DASHED);

  // F6 = Override Hari Efektif ← EDIT DI SINI (opsional)
  s.getRange('E6:G6').merge()
    .setNumberFormat('@STRING@')
    .setValue('')
    .setBackground('#FFFDE7').setFontColor('#1a237e')
    .setFontSize(22).setFontWeight('bold')
    .setHorizontalAlignment('center').setVerticalAlignment('middle')
    .setBorder(true, true, true, true, false, false,
      '#F9A825', SpreadsheetApp.BorderStyle.MEDIUM_DASHED);

  // Keterangan
  s.getRange('H6:J6').merge()
    .setValue('Contoh: Bulan → 5\nTahun → 2026\nHari Efektif → kosongkan saja')
    .setBackground('#F5F5F5').setFontColor('#546e7a')
    .setFontSize(9).setHorizontalAlignment('left').setVerticalAlignment('middle')
    .setWrap(true);

  // Lebar kolom
  [80,80,80,80,80,80,80,120,80,80].forEach(function(w,i){ s.setColumnWidth(i+1,w); });

  // ── BARIS 7: Spacer ──────────────────────────────────────────
  s.getRange('A7:J7').setBackground('#e8eaf6'); s.setRowHeight(7, 8);

  // ── BARIS 8-10: KARTU RINGKASAN ─────────────────────────────
  // Referensi bulan/tahun ke B6 & D6 (Dashboard)
  s.setRowHeight(8, 20); s.setRowHeight(9, 46); s.setRowHeight(10, 20);

  function buatKartu(labelRange, valRange, botRange, label, formula, cBg, cFg, vBg, vFg) {
    s.getRange(labelRange).merge().setValue(label)
      .setBackground(cBg).setFontColor(cFg)
      .setFontSize(9).setFontWeight('bold')
      .setHorizontalAlignment('center').setVerticalAlignment('middle');
    s.getRange(valRange).merge().setFormula(formula)
      .setBackground(vBg).setFontColor(vFg)
      .setFontSize(18).setFontWeight('bold')
      .setHorizontalAlignment('center').setVerticalAlignment('middle');
    s.getRange(botRange).merge().setBackground(vBg);
  }

  buatKartu('A8:B8','A9:B9','A10:B10',
    'TOTAL TERDAFTAR',
    '=COUNTA(Data_Induk!B2:B)&" Orang"',
    '#0d47a1','#ffffff','#e3f2fd','#0d47a1');

  buatKartu('C8:D8','C9:D9','C10:D10',
    'HADIR HARI INI',
    '=COUNTIFS(Laporan_Harian!A:A,TODAY(),Laporan_Harian!G:G,"<>")&" Orang"',
    '#1b5e20','#ffffff','#e8f5e9','#1b5e20');

  buatKartu('E8:G8','E9:G9','E10:G10',
    'RATA-RATA KEHADIRAN BULAN INI',
    '=IFERROR(TEXT(AVERAGEIF(Rekapan!H5:H100,"<>-",IFERROR(VALUE(SUBSTITUTE(Rekapan!H5:H100,"%",""))/100,"")),"0.0%"),"-")',
    '#4a148c','#ffffff','#f3e5f5','#4a148c');

  buatKartu('H8:J8','H9:J9','H10:J10',
    'TERLAMBAT BULAN INI',
    '=IFERROR(SUMPRODUCT((Laporan_Harian!G2:G500="Terlambat")*(MONTH(Laporan_Harian!A2:A500)=VALUE(Dashboard!A6:B6))*(YEAR(Laporan_Harian!A2:A500)=VALUE(Dashboard!C6:D6)))&" Kejadian","0 Kejadian")',
    '#b71c1c','#ffffff','#ffebee','#b71c1c');

  // ── BARIS 11: Spacer ─────────────────────────────────────────
  s.getRange('A11:J11').setBackground('#e8eaf6'); s.setRowHeight(11, 8);

  // ── BARIS 12: Header tabel ───────────────────────────────────
  s.getRange('A12:H12')
    .setValues([['No','Nama','Jabatan','Kelas / Bidang',
                 'Total Hadir','Terlambat','Hari Efektif','% Kehadiran']])
    .setBackground('#37474f').setFontColor('#ffffff')
    .setFontWeight('bold').setHorizontalAlignment('center').setFontSize(11);
  s.setRowHeight(12, 36);
  s.setFrozenRows(12);
  [35,185,90,145,115,115,115,115].forEach(function(w,i){ s.setColumnWidth(i+1,w); });

  // ── BARIS 13+: Data dari Rekapan ────────────────────────────
  s.getRange('A13').setFormula('=ARRAYFORMULA(IF(B13:B70="","",ROW(B13:B70)-ROW(B13)+1))');
  s.getRange('B13').setFormula('=IFERROR(Rekapan!B5:B54,"")');
  s.getRange('C13').setFormula('=IFERROR(Rekapan!C5:C54,"")');
  s.getRange('D13').setFormula('=IFERROR(Rekapan!D5:D54,"")');
  s.getRange('E13').setFormula('=IFERROR(Rekapan!E5:E54,"")');
  s.getRange('F13').setFormula('=IFERROR(Rekapan!F5:F54,"")');
  s.getRange('G13').setFormula('=IFERROR(Rekapan!G5:G54,"")');
  s.getRange('H13').setFormula('=IFERROR(Rekapan!H5:H54,"")');

  // Alternating row colors
  var rdt = s.getConditionalFormatRules();
  rdt.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=AND(MOD(ROW(),2)=1,$B13<>"")')
    .setBackground('#fafafa').setRanges([s.getRange('A13:H70')]).build());
  rdt.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=AND(MOD(ROW(),2)=0,$B13<>"")')
    .setBackground('#f0f0f0').setRanges([s.getRange('A13:H70')]).build());

  // % kehadiran
  var rph = s.getRange('H13:H70');
  rdt.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=AND(H13<>"-",H13<>"",VALUE(SUBSTITUTE(H13,"%",""))>=90)')
    .setBackground('#c8e6c9').setFontColor('#1b5e20').setBold(true).setRanges([rph]).build());
  rdt.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=AND(H13<>"-",H13<>"",VALUE(SUBSTITUTE(H13,"%",""))>=75,VALUE(SUBSTITUTE(H13,"%",""))<90)')
    .setBackground('#fff9c4').setFontColor('#e65100').setBold(true).setRanges([rph]).build());
  rdt.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=AND(H13<>"-",H13<>"",VALUE(SUBSTITUTE(H13,"%",""))<75)')
    .setBackground('#ffcdd2').setFontColor('#b71c1c').setBold(true).setRanges([rph]).build());

  // Jabatan color
  var rcj = s.getRange('C13:C70');
  rdt.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('Guru').setBackground('#e3f2fd').setFontColor('#0d47a1').setBold(true).setRanges([rcj]).build());
  rdt.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('Siswa').setBackground('#e8f5e9').setFontColor('#1b5e20').setBold(true).setRanges([rcj]).build());

  s.setConditionalFormatRules(rdt);
}

// Helper konversi huruf kolom ke angka
function columnLetterToNumber(letter) {
  var n = 0;
  for (var i = 0; i < letter.length; i++) {
    n = n * 26 + letter.charCodeAt(i) - 64;
  }
  return n;
}


// ====================================================
//  CHART — jalankan setelah setupSpreadsheet()
// ====================================================
function buatChartDashboard() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var s  = ss.getSheetByName(SHEET_DASHBOARD);
  if (!s) {
    SpreadsheetApp.getUi().alert('Jalankan setupSpreadsheet() dulu.');
    return;
  }

  s.getCharts().forEach(function(c){ s.removeChart(c); });

  // Chart menggunakan header baris 12 dan data mulai baris 13
  var chart = s.newChart()
    .setChartType(Charts.ChartType.BAR)
    .addRange(s.getRange('B12:B70'))
    .addRange(s.getRange('E12:E70'))
    .setPosition(13, 10, 10, 0)
    .setNumHeaders(1)
    .setOption('title', 'Total Kehadiran per Orang')
    .setOption('titleTextStyle', { fontSize: 12, bold: true, color: '#1a237e' })
    .setOption('legend', { position: 'none' })
    .setOption('colors', ['#1565c0'])
    .setOption('backgroundColor', { fill: '#fafafa' })
    .setOption('hAxis', {
      title: 'Jumlah Hari Hadir',
      titleTextStyle: { color: '#546e7a', fontSize: 10 },
      textStyle: { color: '#37474f' }
    })
    .setOption('vAxis', { textStyle: { color: '#37474f', fontSize: 11 } })
    .setOption('chartArea', { left: 130, top: 40, width: '60%', height: '72%' })
    .setOption('width', 420)
    .setOption('height', 300)
    .build();

  s.insertChart(chart);
  SpreadsheetApp.getUi().alert('✅ Chart berhasil dibuat di Dashboard.');
}


// ====================================================
//  UTILITAS
// ====================================================
function bersihkanDataMentah() {
  var s = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_MENTAH);
  var last = s.getLastRow();
  if (last > 1) {
    s.getRange(2, 1, last - 1, 9).clearContent();
    SpreadsheetApp.getUi().alert('Data_Mentah berhasil dibersihkan.');
  } else {
    SpreadsheetApp.getUi().alert('Data_Mentah sudah kosong.');
  }
}

function paksaUpdateVersi() {
  updateVersi_();
  SpreadsheetApp.getUi().alert('Versi: ' + bacaVersi_());
}

function resetFilterBulanIni() {
  var s = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_DASHBOARD);
  if (!s) return;
  // Reset ke bulan & tahun saat ini di sel filter Dashboard
  s.getRange('A6:B6').setValue(String(new Date().getMonth() + 1));
  s.getRange('C6:D6').setValue(String(new Date().getFullYear()));
  s.getRange('E6:G6').setValue('');
  SpreadsheetApp.getUi().alert('Filter di-reset ke bulan ini.');
}

function balikUrutanDataMentah() {
  var ss   = SpreadsheetApp.getActiveSpreadsheet();
  var s    = ss.getSheetByName(SHEET_MENTAH);
  var last = s.getLastRow();
  if (last < 3) {
    SpreadsheetApp.getUi().alert('Data kurang dari 2 baris.');
    return;
  }
  var data    = s.getRange(2, 1, last-1, 9).getValues();
  var formats = s.getRange(2, 1, last-1, 9).getNumberFormats();
  data.reverse(); formats.reverse();
  s.getRange(2, 1, last-1, 9).setValues(data).setNumberFormats(formats);
  SpreadsheetApp.getUi().alert('✅ Urutan dibalik. Data terbaru sekarang di atas.');
}