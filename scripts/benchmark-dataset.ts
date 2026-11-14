/**
 * SemEval-2020 Task 11 Automated Benchmark Runner for Truthier
 *
 * Evaluates Truthier's full 2-stage propaganda identification engine
 * (Stage 1 `jev` Gatekeeper + Stage 2 `gemini-4-hydrogen` Stance/Forensic Verification)
 * against the SemEval-2020 Task 11 Gold Standard Corpus (PTC).
 *
 * Target: Negative Predictive Value (NPV = TN / (TN + FN) >= 95%)
 *
 * Usage:
 *   bun run scripts/benchmark-dataset.ts [options]
 *
 * Options:
 *   --dataset-dir <path>   Path to the datasets directory (default: /Users/andwspb/Downloads/datasets)
 *   --limit <number>       Total samples to test (e.g. --limit 50, half positive, half negative)
 *   --mode <mode>          Threshold mode: 'strict' | 'balanced' | 'high_precision' (default: balanced)
 *   --technique <name>     Filter to a specific technique (e.g. Loaded_Language)
 *   --stage1-only          Only run Stage 1 (jev) without calling Stage 2 Gemini
 *   --dry-run              Parse and display extracted samples without invoking AI API
 *   --output <file>        Save detailed JSON results to file
 */

import * as fs from "fs";
import * as path from "path";
import { screenWithJev } from "../src/ai/jev-screener";
import { evaluateSemEvalBitmask, type QuestionId } from "../src/engines/semeval-scorer";
import { verifyStanceOrForensic } from "../src/ai/hydrogen-research";

// Mapping SemEval-2020 Task 11 Gold Standard techniques to Truthier 22-question IDs
export const TECHNIQUE_TO_QUESTIONS: Record<string, QuestionId[]> = {
  Loaded_Language: ["Q1"],
  "Exaggeration,Minimisation": ["Q2"],
  Repetition: ["Q3"],
  Slogans: ["Q3"],
  "Thought-terminating_Cliches": ["Q4"],
  "Name_Calling,Labeling": ["Q5", "Q15", "Q16"],
  Doubt: ["Q6"],
  Appeal_to_Authority: ["Q7"],
  "Flag-Waving": ["Q8"],
  "Bandwagon,Reductio_ad_hitlerum": ["Q9", "Q16"],
  Causal_Oversimplification: ["Q10"],
  "Whataboutism,Straw_Men,Red_Herring": ["Q11", "Q12"],
  "Appeal_to_fear-prejudice": ["Q14", "Q15"],
  "Black-and-White_Fallacy": ["Q18"],
};

export interface BenchmarkSample {
  id: string;
  articleId: string;
  text: string;
  spanText: string;
  isPropaganda: boolean;
  expectedTechnique?: string;
  expectedQuestionIds: QuestionId[];
}

export interface SampleEvaluationResult {
  sample: BenchmarkSample;
  predictedPropaganda: boolean;
  correct: boolean;
  riskScore: number;
  route: string;
  modelUsed: string;
  triggeredIds: QuestionId[];
  techniqueMatch: boolean;
  latencyMs: number;
  explanation: string | null;
}

/**
 * Extracts target sentence along with 1 preceding and 1 following sentence for context window.
 * Formats with [TARGET SENTENCE]: ... and [SURROUNDING CONTEXT]: ... so short quotes aren't blind.
 */
