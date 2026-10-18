// 맥 빌드 뒤 임시 서명 (ad-hoc): 애플 개발자 인증서 없이도 애플 실리콘 맥에서 열리게
// electron-builder 의 afterPack 에서 불린다 (윈도우 빌드에서는 아무것도 안 함)
const { execFileSync } = require('child_process');
const path = require('path');

exports.default = async function adhocSign(ctx) {
  if (ctx.electronPlatformName !== 'darwin') return;
  const app = path.join(ctx.appOutDir, `${ctx.packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
  console.log('  • ad-hoc signed', app);
};
