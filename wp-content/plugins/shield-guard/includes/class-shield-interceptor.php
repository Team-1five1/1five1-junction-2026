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
        add_action('wp_insert_comment', array($this, 'on_insert_comment'), 10, 2);
        add_filter('comments_clauses', array($this, 'filter_comments_clauses'), 10, 2);
    }

    /**
     * Generates or retrieves the session hash.
     * Sets a persistent cookie, with deterministic IP + UserAgent SHA256 fallback for headless bots.
     */
    public function get_viewer_session_hash() {
        if (!empty($_COOKIE['shield_author_session'])) {
            return sanitize_text_field($_COOKIE['shield_author_session']);
        }

        $ip = !empty($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : '127.0.0.1';
        $ua = !empty($_SERVER['HTTP_USER_AGENT']) ? $_SERVER['HTTP_USER_AGENT'] : 'none';
        return hash('sha256', $ip . '|' . $ua . '|' . wp_salt('nonce'));
    }

    public function ensure_author_session_cookie() {
        if (empty($_COOKIE['shield_author_session']) && !headers_sent()) {
            $hash = $this->get_viewer_session_hash();
            setcookie('shield_author_session', $hash, time() + (30 * 86400), COOKIEPATH ? COOKIEPATH : '/', COOKIE_DOMAIN, is_ssl(), true);
            $_COOKIE['shield_author_session'] = $hash;
        }
    }

    /**
     * Hook wp_insert_comment: tags comment with session hash and pending visibility,
     * then fires non-blocking asynchronous POST to Bun API /v1/ingest.
     */
    public function on_insert_comment($comment_id, $comment_object) {
        $author_hash = $this->get_viewer_session_hash();
        update_comment_meta($comment_id, '_shield_author_hash', $author_hash);
        update_comment_meta($comment_id, '_shield_visibility', 'pending');

        $telemetry_token = isset($_POST['_shield_token']) ? sanitize_text_field($_POST['_shield_token']) : '';
        $hp_val = isset($_POST['_shield_hp_field']) ? sanitize_text_field($_POST['_shield_hp_field']) : '';
        $rating = isset($_POST['rating']) ? intval($_POST['rating']) : null;

        $post_id = $comment_object->comment_post_ID;
        $post = get_post($post_id);
        $entity_title = $post ? $post->post_title : 'Post #' . $post_id;

        $options = get_option('shield_guard_settings', array());
        $api_url = !empty($options['api_url']) ? rtrim($options['api_url'], '/') : 'http://127.0.0.1:4000';
        $api_key = !empty($options['api_key']) ? $options['api_key'] : 'default_tenant';
        $mode = !empty($options['threshold_mode']) ? $options['threshold_mode'] : 'balanced';

        $payload = array(
            'wpCommentId'        => intval($comment_id),
            'entityId'           => strval($post_id),
            'entityTitle'        => $entity_title,
            'authorSessionHash'  => $author_hash,
            'rawText'            => $comment_object->comment_content,
            'rating'             => $rating,
            'telemetryToken'     => $telemetry_token,
            'honeypotValue'      => $hp_val,
            'tenantApiKey'       => $api_key,
            'wpWebhookUrl'       => rest_url('shield/v1/webhook'),
            'thresholdMode'      => $mode,
        );

        // Non-blocking async dispatch to Bun Hono ingestion endpoint
        wp_remote_post($api_url . '/v1/ingest', array(
            'method'      => 'POST',
            'blocking'    => false, // Fire and forget in <1ms
            'timeout'     => 1,
            'headers'     => array(
                'Content-Type' => 'application/json',
                'X-Shield-Key' => $api_key,
            ),
            'body'        => wp_json_encode($payload),
            'data_format' => 'body',
        ));
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
}
