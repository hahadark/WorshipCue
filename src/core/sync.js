'use strict';
// 여러 PC 사이 동기화 · 자동 백업
//
// 동기화: 설정의 syncDir(원드라이브 같은 동기화 폴더)에 WorshipCue-sync.json 을 쓰고 읽는다.
//   - 찬양 라이브러리 · 큐시트 · 오버레이. 같은 id 는 updated_at 이 최신인 쪽이 이긴다 (지우기는 휴지통 표시만 전달).
//   - 시작할 때 읽고, 바뀐 것이 있으면 1분 안에 쓰고, 끝날 때 쓴다.
// 백업: 하루 한 번 bible.db(찬양·큐시트·기록이 든 DB)와 settings.json 을 data/backups 에 복사. 10일치 보관.
//   되돌리기는 bible.restore.db 로 적어 두고 다음 시작 때 바꿔 끼운다 (열려 있는 DB 를 바꿀 수 없으므로).

const fs = require('fs');
const os = require('os');
const path = require('path');

const SYNC_FILE = 'WorshipCue-sync.json';
const KEEP_BACKUPS = 10;

class Sync {
  constructor(core) {
    this.core = core;
    this.lastSig = '';
    this.timer = null;
    this.status = { lastImport: '', lastExport: '', remoteAt: '', remoteHost: '', error: '' };
  }

  dir() { return String(this.core.settings.get().syncDir || '').trim(); }
  file() { const d = this.dir(); return d ? path.join(d, SYNC_FILE) : ''; }

  /** 시작: 읽기 → 주기 점검 */
  start() {
    try { this.importNow(); } catch (e) { this.status.error = e.message; this.core.logger.warn('동기화 읽기 실패: ' + e.message); }
    this.lastSig = this.signature();
    this.timer = setInterval(() => { try { this.exportIfChanged(); } catch (e) { this.status.error = e.message; } }, 60000);
    if (this.timer.unref) this.timer.unref();
  }
  stop() { clearInterval(this.timer); try { this.exportIfChanged(); } catch { /* 끝날 때는 조용히 */ } }

  /** DB 가 바뀌었는지 싸게 보는 서명 */
  signature() {
    const db = this.core.store.db;
    const s = db.prepare('SELECT COUNT(*) c, MAX(updated_at) m FROM Songs').get();
    const c = db.prepare('SELECT COUNT(*) c, MAX(updated_at) m, MAX(deleted_at) d FROM Cuesheets').get();
    const ov = JSON.stringify(this.core.settings.get().overlays || []);
    return `${s.c}|${s.m}|${c.c}|${c.m}|${c.d}|${ov.length}|${hash(ov)}`;
  }
  exportIfChanged() {
    if (!this.dir()) return false;
    const sig = this.signature();
    if (sig === this.lastSig) return false;
    this.exportNow();
    this.lastSig = sig;
    return true;
  }

