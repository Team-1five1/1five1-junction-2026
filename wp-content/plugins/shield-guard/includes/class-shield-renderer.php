<?php
if (!defined('ABSPATH')) {
    exit;
}

class Shield_Renderer {
    private static $instance = null;

    public static function get_instance() {
        if (self::$instance === null) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    private function __construct() {
        add_action('wp_enqueue_scripts', array($this, 'enqueue_frontend_assets'));
        // Prepend post-level warning banner to the post content on single view
        add_filter('the_content', array($this, 'prepend_post_banner_to_content'), 5);
        // Priority 99 runs after wpautop so paragraph formatting does not corrupt custom shield DOM nodes
        add_filter('comment_text', array($this, 'render_comment_badges_and_explanation'), 99, 2);
        add_action('comment_form_before', array($this, 'render_post_review_banner'));
        add_action('woocommerce_before_single_product_summary', array($this, 'render_post_review_banner'));
        add_action('wp_footer', array($this, 'render_honeypot_crawler_trap'), 99);
    }

    public function enqueue_frontend_assets() {
        wp_enqueue_style(
            'shield-styles',
            plugins_url('assets/shield.css', dirname(__FILE__)),
            array(),
            SHIELD_GUARD_VERSION
        );

        wp_enqueue_script(
            'shield-botd',
            plugins_url('assets/botd.bundle.js', dirname(__FILE__)),
            array(),
            '2.0.0',
            true
        );

        wp_enqueue_script(
            'shield-collector',
            plugins_url('assets/collector.js', dirname(__FILE__)),
            array('shield-botd'),
            SHIELD_GUARD_VERSION,
            true
        );

        $key = get_transient('shield_telemetry_public_key');
        if (!$key) {
            $options = get_option('shield_guard_settings', array());
            $url = !empty($options['api_url']) ? rtrim($options['api_url'], '/') : 'http://127.0.0.1:4000';
            $response = wp_remote_get($url . '/v1/telemetry/key', array('timeout' => 2, 'headers' => array('X-Shield-Key' => $options['api_key'] ?? '')));
            if (!is_wp_error($response) && wp_remote_retrieve_response_code($response) === 200) {
                $body = json_decode(wp_remote_retrieve_body($response), true);
                $key = $body['publicKey'] ?? '';
                if ($key) set_transient('shield_telemetry_public_key', $key, HOUR_IN_SECONDS);
            }
        }
        wp_add_inline_script('shield-collector', 'window.shieldMetricsConfig=' . wp_json_encode(array('publicKey' => $key ?: '')) . ';', 'before');

        wp_enqueue_script(
            'shield-badges',
            plugins_url('assets/badge-renderer.js', dirname(__FILE__)),
            array(),
            SHIELD_GUARD_VERSION,
            true
        );
    }

    /**
     * Prepends the post-level notice banner to the main post content if flagged.
     */
    public function prepend_post_banner_to_content($content) {
        if (!is_singular()) {
            return $content;
        }

        global $post;
        if (!$post) {
            return $content;
        }

        $banner_html = $this->get_post_banner_html($post->ID);
        if (!empty($banner_html)) {
            return $banner_html . $content;
        }

        return $content;
    }

    /**
     * Appends banner, SemEval question badges, and Deep Research Explanation card to flagged comments.
     */
    public function render_comment_badges_and_explanation($comment_text, $comment = null) {
        if (!$comment) {
            $comment = get_comment();
        }
        if (!$comment) {
            return $comment_text;
        }

        $visibility = get_comment_meta($comment->comment_ID, '_shield_visibility', true);
        if ($visibility !== 'public_flagged') {
            return $comment_text;
        }

        $failed_ids_json = get_comment_meta($comment->comment_ID, '_shield_failed_ids', true);
        $explanation = get_comment_meta($comment->comment_ID, '_shield_explanation', true);
        $model_used = get_comment_meta($comment->comment_ID, '_shield_model_used', true);
        $evidence = json_decode(get_comment_meta($comment->comment_ID, '_shield_research_evidence', true), true);
        $unverified = ($evidence['researchStatus'] ?? '') === 'unverified';
        $incorrect = false;
        foreach (($evidence['claimChecks'] ?? array()) as $check) {
            if (in_array($check['status'] ?? '', array('incorrect', 'misleading'), true)) $incorrect = true;
            if (($check['status'] ?? '') === 'unsubstantiated') $unverified = true;
        }

        $generic_desc = 'This comment was flagged for potentially misleading statements or manipulative patterns. The assessment is shown below.';
        $banner_desc = !empty($explanation) ? nl2br(esc_html($explanation)) : $generic_desc;
        $banner_title = $incorrect ? 'Incorrect or Misleading Factual Claims' : ($unverified ? 'Potentially Misleading: Unsubstantiated Claims' : 'Community Context Notice: Flagged Content');

        // Prepend comment-level context warning banner with clear-text or fallback description
        $output = '<div class="shield-comment-banner">' .
            '<div class="shield-comment-banner-badge">⚠️ ' . esc_html($banner_title) . '</div>' .
            '<div class="shield-comment-banner-desc">' . $banner_desc . '</div>' .
        '</div>' . $comment_text;

        // SemEval Badges
        if (!empty($failed_ids_json) && $failed_ids_json !== '[]') {
            $escaped_json = esc_attr($failed_ids_json);
            $output .= '<div class="shield-badge-container" data-failed-ids="' . $escaped_json . '"></div>';
        }

        // Forensic AI Research Grounding Card & Toggle
        if (!empty($explanation)) {
            $escaped_explanation = nl2br(esc_html($explanation));
            $model_label = !empty($model_used) ? esc_html($model_used) : 'Research model';
            $sources_html = '';
            foreach (($evidence['sources'] ?? array()) as $source) {
                if (!empty($source['url']) && preg_match('#^https?://#', $source['url'])) {
                    $sources_html .= '<li><a href="' . esc_url($source['url']) . '" target="_blank" rel="noopener noreferrer">' . esc_html($source['title'] ?? $source['url']) . '</a></li>';
                }
            }
            if ($sources_html) $sources_html = '<ul class="shield-context-sources">' . $sources_html . '</ul>';
            $output .= '<div class="shield-explanation-wrapper">' .
                '<button type="button" class="shield-explanation-toggle" aria-expanded="false">🛡️ View Fact Check and Context</button>' .
                '<div class="shield-explanation-card" style="display:none;">' .
                    '<div class="shield-explanation-header"><strong>Fact Check and Context (' . $model_label . '):</strong></div>' .
                    '<p class="shield-explanation-body">' . $escaped_explanation . '</p>' . $sources_html .
                '</div>' .
            '</div>';
        }

        return $output;
    }

    /**
     * Builds HTML for post-level coordinated activity / review volume banner.
     */
    public function get_post_banner_html($post_id) {
        $banner_data = get_post_meta($post_id, '_shield_review_banner', true);
        if (empty($banner_data)) {
            return '';
        }

        $banner = null;
        if (is_array($banner_data)) {
            $banner = $banner_data;
        } elseif (is_string($banner_data)) {
            $banner = json_decode($banner_data, true);
            if (!$banner) {
                $banner = maybe_unserialize($banner_data);
                if (!is_array($banner)) {
                    // Fallback regex extraction if unslashed quotes corrupted strict JSON
                    if (preg_match('/"anomalyStatus"\s*:\s*"([^"]+)"/', $banner_data, $m1) &&
                        preg_match('/"bannerExplanation"\s*:\s*"(.*?)"\s*}/s', $banner_data, $m2)) {
                        $banner = array(
                            'anomalyStatus'     => $m1[1],
                            'bannerExplanation' => str_replace('\\"', '"', $m2[1]),
                        );
                    }
                }
            }
        }

        // Legacy banners were inferred without search evidence. Render only fresh, sourced context.
        if (empty($banner['updatedAt']) || empty($banner['sources']) || strtotime($banner['updatedAt']) < time() - 6 * HOUR_IN_SECONDS) return '';
        if (!$banner || ($banner['anomalyStatus'] ?? 'normal') === 'normal' || empty($banner['bannerExplanation'])) {
            return '';
        }

        $status = !empty($banner['anomalyStatus']) ? esc_attr($banner['anomalyStatus']) : 'normal';
        $text = esc_html($banner['bannerExplanation']);
        $icon = ($status === 'coordinated_attack') ? '🚨' : 'ℹ️';
        $title = ($status === 'coordinated_attack')
            ? 'Coordinated Activity Notice Under Investigation'
            : 'Public Review Volume Notice';

        $sources_html = '';
        foreach (($banner['sources'] ?? array()) as $source) {
            if (!empty($source['url']) && preg_match('#^https?://#', $source['url'])) {
                $sources_html .= '<li><a href="' . esc_url($source['url']) . '" rel="noopener noreferrer" target="_blank">' . esc_html($source['title'] ?? $source['url']) . '</a></li>';
            }
        }
        if ($sources_html) $sources_html = '<ul class="shield-context-sources">' . $sources_html . '</ul>';
        return "
        <div class=\"shield-review-banner {$status}\">
            <div class=\"shield-review-banner-icon\">{$icon}</div>
            <div>
                <div class=\"shield-review-banner-title\">{$title}</div>
                <div class=\"shield-review-banner-text\">{$text}</div>{$sources_html}
            </div>
        </div>";
    }

    /**
     * Renders Public Review Volume / Discussion Notice banner above review forms if post has banner meta.
     */
    public function render_post_review_banner() {
        global $post;
        if (!$post) return;
        echo $this->get_post_banner_html($post->ID);
    }

    /**
     * Outputs an invisible crawler honeypot link in the footer so automated scrapers
     * ignoring CSS visibility / rel=nofollow stream straight into Clean the Traffic.
     */
    public function render_honeypot_crawler_trap() {
        $trap_url = esc_url(home_url('/?shield_trap=bot_probe'));
        echo '<div aria-hidden="true" style="display:none !important;visibility:hidden !important;"><a href="' . $trap_url . '" rel="nofollow" tabindex="-1">Site Directory Index</a></div>';
    }
}
