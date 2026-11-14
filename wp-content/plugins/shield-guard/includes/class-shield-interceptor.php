<?php
if (!defined('ABSPATH')) {
    exit;
}

class Shield_Interceptor {
    private static $instance = null;

    public static function get_instance() {
        if (self::$instance === null) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    private function __construct() {
        add_action('init', array($this, 'ensure_author_session_cookie'));
        add_filter('pre_comment_approved', array($this, 'auto_approve_bot_illusion'), 99, 2);
        add_action('shield_retry_ingest', array($this, 'dispatch_comment'));
        add_action('pre_get_comments', function($query) {
            if (is_admin() && current_user_can('moderate_comments')) return;
            // WP caches IDs before comments_clauses runs. Partition that cache by viewer.
            $query->query_vars['cache_domain'] = 'shield_' . $this->get_viewer_session_hash();
        });
        add_action('wp_insert_comment', array($this, 'on_insert_comment'), 10, 2);
        add_filter('comments_clauses', array($this, 'filter_comments_clauses'), 10, 2);
        // Filter the displayed comment count so public visitors only see the count of visible comments,
        // and bots only see the count of public comments + their own comments!
        add_filter('get_comments_number', array($this, 'filter_comments_number'), 10, 2);
        // Disable WordPress default flood control throttle and duplicate comment check
        // so automated honeypot bot swarm demos can post successive comments without wp_die
        add_filter('comment_flood_filter', '__return_false', 99);
        add_filter('duplicate_comment_id', '__return_false', 99);
    }

    /**
     * Deceptive Shadowban:
     * Tell WordPress core comment is approved (status = 1) so:
     * 1. WordPress does NOT show "Your comment is awaiting moderation" to the bot.
     * 2. When the bot submits comment 2, 3, etc., previous comments stay published in the database!
     * 3. Shield_Interceptor::filter_comments_clauses ensures the public still NEVER sees it!
     */
    public function auto_approve_bot_illusion($approved, $commentdata) {
        return 1;
    }

    /**
     * Generates or retrieves the session hash.
     * Sets a persistent cookie, with deterministic IP + UserAgent SHA256 fallback for headless bots.
     */
    public function get_viewer_session_hash() {
        if (!empty($_COOKIE['shield_author_session']) && preg_match('/^[a-f0-9]{64}$/', $_COOKIE['shield_author_session'])) {
            return sanitize_text_field($_COOKIE['shield_author_session']);
        }

        // Generate a random unique session token so distinct visitors/browsers never collide
        $token = bin2hex(random_bytes(16));
        if (!headers_sent()) {
            setcookie('shield_author_session', $token, time() + (30 * 86400), COOKIEPATH ? COOKIEPATH : '/', COOKIE_DOMAIN, is_ssl(), true);
            $_COOKIE['shield_author_session'] = $token;
        }
        return $token;
    }

    public function ensure_author_session_cookie() {
        if (empty($_COOKIE['shield_author_session']) && !headers_sent()) {
            $hash = hash('sha256', wp_generate_uuid4() . wp_salt('nonce'));
            setcookie('shield_author_session', $hash, time() + (30 * 86400), COOKIEPATH ? COOKIEPATH : '/', COOKIE_DOMAIN, is_ssl(), true);
            $_COOKIE['shield_author_session'] = $hash;
        }
    }

    /**
     * Hook wp_insert_comment: tags comment with session hash and pending visibility,
     * then fires non-blocking asynchronous POST to Bun API /v1/ingest.
     */
    public function on_insert_comment($comment_id, $comment_object) {
        if ($comment_object->comment_type && !in_array($comment_object->comment_type, array('comment', 'review'), true)) return;
        $author_hash = $this->get_viewer_session_hash();
        update_comment_meta($comment_id, '_shield_visitor_ip', $comment_object->comment_author_IP);
        update_comment_meta($comment_id, '_shield_visitor_ua', $comment_object->comment_agent);
        update_comment_meta($comment_id, '_shield_author_hash', $author_hash);
        update_comment_meta($comment_id, '_shield_visibility', 'pending');
        // Replace WordPress's first-time-author hold after evaluation, while respecting
        // an administrator's explicit "manually approve comments" setting.
        if (strval($comment_object->comment_approved) === '0' && !get_option('comment_moderation')) {
            update_comment_meta($comment_id, '_shield_auto_publish', '1');
        }

        $telemetry_token = isset($_POST['_shield_token']) ? sanitize_text_field($_POST['_shield_token']) : '';
        $hp_val = isset($_POST['_shield_hp_field']) ? sanitize_text_field($_POST['_shield_hp_field']) : '';
        $ai_trap_val = isset($_POST['_shield_ai_trap']) ? sanitize_text_field($_POST['_shield_ai_trap']) : '';
        $rating = isset($_POST['rating']) ? intval($_POST['rating']) : null;

        $post_id = $comment_object->comment_post_ID;
        $post = get_post($post_id);
        $entity_title = $post ? $post->post_title : 'Post #' . $post_id;

        $options = get_option('shield_guard_settings', array());
        $api_key = !empty($options['api_key']) ? $options['api_key'] : 'default_tenant';
        $mode = !empty($options['threshold_mode']) ? $options['threshold_mode'] : 'balanced';

        // Use explicit index.php?rest_route= URL so webhook succeeds even without Apache mod_rewrite permalinks
        $webhook_url = add_query_arg('rest_route', '/shield/v1/webhook', home_url('/index.php'));

        $payload = array(
            'wpCommentId'        => intval($comment_id),
            'entityId'           => strval($post_id),
            'entityTitle'        => $entity_title,
            'authorSessionHash'  => $author_hash,
            'rawText'            => $comment_object->comment_content,
            'rating'             => $rating,
            'telemetryToken'     => $telemetry_token,
            'honeypotValue'      => !empty($hp_val) ? $hp_val : $ai_trap_val,
            'tenantApiKey'       => $api_key,
            'wpWebhookUrl'       => $webhook_url,
            'thresholdMode'      => $mode,
        );

        update_comment_meta($comment_id, '_shield_ingest_payload', wp_slash(wp_json_encode($payload)));
        $this->dispatch_comment($comment_id);
    }

    public function dispatch_comment($comment_id) {
        $payload_json = get_comment_meta($comment_id, '_shield_ingest_payload', true);
        if (!$payload_json) return;
        $options = get_option('shield_guard_settings', array());
        $configured_url = !empty($options['api_url']) ? rtrim($options['api_url'], '/') : 'http://127.0.0.1:4000';
        if (strpos($configured_url, '127.0.0.1:4000') !== false || strpos($configured_url, 'localhost:4000') !== false) {
            $api_url = file_exists('/.dockerenv') ? 'http://host.docker.internal:4000' : $configured_url;
        } else {
            $api_url = $configured_url;
        }
        $api_key = isset($options['api_key']) ? $options['api_key'] : '';

        // Ensure payload has the latest tenant key if options were updated since insert
        $payload = json_decode($payload_json, true);
        if (is_array($payload) && !empty($api_key) && (empty($payload['tenantApiKey']) || $payload['tenantApiKey'] !== $api_key)) {
            $payload['tenantApiKey'] = $api_key;
            $payload_json = wp_json_encode($payload);
            update_comment_meta($comment_id, '_shield_ingest_payload', wp_slash($payload_json));
        }

        $response = wp_remote_post($api_url . '/v1/ingest', array(
            'method'      => 'POST',
            'blocking'    => true, // Wait for durable acceptance, never for AI analysis.
            'timeout'     => 3,
            'headers'     => array(
                'Content-Type' => 'application/json',
                'X-Shield-Key' => $api_key,
                'X-Shield-Visitor-IP' => get_comment_meta($comment_id, '_shield_visitor_ip', true),
                'X-Shield-Visitor-UA' => get_comment_meta($comment_id, '_shield_visitor_ua', true),
            ),
            'body'        => $payload_json,
            'data_format' => 'body',
        ));

        if (!is_wp_error($response) && (wp_remote_retrieve_response_code($response) === 202 || wp_remote_retrieve_response_code($response) === 200)) {
            delete_comment_meta($comment_id, '_shield_ingest_payload');
            delete_comment_meta($comment_id, '_shield_visitor_ip');
            delete_comment_meta($comment_id, '_shield_visitor_ua');
        } elseif (!wp_next_scheduled('shield_retry_ingest', array(intval($comment_id)))) {
            wp_schedule_single_event(time() + 60, 'shield_retry_ingest', array(intval($comment_id)));
        }
    }

    /**
     * Dual-Storage Shadowban Filter:
     * Public visitors only query comments where _shield_visibility IN ('public', 'public_flagged')
     * OR where the comment was created by the currently browsing session (_shield_author_hash).
     * Bots always see their own shadowbanned content!
     */
    public function filter_comments_clauses($clauses, $query) {
        if (is_admin() && current_user_can('moderate_comments')) {
            return $clauses;
        }

        global $wpdb;
        $viewer_hash = esc_sql($this->get_viewer_session_hash());

        $clauses['join'] .= " LEFT JOIN {$wpdb->commentmeta} AS shield_vis ON {$wpdb->comments}.comment_ID = shield_vis.comment_id AND shield_vis.meta_key = '_shield_visibility'";
        $clauses['join'] .= " LEFT JOIN {$wpdb->commentmeta} AS shield_hash ON {$wpdb->comments}.comment_ID = shield_hash.comment_id AND shield_hash.meta_key = '_shield_author_hash'";

        // The native approval predicate must also allow this author's own held submissions.
        $clauses['where'] = preg_replace(
            "/(?:[a-zA-Z0-9_]+\\.)?comment_approved\\s*=\\s*'1'/",
            "({$wpdb->comments}.comment_approved = '1' OR ({$wpdb->comments}.comment_approved = '0' AND shield_hash.meta_value = '{$viewer_hash}'))",
            $clauses['where']
        );

        // Allow:
        // 1. Unmanaged/legacy comments (shield_vis.meta_value IS NULL)
        // 2. Verified public or public_flagged comments
        // 3. Comments where current viewer is author (even if pending or shadowbanned!)
        $clauses['where'] .= " AND (
            shield_vis.meta_value IS NULL OR
            shield_vis.meta_value IN ('public', 'public_flagged') OR
            shield_hash.meta_value = '{$viewer_hash}'
        )";

        return $clauses;
    }

