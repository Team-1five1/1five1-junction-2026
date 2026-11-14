<?php
// Run inside the WordPress container; fixtures are removed in finally.
require '/var/www/html/wp-load.php';
$post_id = 0; $comments = array(); $passed = 0;
function verify($condition, $label) {
    global $passed;
    if (!$condition) throw new Exception($label);
    $passed++;
    echo "PASS $label\n";
}
try {
    $interceptor = Shield_Interceptor::get_instance();
    remove_action('wp_insert_comment', array($interceptor, 'on_insert_comment'), 10);
    $post_id = wp_insert_post(array('post_title' => 'Verius verification fixture', 'post_status' => 'publish', 'comment_status' => 'open'));
    $_COOKIE['shield_author_session'] = str_repeat('a', 64);
    foreach (array('public', 'public_flagged', 'shadowbanned', 'pending') as $visibility) {
        $id = wp_insert_comment(array('comment_post_ID' => $post_id, 'comment_content' => 'Fixture ' . $visibility, 'comment_author' => 'Verification', 'comment_approved' => in_array($visibility, array('pending', 'shadowbanned'), true) ? 0 : 1));
        $comments[$visibility] = $id;
        update_comment_meta($id, '_shield_author_hash', str_repeat('a', 64));
        update_comment_meta($id, '_shield_visibility', $visibility);
    }
    verify(count(get_comments(array('post_id' => $post_id, 'status' => 'approve'))) === 4, 'author sees public, flagged, hidden and pending own comments');
    $_COOKIE['shield_author_session'] = str_repeat('b', 64);
    verify(count(get_comments(array('post_id' => $post_id, 'status' => 'approve'))) === 2, 'another visitor sees only public and flagged comments');
    verify(intval(get_comments_number($post_id)) === 2, 'public comment counts exclude hidden submissions');
    $rest = new WP_REST_Request('GET', '/wp/v2/comments/' . $comments['shadowbanned']);
    verify(rest_do_request($rest)->get_status() === 404, 'direct REST item reads cannot reveal a hidden comment');
    update_comment_meta($comments['pending'], '_shield_auto_publish', '1');
    $webhook = new WP_REST_Request('POST', '/shield/v1/webhook');
    $body = wp_json_encode(array('wpCommentId' => $comments['pending'], 'entityId' => strval($post_id), 'visibility' => 'public_flagged', 'failedRiskIds' => array('Q8'), 'triggeredShieldIds' => array(), 'modelUsed' => 'configured-research-model', 'deepResearchExplanation' => 'The text uses dehumanizing language.', 'researchEvidence' => array('researchStatus' => 'verified', 'sources' => array(array('title' => 'Original source', 'url' => 'https://example.org/original')), 'quoteChecks' => array())));
    $webhook->set_header('Content-Type', 'application/json');
    $webhook->set_body($body);
    verify(rest_do_request($webhook)->get_status() === 401, 'unsigned callbacks are rejected');
    $options = get_option('shield_guard_settings');
    $webhook->set_header('X-Shield-Signature', 'sha256=' . hash_hmac('sha256', $body, $options['webhook_secret']));
    verify(rest_do_request($webhook)->get_status() === 200, 'signed callback accepted');
    verify(get_comment_meta($comments['pending'], '_shield_visibility', true) === 'public_flagged', 'signed callback persists verdict');
    verify(strval(get_comment($comments['pending'])->comment_approved) === '1', 'evaluated human is released from the first-time-author hold');
    $rendered = Shield_Renderer::get_instance()->render_comment_badges_and_explanation('Original comment', get_comment($comments['pending']));
    verify(strpos($rendered, 'data-failed-ids=') !== false && strpos($rendered, 'dehumanizing language') !== false, 'flagged comments render question IDs and heavy explanation');
    verify(strpos($rendered, 'https://example.org/original') !== false, 'grounded comment annotations render their source links');
    $banner = array('anomalyStatus' => 'legitimate_backlash', 'bannerExplanation' => 'Feedback follows a patch.', 'sources' => array(array('title' => 'Patch notes', 'url' => 'https://example.org/patch')), 'updatedAt' => gmdate('c'));
    update_post_meta($post_id, '_shield_review_banner', wp_slash(wp_json_encode($banner)));
    verify(strpos(Shield_Renderer::get_instance()->get_post_banner_html($post_id), 'https://example.org/patch') !== false, 'review notices include supporting source links');
    echo "$passed WordPress assertions passed\n";
} finally {
    foreach ($comments as $id) wp_delete_comment($id, true);
    if ($post_id) wp_delete_post($post_id, true);
}