function extractSpanWithWindowContext(fullText: string, start: number, end: number): string {
  // 1. Locate the boundaries of the target sentence containing [start, end]
  let sStart = start;
  while (sStart > 0 && !/[.!?\n]/.test(fullText[sStart - 1])) {
    sStart--;
  }
  let sEnd = end;
  while (sEnd < fullText.length && !/[.!?\n]/.test(fullText[sEnd])) {
    sEnd++;
  }
  if (sEnd < fullText.length && /[.!?]/.test(fullText[sEnd])) {
    sEnd++;
  }

  const targetSentence = fullText.substring(sStart, sEnd).trim().replace(/^["'\s]+|["'\s]+$/g, "");

  // 2. Find preceding sentence boundary
  let prevStart = sStart;
  while (prevStart > 0 && /[.!?\n\s]/.test(fullText[prevStart - 1])) {
    prevStart--;
  }
  let prevEnd = prevStart;
  while (prevStart > 0 && !/[.!?\n]/.test(fullText[prevStart - 1])) {
    prevStart--;
  }
  const prevSentence = fullText.substring(prevStart, prevEnd).trim().replace(/^["'\s]+|["'\s]+$/g, "");

  // 3. Find next sentence boundary
  let nextStart = sEnd;
  while (nextStart < fullText.length && /[.!?\n\s]/.test(fullText[nextStart])) {
    nextStart++;
  }
  let nextEnd = nextStart;
  while (nextEnd < fullText.length && !/[.!?\n]/.test(fullText[nextEnd])) {
    nextEnd++;
  }
  if (nextEnd < fullText.length && /[.!?]/.test(fullText[nextEnd])) {
    nextEnd++;
  }
  const nextSentence = fullText.substring(nextStart, nextEnd).trim().replace(/^["'\s]+|["'\s]+$/g, "");

  // Construct context string
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

  // Group spans by article ID
  const articleSpans = new Map<
    string,
    Array<{ technique: string; start: number; end: number }>
  >();

  for (const line of labelLines) {
    const parts = line.split("\t");
    if (parts.length < 4) continue;
    const [artId, technique, startStr, endStr] = parts;
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

  // 1. Build Positive Samples
  const articleIds = Array.from(articleSpans.keys());
  for (const artId of articleIds) {
    if (positiveSamples.length >= maxPerCategory) break;

    const artFile = path.join(articlesDir, `article${artId}.txt`);
    if (!fs.existsSync(artFile)) continue;
    const fullText = fs.readFileSync(artFile, "utf-8");

    const spans = articleSpans.get(artId) || [];
    for (const span of spans) {
      if (positiveSamples.length >= maxPerCategory) break;
      const spanSnippet = fullText.substring(span.start, span.end).trim();
      if (!spanSnippet || spanSnippet.length < 3) continue;

      const evalText = extractSpanWithWindowContext(fullText, span.start, span.end);
      const expectedQ = TECHNIQUE_TO_QUESTIONS[span.technique] || [];

      positiveSamples.push({
        id: `pos_${artId}_${span.start}_${span.end}`,
        articleId: artId,
        text: evalText,
        spanText: spanSnippet,
        isPropaganda: true,
        expectedTechnique: span.technique,
        expectedQuestionIds: expectedQ,
      });
    }
  }

  // 2. Build Negative Control Samples (clean sentences with zero overlapping propaganda spans)
  for (const artId of articleIds) {
    if (negativeSamples.length >= maxPerCategory) break;

    const artFile = path.join(articlesDir, `article${artId}.txt`);
    if (!fs.existsSync(artFile)) continue;
    const fullText = fs.readFileSync(artFile, "utf-8");
    const spans = articleSpans.get(artId) || [];

    // Split text into paragraphs/sentences
    const paragraphs = fullText
      .split(/\n+/)
      .map((p) => p.trim())
      .filter((p) => p.length >= 40 && p.length <= 300);

    for (const para of paragraphs) {
      if (negativeSamples.length >= maxPerCategory) break;
      const pIdx = fullText.indexOf(para);
      if (pIdx === -1) continue;
      const pEnd = pIdx + para.length;

      // Check if this paragraph overlaps with ANY annotated span
      const overlaps = spans.some((s) => Math.max(s.start, pIdx) < Math.min(s.end, pEnd));
      if (!overlaps) {
        negativeSamples.push({
          id: `neg_${artId}_${pIdx}`,
          articleId: artId,
          text: para,
          spanText: "",
          isPropaganda: false,
          expectedQuestionIds: [],
        });
      }
    }
  }

  // Combine and interleave samples
  const combined: BenchmarkSample[] = [];
  const maxLen = Math.max(positiveSamples.length, negativeSamples.length);
  for (let i = 0; i < maxLen; i++) {
    if (i < positiveSamples.length && combined.length < limit) combined.push(positiveSamples[i]);
    if (i < negativeSamples.length && combined.length < limit) combined.push(negativeSamples[i]);
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
    return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
  }

  const datasetDir = getArg("--dataset-dir", "/Users/andwspb/Downloads/datasets");
  const limit = parseInt(getArg("--limit", "50"), 10);
  const mode = (getArg("--mode", "balanced") as "strict" | "balanced" | "high_precision");
  const techniqueFilter = getArg("--technique", "");
  const isDryRun = args.includes("--dry-run");
  const stage1Only = args.includes("--stage1-only");
  const outputFile = getArg("--output", "");

  console.log("\n=====================================================================");
  console.log("   TRUTHIER PROPAGANDA IDENTIFICATION BENCHMARK");
  console.log("   Dataset: SemEval-2020 Task 11 (Gold Standard Corpus)");
  console.log(`   Pipeline: ${stage1Only ? "Stage 1 (jev) Gatekeeper Only" : "Full 2-Stage (jev + gemini-4-hydrogen)"}`);
  console.log("   Target: Negative Predictive Value (NPV = TN / (TN + FN) >= 95%)");
  console.log("=====================================================================");
  console.log(`  📂 Dataset Directory: ${datasetDir}`);
  console.log(`  🎯 Target Sample Count: ${limit}`);
  console.log(`  ⚙️ Threshold Mode: ${mode}`);
  if (techniqueFilter) console.log(`  🔍 Technique Filter: ${techniqueFilter}`);
  if (isDryRun) console.log(`  🏃 Mode: DRY RUN (no API calls)`);
  console.log("=====================================================================\n");

  console.log("⏳ Loading and parsing dataset annotations...");
  const samples = loadDatasetSamples({
    datasetDir,
    limit,
    techniqueFilter: techniqueFilter || undefined,
  });

  const posCount = samples.filter((s) => s.isPropaganda).length;
  const negCount = samples.filter((s) => !s.isPropaganda).length;
  console.log(`✅ Loaded ${samples.length} samples (${posCount} Propaganda Positive, ${negCount} Clean Controls)\n`);

  if (isDryRun) {
    console.log("--- SAMPLE PREVIEWS (DRY RUN) ---");
    samples.slice(0, 6).forEach((s, i) => {
      console.log(`\n[${i + 1}] Type: ${s.isPropaganda ? `PROPAGANDA (${s.expectedTechnique})` : "CLEAN CONTROL"}`);
      console.log(`    Evaluated Text: "${s.text.substring(0, 100)}..."`);
      if (s.spanText) console.log(`    Annotated Span: "${s.spanText}"`);
      console.log(`    Expected Questions: [${s.expectedQuestionIds.join(", ")}]`);
    });
    console.log("\n✅ Dry run completed successfully.");
    return;
  }

  console.log(`🚀 Evaluating samples against ${stage1Only ? "Stage 1 (jev)" : "Full 2-Stage Pipeline (jev -> Gemini)"}...\n`);

  const results: SampleEvaluationResult[] = [];
  let index = 0;

  for (const sample of samples) {
    index++;
    const t0 = performance.now();

    try {
      // 1. Stage 1: Fast Screener Jev
      const screenRes = await screenWithJev(sample.text);
      // 2. Score via deterministic 22-question gatekeeper with adaptive thresholding
      const scoreRes = evaluateSemEvalBitmask({
        triggeredIds: screenRes.triggeredIds,
        mode,
        textLength: sample.text.length,
      });

      let predictedPropaganda = scoreRes.escalateToHydrogen;
      let finalModel = screenRes.modelUsed;
      let finalRoute = scoreRes.route;
      let explanation: string | null = null;

      // 3. Stage 2: Heavy Forensic & Stance Grounding (Gemini) when escalated
      if (scoreRes.escalateToHydrogen && !stage1Only) {
        const forensicRes = await verifyStanceOrForensic(
          sample.text,
          scoreRes.route === "ROUTE_3_STANCE_VERIFICATION"
            ? "ROUTE_3_STANCE_VERIFICATION"
            : "ROUTE_4_FORENSIC_THREAT",
          scoreRes.failedRiskIds
        );
        finalModel = forensicRes.modelUsed;
        explanation = forensicRes.deepResearchExplanation;

        if (!forensicRes.endorsed) {
          // Gemini cleared the text as benign/unendorsed
          predictedPropaganda = false;
          finalRoute = "ROUTE_2_SHIELDED_CLEAR";
        } else {
          predictedPropaganda = true;
          finalRoute = scoreRes.route;
        }
      }

      const latencyMs = Math.round(performance.now() - t0);

      // Technique match check
      const techniqueMatch =
        sample.isPropaganda &&
        sample.expectedQuestionIds.some((qId) => screenRes.triggeredIds.includes(qId));

      const correct = predictedPropaganda === sample.isPropaganda;

      results.push({
        sample,
        predictedPropaganda,
        correct,
        riskScore: scoreRes.riskScore,
        route: finalRoute,
        modelUsed: finalModel,
        triggeredIds: screenRes.triggeredIds,
        techniqueMatch,
        latencyMs,
        explanation,
      });

      const icon = correct ? "✅" : "❌";
      const typeLabel = sample.isPropaganda ? `PROPAGANDA [${sample.expectedTechnique}]` : "CLEAN";
      const decisionStr = predictedPropaganda ? "FLAGGED (THREAT)" : "CLEARED (CLEAN)";
      console.log(
        `  ${icon} [${String(index).padStart(2, " ")}/${samples.length}] ${typeLabel.padEnd(35, " ")} | ` +
        `Score: ${String(scoreRes.riskScore).padStart(2, " ")} | ${decisionStr.padEnd(17, " ")} | ` +
        `Model: ${finalModel.padEnd(16, " ")} | ` +
        `Questions: [${screenRes.triggeredIds.join(",") || "none"}] (${latencyMs}ms)`
      );
    } catch (err: any) {
      console.error(`  ⚠️ Error on sample ${index}: ${err.message}`);
    }
  }

  // Compute Metrics
  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;

  const techniqueStats: Record<string, { total: number; detected: number; matchedTechnique: number }> = {};

  for (const r of results) {
    if (r.sample.isPropaganda) {
      const tech = r.sample.expectedTechnique || "Unknown";
      if (!techniqueStats[tech]) techniqueStats[tech] = { total: 0, detected: 0, matchedTechnique: 0 };
      techniqueStats[tech].total++;

      if (r.predictedPropaganda) {
        tp++;
        techniqueStats[tech].detected++;
        if (r.techniqueMatch) techniqueStats[tech].matchedTechnique++;
      } else {
        fn++;
      }
    } else {
      if (r.predictedPropaganda) {
        fp++;
      } else {
        tn++;
      }
    }
  }

  const total = results.length;
  const accuracy = total > 0 ? (tp + tn) / total : 0;
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  const npv = tn + fn > 0 ? tn / (tn + fn) : 0;
  const avgLatency = Math.round(results.reduce((a, b) => a + b.latencyMs, 0) / (total || 1));

  console.log("\n=====================================================================");
  console.log("   BENCHMARK PERFORMANCE SUMMARY");
  console.log(`   Pipeline: ${stage1Only ? "Stage 1 (jev) Gatekeeper Only" : "Full 2-Stage (jev + gemini-4-hydrogen)"}`);
  console.log("=====================================================================");
  console.log(`  Total Evaluated:        ${total}`);
  console.log(`  True Positives (TP):    ${tp}  (Propaganda correctly identified)`);
  console.log(`  True Negatives (TN):    ${tn}  (Clean controls correctly cleared)`);
  console.log(`  False Positives (FP):   ${fp}  (Clean falsely flagged)`);
  console.log(`  False Negatives (FN):   ${fn}  (Propaganda missed)`);
  console.log("---------------------------------------------------------------------");
  console.log(`  🛡️ Negative Pred. Value: ${(npv * 100).toFixed(1)}%  [Target >= 95% Clean Confidence]`);
  console.log(`  🎯 Recall (Sensitivity): ${(recall * 100).toFixed(1)}%  [Fraction of propaganda caught]`);
  console.log(`  🎯 Precision:           ${(precision * 100).toFixed(1)}%`);
  console.log(`  🎯 F1-Score:            ${(f1 * 100).toFixed(1)}%`);
  console.log(`  🎯 Overall Accuracy:    ${(accuracy * 100).toFixed(1)}%`);
  console.log(`  ⚡ Avg Latency:         ${avgLatency} ms / sample`);
  console.log("=====================================================================\n");

  console.log("📊 TECHNIQUE-BY-TECHNIQUE RECALL BREAKDOWN:");
  console.log("---------------------------------------------------------------------");
  console.log(
    "Technique".padEnd(36, " ") +
    "Samples".padEnd(10, " ") +
    "Caught".padEnd(12, " ") +
    "Recall"
  );
  console.log("---------------------------------------------------------------------");
  for (const [tech, s] of Object.entries(techniqueStats)) {
    const techRecall = s.total > 0 ? ((s.detected / s.total) * 100).toFixed(0) : "0";
    console.log(
      tech.padEnd(36, " ") +
      String(s.total).padEnd(10, " ") +
      String(s.detected).padEnd(12, " ") +
      `${techRecall}%`
    );
  }
  console.log("---------------------------------------------------------------------\n");

  // ---------------------------------------------------------------------------
  // Offline Threshold Sweep (Cutoffs 1, 2, 3, 4)
  // ---------------------------------------------------------------------------
  console.log("=====================================================================");
  console.log("   OFFLINE THRESHOLD SWEEP (Stage 1 Cutoff Sensitivity)");
  console.log("=====================================================================");
  console.log(
    "Cutoff".padEnd(10, " ") +
    "NPV (Clean Conf)".padEnd(18, " ") +
    "Recall".padEnd(12, " ") +
    "Precision".padEnd(12, " ") +
    "Clean Cleared %"
  );
  console.log("---------------------------------------------------------------------");

  for (const cutoff of [1, 2, 3, 4]) {
    let sweepTp = 0;
    let sweepFp = 0;
    let sweepTn = 0;
    let sweepFn = 0;

    for (const r of results) {
      // Determine if sample flags under this riskScore cutoff
      const flagsUnderCutoff = r.riskScore >= cutoff;
      if (r.sample.isPropaganda) {
        if (flagsUnderCutoff) sweepTp++;
        else sweepFn++;
      } else {
        if (flagsUnderCutoff) sweepFp++;
        else sweepTn++;
      }
    }

    const sweepNpv = sweepTn + sweepFn > 0 ? (sweepTn / (sweepTn + sweepFn)) * 100 : 0;
    const sweepRecall = sweepTp + sweepFn > 0 ? (sweepTp / (sweepTp + sweepFn)) * 100 : 0;
    const sweepPrec = sweepTp + sweepFp > 0 ? (sweepTp / (sweepTp + sweepFp)) * 100 : 0;
    const cleanClearedPct = posCount + negCount > 0 && negCount > 0 ? (sweepTn / negCount) * 100 : 0;

    console.log(
      `>= ${cutoff} pts`.padEnd(10, " ") +
      `${sweepNpv.toFixed(1)}%`.padEnd(18, " ") +
      `${sweepRecall.toFixed(1)}%`.padEnd(12, " ") +
      `${sweepPrec.toFixed(1)}%`.padEnd(12, " ") +
      `${cleanClearedPct.toFixed(1)}%`
    );
  }
  console.log("=====================================================================\n");

  if (outputFile) {
    fs.writeFileSync(
      outputFile,
      JSON.stringify(
        { summary: { npv, recall, precision, f1, accuracy, avgLatency, tp, tn, fp, fn }, results },
        null,
        2
      )
    );
    console.log(`💾 Full results exported to ${outputFile}\n`);
  }
}

if (import.meta.main) {
  runBenchmark().catch((e) => {
    console.error("Benchmark failed with error:", e);
    process.exit(1);
  });
}
