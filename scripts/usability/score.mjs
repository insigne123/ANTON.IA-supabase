// How each task is scored, from 0 to 100. Every part is measured by run.mjs; the weights favor what a person feels most:
// being able to do it at all, the number of steps, and how much each screen asks to choose from.
//
//   Logra hacerlo     30  desktop 20 + phone 10
//   Pasos             20  ideal steps / steps taken
//   Tiempo (KLM)      10  30 s or less is full, 150 s or more is zero
//   Decisiones        15  controls in view per screen: 12 or fewer is full, 60 or more is zero
//   A la vista        15  next control in view without scrolling: desktop 10 + phone 5
//   Claridad          10  one or two main actions per screen (5) and 150 words or fewer per screen (5; 500 is zero)

/** Keystroke-Level Model operators (Card, Moran and Newell), in seconds, for an average person. */
const K = 0.28;
const P = 1.1;
const BB = 0.2;
const H = 0.4;
const M = 1.35;
const SCROLL = 1.5;
const FILE_DIALOG = 3;
export const KLM = {
  click: () => [['M', M], ['P', P], ['BB', BB]],
  fill: chars => [['M', M], ['P', P], ['BB', BB], ['H', H], ['K', K * chars], ['H', H]],
  select: () => [['M', M], ['P', P], ['BB', BB], ['M', M], ['P', P], ['BB', BB]],
  upload: () => [['M', M], ['P', P], ['BB', BB], ['R', FILE_DIALOG]],
  scroll: () => [['M', M], ['S', SCROLL]],
};

const clamp = value => Math.max(0, Math.min(1, value));
const mean = values => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0);
const round = value => Math.round(value * 10) / 10;

export function seconds(run) {
  return run.steps.reduce((total, step) => total + step.ops.reduce((sum, [, value]) => sum + value, 0), 0);
}

export function scoreTask(task, runs) {
  const desktop = runs.desktop;
  const phone = runs.phone;
  const parts = {};
  parts.logra = (desktop?.success ? 20 : 0) + (phone?.success ? 10 : 0);
  // Steps the bench cannot run (after a research) count from the design: one click each.
  const pending = task.pending?.steps || 0;
  const steps = (desktop?.steps.length || 0) + pending;
  parts.pasos = desktop?.success && steps ? 20 * clamp(task.ideal / steps) : 0;
  const time = desktop ? seconds(desktop) + pending * KLM.click().reduce((sum, [, value]) => sum + value, 0) : 0;
  parts.tiempo = desktop?.success ? 10 * clamp((150 - time) / (150 - 30)) : 0;
  const controls = mean((desktop?.steps || []).map(step => step.controls));
  parts.decisiones = desktop?.steps.length ? 15 * clamp((60 - controls) / (60 - 12)) : 0;
  const inView = run => (run?.steps.length ? run.steps.filter(step => step.inView).length / run.steps.length : 0);
  parts.vista = 10 * inView(desktop) + 5 * inView(phone);
  const clearMain = mean((desktop?.steps || []).map(step => (step.primary >= 1 && step.primary <= 2 ? 1 : 0)));
  const words = mean((desktop?.steps || []).map(step => step.words));
  parts.claridad = desktop?.steps.length ? 5 * clearMain + 5 * clamp((500 - words) / (500 - 150)) : 0;
  const total = Object.values(parts).reduce((sum, value) => sum + value, 0);
  return {
    total: Math.round(total), parts: Object.fromEntries(Object.entries(parts).map(([key, value]) => [key, round(value)])),
    steps, ideal: task.ideal, seconds: Math.round(time), controls: Math.round(controls), words: Math.round(words),
    inViewDesktop: Math.round(inView(desktop) * 100), inViewPhone: Math.round(inView(phone) * 100),
    clearMain: Math.round(clearMain * 100),
  };
}

export function summarize(results) {
  const modules = {};
  for (const result of results) (modules[result.task.module] ||= []).push(result.score.total);
  return {
    index: Math.round(mean(results.map(result => result.score.total))),
    tasks: results.length,
    done: results.filter(result => result.runs.desktop?.success).length,
    modules: Object.fromEntries(Object.entries(modules).map(([name, scores]) => [name, Math.round(mean(scores))])),
  };
}
