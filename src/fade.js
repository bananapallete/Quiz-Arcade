// 맵 이동(모이기) 때 화면이 검게 잠깐 어두워졌다 돌아온다. 위치는 서버가 이미 바꿔 둠
export function mountFade(socket) {
  const el = Object.assign(document.createElement('div'), {});
  el.style.cssText = 'position:fixed;inset:0;background:#000;opacity:0;pointer-events:none;z-index:9999';
  document.body.appendChild(el);
  socket.on('gathered', () => {
    el.style.transition = 'opacity .12s'; el.style.opacity = '1';
    setTimeout(() => { el.style.transition = 'opacity .3s'; el.style.opacity = '0'; }, 220);
  });
}
