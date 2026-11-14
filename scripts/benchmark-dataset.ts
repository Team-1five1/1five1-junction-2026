#!/usr/bin/env bun
/**
 * SemEval-2020 Task 11 Benchmark Evaluation Suite
 *
 * Evaluates the full Truthier pipeline (Stage 1 Jev + Stage 2 Gemini/Grounded Research)
 * against the official SemEval-2020 Task 11 "Detection of Propaganda Techniques in News Articles"
 * Gold Standard Dataset.
 *
 * Metrics Reported:
 * - Negative Predictive Value (NPV = TN / (TN + FN)): Target >= 95% (Clean Confidence)
 * - Recall / Sensitivity (TP / (TP + FN)): Fraction of propaganda caught
 * - Precision (TP / (TP + FP)): Fraction of flags that are real propaganda
 * - Specificity (TN / (TN + FP)): Fraction of clean controls cleared
 * - Technique-by-technique recall breakdown
 * - Stage 1 fast-clear throughput & latency
 *
 * Usage:
 *   bun run benchmark --limit 50
 *   bun run benchmark --limit 100 --mode strict
 *   bun run benchmark --technique Loaded_Language
 *   bun run benchmark --stage1-only
 *   bun run benchmark --dry-run
 *   --dataset-dir <path>   Override path to datasets folder
 *   --output <file>        Save detailed JSON results to file
 */

import * as fs from "fs";
import * as path from "path";
import { screenWithJev } from "../src/ai/jev-screener";
import { evaluateSemEvalBitmask, type QuestionId } from "../src/engines/semeval-scorer";
import { verifyStanceOrForensic } from "../src/ai/grounded-research";

// Mapping SemEval-2020 Task 11 Gold Standard techniques to Truthier question IDs
export const TECHNIQUE_TO_QUESTIONS: Record<string, QuestionId[]> = {
  Loaded_Language: ["Q1"],
  "Exaggeration,Minimisation": ["Q2", "Q3"],
  Repetition: ["Q40"],
  Slogans: ["Q40"],
  "Thought-terminating_Cliches": ["Q39"],
  "Name_Calling,Labeling": ["Q9"],
  Doubt: ["Q14"],
  Appeal_to_Authority: ["Q23"],
  "Flag-Waving": ["Q20"],
  "Bandwagon,Reductio_ad_hitlerum": ["Q12", "Q22"],
  Causal_Oversimplification: ["Q27"],
  "Whataboutism,Straw_Men,Red_Herring": ["Q33", "Q34", "Q35"],
  "Appeal_to_fear-prejudice": ["Q18", "Q19"],
  "Black-and-White_Fallacy": ["Q26"],
};

export interface BenchmarkSample {
  id: string;
  articleId: string;
  technique: string;
  spanStart: number;
  spanEnd: number;
  text: string;
  spanText: string;
  isPropaganda: boolean;
  expectedQuestionIds: QuestionId[];
}

export interface EvaluationResult {
  sample: BenchmarkSample;
  predictedPropaganda: boolean;
  isCorrect: boolean;
  route: string;
  modelUsed: string;
  riskScore: number;
  shieldFlags: number;
  triggeredIds: QuestionId[];
  failedRiskIds: QuestionId[];
  triggeredShieldIds: QuestionId[];
  latencyMs: number;
  explanation: string | null;
  techniqueMatch: boolean;
}

/**
 * Extracts target sentence along with 1 preceding and 1 following sentence for context window.
 * Formats with [TARGET SENTENCE]: ... and [SURROUNDING CONTEXT]: ... so short quotes aren't blind.
 */
