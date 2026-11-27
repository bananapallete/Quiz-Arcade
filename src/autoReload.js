// 배포로 서버가 새로 뜨면(부트 id가 바뀌면) 열려 있던 화면을 새 버전으로 새로고침한다 (폰은 저장된 정보로 자동 재입장)
export function autoReload(socket) {
  let boot = null;
  socket.on('boot', (b) => { if (boot && b !== boot) location.reload(); boot = b; });
}
