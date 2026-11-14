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
        if (!empty($_COOKIE['shield_author_session'])) {
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
            $this->get_viewer_session_hash();
        }
    }

    /**
     * Hook wp_insert_comment: tags comment with session hash and pending visibility,
     * then fires non-blocking asynchronous POST to Bun API /v1/ingest.
     */
    public function on_insert_comment($comment_id, $comment_object) {
        $author_hash = $this->get_viewer_session_hash();
        update_comment_meta($comment_id, '_shield_author_hash', $author_hash);

        $telemetry_token = isset($_POST['_shield_token']) ? sanitize_text_field($_POST['_shield_token']) : '';
        $hp_val = isset($_POST['_shield_hp_field']) ? sanitize_text_field($_POST['_shield_hp_field']) : '';
        $ai_trap_val = isset($_POST['_shield_ai_trap']) ? sanitize_text_field($_POST['_shield_ai_trap']) : '';
        $rating = isset($_POST['rating']) ? intval($_POST['rating']) : null;

        // Decode client telemetry payload (from collector.js + @fingerprintjs/botd)
        $is_bot_detected = false;
        if (!empty($hp_val) || !empty($ai_trap_val)) {
            $is_bot_detected = true;
        } elseif (!empty($telemetry_token)) {
            $decoded_json = base64_decode($telemetry_token, true);
            $telemetry = $decoded_json ? json_decode($decoded_json, true) : json_decode($telemetry_token, true);
            if (is_array($telemetry)) {
                if (!empty($telemetry['botdDetected']) || !empty($telemetry['webdriver']) || !empty($telemetry['honeypotTriggered']) || !empty($telemetry['aiTrapTriggered'])) {
                    $is_bot_detected = true;
                } elseif (isset($telemetry['formCompletionTimeMs']) && intval($telemetry['formCompletionTimeMs']) < 600) {
                    $is_bot_detected = true;
                } elseif (empty($telemetry['mouseEventsCount']) && empty($telemetry['touchEventsCount']) && empty($telemetry['keyCount'])) {
                    $is_bot_detected = true;
                }
            }
        }

        if ($is_bot_detected) {
            update_comment_meta($comment_id, '_shield_visibility', 'shadowbanned');
        } else {
            // Verified human visitor -> immediately public!
            update_comment_meta($comment_id, '_shield_visibility', 'public');
        }

        $post_id = $comment_object->comment_post_ID;
        $post = get_post($post_id);
        $entity_title = $post ? $post->post_title : 'Post #' . $post_id;

        $options = get_option('shield_guard_settings', array());
        $configured_url = !empty($options['api_url']) ? rtrim($options['api_url'], '/') : 'http://host.docker.internal:4000';
        // Inside Docker container, 127.0.0.1:4000 points to the WP container itself instead of the host Bun server
        if (strpos($configured_url, '127.0.0.1:4000') !== false || strpos($configured_url, 'localhost:4000') !== false) {
            $api_url = 'http://host.docker.internal:4000';
        } else {
            $api_url = $configured_url;
        }
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

        // Synchronous dispatch to Bun Hono ingestion endpoint so forensic badges & banners are ready before redirect
        $response = wp_remote_post($api_url . '/v1/ingest?sync=true', array(
            'method'      => 'POST',
            'blocking'    => true,
            'timeout'     => 6,
            'headers'     => array(
                'Content-Type' => 'application/json',
                'X-Shield-Key' => $api_key,
            ),
            'body'        => wp_json_encode($payload),
            'data_format' => 'body',
        ));

        if (!is_wp_error($response) && wp_remote_retrieve_response_code($response) === 200) {
            $res_data = json_decode(wp_remote_retrieve_body($response), true);
            if (is_array($res_data) && !empty($res_data['visibility'])) {
                update_comment_meta($comment_id, '_shield_visibility', sanitize_text_field($res_data['visibility']));
                if (!empty($res_data['failedRiskIds']) && is_array($res_data['failedRiskIds'])) {
                    update_comment_meta($comment_id, '_shield_failed_ids', wp_json_encode($res_data['failedRiskIds']));
                }
                if (isset($res_data['riskScore'])) {
                    update_comment_meta($comment_id, '_shield_risk_score', intval($res_data['riskScore']));
                }
                if (!empty($res_data['modelUsed'])) {
                    update_comment_meta($comment_id, '_shield_model_used', sanitize_text_field($res_data['modelUsed']));
                }
                if (!empty($res_data['deepResearchExplanation'])) {
                    update_comment_meta($comment_id, '_shield_explanation', sanitize_textarea_field($res_data['deepResearchExplanation']));
                }
                if (!empty($res_data['banner']) && is_array($res_data['banner'])) {
                    update_post_meta($post_id, '_shield_review_banner', wp_slash(wp_json_encode($res_data['banner'])));
                }
            }
        }
    }

    /**
     * Dual-Storage Shadowban Filter:
     * Public visitors only query comments where _shield_visibility IN ('public', 'public_flagged')
     * OR where the comment was created by the currently browsing session (_shield_author_hash).
     * Bots always see their own shadowbanned content!
     */
    public function filter_comments_clauses($clauses, $query) {
        if (is_admin()) {
            return $clauses;
        }

        global $wpdb;
        $viewer_hash = esc_sql($this->get_viewer_session_hash());

        $clauses['join'] .= " LEFT JOIN {$wpdb->commentmeta} AS shield_vis ON {$wpdb->comments}.comment_ID = shield_vis.comment_id AND shield_vis.meta_key = '_shield_visibility'";
        $clauses['join'] .= " LEFT JOIN {$wpdb->commentmeta} AS shield_hash ON {$wpdb->comments}.comment_ID = shield_hash.comment_id AND shield_hash.meta_key = '_shield_author_hash'";

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
