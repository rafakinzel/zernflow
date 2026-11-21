-- The Reel's cover. Instagram takes a custom cover only from a public image
-- link (`cover_url`), so the Central puts the cover JPEG in the same public
-- `reels` bucket as the MP4, through the same one-time upload URL, and deletes
-- it with the video once the Reel is out. Only adds image/jpeg to what the
-- bucket accepts; nothing else changes.
update storage.buckets
set allowed_mime_types = array['video/mp4', 'image/jpeg']
where id = 'reels';
