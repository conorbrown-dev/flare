// The seven rainbow colors, tuned to stay readable on the dark theme.
// The server hands each person an index (0-6), picking the least-used color.
export const RAINBOW = [
  "#ff6b6b", // red
  "#ffa94d", // orange
  "#ffe066", // yellow
  "#69db7c", // green
  "#4dabf7", // blue
  "#8c7cff", // indigo
  "#e599f7", // violet
];

export const colorFor = (index: number) => RAINBOW[((index % 7) + 7) % 7];
