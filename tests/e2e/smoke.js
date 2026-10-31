'use strict';
// 조작 화면 점검 (run.js 가 Electron 으로 띄운다): 숨은 창에 /control/ 을 열고 실제 화면 상태를 본다
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
app.commandLine.appendSwitch('use-fake-device-for-media-stream'); // 카메라 점검용 가짜 카메라
app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
const [port, OUT] = process.argv.slice(-2);
const wait = ms => new Promise(r => setTimeout(r, ms));
const R = { log: [], fails: [], console: [] };
const ok = (cond, name, detail) => { if (cond) R.log.push('✓ ' + name); else R.fails.push(name + (detail ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : '')); };

app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  let w;
  try {
    w = new BrowserWindow({ width: 1600, height: 1000, show: false, webPreferences: { offscreen: true } });
    w.webContents.on('console-message', e => { if (e.level === 'error' || /Uncaught|TypeError|ReferenceError/.test(e.message)) R.console.push(e.message.slice(0, 300)); });
    const ev = c => w.webContents.executeJavaScript(`(async () => { const wait = ms => new Promise(r => setTimeout(r, ms)); const $ = s => document.querySelector(s); const $$ = s => [...document.querySelectorAll(s)]; try { ${c} } catch (e) { return { jsErr: String(e.stack).slice(0, 400) }; } })()`);
    const shot = name => w.webContents.capturePage().then(i => fs.writeFileSync(path.join(OUT, name + '.png'), i.toPNG()));
    const load = async () => { await w.loadURL(`http://127.0.0.1:${port}/control/`); await wait(3500); await ev(`if (!$('#modal').hidden) $('#modalClose').click(); return 1;`); };
    await load();

    // ---- 1. 화면이 뜨고 기본 요소가 있다
    const basics = await ev(`return { q: !!$('#q'), cue: !!$('#cueList'), pv: !!$('#pvScreen'), lv: !!$('#lvScreen'), ver: $('#version') && $('#version').options.length };`);
    ok(basics.q && basics.cue && basics.pv && basics.lv, '조작 화면 기본 요소', basics);
    ok(basics.ver >= 1, '성경 번역본 목록', basics);

    // ---- 2. 성경: 검색 → 미리보기 → 송출 → 지우기
    const bible = await ev(`$('#q').focus(); $('#q').value = '요 3:16'; $('#q').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await wait(1500);
      const pv = $('#pvScreen').innerText.replace(/\\s+/g, ' ');
      await window.BC.sendPreview(); await wait(800);
      const lv = $('#lvScreen').innerText.replace(/\\s+/g, ' ');
      await window.BC.cmd('clearAll', {}); await wait(600);
      return { pv, lv, after: window.BC.state.live.visible };`);
    ok(/하나님이 세상을/.test(bible.pv || ''), '성경 검색 → 미리보기', bible);
    ok(/하나님이 세상을/.test(bible.lv || ''), '송출 (F9)', bible);
    ok(bible.after === false, '모두 지우기', bible);

    // ---- 2-1. 즉석 자막: Ctrl+T → 글 쓰고 Enter → 바로 송출 → 최근 목록 → Esc 로 닫기 (보조 화면은 그대로)
    const qt = await ev(`document.body.focus(); window.dispatchEvent(new KeyboardEvent('keydown', { key: 't', code: 'KeyT', ctrlKey: true, bubbles: true })); await wait(300);
      const opened = window.BCQuick.isOpen() && document.activeElement === $('#qtInput');
      $('#qtInput').value = '예배 후 전 교인 식사가 있습니다';
      $('#qtInput').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true })); await wait(900);
      const lv = $('#lvScreen').innerText.replace(/\\s+/g, ' ');
      const title = window.BC.state.live && window.BC.state.live.passage && window.BC.state.live.passage.title;
      const list = $$('#qtList .qt-send').map(b => b.textContent);
      return { opened, lv, title, list };`);
    await shot('quicktext');
    Object.assign(qt, await ev(`$('#qtInput').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })); await wait(200);
      const closed = !window.BCQuick.isOpen();
      await window.BC.cmd('clearAll', {}); await wait(300);
      return { closed, input: $('#qtInput').value };`));
    ok(qt.opened && qt.closed, '즉석 자막: Ctrl+T 로 열고 Esc 로 닫기', qt);
    ok(/전 교인 식사/.test(qt.lv || '') && qt.title === '즉석 자막' && qt.input === '', '즉석 자막: Enter 로 바로 송출', qt);
    ok(qt.list && qt.list[0] === '예배 후 전 교인 식사가 있습니다', '즉석 자막: 최근 목록에 남음', qt);

    // ---- 2-2. 교독문 역할: '회중:' 줄은 굵게, 머리말은 빠짐 → '역할 이름도 보이기' 를 켜면 머리말이 화면에
    const rd = await ev(`const c = (await window.BC.cmd('saveCue', { cue: { name: '교독문 점검', items: [{ type: 'text', title: '교독문 1', body: '인도자: 복 있는 사람은\\n회중: 악인들의 꼬임을 따르지 아니하며' }] } })).result;
      window.BCCue.openCue(c.id); await wait(800); $$('#cueList .cue-item')[0].click(); await wait(1200);
      const off = { text: $('#pvScreen').innerText.replace(/\\s+/g, ' '), bold: $$('#pvScreen b, #pvScreen strong').map(b => b.textContent).join('|') };
      const cb = $('[data-k=roleLabels]'); cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); await wait(1200);
      const on = { text: $('#pvScreen').innerText.replace(/\\s+/g, ' '), saved: (await window.BC.cmd('getCue', { id: c.id })).result.items[0].roleLabels };
      return { off, on };`);
    ok(rd.off && /복 있는 사람은/.test(rd.off.text) && !/인도자|회중/.test(rd.off.text) && /악인들의/.test(rd.off.bold), '교독문 역할: 회중 줄 굵게 · 머리말 빼기', rd);
    ok(rd.on && /회중: 악인들의/.test(rd.on.text) && rd.on.saved === true, '교독문 역할: 역할 이름 보이기 (저장됨)', rd);

    // ---- 2-3. 글자 자동 숨김: 편집칸 '1 초 뒤 글자만 숨김' → 송출 → 1초 뒤 숨김 → F6 은 다시 보이며
    const ah = await ev(`const h = $('[data-k=hideAfter]'); h.value = '1'; h.dispatchEvent(new Event('input', { bubbles: true })); await wait(1500);
      const saved = (await window.BC.cmd('getCue', { id: window.BCCue.currentId() })).result.items[0].hideAfter;
      await window.BC.sendPreview(); await wait(300);
      const shown = window.BC.state.live.visible; await wait(1500);
      const hidden = window.BC.state.live.visible === false;
      await window.BC.cmd('clearAll', {}); await wait(300);
      return { saved, shown, hidden, edge: !!$('[data-k=edgeHide]') };`);
    ok(ah.saved === 1 && ah.shown === true && ah.hidden && ah.edge, '글자 자동 숨김 (N초 뒤) · 처음·끝 숨김 칸', ah);

    // ---- 2-4. 연결 점검: 도움말 → 연결 점검 → 항목들 · 오늘 큐시트 · 결과 글
    const dg = await ev(`window.BCDiag.open(); await wait(2000);
      return { rows: $$('#dgList .dg-row').length, titles: $$('#dgList .dg-title b').map(b => b.textContent), sum: ($('#dgSum') || {}).textContent, text: window.BCDiag.asText().split('\\n')[0], logsBtn: !!$('#dgLogs'), bundle: await window.BC.cmd('logBundle', {}).then(r => r.ok && /## 최근 7일 로그/.test(r.result.text)) };`);
    await shot('diag');
    await ev(`$('#modalClose').click(); await wait(300); return 1;`);
    ok(dg.rows >= 7 && dg.titles.some(t => /오늘 큐시트/.test(t)) && dg.titles.includes('카메라') && /^워십프리젠터 연결 점검/.test(dg.text || ''), '연결 점검 (항목 · 오늘 큐시트 · 카메라 · 결과 글)', dg);
    ok(dg.logsBtn && dg.bundle, '로그 묶음 (연결 점검 창 단추 · 내용)', dg);

    // ---- 2-5. 새 버전 창: 바뀐 점(마크다운) · 받기/설치 · 이번 버전 건너뛰기
    const up = await ev(`const keep = window.BC.update; window.BC.update = { current: '1.0.0', version: '9.9.9', state: 'available', mode: 'notify', notes: '## 새 기능\\n- **즉석 자막** 추가\\n- 교독문 역할', page: '' };
      window.BCUpdate.open(); await wait(300);
      const r = { title: ($('#modalTitle') || {}).textContent, items: $$('.upd-notes li').map(x => x.textContent), bold: !!$('.upd-notes li b'), open: !!$('#updOpenM'), skip: !!$('#updSkip') };
      $('#updSkip').click(); await wait(600);
      r.saved = (await window.BC.cmd('getState', {})).result.settings.skipVersion; r.closed = $('#modal').hidden;
      await window.BC.cmd('updateAction', { action: 'unskip' }); window.BC.update = keep; return r;`);
    ok(up.title === '새 버전 9.9.9' && up.items.length === 2 && up.bold && up.open && up.skip, '새 버전 창 (바뀐 점 · 받기 · 건너뛰기 단추)', up);
    ok(up.saved === '9.9.9' && up.closed, '이번 버전 건너뛰기 (저장)', up);

    // ---- 2-6. OBS 원격 조작: 창 · 켜면 연결 시도(여기엔 OBS 가 없음 → 끊김 표시) · 순서의 자동 동작에 OBS 줄
    const ob = await ev(`window.BCObs.open(); await wait(300);
      const form = { host: !!$('#obsHost'), port: ($('#obsPort') || {}).value };
      $('#obsHost').value = '127.0.0.1'; $('#obsPort').value = '4459'; $('#obsSave').click(); await wait(2500);
      const st = window.BC.state.obs; const bar = ($('#status [data-obs]') || {}).textContent || '';
      await window.BC.cmd('setObs', { enabled: false }); await wait(500);
      $('#modalClose').click(); await wait(200);
      const it = window.BCCue.selected(); $('#cueEditor [data-act=actmore]') && $('#cueEditor [data-act=actmore]').click(); await wait(300);
      return { form, enabled: st && st.enabled, connected: st && st.connected, err: st && st.error, bar, row: !!$('#cueEditor [data-a=obsScene]'), after: ($('#status [data-obs]') || null) === null };`);
    ok(ob.form.host && ob.form.port === '4455' && ob.enabled === true && ob.connected === false && /연결하지 못했습니다/.test(ob.err || '') && /OBS 원격 끊김/.test(ob.bar), 'OBS 원격 조작: 설정 · 연결 실패 안내 · 상태줄', ob);
    ok(ob.row && ob.after, 'OBS 원격 조작: 순서 자동 동작 줄 · 끄면 상태줄에서 사라짐', ob);

    // ---- 3. 주보 순서 붙여 넣기 → 큐시트 (AI 없이)
    await ev(`await window.BC.cmd('saveSong', { song: { title: '은혜 아니면', lyrics: '은혜 아니면 나 서지 못하네' } }); return 1;`);
    const quick = await ev(`window.BCAI.open('quick'); await wait(600); $('#qkText').value = '묵도 / 찬양 은혜 아니면 / 성경봉독 요 3:16 / 설교 “선한 목자” 홍길동 목사 / 축도'; $('#qkName').value = '점검 예배'; $('#qkGo').click(); await wait(2500);
      return { done: ($('#aiResult .ai-done b') || {}).textContent, items: $$('#aiResult li').map(x => x.innerText.replace(/\\s+/g, ' ')) };`);
    ok(/점검 예배.*5개/.test(quick.done || ''), '주보 순서 붙여 넣기 → 큐시트', quick);
    ok(quick.items && quick.items[1] === '은혜 아니면' && /요 3:16/.test(quick.items[2] || ''), '순서 알아보기 (찬양·장절)', quick);
    await shot('quick');
    await ev(`$('#aiOpen').click(); await wait(1000); return 1;`);

    // ---- 3-1. 설교 포인트 슬라이드: 열린 큐시트의 설교·성경 순서로 미리 채우고 → 대지 찾기 → '설교' 다음에 넣기
    const pts = await ev(`window.BCPoints.open(); await wait(500);
      const pre = { title: $('#ptTitle').value, verse: $('#ptVerse').value, speaker: $('#ptSpeaker').value };
      $('#ptText').value = '첫째, 선한 목자는 양을 아십니다.\\n주님은 우리 이름을 부르십니다.\\n둘째, 선한 목자는 목숨을 버립니다.\\n십자가가 그 증거입니다.';
      $('#ptFind').click(); await wait(1000);
      const cards = $$('#ptCards .pts-card').map(c => c.innerText.replace(/\\s+/g, ' '));
      $('#ptInsert').click(); await wait(1200);
      const names = []; for (let i = 0; i < 30; i++) { const it = window.BCCue.item(i); if (!it) break; names.push((it.note || '').startsWith('설교 포인트') ? 'PTS:' + it.title : it.title); }
      return { pre, cards, names, modal: !$('#modal').hidden };`);
    ok(pts.pre && pts.pre.title === '선한 목자' && /요 3:16/.test(pts.pre.verse) && /홍길동/.test(pts.pre.speaker), '설교 포인트: 설교·성경 순서로 미리 채움', pts);
    ok(pts.cards && pts.cards.length === 3 && /첫째, 선한 목자는 양을 아십니다/.test(pts.cards[1]), '설교 포인트: 대지 찾기 → 카드 미리보기', pts);
    ok(pts.names && pts.names.indexOf('PTS:선한 목자') === pts.names.indexOf('설교') + 1 && pts.modal === false, '설교 포인트: 설교 다음에 큐시트로', pts);

    // ---- 4. 베들레헴 찬송가 (있을 때만)
    const books = await ev(`return (await window.BC.cmd('hymnalBooks', {})).result;`);
    if (Array.isArray(books) && books.some(b => b.lyrics)) {
      const h = await ev(`const r = await window.BC.cmd('hymnalGet', { book: '새찬송가', number: 1 }); return r.ok ? { kind: r.result.kind, title: r.result.title, lyrics: (r.result.lyrics || '').slice(0, 20) } : { err: r.error };`);
      ok(h.kind === 'hymn' && /^1장 /.test(h.title || ''), '베들레헴 찬송가 가사', h);
    } else R.log.push('– 베들레헴 찬송가 없음 (건너뜀)');

    // ---- 5. 카메라: 격자 썸네일은 📷 표시만, 미리보기는 잠시 뒤 정지 화면 → 카메라 놓기
    await ev(`window.WC_CAM_PREVIEW_MS = 3000; return 1;`);
    const dev = await ev(`const s = await navigator.mediaDevices.getUserMedia({ video: true }); s.getTracks().forEach(t => t.stop()); return (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput').map(d => d.deviceId);`);
    if (Array.isArray(dev) && dev.length) {
      const cam = await ev(`const c = (await window.BC.cmd('saveCue', { cue: { name: '카메라 점검', items: [{ type: 'camera', deviceId: ${JSON.stringify(dev[0])}, label: '가짜', title: '📷 가짜' }, { type: 'title', title: '다음' }] } })).result;
        window.BCCue.openCue(c.id); await wait(800); $$('#cueList .cue-item')[0].click(); await wait(2000);
        const live = { video: !!$('#pvScreen video[data-cam]'), grid: $$('.sg-screen video[data-cam]').length, still: $$('.sg-screen .bc-cam-still').length, open: window.BCRender.openCameras().length };
        await wait(8000);
        const later = { frozen: !!$('#pvScreen .bc-cam-frozen'), open: window.BCRender.openCameras().length, holders: $$('video[data-cam]').length };
        $$('#cueList .cue-item')[1].click(); await wait(500);
        return { live, later };`);
      ok(cam.live && cam.live.video && cam.live.open === 1, '카메라 미리보기 (산 영상)', cam);
      ok(cam.live && cam.live.grid === 0, '격자 썸네일은 산 영상이 아님', cam);
      ok(cam.later && cam.later.frozen && cam.later.open === 0 && cam.later.holders === 0, '미리보기 정지 화면 → 카메라 놓기 (붙든 곳 없음)', cam);
    } else R.log.push('– 가짜 카메라 없음 (건너뜀)');

    // ---- 6. 도킹(OBS·리모컨) '■ 끄기'
    const before = await ev(`$('#q').focus(); $('#q').value = '시 23:1'; $('#q').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await wait(1500); await window.BC.sendPreview(); await wait(800); return window.BC.state.live.visible;`);
    const d = new BrowserWindow({ width: 420, height: 900, show: false, webPreferences: { offscreen: true } });
    await d.loadURL(`http://127.0.0.1:${port}/dock`);
    await wait(2500);
    const off = await d.webContents.executeJavaScript(`(() => { const b = document.getElementById('dOff'); if (!b) return false; b.click(); return true; })()`);
    await wait(1500);
    const offState = await ev(`return window.BC.state.live.visible;`);
    ok(before === true && off && offState === false, "도킹 '■ 끄기'", { before, off, offState });
    d.destroy();

    // ---- 7. 영어 화면: UI 는 영어, 사용자 글은 그대로
    await ev(`await window.BC.cmd('saveCue', { cue: { name: '찬송', items: [{ type: 'title', title: '설교', subtitle: '축도' }] } }); await window.BC.cmd('updateSettings', { patch: { uiLang: 'en' } }); return 1;`);
    await wait(400);
    await load();
    const en = await ev(`const o = $$('#cueSel option').find(o => /찬송/.test(o.textContent)); if (o) { $('#cueSel').value = o.value; $('#cueSel').dispatchEvent(new Event('change', { bubbles: true })); } await wait(800);
      return { lang: document.documentElement.dataset.lang, menu: $$('.menubar button, #menubar button').slice(0, 3).map(b => b.textContent.trim()), cueSel: o && o.textContent, row: ($('#cueList .cue-item') || {}).innerText };`);
    ok(en.lang === 'en' && /File|Cue/.test((en.menu || []).join(' ')), '영어 화면 (UI 번역)', en);
    ok(/찬송/.test(en.cueSel || '') && /설교/.test(en.row || '') && /축도/.test(en.row || ''), '영어 화면에서 사용자 글은 그대로', en);
    await shot('en');
    await ev(`await window.BC.cmd('updateSettings', { patch: { uiLang: 'ko' } }); return 1;`);

    // ---- 8. 사용 기록 창 · 설정의 동기화·백업 · 큐 편집 실행 취소
    const usage = await ev(`if (!$('#modal').hidden) $('#modalClose').click(); await wait(300); window.BCUsage.open(); await wait(1000); const r = { list: !!$('#ugList'), rows: (await window.BC.cmd('usageLog', { kinds: ['bible'] })).result.rows.length }; $('#modalClose').click(); await wait(300); return r;`);
    ok(usage.list && usage.rows >= 1, '사용 기록 창 (송출한 본문이 보임)', usage);
    const setData = await ev(`window.BCSettings.open('data'); await wait(1000); const r = { sync: !!$('#syDir'), backup: !!$('#bkNow'), info: ($('#syInfo') || {}).textContent }; $('#modalClose').click(); await wait(300); return r;`);
    ok(setData.sync && setData.backup && /동기화 안 함/.test(setData.info || ''), '설정 → 동기화·백업 칸', setData);
    const undo = await ev(`const c = (await window.BC.cmd('saveCue', { cue: { name: '되돌리기', items: [{ type: 'title', title: '하나' }] } })).result;
      window.BCCue.openCue(c.id); await wait(800); window.BCCue.addItem('title', { title: '둘' }); await wait(500);
      const n1 = $$('#cueList .cue-item').length; document.body.focus(); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true })); await wait(600);
      const n2 = $$('#cueList .cue-item').length; window.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true })); await wait(600);
      return { n1, n2, n3: $$('#cueList .cue-item').length };`);
    ok(undo.n1 === 2 && undo.n2 === 1 && undo.n3 === 2, '큐 편집 실행 취소 (Ctrl+Z) · 다시 실행 (Ctrl+Y)', undo);
    ok(R.console.length === 0, '화면 오류(console) 없음', R.console);
  } catch (e) { R.fails.push('점검 중 오류: ' + String(e.stack).slice(0, 500)); }
  fs.writeFileSync(path.join(OUT, 'smoke.json'), JSON.stringify(R, null, 1));
  app.exit(0);
});
