// 卡包对决（加大样本）：node test/pack_duel.js [每组局数] [卡包,卡包...]
// 双方同一手速画像，轮换上下方；输出每组胜负和平均时长
const path = require('path');
for (const f of ['data', 'board', 'sim', 'ai']) require(path.join(__dirname, '..', 'js', f + '.js'));
const JQ = globalThis.JQ;
const P = +(process.argv[2] || 12);
const packs = (process.argv[3] || 'song,sanguo,xiyou,tang').split(',');
const [A, ...rest] = packs;
for (const B of rest) {
  const w = [0, 0, 0];
  let t = 0;
  for (let k = 0; k < P; k++) {
    const pair = k % 2 ? [B, A] : [A, B];
    const g = new JQ.Game({ seed: 3100 + k * 7, difficulty: 'normal', pack: pair[0], enemyPack: pair[1] });
    const prof = JQ.DIFF.human, think = [0, 0];
    while (!g.over) {
      for (const sid of [0, 1]) if ((think[sid] -= 1 / 30) <= 0) (JQ.aiThink(g, sid, prof), (think[sid] = prof.think));
      g.step(1 / 30);
    }
    t += g.time;
    if (g.winner === -1) w[2]++;
    else w[pair[g.winner] === A ? 0 : 1]++;
  }
  console.log(`${JQ.PACKS[A].name} vs ${JQ.PACKS[B].name}：${w[0]} 胜 ${w[1]} 负 ${w[2]} 平（${P} 局，平均 ${Math.round(t / P)}s）`);
}
