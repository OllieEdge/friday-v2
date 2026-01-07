function startScheduler({ tickMs = 15000, getRunbooks, runRunbook, logger }) {
  const log = typeof logger === "function" ? logger : () => {};
  const running = new Set();

  let timer = null;
  async function tick() {
    const now = Date.now();
    const runbooks = getRunbooks();
    for (const rb of runbooks) {
      if (!rb?.enabled) continue;
      if (!rb.everyMinutes) continue;
      if (running.has(rb.id)) continue;
      const last = rb.lastRunAt ? new Date(rb.lastRunAt).getTime() : 0;
      const due = !last || now - last >= rb.everyMinutes * 60_000;
      if (!due) continue;

      running.add(rb.id);
      Promise.resolve()
        .then(() => runRunbook(rb))
        .catch((e) => log(`runbook ${rb.id} error: ${String(e?.message || e)}`))
        .finally(() => running.delete(rb.id));
    }
  }

  timer = setInterval(tick, Math.max(2000, Number(tickMs) || 15000));
  timer.unref?.();
  void tick();

  return {
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    isRunning(runbookId) {
      return running.has(runbookId);
    },
  };
}

module.exports = { startScheduler };

