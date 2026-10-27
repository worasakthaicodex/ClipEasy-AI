/** โทนภาพสำเร็จรูป (Look) — เกรดสีทั้งก้อนด้วย CSS filter (พรีวิวสด ไม่ต้องประมวลผล)
 *  ใช้ทั้งจอ Program และ dropdown ใน Properties */
export const LOOKS = [
  { id: "none", label: "ปกติ (Original)", css: "" },
  {
    id: "night",
    label: "กลางคืน (Day → Night)",
    css: "brightness(0.62) contrast(1.18) saturate(0.8) sepia(0.28) hue-rotate(178deg)",
  },
  {
    id: "golden",
    label: "แดดเย็น (Golden Hour)",
    css: "brightness(1.05) contrast(1.05) saturate(1.25) sepia(0.32) hue-rotate(-14deg)",
  },
  {
    id: "cold",
    label: "หนาวเยือก (Cold)",
    css: "brightness(0.88) contrast(1.15) saturate(0.55) sepia(0.12) hue-rotate(155deg)",
  },
  {
    id: "horror",
    label: "หลอน (Horror)",
    css: "brightness(0.7) contrast(1.35) saturate(0.35) hue-rotate(120deg) sepia(0.2)",
  },
  { id: "bw", label: "ขาวดำ (B&W)", css: "grayscale(1) contrast(1.12)" },
  {
    id: "vintage",
    label: "ฟิล์มเก่า (Vintage)",
    css: "sepia(0.45) contrast(0.95) brightness(1.05) saturate(0.9)",
  },
];

export function lookFilter(id) {
  return LOOKS.find((l) => l.id === id)?.css || "";
}

export const COLOR_GRADES = [
  { id: "cinema-gold", label: "Cinema Gold", colors: ["#33433e", "#d59a3b"] },
  { id: "la-la-blue", label: "La La Land Blue", colors: ["#102d57", "#3b5682"] },
  { id: "twilight-teal", label: "Twilight Teal", colors: ["#123b40", "#3c8a88"] },
  { id: "black-white", label: "Black & White", colors: ["#202020", "#d6d6d6"] },
];

export function colorGradeFilter(id, strength = 100) {
  const s = Math.max(0, Math.min(1, strength / 100));
  if (!id || id === "none" || s === 0) return "";
  const filters = {
    "cinema-gold": `brightness(${1 - .05 * s}) contrast(${1 + .24 * s}) saturate(${1 + .12 * s}) sepia(${.42 * s}) hue-rotate(${-13 * s}deg)`,
    "la-la-blue": `brightness(${1 - .2 * s}) contrast(${1 + .28 * s}) saturate(${1 + .2 * s}) sepia(${.24 * s}) hue-rotate(${155 * s}deg)`,
    "twilight-teal": `brightness(${1 - .1 * s}) contrast(${1 + .2 * s}) saturate(${1 - .12 * s}) sepia(${.28 * s}) hue-rotate(${132 * s}deg)`,
    "black-white": `grayscale(${s}) contrast(${1 + .16 * s}) brightness(${1 - .03 * s})`,
    "teal-orange": `brightness(${1 - .03 * s}) contrast(${1 + .2 * s}) saturate(${1 + .28 * s}) sepia(${.25 * s}) hue-rotate(${-8 * s}deg)`,
    "warm-film": `brightness(${1 + .02 * s}) contrast(${1 + .1 * s}) saturate(${1 + .08 * s}) sepia(${.38 * s}) hue-rotate(${-10 * s}deg)`,
    "cool-cinema": `brightness(${1 - .07 * s}) contrast(${1 + .18 * s}) saturate(${1 - .12 * s}) sepia(${.12 * s}) hue-rotate(${145 * s}deg)`,
  };
  return filters[id] || "";
}
