/**
 * 伊手 鳥獣出没マップ 読み書きAPI(Google Apps Script)
 * 記録用のスプレッドシートで「拡張機能 → Apps Script」を開き、中身を消してこのファイルを貼り付ける。
 *
 * スクリプト プロパティ(任意):
 *   SHEET         … 記録するシート名(省略時は「出没記録」。なければ作る)
 *   PHOTO_FOLDER  … 写真を保存するGoogleドライブのフォルダID(省略時は初回に「伊手鳥獣マップ写真」を作って記録する)
 *
 * 認証はまだ付けていない。URLを知っている人は誰でも読み書きできる。
 * 削除は、投稿した端末だけが持つ削除キーで行う(管理者はシートの「状態」列に「削除」と書けば非表示にできる)。
 */
const SHEET_DEFAULT = '出没記録';
const HEADERS = ['id', '見た日時', '動物', '動物名(その他)', '内容', '頭数', '集落', '地目', 'fid',
  'lat', 'lng', 'メモ', '写真ID', '投稿者', '登録日時', '状態', '削除キー'];
const PUBLIC = HEADERS.filter(h => h !== '削除キー');
const SPECIES = ['クマ', 'シカ', 'イノシシ', 'サル', 'その他'];
const KINDS = ['目撃', '痕跡(足跡・フン)', '農作物の被害', '人身・物損'];
// 伊手地区のまわり(少し広め)。これより外の座標は受け付けない
const BBOX = { w: 141.24, s: 39.11, e: 141.41, n: 39.23 };
const MAX_PHOTO_BYTES = 1500000;

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const name = PropertiesService.getScriptProperties().getProperty('SHEET') || SHEET_DEFAULT;
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  const lastCol = Math.max(sh.getLastColumn(), 1);
  const head = sh.getRange(1, 1, 1, lastCol).getDisplayValues()[0].map(String);
  if (head.every(h => !h)) {
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
    return { sh, head: HEADERS.slice() };
  }
  const missing = HEADERS.filter(h => head.indexOf(h) < 0);
  if (missing.length) {
    sh.getRange(1, head.length + 1, 1, missing.length).setValues([missing]);
    missing.forEach(h => head.push(h));
  }
  return { sh, head };
}

function readAll_() {
  const { sh, head } = sheet_();
  const n = sh.getLastRow() - 1;
  const vals = n > 0 ? sh.getRange(2, 1, n, head.length).getDisplayValues() : [];
  return { sh, head, vals };
}

/** GET …/exec  → 削除されていない記録の一覧 */
function doGet(e) {
  try {
    const { head, vals } = readAll_();
    const iState = head.indexOf('状態'), iId = head.indexOf('id');
    const rows = vals
      .filter(v => v[iId] && v[iState] !== '削除')
      .map(v => Object.fromEntries(PUBLIC.map(h => [h, v[head.indexOf(h)]])));
    return out_({ ok: true, rows });
  } catch (err) {
    return out_({ ok: false, error: String(err.message || err) });
  }
}

