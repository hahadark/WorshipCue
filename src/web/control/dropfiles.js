/* 바깥(탐색기)에서 파일·폴더 끌어다 놓기
 * - 큐시트(또는 아무 곳): PPT → 🎼 찬송가·PPT 순서, 그림 → 🖼 이미지, 영상 → 🎬 영상, 음악 → 🔊 음악, txt → 🎵 찬양(가사)
 *   큐시트의 순서 위에 놓으면 그 순서 다음에, 아니면 고른 순서 다음에 차례로 들어간다
 * - 라이브러리 패널에 폴더를 놓으면: 이미지·영상 / 음악 / 찬송가·PPT 폴더로 등록
 * - 슬라이드 편집기에 그림·영상을 놓으면: 놓은 자리에 그림 덧붙이기
 * - 순서 편집칸의 '배경' 에 그림·영상을 놓으면: 그 순서 배경
 * 파일의 실제 경로는 프리로드(window.wcDesktop.pathOf) 로만 알 수 있다 (데스크톱 프로그램)
 */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const app = window.BC;
  const ICON = { ppt: '🎼', image: '🖼', video: '🎬', audio: '🔊', text: '🎵', folder: '📁' };
  let depth = 0;

  const hasFiles = e => [...(e.dataTransfer && e.dataTransfer.types || [])].includes('Files');

  function hint(e) {
    const t = e.target;
    if (window.BCSlideEdit && window.BCSlideEdit.isOpen()) return '슬라이드에 그림·영상 덧붙이기';
    if (t.closest && t.closest('#panelLibrary')) return '폴더 → 라이브러리에 등록 · 파일 → 큐시트에 넣기';
    if (t.closest && t.closest('#cueEditor .ce-form')) return '그림·영상 → 이 순서 배경 · 그 밖의 파일 → 큐시트에 넣기';
    return 'PPT·그림·영상·음악·가사(txt) → 큐시트에 넣기';
  }
  function showOverlay(e) {
    let o = $('#dropHint');
    if (!o) { document.body.insertAdjacentHTML('beforeend', '<div id="dropHint" class="drop-hint"><div class="drop-box"></div></div>'); o = $('#dropHint'); }
    o.querySelector('.drop-box').textContent = '⬇ 여기에 놓기 — ' + hint(e);
    o.hidden = false;
    // 큐시트 순서 위: 그 아래에 들어간다는 표시
    document.querySelectorAll('.cue-item.drop-after').forEach(x => x.classList.remove('drop-after'));
    const row = e.target.closest && e.target.closest('#cueList .cue-item');
    if (row) row.classList.add('drop-after');
  }
  function hideOverlay() {
    const o = $('#dropHint');
    if (o) o.hidden = true;
    document.querySelectorAll('.cue-item.drop-after').forEach(x => x.classList.remove('drop-after'));
  }

  async function onDrop(e) {
    const files = [...(e.dataTransfer.files || [])];
    if (!files.length) return;
    const pathOf = window.wcDesktop && window.wcDesktop.pathOf;
    const paths = pathOf ? files.map(f => pathOf(f)).filter(Boolean) : [];
    // AI 주보 창: 파일 자체를 넘긴다 (경로 필요 없음)
    if (!$('#modal').hidden && $('#modal .ai-form') && window.BCAI && window.BCAI.setFile) { window.BCAI.setFile(files[0]); return; }
    if (!paths.length) return app.showMsg('끌어다 놓기는 WorshipCue 데스크톱 프로그램에서 됩니다.', 'info', 3000);
    const r = await app.cmd('addDroppedFiles', { paths });
    if (!r.ok) return app.showMsg(r.error, 'error');
    const list = r.result;
    const t = e.target;

    // 슬라이드 편집기: 그림·영상 덧붙이기
    if (window.BCSlideEdit && window.BCSlideEdit.isOpen()) {
      const media = list.filter(x => x.kind === 'image' || x.kind === 'video');
      if (!media.length) return app.showMsg('슬라이드 편집기에는 그림·영상을 놓을 수 있습니다.', 'info', 2500);
      media.forEach((m, k) => window.BCSlideEdit.dropImage(m.url, e.clientX + k * 20, e.clientY + k * 20));
      return;
    }
    // 라이브러리: 폴더 등록
    const folders = list.filter(x => x.kind === 'folder');
    if (folders.length) {
      if (!t.closest('#panelLibrary')) app.showMsg('폴더는 라이브러리 패널(이미지·영상 / 음악 / 찬송가·PPT 탭)에 놓으면 등록됩니다.', 'info', 4000);
      else {
        const tab = window.BCLib && window.BCLib.tab ? window.BCLib.tab() : '';
        for (const f of folders) {
          const kind = tab === 'audio' ? 'audio' : tab === 'hymns' ? 'hymns' : 'image';
          const res = kind === 'hymns' ? await app.cmd('addHymnFolder', { path: f.path, name: f.name }) : await app.cmd('addLibFolder', { kind, path: f.path, name: f.name });
          app.showMsg(res.ok ? `📁 '${f.name}' 폴더를 ${kind === 'audio' ? '음악' : kind === 'hymns' ? '찬송가·PPT' : '이미지·영상'} 폴더로 등록했습니다.` : res.error, res.ok ? 'ok' : 'error', 3000);
        }
        if (window.BCLib) window.BCLib.show(tab || 'images');
      }
    }
    let files2 = list.filter(x => ['ppt', 'image', 'video', 'audio', 'text'].includes(x.kind));
    // 순서 편집칸에 그림·영상: 그 순서 배경
    if (t.closest('#cueEditor .ce-form') && files2.length === 1 && (files2[0].kind === 'image' || files2[0].kind === 'video') && window.BCCue) {
      const ok = window.BCCue.updateSelected(it => { if (['song', 'text', 'title', 'bible'].includes(it.type)) it.bg = files2[0].url; });
      if (ok && ['song', 'text', 'title', 'bible'].includes(window.BCCue.selected().type)) { app.showMsg(`배경: ${files2[0].name}`, 'ok', 1800); return; }
    }
    const bad = list.filter(x => x.kind === 'other' || x.kind === 'missing');
    const badMsg = bad.length ? `넣을 수 없는 파일: ${bad.map(x => x.name).join(', ')} (PPT·그림·영상·음악·txt 만)` : '';
    if (!files2.length || !window.BCCue) { if (badMsg) app.showMsg(badMsg, 'info', 4000); return; }
    // 큐시트 순서 위에 놓았으면 그 다음 자리에
    const row = t.closest('#cueList .cue-item');
    if (row) window.BCCue.selectQuiet(+row.dataset.i);
    for (const f of files2) {
      if (f.kind === 'ppt') window.BCCue.addItem('hymn', { title: f.number != null ? `${f.number}장 ${f.title}` : f.title, file: f.path, number: f.number ?? null, background: 'default' });
      else if (f.kind === 'image') window.BCCue.addItem('image', { title: f.title, image: f.url });
      else if (f.kind === 'video') window.BCCue.addItem('video', { title: f.title, file: f.url, sound: true, volume: 1, endAction: 'hold' });
      else if (f.kind === 'audio') window.BCCue.addItem('audio', { title: f.title, file: f.url });
      else if (f.kind === 'text') window.BCCue.addItem('song', { title: f.title, lyrics: f.text.replace(/\r/g, '').trim() });
    }
    app.showMsg(`큐시트에 넣었습니다: ${files2.map(f => ICON[f.kind] + ' ' + f.name).join(' · ')}${badMsg ? ' — ' + badMsg : ''}`, 'ok', badMsg ? 5000 : 3000);
  }

  function init() {
    window.addEventListener('dragenter', e => { if (!hasFiles(e)) return; depth++; showOverlay(e); });
    window.addEventListener('dragover', e => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; showOverlay(e); });
    window.addEventListener('dragleave', e => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) hideOverlay(); });
    window.addEventListener('drop', e => {
      if (!hasFiles(e)) return;
      e.preventDefault(); // 브라우저가 파일을 열어 버리지 않게
      depth = 0;
      hideOverlay();
      onDrop(e).catch(err => app.showMsg(err.message, 'error'));
    });
  }

  window.BCDrop = { init };
})();