function extractSpanWithWindowContext(fullText: string, start: number, end: number): string {
  let sStart = start;
  while (sStart > 0 && !/[.!?\n]/.test(fullText[sStart - 1] ?? "")) {
    sStart--;
  }
  let sEnd = end;
  while (sEnd < fullText.length && !/[.!?\n]/.test(fullText[sEnd] ?? "")) {
    sEnd++;
  }
  if (sEnd < fullText.length && /[.!?]/.test(fullText[sEnd] ?? "")) {
    sEnd++;
  }

  const targetSentence = fullText.substring(sStart, sEnd).trim().replace(/^["'\s]+|["'\s]+$/g, "");

  let prevStart = sStart;
  while (prevStart > 0 && /[.!?\n\s]/.test(fullText[prevStart - 1] ?? "")) {
    prevStart--;
  }
  let prevEnd = prevStart;
  while (prevStart > 0 && !/[.!?\n]/.test(fullText[prevStart - 1] ?? "")) {
    prevStart--;
  }
  const prevSentence = fullText.substring(prevStart, prevEnd).trim().replace(/^["'\s]+|["'\s]+$/g, "");

  let nextStart = sEnd;
  while (nextStart < fullText.length && /[.!?\n\s]/.test(fullText[nextStart] ?? "")) {
    nextStart++;
  }
  let nextEnd = nextStart;
  while (nextEnd < fullText.length && !/[.!?\n]/.test(fullText[nextEnd] ?? "")) {
    nextEnd++;
  }
  if (nextEnd < fullText.length && /[.!?]/.test(fullText[nextEnd] ?? "")) {
    nextEnd++;
  }
  const nextSentence = fullText.substring(nextStart, nextEnd).trim().replace(/^["'\s]+|["'\s]+$/g, "");

  const contextParts: string[] = [];
  if (prevSentence && prevSentence.length > 10) contextParts.push(prevSentence);
  if (nextSentence && nextSentence.length > 10) contextParts.push(nextSentence);

  if (contextParts.length > 0 && targetSentence.length < 200) {
    return `[TARGET SENTENCE]: "${targetSentence}"\n[SURROUNDING CONTEXT]: "${contextParts.join(" ")}"`;
  }

  return targetSentence.length >= 10 ? targetSentence : fullText.substring(Math.max(0, start - 40), Math.min(fullText.length, end + 40)).trim();
}

/**
 * Loads and constructs positive and negative samples from the dataset folder.
 */
export function loadDatasetSamples(options: {
  datasetDir: string;
  limit: number;
  techniqueFilter?: string;
}): BenchmarkSample[] {
  const { datasetDir, limit, techniqueFilter } = options;
  const labelsFile = path.join(datasetDir, "train-task2-TC.labels");
  const articlesDir = path.join(datasetDir, "train-articles");

  if (!fs.existsSync(labelsFile) || !fs.existsSync(articlesDir)) {
    throw new Error(`Dataset not found at: ${datasetDir}. Ensure train-task2-TC.labels and train-articles exist.`);
  }

  const labelLines = fs.readFileSync(labelsFile, "utf-8").split("\n").filter(Boolean);

  const articleSpans = new Map<
    string,
    Array<{ technique: string; start: number; end: number }>
  >();

  for (const line of labelLines) {
    const parts = line.split("\t");
    if (parts.length < 4) continue;
    const artId = parts[0] ?? "";
    const technique = parts[1] ?? "";
    const startStr = parts[2] ?? "0";
    const endStr = parts[3] ?? "0";
    const start = parseInt(startStr, 10);
    const end = parseInt(endStr, 10);

    if (techniqueFilter && technique.toLowerCase() !== techniqueFilter.toLowerCase()) {
      continue;
    }

    if (!articleSpans.has(artId)) {
      articleSpans.set(artId, []);
    }
    articleSpans.get(artId)!.push({ technique, start, end });
  }

  const positiveSamples: BenchmarkSample[] = [];
  const negativeSamples: BenchmarkSample[] = [];

  const maxPerCategory = Math.ceil(limit / 2);

  const articleIds = Array.from(articleSpans.keys());
  for (const artId of articleIds) {
    if (positiveSamples.length >= maxPerCategory) break;

    const artFile = path.join(articlesDir, `article${artId}.txt`);
    if (!fs.existsSync(artFile)) continue;
    const fullText = fs.readFileSync(artFile, "utf-8");

    const spans = articleSpans.get(artId) || [];
    for (const span of spans) {
      if (positiveSamples.length >= maxPerCategory) break;

      const spanText = fullText.substring(span.start, span.end).trim();
      if (!spanText || spanText.length < 3) continue;

      const windowContext = extractSpanWithWindowContext(fullText, span.start, span.end);

      positiveSamples.push({
        id: `pos_${artId}_${span.start}_${span.end}`,
        articleId: artId,
        technique: span.technique,
        spanStart: span.start,
        spanEnd: span.end,
        text: windowContext,
        spanText,
        isPropaganda: true,
        expectedQuestionIds: TECHNIQUE_TO_QUESTIONS[span.technique] || ["Q1"],
      });
    }
  }

  for (const artId of articleIds) {
    if (negativeSamples.length >= maxPerCategory) break;

    const artFile = path.join(articlesDir, `article${artId}.txt`);
    if (!fs.existsSync(artFile)) continue;
    const fullText = fs.readFileSync(artFile, "utf-8");
    const spans = articleSpans.get(artId) || [];

    const paragraphs = fullText
      .split(/\n\n+/)
      .map((p) => p.trim())
      .filter((p) => p.length >= 40 && p.length <= 400);

    for (const para of paragraphs) {
      if (negativeSamples.length >= maxPerCategory) break;

      const paraOffset = fullText.indexOf(para);
      if (paraOffset === -1) continue;
      const paraEnd = paraOffset + para.length;

      const overlapsPropaganda = spans.some(
        (s) => Math.max(s.start, paraOffset) < Math.min(s.end, paraEnd)
      );

      if (!overlapsPropaganda) {
        negativeSamples.push({
          id: `neg_${artId}_${paraOffset}`,
          articleId: artId,
          technique: "CLEAN_CONTROL",
          spanStart: paraOffset,
          spanEnd: paraEnd,
          text: para,
          spanText: "",
          isPropaganda: false,
          expectedQuestionIds: [],
        });
      }
    }
  }

  const combined: BenchmarkSample[] = [];
  const maxLen = Math.max(positiveSamples.length, negativeSamples.length);
  for (let i = 0; i < maxLen; i++) {
    const pos = positiveSamples[i];
    const neg = negativeSamples[i];
    if (pos && combined.length < limit) combined.push(pos);
    if (neg && combined.length < limit) combined.push(neg);
  }

  return combined;
}

/**
 * Main benchmark execution function.
 */
async function runBenchmark() {
  const args = process.argv.slice(2);

  function getArg(name: string, fallback: string): string {
    const idx = args.indexOf(name);
    return idx !== -1 && args[idx + 1] ? (args[idx + 1] as string) : fallback;
  }

  const datasetDir = getArg("--dataset-dir", "/Users/andwspb/Downloads/datasets");
  const limit = parseInt(getArg("--limit", "50"), 10);
  const mode = (getArg("--mode", "strict") as "strict" | "balanced" | "high_precision");
  const techniqueFilter = getArg("--technique", "");
  const isDryRun = args.includes("--dry-run");
  const stage1Only = args.includes("--stage1-only");
  const outputFile = getArg("--output", "");

  console.log("\n=====================================================================");
  console.log("   TRUTHIER PROPAGANDA IDENTIFICATION BENCHMARK");
  console.log("   Dataset: SemEval-2020 Task 11 (Gold Standard Corpus)");
  console.log(`   Pipeline: ${stage1Only ? "Stage 1 (jev) Gatekeeper Only" : "Full 2-Stage (jev + Grounded Research)"}`);
  console.log("   Target: Negative Predictive Value (NPV = TN / (TN + FN) >= 95%)");
  console.log("=====================================================================");
  console.log(`  📂 Dataset Directory: ${datasetDir}`);
  console.log(`  🎯 Target Sample Count: ${limit}`);
  console.log(`  ⚙️ Threshold Mode: ${mode}`);
  if (techniqueFilter) console.log(`  🔍 Filter Technique: ${techniqueFilter}`);
  if (isDryRun) console.log("  ⚠️  DRY RUN: Parsing dataset without dispatching API calls");
  console.log("=====================================================================\n");

  console.log("⏳ Loading and parsing dataset annotations...");
  let samples: BenchmarkSample[];
  try {
    samples = loadDatasetSamples({ datasetDir, limit, techniqueFilter });
  } catch (err: any) {
    console.error(`❌ Failed to load dataset: ${err.message}`);
    process.exit(1);
  }

  const posCount = samples.filter((s) => s.isPropaganda).length;
  const negCount = samples.filter((s) => !s.isPropaganda).length;
  console.log(`✅ Loaded ${samples.length} samples (${posCount} Propaganda Positive, ${negCount} Clean Controls)\n`);

  if (isDryRun) {
    console.log("Sample Preview (First 3 samples):");
    for (let i = 0; i < Math.min(3, samples.length); i++) {
      const s = samples[i]!;
      console.log(`\n[Sample ${i + 1}] ID: ${s.id} | Propaganda: ${s.isPropaganda} | Technique: ${s.technique}`);
      console.log(`Text: "${s.text.substring(0, 150)}..."`);
    }
    console.log("\n✅ Dry run completed successfully.");
    return;
  }

  console.log(`🚀 Evaluating samples against ${stage1Only ? "Stage 1 (jev)" : "Full 2-Stage Pipeline (jev -> Research)"}...\n`);

  const results: EvaluationResult[] = [];
  let completed = 0;

  for (const sample of samples) {
    const t0 = performance.now();
    try {
      const screenRes = await screenWithJev(sample.text);
      const scoreRes = evaluateSemEvalBitmask({
        triggeredIds: screenRes.triggeredIds,
        mode,
      });

      let predictedPropaganda = scoreRes.escalateToResearch;
      let finalModel = screenRes.modelUsed;
      let finalRoute = scoreRes.route;
      let explanation: string | null = null;

      if (scoreRes.escalateToResearch && !stage1Only) {
        const forensicRes = await verifyStanceOrForensic(
          sample.text,
          scoreRes.route,
          scoreRes.failedRiskIds,
          scoreRes.triggeredShieldIds
        );
        finalModel = forensicRes.modelUsed;
        explanation = forensicRes.deepResearchExplanation;

        if (!forensicRes.flagged && scoreRes.riskScore < 10) {
          predictedPropaganda = false;
          finalRoute = "ROUTE_2_SHIELDED_CLEAR";
        } else {
          predictedPropaganda = true;
          finalRoute = scoreRes.route;
        }
      }

      const latencyMs = Math.round(performance.now() - t0);

      const techniqueMatch =
        sample.isPropaganda &&
        sample.expectedQuestionIds.some((id) => screenRes.triggeredIds.includes(id));

      const isCorrect = predictedPropaganda === sample.isPropaganda;

      const evalResult: EvaluationResult = {
        sample,
        predictedPropaganda,
        isCorrect,
        route: finalRoute,
        modelUsed: finalModel,
        riskScore: scoreRes.riskScore,
        shieldFlags: scoreRes.shieldFlags,
        triggeredIds: screenRes.triggeredIds,
        failedRiskIds: scoreRes.failedRiskIds,
        triggeredShieldIds: scoreRes.triggeredShieldIds,
        latencyMs,
        explanation,
        techniqueMatch,
      };

      results.push(evalResult);
      completed++;

      const statusIcon = isCorrect ? "✅" : "❌";
      const predLabel = predictedPropaganda ? "FLAGGED (THREAT)" : "CLEARED (CLEAN)";
      const sampleType = sample.isPropaganda ? `PROPAGANDA [${sample.technique}]` : "CLEAN";
      const questionsStr = screenRes.triggeredIds.length > 0 ? `Questions: [${screenRes.triggeredIds.join(",")}]` : "Questions: [none]";

      console.log(
        `  ${statusIcon} [${completed}/${samples.length}] ${sampleType.padEnd(45)} | Score: ${String(scoreRes.riskScore).padStart(2)} | ${predLabel.padEnd(16)} | Model: ${finalModel.padEnd(15)} | ${questionsStr} (${latencyMs}ms)`
      );
    } catch (err: any) {
      console.error(`  ⚠️ [${completed + 1}/${samples.length}] Error evaluating ${sample.id}: ${err.message}`);
      completed++;
    }
  }

  // Compute Metrics
  let tp = 0; // True Positives: Propaganda correctly flagged
  let tn = 0; // True Negatives: Clean correctly cleared
  let fp = 0; // False Positives: Clean falsely flagged
  let fn = 0; // False Negatives: Propaganda missed

  for (const r of results) {
    if (r.sample.isPropaganda && r.predictedPropaganda) tp++;
    else if (!r.sample.isPropaganda && !r.predictedPropaganda) tn++;
    else if (!r.sample.isPropaganda && r.predictedPropaganda) fp++;
    else if (r.sample.isPropaganda && !r.predictedPropaganda) fn++;
  }

  const npv = tn + fn > 0 ? (tn / (tn + fn)) * 100 : 0;
  const recall = tp + fn > 0 ? (tp / (tp + fn)) * 100 : 0;
  const precision = tp + fp > 0 ? (tp / (tp + fp)) * 100 : 0;
  const specificity = tn + fp > 0 ? (tn / (tn + fp)) * 100 : 0;
  const accuracy = (tp + tn) / results.length * 100;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  const avgLatency = Math.round(results.reduce((sum, r) => sum + r.latencyMs, 0) / results.length);

  console.log("\n=====================================================================");
  console.log("   BENCHMARK PERFORMANCE SUMMARY");
  console.log(`   Pipeline: ${stage1Only ? "Stage 1 (jev) Gatekeeper Only" : "Full 2-Stage (jev + Grounded Research)"}`);
  console.log("=====================================================================");
  console.log(`  Total Evaluated:        ${results.length}`);
  console.log(`  True Positives (TP):    ${tp}  (Propaganda correctly identified)`);
  console.log(`  True Negatives (TN):    ${tn}  (Clean controls correctly cleared)`);
  console.log(`  False Positives (FP):   ${fp}  (Clean falsely flagged)`);
  console.log(`  False Negatives (FN):   ${fn}  (Propaganda missed)`);
  console.log("---------------------------------------------------------------------");
  console.log(`  🛡️ Negative Pred. Value: ${npv.toFixed(1)}%  [Target >= 95% Clean Confidence]`);
  console.log(`  🎯 Recall (Sensitivity): ${recall.toFixed(1)}%  [Fraction of propaganda caught]`);
  console.log(`  🎯 Precision:           ${precision.toFixed(1)}%`);
  console.log(`  🎯 F1-Score:            ${f1.toFixed(1)}%`);
  console.log(`  🎯 Overall Accuracy:    ${accuracy.toFixed(1)}%`);
  console.log(`  ⚡ Avg Latency:         ${avgLatency} ms / sample`);
  console.log("=====================================================================");

  // Technique-by-technique recall breakdown
  const techniqueStats: Record<string, { total: number; caught: number }> = {};
  for (const r of results) {
    if (!r.sample.isPropaganda) continue;
    const tech = r.sample.technique;
    if (!techniqueStats[tech]) techniqueStats[tech] = { total: 0, caught: 0 };
    techniqueStats[tech]!.total++;
    if (r.predictedPropaganda) techniqueStats[tech]!.caught++;
  }

  console.log("\n📊 TECHNIQUE-BY-TECHNIQUE RECALL BREAKDOWN:");
  console.log("---------------------------------------------------------------------");
  console.log(`Technique                           Samples   Caught      Recall`);
  console.log("---------------------------------------------------------------------");
  for (const [tech, stats] of Object.entries(techniqueStats)) {
    const techRecall = Math.round((stats.caught / stats.total) * 100);
    console.log(
      `${tech.padEnd(35)} ${String(stats.total).padEnd(9)} ${String(stats.caught).padEnd(11)} ${techRecall}%`
    );
  }
  console.log("---------------------------------------------------------------------\n");

  if (outputFile) {
    fs.writeFileSync(outputFile, JSON.stringify(results, null, 2), "utf-8");
    console.log(`💾 Detailed evaluation results saved to: ${outputFile}\n`);
  }
}

if (import.meta.main) {
  runBenchmark().catch((err) => {
    console.error("Unhandled benchmark error:", err);
    process.exit(1);
  });
}
