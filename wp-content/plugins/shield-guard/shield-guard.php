<?php
/**
 * Plugin Name: Truthier
 * Plugin URI:  https://github.com/Team-1five1/1five1-junction-2026
 * Description: Real-time Coordinated Propaganda, Disinformation & Headless Bot Defense using SemEval-50 Bitmask and Hostinger AI Router.
 * Version:     2.0.0
 * Author:      Truthier Team
 * License:     MIT
 * Text Domain: truthier
 */

if (!defined('ABSPATH')) {
    exit;
}

define('SHIELD_GUARD_VERSION', '2.0.0');
define('SHIELD_GUARD_PLUGIN_DIR', plugin_dir_path(__FILE__));
define('SHIELD_GUARD_PLUGIN_URL', plugin_dir_url(__FILE__));

require_once SHIELD_GUARD_PLUGIN_DIR . 'includes/class-shield-interceptor.php';
require_once SHIELD_GUARD_PLUGIN_DIR . 'includes/class-shield-webhook.php';
require_once SHIELD_GUARD_PLUGIN_DIR . 'includes/class-shield-renderer.php';
require_once SHIELD_GUARD_PLUGIN_DIR . 'includes/class-shield-admin.php';

function shield_guard_init() {
    Shield_Interceptor::get_instance();
    Shield_Webhook::get_instance();
    Shield_Renderer::get_instance();

    if (is_admin()) {
        Shield_Admin::get_instance();
    }
}
add_action('plugins_loaded', 'shield_guard_init');

register_activation_hook(__FILE__, function() {
    if (!get_option('shield_guard_settings')) {
        update_option('shield_guard_settings', array(
            'api_url'        => 'http://127.0.0.1:4000',
            'api_key'        => 'tenant_' . wp_generate_password(16, false),
            'webhook_secret' => wp_generate_password(32, true, true),
            'threshold_mode' => 'balanced',
        ));
    }
});
