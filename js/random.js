export const mulberry32 = (seed) => () => {
  let a = seed | 0;
  a = (a + 0x6D2B79F5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

export const newSeed = () => {
  try {
    const bucket = new Uint32Array(1);
    crypto.getRandomValues(bucket);
    return bucket[0] >>> 0;
  } catch {
    return (Math.random() * 0xFFFFFFFF) >>> 0;
  }
};
