<?php
/**
 * Admin settings page for Substack Importer.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Substack_Importer_Admin {

	private static $instance = null;

	public static function instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	private function __construct() {
		add_action( 'admin_menu', array( $this, 'register_menu' ) );
		add_action( 'admin_init', array( $this, 'maybe_handle_actions' ) );
		add_action( 'admin_notices', array( $this, 'maybe_render_notice' ) );
	}

	public function register_menu() {
		add_options_page(
			__( 'Substack Importer', 'substack-importer' ),
			__( 'Substack Importer', 'substack-importer' ),
			'manage_options',
			'substack-importer',
			array( $this, 'render_page' )
		);
	}

	public function maybe_handle_actions() {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}
		if ( empty( $_POST['substack_importer_nonce'] ) ) {
			return;
		}
		if ( ! wp_verify_nonce( sanitize_text_field( wp_unslash( $_POST['substack_importer_nonce'] ) ), 'substack_importer_save' ) ) {
			return;
		}

		$importer = Substack_Importer::instance();

		if ( isset( $_POST['substack_importer_save'] ) ) {
			$frequency = isset( $_POST['frequency'] ) ? sanitize_text_field( wp_unslash( $_POST['frequency'] ) ) : 'hourly';
			$new = array(
				'substack_url'       => isset( $_POST['substack_url'] ) ? esc_url_raw( wp_unslash( $_POST['substack_url'] ) ) : '',
				'post_status'        => isset( $_POST['post_status'] ) ? sanitize_text_field( wp_unslash( $_POST['post_status'] ) ) : 'draft',
				'post_author'        => isset( $_POST['post_author'] ) ? (int) $_POST['post_author'] : 0,
				'category_id'        => isset( $_POST['category_id'] ) ? (int) $_POST['category_id'] : 0,
				'frequency'          => $frequency,
				'import_images'      => isset( $_POST['import_images'] ) ? 1 : 0,
				'append_source_link' => isset( $_POST['append_source_link'] ) ? 1 : 0,
			);
			$importer->update_settings( $new );
			Substack_Importer::schedule_event( $frequency );
			set_transient( 'substack_importer_notice', array( 'type' => 'success', 'msg' => __( 'Settings saved.', 'substack-importer' ) ), 30 );
			wp_safe_redirect( admin_url( 'options-general.php?page=substack-importer' ) );
			exit;
		}

		if ( isset( $_POST['substack_importer_sync_now'] ) ) {
			$result = $importer->run_sync();
			$msg    = sprintf(
				/* translators: 1: imported, 2: skipped */
				__( 'Sync complete. Imported %1$d, skipped %2$d.', 'substack-importer' ),
				$result['imported'],
				$result['skipped']
			);
			if ( ! empty( $result['errors'] ) ) {
				$msg .= ' ' . __( 'Errors:', 'substack-importer' ) . ' ' . esc_html( implode( '; ', $result['errors'] ) );
				set_transient( 'substack_importer_notice', array( 'type' => 'warning', 'msg' => $msg ), 30 );
			} else {
				set_transient( 'substack_importer_notice', array( 'type' => 'success', 'msg' => $msg ), 30 );
			}
			wp_safe_redirect( admin_url( 'options-general.php?page=substack-importer' ) );
			exit;
		}
	}

	public function maybe_render_notice() {
		$notice = get_transient( 'substack_importer_notice' );
		if ( ! $notice ) {
			return;
		}
		delete_transient( 'substack_importer_notice' );
		$class = 'notice-success';
		if ( ! empty( $notice['type'] ) ) {
			$class = 'notice-' . sanitize_html_class( $notice['type'] );
		}
		printf(
			'<div class="notice %1$s is-dismissible"><p>%2$s</p></div>',
			esc_attr( $class ),
			esc_html( $notice['msg'] )
		);
	}

	public function render_page() {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}
		$importer = Substack_Importer::instance();
		$settings = $importer->get_settings();
		$next_run = wp_next_scheduled( SUBSTACK_IMPORTER_CRON_HOOK );

		$users      = get_users( array( 'capability' => 'edit_posts', 'fields' => array( 'ID', 'display_name' ) ) );
		$categories = get_categories( array( 'hide_empty' => 0 ) );

		$frequencies = array(
			'substack_importer_15min' => __( 'Every 15 minutes', 'substack-importer' ),
			'substack_importer_30min' => __( 'Every 30 minutes', 'substack-importer' ),
			'hourly'                  => __( 'Hourly', 'substack-importer' ),
			'twicedaily'              => __( 'Twice daily', 'substack-importer' ),
			'daily'                   => __( 'Daily', 'substack-importer' ),
		);
		?>
		<div class="wrap">
			<h1><?php esc_html_e( 'Substack Importer', 'substack-importer' ); ?></h1>
			<p><?php esc_html_e( 'Pull posts from a Substack publication into WordPress automatically. Enter your publication URL (e.g. https://yourname.substack.com) and the plugin will fetch the RSS feed on a schedule.', 'substack-importer' ); ?></p>

			<form method="post" action="">
				<?php wp_nonce_field( 'substack_importer_save', 'substack_importer_nonce' ); ?>
				<table class="form-table" role="presentation">
					<tr>
						<th scope="row"><label for="substack_url"><?php esc_html_e( 'Substack publication URL', 'substack-importer' ); ?></label></th>
						<td>
							<input name="substack_url" id="substack_url" type="url" class="regular-text" value="<?php echo esc_attr( $settings['substack_url'] ); ?>" placeholder="https://yourname.substack.com" />
							<p class="description"><?php esc_html_e( 'The plugin appends /feed automatically. You can also paste the full /feed URL.', 'substack-importer' ); ?></p>
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="post_status"><?php esc_html_e( 'Imported post status', 'substack-importer' ); ?></label></th>
						<td>
							<select name="post_status" id="post_status">
								<?php foreach ( array( 'draft', 'publish', 'pending', 'private' ) as $status ) : ?>
									<option value="<?php echo esc_attr( $status ); ?>" <?php selected( $settings['post_status'], $status ); ?>><?php echo esc_html( ucfirst( $status ) ); ?></option>
								<?php endforeach; ?>
							</select>
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="post_author"><?php esc_html_e( 'Default author', 'substack-importer' ); ?></label></th>
						<td>
							<select name="post_author" id="post_author">
								<option value="0"><?php esc_html_e( '— Use site default —', 'substack-importer' ); ?></option>
								<?php foreach ( $users as $user ) : ?>
									<option value="<?php echo esc_attr( $user->ID ); ?>" <?php selected( $settings['post_author'], $user->ID ); ?>><?php echo esc_html( $user->display_name ); ?></option>
								<?php endforeach; ?>
							</select>
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="category_id"><?php esc_html_e( 'Category', 'substack-importer' ); ?></label></th>
						<td>
							<select name="category_id" id="category_id">
								<option value="0"><?php esc_html_e( '— Uncategorized —', 'substack-importer' ); ?></option>
								<?php foreach ( $categories as $cat ) : ?>
									<option value="<?php echo esc_attr( $cat->term_id ); ?>" <?php selected( $settings['category_id'], $cat->term_id ); ?>><?php echo esc_html( $cat->name ); ?></option>
								<?php endforeach; ?>
							</select>
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="frequency"><?php esc_html_e( 'Sync frequency', 'substack-importer' ); ?></label></th>
						<td>
							<select name="frequency" id="frequency">
								<?php foreach ( $frequencies as $key => $label ) : ?>
									<option value="<?php echo esc_attr( $key ); ?>" <?php selected( $settings['frequency'], $key ); ?>><?php echo esc_html( $label ); ?></option>
								<?php endforeach; ?>
							</select>
							<p class="description"><?php esc_html_e( 'Runs via WP-Cron. For reliable timing, set a real cron job hitting wp-cron.php and disable DISABLE_WP_CRON if it is enabled.', 'substack-importer' ); ?></p>
						</td>
					</tr>
					<tr>
						<th scope="row"><?php esc_html_e( 'Options', 'substack-importer' ); ?></th>
						<td>
							<label><input type="checkbox" name="import_images" value="1" <?php checked( ! empty( $settings['import_images'] ) ); ?> /> <?php esc_html_e( 'Import featured images into the WordPress media library', 'substack-importer' ); ?></label><br />
							<label><input type="checkbox" name="append_source_link" value="1" <?php checked( ! empty( $settings['append_source_link'] ) ); ?> /> <?php esc_html_e( 'Append a "Originally published on Substack" link to each post', 'substack-importer' ); ?></label>
						</td>
					</tr>
				</table>
				<p class="submit">
					<button type="submit" name="substack_importer_save" class="button button-primary"><?php esc_html_e( 'Save settings', 'substack-importer' ); ?></button>
					<button type="submit" name="substack_importer_sync_now" class="button"><?php esc_html_e( 'Sync now', 'substack-importer' ); ?></button>
				</p>
			</form>

			<h2><?php esc_html_e( 'Status', 'substack-importer' ); ?></h2>
			<table class="widefat striped" style="max-width:640px">
				<tbody>
					<tr>
						<th><?php esc_html_e( 'Feed URL', 'substack-importer' ); ?></th>
						<td><code><?php echo esc_html( $importer->feed_url_from_setting( $settings['substack_url'] ) ); ?></code></td>
					</tr>
					<tr>
						<th><?php esc_html_e( 'Last sync', 'substack-importer' ); ?></th>
						<td>
							<?php
							if ( ! empty( $settings['last_sync'] ) ) {
								echo esc_html( wp_date( 'Y-m-d H:i:s', (int) $settings['last_sync'] ) );
								if ( ! empty( $settings['last_result'] ) ) {
									echo ' — ' . esc_html( $settings['last_result'] );
								}
							} else {
								esc_html_e( 'Never', 'substack-importer' );
							}
							?>
						</td>
					</tr>
					<tr>
						<th><?php esc_html_e( 'Next scheduled run', 'substack-importer' ); ?></th>
						<td><?php echo $next_run ? esc_html( wp_date( 'Y-m-d H:i:s', (int) $next_run ) ) : esc_html__( 'Not scheduled', 'substack-importer' ); ?></td>
					</tr>
				</tbody>
			</table>
		</div>
		<?php
	}
}
