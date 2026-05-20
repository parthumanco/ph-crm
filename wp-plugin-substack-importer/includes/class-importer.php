<?php
/**
 * Core importer: fetches the Substack RSS feed and creates WordPress posts.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Substack_Importer {

	private static $instance = null;

	public static function instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	public static function default_settings() {
		return array(
			'substack_url' => '',
			'post_status'  => 'draft',
			'post_author'  => 0,
			'category_id'  => 0,
			'frequency'    => 'hourly',
			'import_images' => 1,
			'append_source_link' => 1,
			'last_sync'    => 0,
			'last_result'  => '',
		);
	}

	public function get_settings() {
		$settings = get_option( SUBSTACK_IMPORTER_OPTION, array() );
		return wp_parse_args( $settings, self::default_settings() );
	}

	public function update_settings( $new ) {
		$current = $this->get_settings();
		$merged  = array_merge( $current, $new );
		update_option( SUBSTACK_IMPORTER_OPTION, $merged );
		return $merged;
	}

	public static function on_activate() {
		$existing = get_option( SUBSTACK_IMPORTER_OPTION );
		if ( false === $existing ) {
			add_option( SUBSTACK_IMPORTER_OPTION, self::default_settings() );
		}
		self::schedule_event( 'hourly' );
	}

	public static function on_deactivate() {
		$timestamp = wp_next_scheduled( SUBSTACK_IMPORTER_CRON_HOOK );
		if ( $timestamp ) {
			wp_unschedule_event( $timestamp, SUBSTACK_IMPORTER_CRON_HOOK );
		}
		wp_clear_scheduled_hook( SUBSTACK_IMPORTER_CRON_HOOK );
	}

	public static function schedule_event( $frequency ) {
		$valid = array( 'substack_importer_15min', 'substack_importer_30min', 'hourly', 'twicedaily', 'daily' );
		if ( ! in_array( $frequency, $valid, true ) ) {
			$frequency = 'hourly';
		}
		$timestamp = wp_next_scheduled( SUBSTACK_IMPORTER_CRON_HOOK );
		if ( $timestamp ) {
			wp_unschedule_event( $timestamp, SUBSTACK_IMPORTER_CRON_HOOK );
		}
		wp_schedule_event( time() + 60, $frequency, SUBSTACK_IMPORTER_CRON_HOOK );
	}

	/**
	 * Build the RSS feed URL from a Substack publication URL.
	 */
	public function feed_url_from_setting( $url ) {
		$url = trim( (string) $url );
		if ( '' === $url ) {
			return '';
		}
		if ( false !== strpos( $url, '/feed' ) ) {
			return $url;
		}
		return untrailingslashit( $url ) . '/feed';
	}

	/**
	 * Run an import. Returns an associative array with counts.
	 */
	public function run_sync() {
		$settings = $this->get_settings();
		$feed_url = $this->feed_url_from_setting( $settings['substack_url'] );

		$result = array(
			'imported' => 0,
			'skipped'  => 0,
			'errors'   => array(),
			'ran_at'   => time(),
		);

		if ( '' === $feed_url ) {
			$result['errors'][] = __( 'No Substack URL configured.', 'substack-importer' );
			$this->record_result( $result );
			return $result;
		}

		if ( ! function_exists( 'fetch_feed' ) ) {
			require_once ABSPATH . WPINC . '/feed.php';
		}

		$feed = fetch_feed( $feed_url );
		if ( is_wp_error( $feed ) ) {
			$result['errors'][] = sprintf( __( 'Feed error: %s', 'substack-importer' ), $feed->get_error_message() );
			$this->record_result( $result );
			return $result;
		}

		$max_items = $feed->get_item_quantity( 50 );
		$items     = $feed->get_items( 0, $max_items );

		foreach ( $items as $item ) {
			try {
				$status = $this->import_item( $item, $settings );
				if ( 'imported' === $status ) {
					$result['imported']++;
				} else {
					$result['skipped']++;
				}
			} catch ( Exception $e ) {
				$result['errors'][] = $e->getMessage();
			}
		}

		$this->record_result( $result );
		return $result;
	}

	private function record_result( $result ) {
		$summary = sprintf(
			/* translators: 1: imported, 2: skipped, 3: error count */
			__( 'Imported %1$d, skipped %2$d, errors %3$d', 'substack-importer' ),
			$result['imported'],
			$result['skipped'],
			count( $result['errors'] )
		);
		if ( ! empty( $result['errors'] ) ) {
			$summary .= ' — ' . implode( '; ', array_slice( $result['errors'], 0, 3 ) );
		}
		$this->update_settings( array(
			'last_sync'   => $result['ran_at'],
			'last_result' => $summary,
		) );
	}

	/**
	 * Import a single SimplePie_Item. Returns 'imported' or 'skipped'.
	 */
	private function import_item( $item, $settings ) {
		$guid = $item->get_id();
		$link = esc_url_raw( $item->get_link() );
		if ( empty( $guid ) ) {
			$guid = $link;
		}

		if ( $this->post_exists_for_guid( $guid ) ) {
			return 'skipped';
		}

		$title = wp_strip_all_tags( (string) $item->get_title() );
		if ( '' === $title ) {
			$title = __( '(Untitled)', 'substack-importer' );
		}

		$content = (string) $item->get_content();
		if ( '' === $content ) {
			$content = (string) $item->get_description();
		}

		if ( ! empty( $settings['append_source_link'] ) && $link ) {
			$content .= "\n\n" . sprintf(
				'<p><em><a href="%s" rel="noopener" target="_blank">%s</a></em></p>',
				esc_url( $link ),
				esc_html__( 'Originally published on Substack', 'substack-importer' )
			);
		}

		$post_date = '';
		$timestamp = $item->get_date( 'U' );
		if ( $timestamp ) {
			$post_date     = gmdate( 'Y-m-d H:i:s', (int) $timestamp + ( (int) ( get_option( 'gmt_offset' ) * HOUR_IN_SECONDS ) ) );
			$post_date_gmt = gmdate( 'Y-m-d H:i:s', (int) $timestamp );
		} else {
			$post_date_gmt = current_time( 'mysql', true );
			$post_date     = current_time( 'mysql' );
		}

		$postarr = array(
			'post_title'    => $title,
			'post_content'  => wp_kses_post( $content ),
			'post_status'   => in_array( $settings['post_status'], array( 'draft', 'publish', 'pending', 'private' ), true ) ? $settings['post_status'] : 'draft',
			'post_type'     => 'post',
			'post_date'     => $post_date,
			'post_date_gmt' => $post_date_gmt,
		);

		if ( ! empty( $settings['post_author'] ) ) {
			$postarr['post_author'] = (int) $settings['post_author'];
		}
		if ( ! empty( $settings['category_id'] ) ) {
			$postarr['post_category'] = array( (int) $settings['category_id'] );
		}

		$author_name = $this->extract_author_name( $item );
		$post_id     = wp_insert_post( $postarr, true );
		if ( is_wp_error( $post_id ) ) {
			throw new Exception( $post_id->get_error_message() );
		}

		update_post_meta( $post_id, SUBSTACK_IMPORTER_GUID_META, $guid );
		if ( $link ) {
			update_post_meta( $post_id, SUBSTACK_IMPORTER_URL_META, $link );
		}
		if ( $author_name ) {
			update_post_meta( $post_id, '_substack_author_name', $author_name );
		}

		if ( ! empty( $settings['import_images'] ) ) {
			$image_url = $this->extract_featured_image_url( $item, $content );
			if ( $image_url ) {
				$this->set_featured_image_from_url( $post_id, $image_url, $title );
			}
		}

		return 'imported';
	}

	private function post_exists_for_guid( $guid ) {
		if ( empty( $guid ) ) {
			return false;
		}
		$existing = get_posts( array(
			'post_type'      => 'post',
			'post_status'    => 'any',
			'meta_key'       => SUBSTACK_IMPORTER_GUID_META,
			'meta_value'     => $guid,
			'fields'         => 'ids',
			'posts_per_page' => 1,
			'no_found_rows'  => true,
		) );
		return ! empty( $existing );
	}

	private function extract_author_name( $item ) {
		$author = $item->get_author();
		if ( $author && method_exists( $author, 'get_name' ) ) {
			$name = $author->get_name();
			if ( $name ) {
				return wp_strip_all_tags( $name );
			}
		}
		return '';
	}

	private function extract_featured_image_url( $item, $content_html ) {
		$enclosures = $item->get_enclosures();
		if ( $enclosures ) {
			foreach ( $enclosures as $enclosure ) {
				$type = method_exists( $enclosure, 'get_type' ) ? (string) $enclosure->get_type() : '';
				$url  = method_exists( $enclosure, 'get_link' ) ? (string) $enclosure->get_link() : '';
				if ( $url && ( '' === $type || false !== strpos( $type, 'image' ) ) ) {
					return esc_url_raw( $url );
				}
			}
		}

		if ( preg_match( '/<img[^>]+src=["\']([^"\']+)["\']/i', $content_html, $m ) ) {
			return esc_url_raw( $m[1] );
		}
		return '';
	}

	private function set_featured_image_from_url( $post_id, $url, $title ) {
		if ( ! function_exists( 'media_handle_sideload' ) ) {
			require_once ABSPATH . 'wp-admin/includes/media.php';
			require_once ABSPATH . 'wp-admin/includes/file.php';
			require_once ABSPATH . 'wp-admin/includes/image.php';
		}

		$tmp = download_url( $url, 30 );
		if ( is_wp_error( $tmp ) ) {
			return false;
		}

		$path = wp_parse_url( $url, PHP_URL_PATH );
		$name = $path ? basename( $path ) : 'substack-image.jpg';
		if ( ! preg_match( '/\.(jpe?g|png|gif|webp)$/i', $name ) ) {
			$name .= '.jpg';
		}

		$file_array = array(
			'name'     => sanitize_file_name( $name ),
			'tmp_name' => $tmp,
		);

		$attachment_id = media_handle_sideload( $file_array, $post_id, $title );
		if ( is_wp_error( $attachment_id ) ) {
			@unlink( $tmp );
			return false;
		}

		set_post_thumbnail( $post_id, $attachment_id );
		return $attachment_id;
	}
}
