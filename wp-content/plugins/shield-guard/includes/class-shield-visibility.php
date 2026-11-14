<?php
if (!defined('ABSPATH')) exit;

// WP REST single-item reads bypass WP_Comment_Query and therefore comments_clauses.
add_filter('rest_pre_dispatch', function($result, $server, $request) {
    if (!in_array($request->get_method(), array('GET', 'HEAD'), true) || !preg_match('#^/wp/v2/comments/(\d+)$#', $request->get_route(), $match)) return $result;
    if (current_user_can('moderate_comments')) return $result;
    $visibility = get_comment_meta(intval($match[1]), '_shield_visibility', true);
    if (in_array($visibility, array('pending', 'shadowbanned'), true)) {
        $owner = get_comment_meta(intval($match[1]), '_shield_author_hash', true);
        if (!$owner || !hash_equals($owner, Shield_Interceptor::get_instance()->get_viewer_session_hash())) {
            return new WP_Error('rest_comment_invalid_id', 'Invalid comment ID.', array('status' => 404));
        }
    }
    return $result;
}, 10, 3);

// A page containing author-only comments cannot be shared through a page cache.
add_action('template_redirect', function() {
    if (is_singular() && comments_open()) {
        if (!defined('DONOTCACHEPAGE')) define('DONOTCACHEPAGE', true);
        nocache_headers();
    }
});

add_filter('get_comments_number', function($count, $post_id) {
    if (is_admin() && current_user_can('moderate_comments')) return $count;
    return get_comments(array('post_id' => $post_id, 'status' => 'approve', 'count' => true));
}, 10, 2);

// WooCommerce's cached aggregates otherwise count hidden bot reviews.
function shield_public_rating_counts($value, $product) {
    global $wpdb;
    $rows = $wpdb->get_results($wpdb->prepare(
        "SELECT rating.meta_value AS rating, COUNT(DISTINCT c.comment_ID) AS total
        FROM {$wpdb->comments} c
        JOIN {$wpdb->commentmeta} rating ON rating.comment_id = c.comment_ID AND rating.meta_key = 'rating'
        LEFT JOIN {$wpdb->commentmeta} visibility ON visibility.comment_id = c.comment_ID AND visibility.meta_key = '_shield_visibility'
        WHERE c.comment_post_ID = %d AND c.comment_approved = '1'
        AND (visibility.meta_value IS NULL OR visibility.meta_value IN ('public', 'public_flagged'))
        AND rating.meta_value IN ('1','2','3','4','5') GROUP BY rating.meta_value", $product->get_id()
    ));
    $counts = array();
    foreach ($rows as $row) $counts[intval($row->rating)] = intval($row->total);
    return $counts;
}
add_filter('woocommerce_product_get_rating_counts', 'shield_public_rating_counts', 10, 2);
add_filter('woocommerce_product_get_average_rating', function($value, $product) {
    $counts = shield_public_rating_counts(array(), $product);
    $total = array_sum($counts); $sum = 0;
    foreach ($counts as $rating => $count) $sum += $rating * $count;
    return $total ? number_format($sum / $total, 2, '.', '') : '0';
}, 10, 2);
add_filter('woocommerce_product_get_review_count', function($value, $product) {
    return array_sum(shield_public_rating_counts(array(), $product));
}, 10, 2);
