-- Ảnh bìa gian hàng đại lý (banner trên trang đại lý và thẻ khám phá). Additive, idempotent.
-- Run via `npm run agrilink:cover-setup` after agrilink:setup.
ALTER TABLE agrilink_organizations ADD COLUMN IF NOT EXISTS cover_url varchar(500) NOT NULL DEFAULT '';
