/** Rendered-frame policy: 90-frame descent, 180 fast frames before recovery. */
export function createQualityPolicy(ceiling: number) {
  const floor = Math.min(0.8, ceiling);
  let count = 0,
    slow = 0,
    fast = 0;
  return {
    dpr: ceiling,
    steps: 16,
    frames: 0,
    update(milliseconds: number) {
      this.frames++;
      count++;
      if (milliseconds > 38) slow++;
      fast = milliseconds < 38 ? fast + 1 : 0;
      const before = `${this.dpr}:${this.steps}`;
      if (count >= 90) {
        if (slow > 45) {
          if (this.dpr > floor)
            this.dpr = Math.max(floor, +(this.dpr - 0.2).toFixed(2));
          else this.steps = this.steps > 8 ? 8 : 4;
          fast = 0;
        }
        count = slow = 0;
      }
      if (fast >= 180) {
        if (this.steps < 16) this.steps = this.steps < 8 ? 8 : 16;
        else this.dpr = Math.min(ceiling, +(this.dpr + 0.2).toFixed(2));
        fast = 0;
      }
      return before !== `${this.dpr}:${this.steps}`;
    },
  };
}
