<?php
/**
 * Plugin Name: Substack Importer
 * Plugin URI:  https://github.com/parthumanco/ph-crm
 * Description: Automatically imports posts from a Substack publication into WordPress on a schedule, with dedupe, featured images, category and author mapping.
 * Version:     1.0.0
 * Author:      Parthuman Co
 * License:     GPL-2.0-or-later
 * Text Domain: substack-importer
 * Requires PHP: 7.4
 * Requires at least: 5.8
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'SUBSTACK_IMPORTER_VERSION', '1.0.0' );
define( 'SUBSTACK_IMPORTER_FILE', __FILE__ );
define( 'SUBSTACK_IMPORTER_DIR', plugin_dir_path( __FILE__ ) );
define( 'SUBSTACK_IMPORTER_OPTION', 'substack_importer_settings' );
define( 'SUBSTACK_IMPORTER_CRON_HOOK', 'substack_importer_sync_event' );
define( 'SUBSTACK_IMPORTER_GUID_META', '_substack_guid' );
define( 'SUBSTACK_IMPORTER_URL_META', '_substack_source_url' );

require_once SUBSTACK_IMPORTER_DIR . 'includes/class-importer.php';
require_once SUBSTACK_IMPORTER_DIR . 'includes/class-admin.php';

register_activation_hook( __FILE__, array( 'Substack_Importer', 'on_activate' ) );
register_deactivation_hook( __FILE__, array( 'Substack_Importer', 'on_deactivate' ) );

add_action( 'plugins_loaded', function () {
	Substack_Importer::instance();
	if ( is_admin() ) {
		Substack_Importer_Admin::instance();
	}
} );

add_filter( 'cron_schedules', function ( $schedules ) {
	if ( ! isset( $schedules['substack_importer_15min'] ) ) {
		$schedules['substack_importer_15min'] = array(
			'interval' => 15 * MINUTE_IN_SECONDS,
			'display'  => __( 'Every 15 Minutes (Substack Importer)', 'substack-importer' ),
		);
	}
	if ( ! isset( $schedules['substack_importer_30min'] ) ) {
		$schedules['substack_importer_30min'] = array(
			'interval' => 30 * MINUTE_IN_SECONDS,
			'display'  => __( 'Every 30 Minutes (Substack Importer)', 'substack-importer' ),
		);
	}
	return $schedules;
} );

add_action( SUBSTACK_IMPORTER_CRON_HOOK, function () {
	Substack_Importer::instance()->run_sync();
} );
