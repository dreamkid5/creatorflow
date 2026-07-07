/* =========================================================
   CreatorFlow data
   Starts empty and at zero. Real numbers appear once you
   connect your YouTube channel and start publishing.
   Product configuration (automation options, roles, feature
   names) is kept because it describes the tool, not fake stats.
   ========================================================= */

export const channel = {
  name: "Your channel",
  handle: "@yourchannel",
  avatar: "YC",
  plan: "",
  joined: ""
};

export const stats = [
  { key: "subscribers", label: "Subscribers", value: "0", raw: 0, trend: 0, up: true, cmp: "No data yet", color: "red", icon: "users" },
  { key: "views", label: "Views", value: "0", raw: 0, trend: 0, up: true, cmp: "No data yet", color: "violet", icon: "eye" },
  { key: "watch", label: "Watch time (hrs)", value: "0", raw: 0, trend: 0, up: true, cmp: "No data yet", color: "cyan", icon: "clock" },
  { key: "revenue", label: "Estimated revenue", value: "$0", raw: 0, trend: 0, up: true, cmp: "No data yet", color: "green", icon: "cash" }
];

/* Growth chart series. Empty until real data arrives. */
export const viewsSeries = [];
export const subsSeries  = [];
export const seriesLabels = [];

/* Traffic sources for the donut. Empty until real data arrives. */
export const traffic = [];

/* Weekly upload performance. Empty until real data arrives. */
export const weekly = [];

/* Your content library. Empty until you make or connect videos. */
export const videos = [];

/* Upcoming schedule queue. */
export const queue = [];

/* Calendar events keyed by day of month. */
export const calendarEvents = {};

/* Top performing videos. */
export const topVideos = [];

/* Audience demographics. */
export const demographics = [];

/* Audience geography. */
export const geography = [];

/* Activity feed. */
export const activity = [];

/* Media library items. Empty until you upload. */
export const mediaItems = [];

/* Storage breakdown. */
export const storage = [];

/* Comment inbox. */
export const comments = [];

/* Admin panel stats. */
export const adminStats = [
  { label: "Total users", value: "0", trend: 0, up: true, icon: "users", color: "violet" },
  { label: "Active channels", value: "0", trend: 0, up: true, icon: "video", color: "red" },
  { label: "Videos rendered", value: "0", trend: 0, up: true, icon: "film", color: "cyan" },
  { label: "Monthly revenue", value: "$0", trend: 0, up: true, icon: "cash", color: "green" }
];

export const adminUsers = [];

export const moderationQueue = [];

export const featureFlags = [
  { name: "AI thumbnail generator", key: "ai_thumbnails", on: true },
  { name: "Speech to clip alignment", key: "speech_align", on: false },
  { name: "Team seats and roles", key: "team_seats", on: true },
  { name: "Auto comment replies", key: "auto_reply", on: false },
  { name: "Public analytics API", key: "public_api", on: true }
];

export const apiKeys = [];

export const systemHealth = [];

/* Team members and roles. Roles and the permission matrix are product
   configuration and are kept. The member list starts empty. */
export const roles = [
  { key: "owner", name: "Owner", desc: "Full control including billing and deleting the workspace", color: "var(--brand)" },
  { key: "admin", name: "Admin", desc: "Manage members, settings, and every channel", color: "var(--violet)" },
  { key: "editor", name: "Editor", desc: "Create, edit, and publish videos and thumbnails", color: "var(--cyan)" },
  { key: "analyst", name: "Analyst", desc: "View analytics and reports, no editing", color: "var(--green)" },
  { key: "moderator", name: "Moderator", desc: "Handle comments and the moderation queue", color: "var(--amber)" }
];

export const permissionMatrix = [
  { area: "Billing and plan", owner: true, admin: false, editor: false, analyst: false, moderator: false },
  { area: "Manage members", owner: true, admin: true, editor: false, analyst: false, moderator: false },
  { area: "Publish videos", owner: true, admin: true, editor: true, analyst: false, moderator: false },
  { area: "Edit thumbnails", owner: true, admin: true, editor: true, analyst: false, moderator: false },
  { area: "View analytics", owner: true, admin: true, editor: true, analyst: true, moderator: false },
  { area: "Moderate comments", owner: true, admin: true, editor: false, analyst: false, moderator: true }
];

/* Automation engine configuration. These describe what the tool can do,
   so they are kept. Active automations and run logs start empty. */
export const triggerOptions = [
  { key: "folder_csv", label: "A CSV lands in the watch folder" },
  { key: "script_added", label: "A new script is added" },
  { key: "video_rendered", label: "A video finishes rendering" },
  { key: "schedule_time", label: "A scheduled time arrives" },
  { key: "new_comment", label: "A new comment comes in" },
  { key: "video_published", label: "A video is published" }
];

export const actionOptions = [
  { key: "gen_scene_images", label: "Generate scene images from the script" },
  { key: "gen_narration", label: "Generate the narration voiceover" },
  { key: "gen_metadata", label: "Generate title, description, and tags" },
  { key: "gen_thumbnail", label: "Create a thumbnail" },
  { key: "build_video", label: "Build a video with motion and music" },
  { key: "schedule_upload", label: "Schedule the upload at the best time" },
  { key: "auto_reply", label: "Send a friendly reply" },
  { key: "share_socials", label: "Share the link on socials" },
  { key: "notify_me", label: "Notify me" }
];

export const automations = [];

export const automationTemplates = [
  { name: "Story video from script", desc: "Scene images, narration, motion, and music, then schedule", trigger: "script_added", actions: ["gen_scene_images", "gen_narration", "build_video", "schedule_upload"] },
  { name: "Auto metadata", desc: "Generate title, description, and tags on every render", trigger: "video_rendered", actions: ["gen_metadata"] },
  { name: "Thumbnail on render", desc: "Create a thumbnail as soon as a video is ready", trigger: "video_rendered", actions: ["gen_thumbnail"] },
  { name: "Best time scheduler", desc: "Queue new videos for the top performing slot", trigger: "video_rendered", actions: ["schedule_upload"] },
  { name: "Comment autopilot", desc: "Reply and share when comments arrive", trigger: "new_comment", actions: ["auto_reply", "notify_me"] }
];

export const automationRuns = [];

export const teamMembers = [];
