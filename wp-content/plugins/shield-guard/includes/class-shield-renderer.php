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
    }

    public function enqueue_frontend_assets() {
        wp_enqueue_style(
            'shield-styles',
            plugins_url('assets/shield.css', dirname(__FILE__)),
            array(),
            '1.0.3'
        );

        wp_enqueue_script(
            'shield-collector',
            plugins_url('assets/collector.js', dirname(__FILE__)),
            array(),
            '1.0.3',
            true
        );

        wp_enqueue_script(
            'shield-badges',
            plugins_url('assets/badge-renderer.js', dirname(__FILE__)),
            array(),
            '1.0.3',
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
            return $comment_text;
        }

        $visibility = get_comment_meta($comment->comment_ID, '_shield_visibility', true);
        if ($visibility !== 'public_flagged') {
            return $comment_text;
        }

        $failed_ids_json = get_comment_meta($comment->comment_ID, '_shield_failed_ids', true);
        $explanation = get_comment_meta($comment->comment_ID, '_shield_explanation', true);
        $model_used = get_comment_meta($comment->comment_ID, '_shield_model_used', true);

        // When harder thinking model was set on the review, return clear-text explanation in place of generic description
        // Fallback to generic message when jev is used only (or when explanation is empty)
        $is_harder_model = (!empty($model_used) && $model_used !== 'jev' && $model_used !== 'none') || (!empty($explanation) && empty($model_used));
        $generic_desc = 'This comment was flagged for manipulative patterns or coordinated messaging. Specific detected markers are shown below.';
        $banner_desc = ($is_harder_model && !empty($explanation)) ? esc_html($explanation) : $generic_desc;

        // Prepend comment-level context warning banner with clear-text or fallback description
        $output = '<div class="shield-comment-banner">' .
            '<div class="shield-comment-banner-badge">⚠️ Community Context Notice: Flagged Content</div>' .
            '<div class="shield-comment-banner-desc">' . $banner_desc . '</div>' .
        '</div>' . $comment_text;

        // SemEval Badges
        if (!empty($failed_ids_json) && $failed_ids_json !== '[]') {
            $escaped_json = esc_attr($failed_ids_json);
            $output .= '<div class="shield-badge-container" data-failed-ids="' . $escaped_json . '"></div>';
        }

        // Forensic AI Research Grounding Card & Toggle
        if (!empty($explanation)) {
            $escaped_explanation = esc_html($explanation);
            $model_label = !empty($model_used) ? esc_html($model_used) : 'gemini-4-hydrogen';
            $output .= '<div class="shield-explanation-wrapper">' .
                '<button type="button" class="shield-explanation-toggle" aria-expanded="false">🛡️ View Forensic AI Research Grounding</button>' .
                '<div class="shield-explanation-card" style="display:none;">' .
                    '<div class="shield-explanation-header"><strong>Forensic Model Grounding (' . $model_label . '):</strong></div>' .
                    '<p class="shield-explanation-body">' . $escaped_explanation . '</p>' .
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

        if (!$banner || empty($banner['bannerExplanation'])) {
            return '';
        }

        $status = !empty($banner['anomalyStatus']) ? esc_attr($banner['anomalyStatus']) : 'normal';
        $text = esc_html($banner['bannerExplanation']);
        $icon = ($status === 'coordinated_attack') ? '🚨' : 'ℹ️';
        $title = ($status === 'coordinated_attack')
            ? 'Coordinated Activity Notice Under Investigation'
            : 'Public Review Volume Notice';

        return "
        <div class=\"shield-review-banner {$status}\">
            <div class=\"shield-review-banner-icon\">{$icon}</div>
            <div>
                <div class=\"shield-review-banner-title\">{$title}</div>
                <div class=\"shield-review-banner-text\">{$text}</div>
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
}
