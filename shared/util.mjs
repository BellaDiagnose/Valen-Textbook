// shared/util.mjs — 两套 agent 共用的 CLI 参数与节流工具。
export const arg = (name, dflt) => {
  const i = process.argv.indexOf("--" + name);
  return i > 0 ? process.argv[i + 1] : dflt;
};

export const flag = (name) => process.argv.includes("--" + name);

// "12" → [12, 12]；"12-30" → [12, 30]
export const range = (s) => {
  const p = String(s).split("-").map(Number);
  return p.length === 2 ? [p[0], p[1]] : [p[0], p[0]];
};

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