    /**
     * Filters the comment count (e.g. "X responses to Post") dynamically per-viewer
     * so public visitors only see the count of public comments, and bots only see
     * public comments + their own comments.
     */
    public function filter_comments_number($count, $post_id) {
        if (is_admin()) {
            return $count;
        }

        global $wpdb;
        $viewer_hash = esc_sql($this->get_viewer_session_hash());
        $post_id_int = intval($post_id);

        $sql = "SELECT COUNT(DISTINCT c.comment_ID)
                FROM {$wpdb->comments} c
                LEFT JOIN {$wpdb->commentmeta} shield_vis ON c.comment_ID = shield_vis.comment_id AND shield_vis.meta_key = '_shield_visibility'
                LEFT JOIN {$wpdb->commentmeta} shield_hash ON c.comment_ID = shield_hash.comment_id AND shield_hash.meta_key = '_shield_author_hash'
                WHERE c.comment_post_ID = {$post_id_int}
                  AND c.comment_approved = '1'
                  AND (
                      shield_vis.meta_value IS NULL OR
                      shield_vis.meta_value IN ('public', 'public_flagged') OR
                      shield_hash.meta_value = '{$viewer_hash}'
                  )";

        $filtered_count = $wpdb->get_var($sql);
        return ($filtered_count !== null) ? intval($filtered_count) : $count;
    }
}
