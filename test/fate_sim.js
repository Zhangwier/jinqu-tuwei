// 天命关卡长期模拟：玩家带强力天赋，看关卡是否会一路推到 200
for (const f of ['data', 'board', 'sim', 'ai']) require(require('path').join(__dirname, '..', 'js', f + '.js'));
const JQ = globalThis.JQ;
// 用法：node test/fate_sim.js 天赋id,天赋id,天赋id
const mine = (process.argv[2] || 'pofu,modao,jianjia').split(',');
let stage = 1, wins = 0;
const trace = [];
for (let k = 0; k < 60; k++) {
  const rnd = JQ.rng(4000 + k);
  const n = JQ.fateEnemy(stage).talents;
  const pool = stage >= 7 ? JQ.COMBAT_TALENTS.slice() : JQ.TALENTS.filter((t) => t.id !== 'tanlan').map((t) => t.id);
  const theirs = [];
  while (theirs.length < n && pool.length) theirs.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
  const g = new JQ.Game({ seed: 4000 + k, mode: 'fate', stage, talents: [mine, theirs], enemyBoost: JQ.stageBoost(stage), aiProfile: JQ.aiProfile('normal', { apm: 50, adapt: 1 }) });
  const prof = [JQ.DIFF.human, g.diff], th = [0, 0];
  while (!g.over) {
    for (const s of [0, 1]) if ((th[s] -= 1 / 30) <= 0) (JQ.aiThink(g, s, prof[s]), (th[s] = prof[s].think));
    g.step(1 / 30);
  }
  if (g.winner === 0) {
    wins++;
    stage = Math.min(JQ.C.MAX_STAGE, stage + 1);
  }
  trace.push(stage);
}
console.log(`带 ${mine.join('+')}：60 局赢 ${wins}，关卡轨迹 ${trace.join(' ')}`);
