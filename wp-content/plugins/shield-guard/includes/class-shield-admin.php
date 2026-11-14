<?php
if (!defined('ABSPATH')) {
    exit;
}

class Shield_Admin {
    private static $instance = null;

    public static function get_instance() {
        if (self::$instance === null) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    private function __construct() {
        add_action('admin_menu', array($this, 'add_admin_menu'));
        add_action('admin_init', array($this, 'register_settings'));
        add_filter('manage_edit-comments_columns', array($this, 'add_comments_columns'));
        add_action('manage_comments_custom_column', array($this, 'render_comments_column'), 10, 2);
    }

    public function add_admin_menu() {
        add_options_page(
            'Verius Settings',
            'Verius',
            'manage_options',
            'shield-guard',
            array($this, 'render_settings_page')
        );
    }

    public function register_settings() {
        register_setting('shield_guard_settings_group', 'shield_guard_settings', array($this, 'sanitize_settings'));
    }

    public function add_comments_columns($columns) {
        $new_columns = array();
        foreach ($columns as $key => $title) {
            $new_columns[$key] = $title;
            if ($key === 'comment') {
                $new_columns['shield_status'] = '🛡️ Verius Status';
            }
        }
        if (!isset($new_columns['shield_status'])) {
            $new_columns['shield_status'] = '🛡️ Verius Status';
        }
        return $new_columns;
    }

    public function render_comments_column($column, $comment_id) {
        if ($column !== 'shield_status') {
            return;
        }

        $visibility = get_comment_meta($comment_id, '_shield_visibility', true);
        if (!$visibility) {
            echo '<span style="color:#6b7280; font-size:12px;">Unmanaged</span>';
            return;
        }

        $failed_ids_raw = get_comment_meta($comment_id, '_shield_failed_ids', true);
        $failed_ids = !empty($failed_ids_raw) ? json_decode($failed_ids_raw, true) : array();
        $model = get_comment_meta($comment_id, '_shield_model_used', true);
        $explanation = get_comment_meta($comment_id, '_shield_explanation', true);

        switch ($visibility) {
            case 'public':
                echo '<span style="display:inline-block; padding:2px 8px; border-radius:12px; font-size:11px; font-weight:600; background:#dcfce7; color:#15803d; border:1px solid #bbf7d0;">✓ Cleared</span>';
                if ($model && $model !== 'none') {
                    echo '<div style="font-size:11px; color:#6b7280; margin-top:3px;">' . esc_html($model) . '</div>';
                }
                break;

            case 'public_flagged':
                echo '<span style="display:inline-block; padding:2px 8px; border-radius:12px; font-size:11px; font-weight:600; background:#fef3c7; color:#b45309; border:1px solid #fde68a;">⚠ Flagged</span>';
                if (!empty($failed_ids) && is_array($failed_ids)) {
                    echo '<div style="font-size:11px; font-family:monospace; color:#92400e; margin-top:3px;">' . esc_html(implode(', ', array_slice($failed_ids, 0, 4))) . (count($failed_ids) > 4 ? '…' : '') . '</div>';
                }
                if ($explanation) {
                    echo '<div style="font-size:11px; color:#4b5563; margin-top:3px; max-width:260px; line-height:1.3;" title="' . esc_attr($explanation) . '">' . esc_html(wp_trim_words($explanation, 12, '…')) . '</div>';
                }
                break;

            case 'shadowbanned':
                echo '<span style="display:inline-block; padding:2px 8px; border-radius:12px; font-size:11px; font-weight:600; background:#fee2e2; color:#b91c1c; border:1px solid #fecaca;">🤖 Bot / Shadowbanned</span>';
                echo '<div style="font-size:11px; color:#991b1b; margin-top:3px;">Author-only (Honeypot)</div>';
                break;

            case 'pending':
                echo '<span style="display:inline-block; padding:2px 8px; border-radius:12px; font-size:11px; font-weight:600; background:#f3f4f6; color:#4b5563; border:1px solid #e5e7eb;">⏳ Evaluating…</span>';
                break;

            default:
                echo '<span style="font-size:12px; color:#6b7280;">' . esc_html(ucfirst($visibility)) . '</span>';
                break;
        }
    }

    public function sanitize_settings($input) {
        $sanitized = array();
        $sanitized['api_url'] = !empty($input['api_url']) ? esc_url_raw(rtrim($input['api_url'], '/')) : 'http://127.0.0.1:4000';
        $sanitized['api_key'] = !empty($input['api_key']) ? sanitize_text_field($input['api_key']) : 'default_tenant';
        $sanitized['webhook_secret'] = !empty($input['webhook_secret']) ? sanitize_text_field($input['webhook_secret']) : 'shield_shared_secret';
        
        $valid_modes = array('strict', 'balanced', 'high_precision');
        $sanitized['threshold_mode'] = (!empty($input['threshold_mode']) && in_array($input['threshold_mode'], $valid_modes, true))
            ? $input['threshold_mode']
            : 'balanced';

        delete_transient('shield_telemetry_public_key');
        // Notify Bun API of mode change
        wp_remote_request($sanitized['api_url'] . '/v1/tenant/mode', array(
            'method'  => 'PATCH',
            'headers' => array('Content-Type' => 'application/json', 'X-Shield-Key' => $sanitized['api_key']),
            'body'    => wp_json_encode(array(
                'apiKey' => $sanitized['api_key'],
                'mode'   => $sanitized['threshold_mode'],
            )),
            'timeout' => 2,
        ));

        return $sanitized;
    }

    public function render_settings_page() {
        $options = get_option('shield_guard_settings', array(
            'api_url'        => 'http://127.0.0.1:4000',
            'api_key'        => 'default_tenant',
            'webhook_secret' => 'shield_shared_secret',
            'threshold_mode' => 'balanced',
        ));

        $mode = !empty($options['threshold_mode']) ? $options['threshold_mode'] : 'balanced';

        // Ping local Bun API health
        $api_url = !empty($options['api_url']) ? $options['api_url'] : 'http://127.0.0.1:4000';
        $health_check = wp_remote_get($api_url . '/api/health', array('timeout' => 2));
        $is_online = (!is_wp_error($health_check) && wp_remote_retrieve_response_code($health_check) === 200);

        ?>
        <div class="wrap" style="max-width: 860px;">
            <h1>🛡️ Verius &mdash; Propaganda & Bot Defense</h1>
            <p>Integrated Coordinated Propaganda and Headless Bot Defense powered by SemEval-50 and Hostinger AI Router.</p>

            <div style="background: <?php echo $is_online ? '#ecfdf5' : '#fef2f2'; ?>; border: 1px solid <?php echo $is_online ? '#a7f3d0' : '#fecaca'; ?>; border-radius: 8px; padding: 14px 18px; margin: 16px 0; display: flex; align-items: center; justify-content: space-between;">
                <div>
                    <strong>Bun Core API Status:</strong> 
                    <span style="color: <?php echo $is_online ? '#059669' : '#dc2626'; ?>; font-weight: 600;">
                        <?php echo $is_online ? '● ONLINE & ACTIVE' : '○ DISCONNECTED (' . esc_html($api_url) . ')'; ?>
                    </span>
                </div>
                <div style="font-size: 13px; color: #6b7280;">
                    Webhook: <code><?php echo esc_html(rest_url('shield/v1/webhook')); ?></code>
                </div>
            </div>

            <form method="post" action="options.php">
                <?php
                settings_fields('shield_guard_settings_group');
                ?>
                <table class="form-table" role="presentation">
                    <tr>
                        <th scope="row"><label for="shield_mode">Detection Sensitivity Mode</label></th>
                        <td>
                            <select name="shield_guard_settings[threshold_mode]" id="shield_mode">
                                <option value="strict" <?php selected($mode, 'strict'); ?>>Strict (Base: 5 pts, Shielded: 7 pts &bull; Rapid Threat Escalation)</option>
                                <option value="balanced" <?php selected($mode, 'balanced'); ?>>Balanced [Default] (Base: 7 pts, Shielded: 10 pts &bull; Standard Protection)</option>
                                <option value="high_precision" <?php selected($mode, 'high_precision'); ?>>High Precision (Base: 10 pts, Shielded: 13 pts &bull; Minimal False Flags)</option>
                            </select>
                            <p class="description">Selects the SemEval deterministic bitmask routing threshold.</p>
                        </td>
                    </tr>
                    <tr>
                        <th scope="row"><label for="shield_api_url">Bun Core API URL</label></th>
                        <td>
                            <input name="shield_guard_settings[api_url]" type="url" id="shield_api_url" value="<?php echo esc_attr(!empty($options['api_url']) ? $options['api_url'] : 'http://127.0.0.1:4000'); ?>" class="regular-text" />
                            <p class="description">URL to the Verius Bun service (e.g. <code>http://127.0.0.1:4000</code>).</p>
                        </td>
                    </tr>
                    <tr>
                        <th scope="row"><label for="shield_api_key">Tenant API Key</label></th>
                        <td>
                            <input name="shield_guard_settings[api_key]" type="text" id="shield_api_key" value="<?php echo esc_attr(!empty($options['api_key']) ? $options['api_key'] : 'default_tenant'); ?>" class="regular-text" />
                        </td>
                    </tr>
                    <tr>
                        <th scope="row"><label for="shield_webhook_secret">Shared Webhook Secret (HMAC)</label></th>
                        <td>
                            <input name="shield_guard_settings[webhook_secret]" type="password" id="shield_webhook_secret" value="<?php echo esc_attr(!empty($options['webhook_secret']) ? $options['webhook_secret'] : 'shield_shared_secret'); ?>" class="regular-text" />
                            <p class="description">Secret used to sign callbacks from the evaluation worker.</p>
                        </td>
                    </tr>
                </table>
                <?php submit_button('Save Verius Settings'); ?>
            </form>
        </div>
        <?php
    }
}
