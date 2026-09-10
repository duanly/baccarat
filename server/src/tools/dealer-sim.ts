/**
 * 荷官端模拟器：模拟 ETG 真人桌的 RFID/摄像头识牌事件，驱动所有 VIP 桌循环开局。
 * 用法： npx tsx src/tools/dealer-sim.ts [tableId,tableId...]
 * 真实部署时把本脚本替换成 RFID 读卡器 / 视频识别服务的回调，调用相同的 /api/dealer 接口即可。
 */
import { randomInt } from 'node:crypto';

const BASE = process.env.API_BASE ?? 'http://localhost:8080';
const KEY = process.env.DEALER_API_KEY ?? 'dealer-dev-key';
const ids = process.argv[2]?.split(',') ?? Array.from({ length: 3 }, (_, h) => Array.from({ length: 5 }, (_, t) => `vip${h + 1}-t${t + 1}`)).flat();

const RANKS = 'A23456789TJQK';
const SUITS = 'SHDC';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function call(id: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}/api/dealer/tables/${id}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-dealer-key': KEY }, body: JSON.stringify(body ?? {}),
  });
  return res.json() as Promise<any>;
}

async function runTable(id: string) {
  // 错开各桌开局时间
  await sleep(randomInt(0, 8000));
  for (;;) {
    try {
      const open = await call(id, '/open');
      if (!open.ok) { await sleep(3000); continue; }
      await sleep(21_000); // 等投注倒计时（20s）结束
      let complete = false;
      while (!complete) {
        const card = RANKS[randomInt(13)] + SUITS[randomInt(4)];
        const r = await call(id, '/card', { card });
        if (r.error) { console.error(id, r.error); break; }
        complete = r.complete;
        await sleep(1500); // 荷官翻牌节奏
      }
      await sleep(8000);
      if (randomInt(60) === 0) await call(id, '/shuffle'); // 偶尔换靴
    } catch (e) {
      console.error(id, e);
      await sleep(3000);
    }
  }
}

console.log(`dealer-sim → ${BASE}, tables: ${ids.join(', ')}`);
await Promise.all(ids.map(runTable));
