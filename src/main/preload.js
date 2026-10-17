'use strict';
// 조작 화면 프리로드: 탐색기에서 끌어다 놓은 파일의 실제 경로만 알려 준다 (그 밖의 기능은 열지 않음)
const { contextBridge, webUtils } = require('electron');

contextBridge.exposeInMainWorld('wcDesktop', {
  pathOf: file => { try { return webUtils.getPathForFile(file) || ''; } catch { return ''; } },
});
