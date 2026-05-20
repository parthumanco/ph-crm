<?php
/**
 * Substack Importer uninstall handler.
 * Removes plugin options and scheduled events. Imported posts and media are preserved.
 */

if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}

delete_option( 'substack_importer_settings' );

$timestamp = wp_next_scheduled( 'substack_importer_sync_event' );
if ( $timestamp ) {
	wp_unschedule_event( $timestamp, 'substack_importer_sync_event' );
}
wp_clear_scheduled_hook( 'substack_importer_sync_event' );
