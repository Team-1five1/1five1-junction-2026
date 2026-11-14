/** Uses live AI credits. Creates and removes only its own WordPress fixtures. */
import { strict as assert } from "node:assert";
import { db, sql } from "../src/db";
import { submissions, honeypotVault, evaluationJobs, entityBanners } from "../src/db/schema";
import { and, eq, inArray } from "drizzle-orm";

async function php(code: string) {
  const proc = Bun.spawn(["docker", "compose", "exec", "-T", "wordpress", "php", "-r", `require '/var/www/html/wp-load.php'; ${code}`], { stdout: "pipe", stderr: "pipe" });
  const output = await new Response(proc.stdout).text();
  if (await proc.exited !== 0) throw new Error(await new Response(proc.stderr).text());
  return output;
}
let fixture: { post: number; ids: number[] } | undefined;
try {
  fixture = JSON.parse(await php(`
    $post = wp_insert_post(array('post_title'=>'Verius live verification','post_status'=>'publish','comment_status'=>'open'));
    $ids = array();
    foreach (array('I had a rough experience with my order, but customer service refunded me.', 'Those people are parasites controlled by shadowy puppet masters. They alone cause all our problems. Share this before it gets deleted!', 'Automated honeypot verification fixture') as $index => $text) {
      $_COOKIE['shield_author_session'] = hash('sha256', 'live-fixture-' . $index . $post);
      $_POST = array('_shield_token' => wp_json_encode(array('webdriver' => $index === 2, 'mouseEventsCount' => 20, 'formCompletionTimeMs' => 8000)));
      $ids[] = wp_new_comment(array('comment_post_ID'=>$post,'comment_content'=>$text,'comment_author'=>'Verius verification','comment_author_email'=>'verify'.$index.'@example.org','comment_author_IP'=>'198.51.100.'.($index+1)), true);
    }
    echo wp_json_encode(array('post'=>$post,'ids'=>$ids));
  `));
  assert.ok(fixture?.ids.length === 3);
  const deadline = Date.now() + 120000;
  let verdicts: any[] = [];
  do {
    verdicts = JSON.parse(await php(`$out=array(); foreach (${JSON.stringify(fixture.ids).replace("[", "array(").replace("]", ")")} as $id) $out[]=array('id'=>$id,'visibility'=>get_comment_meta($id,'_shield_visibility',true),'model'=>get_comment_meta($id,'_shield_model_used',true),'explanation'=>get_comment_meta($id,'_shield_explanation',true)); echo wp_json_encode($out);`));
    if (verdicts.every(r => r.visibility !== "pending")) break;
    if (Date.now() >= deadline) throw new Error("Live WordPress callbacks timed out");
    await Bun.sleep(1000);
  } while (true);
  assert.equal(verdicts[0].visibility, "public");
  assert.equal(verdicts[0].explanation, "");
  assert.equal(verdicts[1].visibility, "public_flagged");
  assert.ok(verdicts[1].model.startsWith((process.env.MODEL_HEAVY_RESEARCH || "gpt-5-nano").replace(/-(eu|us)$/, "")));
  assert.ok(verdicts[1].explanation.length > 0);
  assert.equal(verdicts[2].visibility, "shadowbanned");
  assert.equal(verdicts[2].model, "none");
  const rows = await db.select().from(submissions).where(and(eq(submissions.entityId, String(fixture.post)), inArray(submissions.wpCommentId, fixture.ids)));
  assert.equal(rows.length, 3);
  const bot = rows.find(r => r.authorType === "bot")!;
  const vault = await db.select().from(honeypotVault).where(eq(honeypotVault.submissionId, bot.id));
  assert.equal(vault.length, 1);
  console.log("Live WordPress → PostgreSQL/Redis → Jev/research model → signed WordPress callbacks passed for human, flagged-human, and bot submissions. Dual storage confirmed.");
} finally {
  if (fixture) {
    const rows = await db.select().from(submissions).where(and(eq(submissions.entityId, String(fixture.post)), inArray(submissions.wpCommentId, fixture.ids)));
    if (rows.length) await db.delete(honeypotVault).where(inArray(honeypotVault.submissionId, rows.map(r => r.id)));
    await db.delete(submissions).where(and(eq(submissions.entityId, String(fixture.post)), inArray(submissions.wpCommentId, fixture.ids)));
    await db.delete(evaluationJobs).where(inArray(evaluationJobs.wpCommentId, fixture.ids));
    await db.delete(entityBanners).where(eq(entityBanners.entityId, String(fixture.post)));
    await php(`foreach (${JSON.stringify(fixture.ids).replace("[", "array(").replace("]", ")")} as $id) wp_delete_comment($id,true); wp_delete_post(${fixture.post},true);`);
  }
  await sql.end();
}
