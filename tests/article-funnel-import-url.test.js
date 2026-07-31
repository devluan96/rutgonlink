const test = require("node:test");
const assert = require("node:assert/strict");

const { __testUtils } = require("../api/index");

test("extractArticleFunnelImportPayload preserves sensitive wrappers from source HTML", () => {
  const html = `
    <html>
      <head>
        <title>Demo nhay cam</title>
      </head>
      <body>
        <article>
          <div class="sensitive-video-wrapper">
            <video controls src="https://cdn.example.com/video-1.mp4"></video>
            <button class="reveal-button">Video nhạy cảm, xác nhận xem?</button>
          </div>
          <div class="sensitive-image-wrapper">
            <img src="https://cdn.example.com/image-1.jpg" alt="hinh 1" width="1200" height="900" />
            <button class="reveal-button">Hình ảnh nhạy cảm, xác nhận xem?</button>
          </div>
        </article>
      </body>
    </html>
  `;

  const payload = __testUtils.extractArticleFunnelImportPayload(
    html,
    "https://example.com/article",
  );

  assert.equal(payload.blocks.length >= 2, true);
  assert.equal(payload.blocks[0].type, "sensitive-video");
  assert.equal(payload.blocks[0].src, "https://cdn.example.com/video-1.mp4");
  assert.equal(payload.blocks[1].type, "sensitive-image");
  assert.equal(payload.blocks[1].src, "https://cdn.example.com/image-1.jpg");
});

test("extractArticleFunnelImportPayload imports iframe video providers as video-embed blocks", () => {
  const html = `
    <html>
      <head>
        <title>Demo embed video</title>
      </head>
      <body>
        <article>
          <figure class="wp-block-embed is-type-video is-provider-vimeo">
            <div class="wp-block-embed__wrapper">
              <iframe
                src="https://player.vimeo.com/video/1214443665?dnt=1&amp;app_id=122963"
                width="422"
                height="750"
                allow="autoplay; fullscreen; picture-in-picture"
              ></iframe>
            </div>
          </figure>
          <p>Mo ta ngan.</p>
        </article>
      </body>
    </html>
  `;

  const payload = __testUtils.extractArticleFunnelImportPayload(
    html,
    "https://example.com/article",
  );

  assert.equal(payload.video_count, 1);
  assert.equal(payload.blocks[0].type, "video-embed");
  assert.equal(
    payload.blocks[0].src,
    "https://player.vimeo.com/video/1214443665?dnt=1&app_id=122963",
  );
});