/** POST …/exec  本文はJSON {action:'add', record, photo} または {action:'delete', id, key} */
function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.action === 'add') return out_(add_(body, lock));
    if (body.action === 'delete') return out_(del_(body, lock));
    return out_({ ok: false, error: '不明な操作です' });
  } catch (err) {
    return out_({ ok: false, error: String(err.message || err) });
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

function add_(body, lock) {
  const r = body.record || {};
  const lat = Number(r.lat), lng = Number(r.lng);
  if (!(lat > BBOX.s && lat < BBOX.n && lng > BBOX.w && lng < BBOX.e)) return { ok: false, error: '伊手地区の外の場所は登録できません' };
  if (SPECIES.indexOf(r['動物']) < 0) return { ok: false, error: '動物の種類が正しくありません' };
  if (KINDS.indexOf(r['内容']) < 0) return { ok: false, error: '内容の区分が正しくありません' };
  if (!r['見た日時']) return { ok: false, error: '見た日時が必要です' };
  const key = String(body.key || '');
  if (key.length < 16) return { ok: false, error: '削除キーがありません' };

  const tz = Session.getScriptTimeZone() || 'Asia/Tokyo';
  const id = Utilities.formatDate(new Date(), tz, 'yyyyMMddHHmmss') + '-' + Utilities.getUuid().slice(0, 6);
  let photoId = '';
  if (body.photo) photoId = savePhoto_(body.photo, id);

  const clip = (s, n) => String(s == null ? '' : s).slice(0, n);
  const row = {
    'id': id,
    '見た日時': clip(r['見た日時'], 16),
    '動物': r['動物'],
    '動物名(その他)': r['動物'] === 'その他' ? clip(r['動物名(その他)'], 30) : '',
    '内容': r['内容'],
    '頭数': String(Math.max(0, Math.min(99, parseInt(r['頭数'], 10) || 0))),
    '集落': clip(r['集落'], 20),
    '地目': clip(r['地目'], 4),
    'fid': r.fid ? String(parseInt(r.fid, 10)) : '',
    'lat': lat.toFixed(6),
    'lng': lng.toFixed(6),
    'メモ': clip(r['メモ'], 400),
    '写真ID': photoId,
    '投稿者': clip(r['投稿者'], 20),
    '登録日時': Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm:ss'),
    '状態': '',
    '削除キー': key.slice(0, 64),
  };
  lock.waitLock(10000);
  const { sh, head } = sheet_();
  const range = sh.getRange(sh.getLastRow() + 1, 1, 1, head.length);
  range.setNumberFormat('@');  // 日付などが勝手に変換されないよう文字列で書く
  range.setValues([head.map(h => row[h] == null ? '' : String(row[h]))]);
  return { ok: true, row: Object.fromEntries(PUBLIC.map(h => [h, row[h]])) };
}

function del_(body, lock) {
  lock.waitLock(10000);
  const { sh, head, vals } = readAll_();
  const iId = head.indexOf('id'), iKey = head.indexOf('削除キー'), iState = head.indexOf('状態'), iPhoto = head.indexOf('写真ID');
  const k = vals.findIndex(v => v[iId] === String(body.id));
  if (k < 0) return { ok: false, error: '記録が見つかりません' };
  if (!body.key || vals[k][iKey] !== String(body.key)) return { ok: false, error: 'この端末から投稿した記録ではないため削除できません' };
  sh.getRange(k + 2, iState + 1).setValue('削除');
  if (vals[k][iPhoto]) { try { DriveApp.getFileById(vals[k][iPhoto]).setTrashed(true); } catch (_) {} }
  return { ok: true };
}

function photoFolder_() {
  const props = PropertiesService.getScriptProperties();
  const fid = props.getProperty('PHOTO_FOLDER');
  if (fid) { try { return DriveApp.getFolderById(fid); } catch (_) {} }
  const f = DriveApp.createFolder('伊手鳥獣マップ写真');
  props.setProperty('PHOTO_FOLDER', f.getId());
  return f;
}

function savePhoto_(dataUrl, id) {
  const m = /^data:image\/jpeg;base64,(.+)$/.exec(String(dataUrl));
  if (!m) throw new Error('写真はJPEGで送ってください');
  const bytes = Utilities.base64Decode(m[1]);
  if (bytes.length > MAX_PHOTO_BYTES) throw new Error('写真が大きすぎます');
  const file = photoFolder_().createFile(Utilities.newBlob(bytes, 'image/jpeg', id + '.jpg'));
  // 地図から写真を表示できるよう「リンクを知っている全員が閲覧可」にする
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (_) {}
  return file.getId();
}

/** 初回だけエディタで実行して、シート・写真フォルダの作成とドライブの権限承認を済ませる */
function setup() {
  sheet_();
  Logger.log('写真フォルダ: ' + photoFolder_().getUrl());
}
