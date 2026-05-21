/* global PowerPoint */

/**
 * Execute arbitrary Office.js code inside a PowerPoint.run context.
 * The code string receives `context` (RequestContext) and may return a value.
 *
 * Usage: const result = await executePpt('context.presentation.slides.load("items"); await context.sync(); return context.presentation.slides.items.length;');
 */
async function executePpt(code) {
  return PowerPoint.run(async (context) => {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const fn = new AsyncFunction('context', code);
    const result = await fn(context);
    await context.sync();
    return result;
  });
}

window.executePpt = executePpt;
