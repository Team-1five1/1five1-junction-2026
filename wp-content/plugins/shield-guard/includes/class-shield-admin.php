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
    }

    public function add_admin_menu() {
        add_options_page(
            'Truthier Settings',
            'Truthier',
            'manage_options',
            'shield-guard',
            array($this, 'render_settings_page')
        );
    }

    public function register_settings() {
        register_setting('shield_guard_settings_group', 'shield_guard_settings', array($this, 'sanitize_settings'));
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

        // Notify Bun API of mode change
        wp_remote_request($sanitized['api_url'] . '/v1/tenant/mode', array(
            'method'  => 'PATCH',
            'headers' => array('Content-Type' => 'application/json'),
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
            <h1>🛡️ Truthier &mdash; Propaganda & Bot Defense</h1>
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
                            <p class="description">URL to the Truthier Bun service (e.g. <code>http://127.0.0.1:4000</code>).</p>
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
                <?php submit_button('Save Truthier Settings'); ?>
            </form>
        </div>
        <?php
    }
}
