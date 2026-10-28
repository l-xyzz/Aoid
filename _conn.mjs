new Promise(async (resolve) => {
  const 列表 = await window.deck.设备.列表();
  if (!列表.ok || !列表.data.length) { resolve('无设备'); return; }
  const 连接 = await window.deck.设备.连接(列表.data[0].serial);
  await new Promise((r) => setTimeout(r, 6000));
  resolve('连接: ' + (连接.ok ? 'ok' : 连接.error) + ' | 画布: ' + document.getElementById('画布')?.width + 'x' + document.getElementById('画布')?.height + ' | 帧率: ' + document.getElementById('指标帧率')?.textContent);
})
