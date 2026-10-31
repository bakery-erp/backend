export function decimalToNum(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return parseFloat(v) || 0;
  if (typeof v === 'object' && v !== null) {
    if (typeof (v as any).toNumber === 'function') {
      return (v as any).toNumber();
    }
    const num = Number(v);
    return isNaN(num) ? 0 : num;
  }
  return 0;
}