  /** 지금 상태를 동기화 파일로 */
  exportNow() {
    const f = this.file();
    if (!f) throw new Error('동기화 폴더를 설정하세요.');
    fs.mkdirSync(path.dirname(f), { recursive: true });
    const db = this.core.store.db;
    const songs = db.prepare('SELECT id, title, lyrics, credit, tags, arrangement, updated_at FROM Songs').all().map(r => ({ ...r }));
    const cues = db.prepare('SELECT id, name, service_date, start_time, items, updated_at, memo, pinned, template, deleted_at, created_at FROM Cuesheets').all().map(r => ({ ...r }));
    const data = { v: 1, app: 'WorshipCue', at: new Date().toISOString(), host: os.hostname(), songs, cues, overlays: this.core.settings.get().overlays || [] };
    const tmp = f + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, f);
    this.status.lastExport = data.at;
    this.status.error = '';
    this.lastSig = this.signature();
    return { at: data.at, songs: songs.length, cues: cues.length };
  }

  /** 동기화 파일을 읽어 최신 것을 받아들인다 → { songs, cues, overlays } 받은 개수 */
  importNow() {
    const f = this.file();
    if (!f || !fs.existsSync(f)) return { songs: 0, cues: 0, overlays: 0, none: true };
    const data = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (!data || data.app !== 'WorshipCue' || !Array.isArray(data.songs)) throw new Error('동기화 파일 형식이 다릅니다.');
    this.status.remoteAt = data.at || '';
    this.status.remoteHost = data.host || '';
    const db = this.core.store.db;
    const got = { songs: 0, cues: 0, overlays: 0 };
    const newer = (remote, local) => !local || String(remote || '') > String(local || '');
    const tx = fn => () => this.core.store.transaction(fn);
    const run = () => {
      const song = db.prepare('SELECT updated_at FROM Songs WHERE id = ?');
      const putSong = db.prepare('INSERT OR REPLACE INTO Songs (id, title, lyrics, credit, tags, arrangement, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
      for (const s of data.songs) {
        if (!/^[a-z0-9]{4,40}$/i.test(s.id || '') || !String(s.title || '').trim()) continue;
        const l = song.get(s.id);
        if (!newer(s.updated_at, l && l.updated_at)) continue;
        putSong.run(s.id, String(s.title).slice(0, 200), String(s.lyrics || '').slice(0, 50000), String(s.credit || '').slice(0, 300), String(s.tags || '').slice(0, 300), String(s.arrangement || '').slice(0, 300), String(s.updated_at || new Date().toISOString()));
        got.songs += 1;
      }
      const cue = db.prepare('SELECT updated_at, deleted_at FROM Cuesheets WHERE id = ?');
      const putCue = db.prepare('INSERT OR REPLACE INTO Cuesheets (id, name, service_date, start_time, items, updated_at, memo, pinned, template, deleted_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      for (const c of Array.isArray(data.cues) ? data.cues : []) {
        if (!c.id || !String(c.name || '').trim()) continue;
        const l = cue.get(c.id);
        // 수정 시각이 최신인 쪽, 또는 휴지통 표시가 더 최근인 쪽
        if (!newer(c.updated_at, l && l.updated_at) && !newer(c.deleted_at, l && l.deleted_at)) continue;
        let items = '[]';
        try { items = JSON.stringify(JSON.parse(c.items || '[]')); } catch { continue; }
        putCue.run(c.id, String(c.name).slice(0, 200), c.service_date || '', c.start_time || '', items, String(c.updated_at || ''), c.memo || '', c.pinned ? 1 : 0, c.template ? 1 : 0, c.deleted_at || '', c.created_at || '');
        got.cues += 1;
      }
    };
    tx(run)();
    // 오버레이: id 별로 updatedAt 비교 (없으면 원격 것을 넣는다)
    if (Array.isArray(data.overlays) && data.overlays.length) {
      this.core.settings.update(d => {
        const mine = new Map((d.overlays || []).map(o => [o.id, o]));
        for (const o of data.overlays) {
          if (!o || !o.id) continue;
          const l = mine.get(o.id);
          if (l && !newer(o.updatedAt, l.updatedAt)) continue;
          mine.set(o.id, { ...o, on: l ? l.on : false }); // 켜짐 여부는 이 PC 것
          got.overlays += 1;
        }
        d.overlays = [...mine.values()];
      });
    }
    this.status.lastImport = new Date().toISOString();
    this.status.error = '';
    if (got.songs || got.cues) { this.core.emit('songs', {}); this.core.emit('cues', {}); }
    if (got.overlays) this.core.settingsChanged('settings');
    this.core.logger.info(`동기화 읽음: 찬양 ${got.songs} · 큐시트 ${got.cues} · 오버레이 ${got.overlays} (${data.host || ''} ${data.at || ''})`);
    return got;
  }

  info() {
    const f = this.file();
    let fileAt = '';
    try { if (f && fs.existsSync(f)) fileAt = fs.statSync(f).mtime.toISOString(); } catch { /* 무시 */ }
    return { dir: this.dir(), file: f, exists: !!fileAt, fileAt, host: os.hostname(), ...this.status };
  }

  // ---------------- 백업 ----------------
  backupDir() { return path.join(this.core.dataDir, 'backups'); }

  /** 오늘 백업이 없으면 만든다 (시작 20초 뒤에 부른다) */
  backupDaily() {
    const today = new Date().toISOString().slice(0, 10);
    if (this.backups().some(b => b.day === today)) return null;
    return this.backupNow();
  }

  backupNow() {
    const dir = this.backupDir();
    fs.mkdirSync(dir, { recursive: true });
    const day = new Date().toISOString().slice(0, 10);
    const db = this.core.store.db;
    try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch { /* 읽기 전용이면 무시 */ }
    const dbOut = path.join(dir, `WorshipCue-${day}.db`);
    const tmp = dbOut + '.tmp';
    try { db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`); fs.renameSync(tmp, dbOut); } catch { fs.copyFileSync(path.join(this.core.dataDir, 'bible.db'), dbOut); }
    const st = path.join(this.core.dataDir, 'settings.json');
    if (fs.existsSync(st)) fs.copyFileSync(st, path.join(dir, `settings-${day}.json`));
    // 오래된 것 정리
    const list = this.backups();
    for (const b of list.slice(KEEP_BACKUPS)) { for (const f of [b.db, b.settings]) if (f) try { fs.unlinkSync(f); } catch { /* 무시 */ } }
    this.core.logger.info('백업: ' + dbOut);
    return this.backups()[0];
  }

  /** 최신순 */
  backups() {
    const dir = this.backupDir();
    if (!fs.existsSync(dir)) return [];
    const out = [];
    for (const f of fs.readdirSync(dir)) {
      const m = /^WorshipCue-(\d{4}-\d{2}-\d{2})\.db$/.exec(f);
      if (!m) continue;
      const db = path.join(dir, f);
      const settings = path.join(dir, `settings-${m[1]}.json`);
      out.push({ day: m[1], db, settings: fs.existsSync(settings) ? settings : '', size: fs.statSync(db).size });
    }
    return out.sort((a, b) => b.day.localeCompare(a.day));
  }

  /** 되돌리기 예약: 다음 시작 때 bible.db 를 이 백업으로 바꾼다 (지금 것은 bible.pre-restore.db 로 남김) */
  restore(day) {
    const b = this.backups().find(x => x.day === day);
    if (!b) throw new Error('그 날짜의 백업이 없습니다.');
    fs.copyFileSync(b.db, path.join(this.core.dataDir, 'bible.restore.db'));
    if (b.settings) fs.copyFileSync(b.settings, path.join(this.core.dataDir, 'settings.restore.json'));
    return { day, restartNeeded: true };
  }
  cancelRestore() {
    for (const f of ['bible.restore.db', 'settings.restore.json']) { const p = path.join(this.core.dataDir, f); if (fs.existsSync(p)) fs.unlinkSync(p); }
    return {};
  }
  restorePending() { return fs.existsSync(path.join(this.core.dataDir, 'bible.restore.db')); }

  /** 시작 전에(DB 를 열기 전) 예약된 되돌리기를 적용 */
  static applyPendingRestore(dataDir, logger) {
    const r = path.join(dataDir, 'bible.restore.db');
    if (!fs.existsSync(r)) return false;
    const cur = path.join(dataDir, 'bible.db');
    for (const ext of ['', '-wal', '-shm']) { const p = cur + ext; const keep = path.join(dataDir, 'bible.pre-restore.db' + ext); if (fs.existsSync(p)) fs.renameSync(p, keep); }
    fs.renameSync(r, cur);
    const s = path.join(dataDir, 'settings.restore.json');
    if (fs.existsSync(s)) { const st = path.join(dataDir, 'settings.json'); if (fs.existsSync(st)) fs.copyFileSync(st, path.join(dataDir, 'settings.pre-restore.json')); fs.renameSync(s, st); }
    if (logger) logger.info('백업에서 되돌림: ' + cur);
    return true;
  }
}

function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }

module.exports = { Sync, SYNC_FILE };
