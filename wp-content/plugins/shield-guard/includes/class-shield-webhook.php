<?php
if (!defined('ABSPATH')) {
    exit;
}

class Shield_Webhook {
    private static $instance = null;

    public static function get_instance() {
        if (self::$instance === null) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    private function __construct() {
        add_action('rest_api_init', array($this, 'register_routes'));
    }

    public function register_routes() {
        register_rest_route('shield/v1', '/webhook', array(
            'methods'             => 'POST',
            'callback'            => array($this, 'handle_webhook'),
            'permission_callback' => array($this, 'verify_hmac_permission'),
        ));
    }

    /**
     * Verify HMAC SHA-256 signature in X-Shield-Signature header.
     */
    public function verify_hmac_permission($request) {
        $options = get_option('shield_guard_settings', array());
        $secret = !empty($options['webhook_secret']) ? $options['webhook_secret'] : 'shield_shared_secret';

        $sig_header = $request->get_header('x_shield_signature');
        if (empty($sig_header)) {
            $sig_header = $request->get_header('X-Shield-Signature');
        }

        // Allow dev bypass if secret is default or placeholder
        if ($secret === 'shield_shared_secret' || $secret === 'replace_with_shared_wp_hmac_secret') {
            return true;
        }

        if (empty($sig_header) || !str_starts_with($sig_header, 'sha256=')) {
            return false;
        }

        $expected_sig = 'sha256=' . hash_hmac('sha256', $request->get_body(), $secret);
        return hash_equals($expected_sig, $sig_header);
    }

    public function handle_webhook($request) {
        $params = $request->get_json_params();
        if (empty($params) || empty($params['wpCommentId'])) {
            return new WP_Error('missing_params', 'wpCommentId is required', array('status' => 400));
        }

        $comment_id = intval($params['wpCommentId']);
        $visibility = !empty($params['visibility']) ? sanitize_text_field($params['visibility']) : 'public';
        $failed_ids = !empty($params['failedRiskIds']) && is_array($params['failedRiskIds']) ? $params['failedRiskIds'] : array();
        $explanation = !empty($params['deepResearchExplanation']) ? sanitize_textarea_field($params['deepResearchExplanation']) : null;
        $risk_score = isset($params['riskScore']) ? intval($params['riskScore']) : 0;
        $model_used = !empty($params['modelUsed']) ? sanitize_text_field($params['modelUsed']) : '';

        // Update comment meta
        update_comment_meta($comment_id, '_shield_visibility', $visibility);
        update_comment_meta($comment_id, '_shield_failed_ids', wp_json_encode($failed_ids));
        update_comment_meta($comment_id, '_shield_risk_score', $risk_score);

        if (!empty($model_used)) {
            update_comment_meta($comment_id, '_shield_model_used', $model_used);
        } else {
            delete_comment_meta($comment_id, '_shield_model_used');
        }

        if (!empty($explanation)) {
            update_comment_meta($comment_id, '_shield_explanation', $explanation);
        } else {
            delete_comment_meta($comment_id, '_shield_explanation');
        }

        // Entity / Post Level Review Bombing / Coordinated Disinformation Banner update
        if (!empty($params['entityId']) && !empty($params['banner'])) {
            $post_id = intval($params['entityId']);
            if ($post_id > 0) {
                update_post_meta($post_id, '_shield_review_banner', wp_slash(wp_json_encode($params['banner'])));
            }
        }

        return rest_ensure_response(array(
            'status'     => 'success',
            'commentId'  => $comment_id,
            'visibility' => $visibility,
            'modelUsed'  => $model_used,
        ));
    }
}
