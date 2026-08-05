// Зводить покриття з двох раннерів (node --test і vitest) в один звіт.
// npm test жене обидва раннери, бо src/lib/*.test.mts не сумісні з vitest API
// (node:test виконується як побічний ефект імпорту й падає з "No test suite
// found" — див. коментар у vitest.config.mts), тому й покриття збирається
// окремо кожним і зводиться тут, а не одним інструментом.
import libCoverage from "istanbul-lib-coverage";
import libReport from "istanbul-lib-report";
import reports from "istanbul-reports";
import { readFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const { createCoverageMap } = libCoverage;
const { createContext } = libReport;

const root = path.resolve(import.meta.dirname, "..");
const sources = [
  path.join(root, "coverage/node/coverage-final.json"),
  path.join(root, "coverage/vitest/coverage-final.json"),
];

const map = createCoverageMap({});
for (const file of sources) {
  const data = JSON.parse(readFileSync(file, "utf8"));
  map.merge(data);
}

const outDir = path.join(root, "coverage/merged");
mkdirSync(outDir, { recursive: true });
const context = createContext({ dir: outDir, coverageMap: map });
reports.create("text").execute(context);
reports.create("text-summary").execute(context);
reports.create("json").execute(context);
reports.create("lcov").execute(context);

const rows = map.files().map((file) => {
  const summary = map.fileCoverageFor(file).toSummary();
  return {
    file: path.relative(root, file),
    pct: summary.lines.pct,
    lines: summary.lines.total,
  };
});
// При однаковому % великі файли важливіші за 3-рядкові loading.tsx —
// інакше топ-10 забивають однотипні тривіальні нулі й ховають реальні дірки.
rows.sort((a, b) => a.pct - b.pct || b.lines - a.lines);

console.log("\nТоп-10 найгірше покритих файлів (portal, злите покриття):");
for (const row of rows.slice(0, 10)) {
  console.log(`  ${row.pct.toString().padStart(6)}%  (${row.lines} рядків)  ${row.file}`);
}
