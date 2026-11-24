/**
 * Stateful spring that carries velocity (not an easing curve).
 *
 *   vel += (target - pos) * stiffness * dt
 *   vel *= damping ^ (dt * 60)        // damping = velocity kept per 1/60 s
 *   pos += vel * dt
 *
 * The camera and the cursor never step a spring from the render loop: they step
 * it at a FIXED rate (SPRING_STEP_MS) over the whole timeline once, into a table
 * that is read by time. Preview, scrubbing, MP4 and GIF therefore all see the
 * same value at the same time, and a seek shows exactly what playback would
 * have shown there (nothing flies across the screen).
 */
export interface Spring {
  readonly value: number;
  readonly velocity: number;
  step(target: number, dt: number): number;
  snap(v: number): void;
}

export function createSpring(stiffness: number, damping: number, initial: number): Spring {
  let pos = initial;
  let vel = 0;
  return {
    get value() { return pos; },
    get velocity() { return vel; },
    step(target: number, dt: number) {
      vel += (target - pos) * stiffness * dt;
      vel *= Math.pow(damping, dt * 60);
      pos += vel * dt;
      if (!Number.isFinite(pos) || !Number.isFinite(vel)) { pos = target; vel = 0; }
      return pos;
    },
    snap(v: number) { pos = v; vel = 0; }
  };
}

/** Fixed integration step of every precomputed spring track (120 Hz). */
export const SPRING_STEP_MS = 1000 / 120;

/**
 * The per-1/60 s damping factor that gives this damping ratio for this stiffness
 * (1 = critically damped: fastest settle without oscillating; < 1 overshoots), for a
 * spring stepped every `stepMs`. Chosen so one step removes the same velocity as the
 * continuous spring would (step factor 1 / (1 + 2 ratio sqrt(k) dt)): a stiff spring
 * is not over-damped by the coarse step, so its lag stays 2 v / sqrt(k).
 */
export function dampingFor(stiffness: number, ratio = 1, stepMs = SPRING_STEP_MS): number {
  const dt = stepMs / 1000;
  const perStep = 1 / (1 + 2 * ratio * Math.sqrt(Math.max(0, stiffness)) * dt);
  return Math.pow(perStep, 1 / (60 * dt));
}
