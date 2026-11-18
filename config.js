// ---------------------------------------------
// SETTINGS: change school days and times here
// ---------------------------------------------
const CONFIG = {
  days: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday"],

  // The fixed periods of every school day: [start, end] in 24-hour time
  periods: [
    ["09:00", "09:50"],   // Period 1
    ["09:50", "10:40"],   // Period 2
    ["10:40", "11:30"],   // Period 3
    ["12:00", "12:40"],   // Period 4
    ["12:40", "13:20"],   // Period 5 (last)
  ],

  // Tiffin break is shown after this many periods (3 = after Period 3)
  break: ["11:30", "12:00"],
  breakAfterPeriod: 3,
};
