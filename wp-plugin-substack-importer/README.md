# Substack Importer (WordPress plugin)

Pulls posts from a Substack publication into a WordPress site automatically. Runs on WP-Cron, dedupes by Substack post ID, and can import the featured image into the WordPress media library.

## Features

- Configurable Substack publication URL — RSS feed is built automatically
- Schedule: every 15 min, 30 min, hourly, twice daily, or daily
- Mapping: choose default author, category, and post status (draft / publish / pending / private)
- Dedupe: each imported post stores the Substack GUID in `_substack_guid` post meta — re-syncs skip already-imported items
- Featured image: first inline image (or enclosure) is sideloaded to the media library and set as the featured image
- Original publication date is preserved
- Optional "Originally published on Substack" link appended to each post
- Manual "Sync now" button in the admin
- Clean uninstall removes options and cron job (imported posts/media are kept)

## Install

1. Zip the `wp-plugin-substack-importer/` folder:
   ```bash
   cd wp-plugin-substack-importer
   zip -r ../substack-importer.zip .
   ```
2. In WordPress: **Plugins → Add New → Upload Plugin → Choose File → Install Now → Activate**.
3. Go to **Settings → Substack Importer**.

Alternative: copy the `wp-plugin-substack-importer/` folder directly into `wp-content/plugins/` on the server, then activate from the Plugins screen.

## Configure

| Field | Notes |
| --- | --- |
| Substack publication URL | e.g. `https://yourname.substack.com`. The plugin appends `/feed` automatically. |
| Imported post status | `draft` is safest while you're testing; switch to `publish` for full auto-publish. |
| Default author | The WordPress user the imported posts are attributed to. |
| Category | Imported posts go into this category. |
| Sync frequency | How often WP-Cron triggers a sync. |
| Import featured images | Downloads the first inline image to the media library and sets it as the featured image. |
| Append "Originally published on Substack" | Appends a small link back to the Substack URL at the end of each post. |

Hit **Sync now** to run an immediate import. The Status panel shows the last sync time, result, and next scheduled run.

## How it works

1. WP-Cron triggers `substack_importer_sync_event` on the configured schedule.
2. The importer fetches the Substack RSS feed via WordPress's built-in `fetch_feed()` (SimplePie).
3. For each item, it checks `_substack_guid` meta. If a post with that GUID exists, the item is skipped.
4. New items become a WordPress post (`wp_insert_post`) with the original publish date, title, content, author, category, and configured status.
5. If image import is on, the first image is sideloaded via `media_handle_sideload()` and set as the featured image.

## Reliable scheduling

WP-Cron only fires on page visits. For low-traffic sites:

1. Add `define( 'DISABLE_WP_CRON', true );` to `wp-config.php`.
2. Set a real cron job hitting `wp-cron.php`:
   ```
   */5 * * * * wget -q -O - https://yoursite.com/wp-cron.php?doing_wp_cron >/dev/null 2>&1
   ```

## Notes & limits

- Substack RSS feeds expose recent posts only (typically the most recent 20). To backfill older posts, run **Sync now** while a Substack export is paginated, or import via Substack's CSV export separately.
- Paywalled / subscriber-only content is not in the public RSS, so it won't be imported.
- Substack's RSS includes the post HTML; the plugin filters it through `wp_kses_post()` to strip unsafe tags.
- Imported posts retain the `_substack_guid` and `_substack_source_url` post meta — useful for later cleanup or canonical tag plugins.

## Uninstall

Deactivating the plugin stops the cron schedule. Deleting it (via Plugins → Delete) also removes the saved settings option. Imported posts and media are preserved.
