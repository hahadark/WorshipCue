/* 예배 전 화면 자동 만들기 (큐시트 → 순서 넣기 → 예배 전 화면 자동 만들기…)
 * 지난주 말씀카드(그림 · 카드 문장 · 주보 표지 말씀) + 이번 주 QT 첫날 본문 → 슬라이드쇼 순서 하나를 큐시트 맨 앞에
 * 자동으로 넘기며 반복하고, 예배 시작 시각까지 카운트다운을 띄운다.
 */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const app = window.BC;
  const cmd = (...a) => app.cmd(...a);
  const ic = n => (window.BCIcon ? window.BCIcon(n) : '');
  const QT_DRAFT = 'wc-qt-draft';
  let groups = [];
  let qt = null;
  let verse = null;

  async function open() {
    const r = await cmd('preServiceInfo');
    const info = r.ok ? r.result : { cardFolder: '', bundleDir: '', autoSec: 8, feedUrl: '' };
    const meta = (window.BCCue && window.BCCue.meta()) || {};
    let qtDraft = '';
    try { qtDraft = localStorage.getItem(QT_DRAFT) || ''; } catch { /* 무시 */ }
    groups = []; qt = null; verse = null;
    app.openModal('예배 전 화면 자동 만들기', `<div class="ps form">
      <div class="note full">지난주 말씀카드와 이번 주 QT 첫날 본문을 예배 전 화면(슬라이드쇼)으로 만들어 큐시트 맨 앞에 넣습니다. 자동으로 넘기며 반복하고, 예배 시작까지 카운트다운을 띄웁니다.</div>
      <h4>${ic('images')}지난주 말씀카드</h4>
      <label>카드 그림 폴더</label><div class="row-flex"><input type="text" id="psFolder" value="${esc(info.cardFolder)}" placeholder="설교쇼츠 편집기에서 묵상카드·카드뉴스 PNG 를 저장한 폴더" style="flex:1" spellcheck="false"><button id="psPick">${ic('folder-open')}폴더…</button><button id="psLoad">${ic('download')}불러오기</button></div>
      <span></span><div id="psCards" class="ps-cards"><span class="muted">폴더를 고르면 가장 최근에 저장한 카드 묶음을 고릅니다.</span></div>
      <label>카드 문장</label><div class="row-flex"><label class="ps-chk"><input type="checkbox" id="psLineOn"></label><input type="text" id="psLine" placeholder="지난주 설교의 핵심 문장 (설교쇼츠 편집기 '홈페이지 묶음' 에서 불러옴)" style="flex:1"></div>
      <span></span><div class="note" id="psLineNote">${info.bundleDir ? `'${esc(info.bundleDir)}' 의 가장 최근 묶음에서 찾는 중…` : "설교쇼츠 편집기의 '홈페이지 묶음 보내기' 폴더가 없으면 직접 적어도 됩니다."}</div>
      <label>주보 표지 말씀</label><div class="row-flex"><label class="ps-chk"><input type="checkbox" id="psVerseOn"></label><span id="psVerse" class="muted" style="flex:1">${info.feedUrl ? '홈페이지 주보에서 찾는 중…' : "홈페이지 주보 주소가 없습니다 (파일 → 홈페이지 주보 에서 한 번 불러오면 씁니다)"}</span></div>
      <h4>${ic('book-open')}이번 주 QT 첫날 본문</h4>
      <label>QT 본문</label><textarea id="psQt" rows="3" spellcheck="false" placeholder="장절(예: 마 6:9-13), 또는 설교쇼츠 편집기 'QT 자료' 의 글·JSON 을 통째로 붙여 넣으세요">${esc(qtDraft)}</textarea>
      <span></span><div class="row-flex"><button id="psQtFind">${ic('search')}본문 찾기</button><span id="psQtMsg" class="muted"></span></div>
      <span></span><div id="psQtView" class="ps-qt"></div>
      <h4>${ic('clock')}보여 주기</h4>
      <label>넘김 · 카운트다운</label><div class="row-flex"><input type="number" id="psSec" min="3" max="60" value="${esc(info.autoSec || 8)}" style="width:70px"> 초마다 넘김 · <input type="time" id="psCount" value="${esc(meta.startTime || '')}"> 까지 카운트다운 <span class="muted">(비우면 없음)</span></div>
      <span></span><div class="row-flex ps-go"><button id="psInsert" class="primary">${ic('plus')}큐시트 맨 앞에 넣기</button><span id="psMsg" class="muted"></span></div>
    </div>`);
    $('#psPick').onclick = async () => { const p = await cmd('pickFolder', { title: '말씀카드 그림 폴더' }); if (p.ok && p.result) { $('#psFolder').value = typeof p.result === 'string' ? p.result : (p.result.path || ''); loadCards(); } else if (!p.ok) app.showMsg(p.error, 'error'); };
    $('#psLoad').onclick = loadCards;
    $('#psQtFind').onclick = findQt;
    $('#psQt').oninput = () => { try { localStorage.setItem(QT_DRAFT, $('#psQt').value.slice(0, 50000)); } catch { /* 무시 */ } };
    $('#psInsert').onclick = insert;
    if (info.cardFolder) loadCards();
    if (info.bundleDir) loadBundle(info.bundleDir);
    if (info.feedUrl) loadVerse(meta.serviceDate);
    if (qtDraft.trim()) findQt();
  }

  async function loadCards() {
    const folder = $('#psFolder').value.trim();
    if (!folder) return;
    const r = await cmd('preServiceCards', { folder });
    if (!r.ok) { $('#psCards').innerHTML = `<span class="err-text">${esc(r.error)}</span>`; return; }
    groups = r.result.groups;
    if (!groups.length) { $('#psCards').innerHTML = '<span class="muted">이 폴더에 그림이 없습니다.</span>'; return; }
    drawCards(0);
  }
  function drawCards(gi) {
    const g = groups[gi];
    const when = t => new Date(t).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' });
    $('#psCards').innerHTML = `<div class="row-flex"><select id="psGroup">${groups.map((x, i) => `<option value="${i}" ${i === gi ? 'selected' : ''}>${esc(x.base)} · ${x.files.length}장 · ${when(x.mtime)}</option>`).join('')}</select><span class="muted">가장 최근 묶음을 골랐습니다</span></div>
      <div class="ps-thumbs">${g.files.map((f, k) => `<label class="ps-th" title="${esc(f.name)}"><input type="checkbox" data-img="${esc(f.url)}" checked><img src="${esc(f.url)}" alt=""><i>${k + 1}</i></label>`).join('')}</div>`;
    $('#psGroup').onchange = e => drawCards(+e.target.value);
  }

  async function loadBundle(dir) {
    const r = await cmd('preServiceBundle', { dir });
    const b = r.ok && r.result.bundle;
    if (b && b.cardLine) {
      $('#psLine').value = b.cardLine;
      $('#psLineOn').checked = true;
      $('#psLineNote').textContent = `설교쇼츠 편집기 홈페이지 묶음 (${b.date}) 의 카드 문장`;
    } else $('#psLineNote').textContent = '홈페이지 묶음에 카드 문장이 없습니다. 직접 적어도 됩니다.';
  }

  async function loadVerse(date) {
    const r = await cmd('homeFeed', {});
    if (!r.ok) { $('#psVerse').textContent = `홈페이지 주보를 받지 못했습니다: ${r.error}`; return; }
    const b = (date && r.result.bulletins.find(x => x.date === date)) || r.result.bulletins[0];
    verse = b && b.verse;
    if (verse && verse.text) {
      $('#psVerse').innerHTML = `<b>${esc(verse.ref || '')}</b> ${esc(verse.text)} <span class="muted">(${esc(b.date)} 주보)</span>`;
      $('#psVerseOn').checked = true;
    } else $('#psVerse').textContent = '이 주보에는 표지 말씀이 없습니다.';
  }

  async function findQt() {
    const text = $('#psQt').value;
    if (!text.trim()) return;
    const r = await cmd('preServiceQt', { text });
    if (!r.ok) { qt = null; $('#psQtView').innerHTML = ''; $('#psQtMsg').innerHTML = `<span class="err-text">${esc(r.error)}</span>`; return; }
    qt = r.result;
    $('#psQtMsg').textContent = `${qt.passage.title} · ${qt.passage.verses.length}절`;
    $('#psQtView').innerHTML = `<label class="ps-chk"><input type="checkbox" id="psQtOn" checked> 넣기</label><div><b>${esc([qt.dayTitle || qt.title, qt.passage.title].filter(Boolean).join(' · '))}</b>
      <div class="ps-verses">${qt.passage.verses.map(v => `<span><sup>${v.verse}</sup>${esc(v.text)}</span>`).join(' ')}</div></div>`;
  }

  async function insert() {
    if (!window.BCCue || !window.BCCue.currentId()) return app.showMsg('큐시트를 먼저 여세요.', 'error');
    const images = [...document.querySelectorAll('#psCards [data-img]')].filter(c => c.checked).map(c => c.dataset.img);
    const a = {
      images,
      cardLine: $('#psLineOn').checked ? $('#psLine').value.trim() : '',
      verse: $('#psVerseOn').checked && verse ? verse : null,
      qt: qt && $('#psQtOn') && $('#psQtOn').checked ? qt : null,
      autoSec: Number($('#psSec').value) || 8,
      countdown: $('#psCount').value || '',
    };
    const r = await cmd('preServiceItem', a);
    if (!r.ok) { $('#psMsg').innerHTML = `<span class="err-text">${esc(r.error)}</span>`; return; }
    window.BCCue.addItem('slideshow', { ...r.result.item, _at: 0 });
    app.closeModal();
    app.showMsg(`예배 전 화면을 큐시트 맨 앞에 넣었습니다 (${r.result.item.note}). 미리보기로 확인하고 F9 로 송출하세요.`, 'ok', 3500);
  }

  window.BCPreService = { open };
})();
