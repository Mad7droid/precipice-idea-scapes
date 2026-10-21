import { createServer } from "vite";

// Uses Vite's normal TypeScript/registry transforms, without starting an HTTP listener.
const live = process.argv.includes("--live");
if (live && !process.env.TYPESAFE_API_KEY) {
  console.error(
    "Live evaluation needs TYPESAFE_API_KEY. Put it in a gitignored .env.routing.local file.",
  );
  process.exit(1);
}
const server = await createServer({
  server: { middlewareMode: true, watch: null },
  appType: "custom",
  logLevel: "error",
});
try {
  const { ROUTING_EVALS, evalResult, summarizeEval } =
    await server.ssrLoadModule("/src/ai/router/evals.ts");
  const { heuristicRoute } = await server.ssrLoadModule("/src/ai/router/heuristics.ts");
  const local = summarizeEval(
    ROUTING_EVALS.map((row) => evalResult(row, heuristicRoute(row.text, row.context))),
  );
  const report = { synthetic: true, local };
  if (live) {
    const { askJev } = await server.ssrLoadModule("/src/ai/router/jev.ts");
    const results = [];
    for (const row of ROUTING_EVALS) {
      const started = performance.now();
      const answer = await askJev(
        row.text,
        row.context,
        process.env.TYPESAFE_API_KEY,
        undefined,
        (_url, init) => fetch("https://api.typesafe.ai/v1/systemone", init),
      );
      results.push({ ...evalResult(row, answer), ms: Math.round(performance.now() - started) });
    }
    report.jev = summarizeEval(results);
    report.gatePassed =
      report.jev.confident > 0 &&
      report.jev.confidentAccuracy >= 0.9 &&
      report.jev.p95Ms < 600 &&
      report.jev.accuracy > local.accuracy;
    if (!report.gatePassed) process.exitCode = 1;
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  await server.close();
}
