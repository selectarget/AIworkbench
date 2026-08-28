"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

require("../shared/platform-rules.js");

const rules = globalThis.MaowangPlatformRules;
const fixture = (name) => JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8")
);

const messageMedia = rules.extractDoubaoMessageMedia(fixture("doubao-message.json"));

assert.equal(messageMedia.images.length, 1);
assert.equal(messageMedia.images[0].width, 2048);
assert.deepEqual(messageMedia.videos, [
  { videoKey: "v0123456789", messageId: "message-1" }
]);

const durationBody = JSON.stringify({
  chat_ability: {
    ability_type: 17,
    ability_param: JSON.stringify({ model: "old-model", duration: 10 })
  }
});
const patchedBody = rules.patchDoubaoDurationBody(durationBody, 15, 15, "seedance_v2.0");
const patchedAbility = JSON.parse(JSON.parse(patchedBody).chat_ability.ability_param);
assert.equal(patchedAbility.duration, 15);
assert.equal(patchedAbility.model, "seedance_v2.0");
assert.equal(rules.patchDoubaoDurationBody(durationBody, 10, 15, "seedance_v2.0"), durationBody);

const playInfo = rules.extractDoubaoPlayInfo(fixture("doubao-play-info.json"));
assert.equal(playInfo.success, true);
assert.match(playInfo.url, /lr=video_gen_no_watermark/);
assert.equal(playInfo.width, 1920);

const playRequest = rules.buildDoubaoPlayInfoRequest("v0123456789", "test-tab");
assert.match(playRequest.url, /samantha\/media\/get_play_info/);
assert.match(playRequest.url, /web_tab_id=test-tab/);
assert.deepEqual(JSON.parse(playRequest.init.body), { key: "v0123456789", type: "video" });

assert.equal(rules.isDoubaoCompletionUrl("https://www.doubao.com/chat/completion"), true);
assert.equal(rules.isDoubaoCompletionUrl("https://example.com/chat/completion"), false);

assert.equal(rules.qianwenImageDecision({
  url: "https://workspace-zb-cdn.qianwen.com/generated/example.png",
  width: 1024,
  height: 1024
}).accepted, true);
assert.equal(rules.qianwenImageDecision({
  url: "https://cdn.example.com/assets/generated/output.png",
  width: 1024,
  height: 1024,
  context: "assistant result creation"
}).accepted, true);
assert.equal(rules.qianwenImageDecision({
  url: "https://cdn.example.com/site/banner.png",
  width: 1024,
  height: 400,
  context: "navigation"
}).accepted, false);

console.log("platform-rules: 通过");
