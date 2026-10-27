import React from "react";

/** ทรง bubble หลังข้อความ — วาดด้วย SVG ยืดตามขนาดข้อความ (ไม่ใช้ไฟล์ภาพ)
 *  pad: padding ของข้อความ (เผื่อพื้นที่หางกรอบ), textColor: สีตัวอักษรที่เข้ากับทรงนั้น */
export const BUBBLES = [
  { id: "chat-white", label: "แชตขาว (หางซ้าย)", textColor: "#30323a", pad: "0.42em 0.9em 0.6em", font: "Arial Rounded MT Bold" },
  { id: "chat-blue", label: "แชตน้ำเงิน (หางขวา)", textColor: "#ffffff", pad: "0.42em 0.9em 0.6em", font: "Arial Rounded MT Bold" },
  { id: "speech", label: "กรอบคำพูด", textColor: "#333333", pad: "0.35em 0.8em 1.0em" },
  { id: "thought", label: "ก้อนความคิด", textColor: "#1d4ed8", pad: "0.55em 1.0em 1.1em" },
  { id: "burst", label: "ตะโกน", textColor: "#7c2d12", pad: "0.9em 1.6em" },
  { id: "round", label: "ป้ายมน", textColor: "#7c3aed", pad: "0.4em 0.9em" },
  { id: "note", label: "โน้ต", textColor: "#ffe08a", pad: "0.55em 1.0em" },
  { id: "paper", label: "กระดาษ", textColor: "#333333", pad: "0.55em 0.9em" },
  { id: "tag", label: "ป้ายห้อย", textColor: "#8d2b5b", pad: "0.45em 0.9em 0.45em 1.4em" },
  { id: "banner", label: "แบนเนอร์", textColor: "#1f2937", pad: "0.45em 1.5em" },
];

export function bubblePad(id) {
  return BUBBLES.find((b) => b.id === id)?.pad;
}

/** SVG พื้นหลังของ bubble — วางเต็มกล่องข้อความ (แม่ต้อง position:relative) */
export function BubbleSvg({ id }) {
  const common = {
    width: "100%",
    height: "100%",
    position: "absolute",
    inset: 0,
    pointerEvents: "none",
  };
  switch (id) {
    case "chat-white":
      return (
        <svg viewBox="0 0 120 58" preserveAspectRatio="none" style={common}>
          <path
            d="M18 3 H105 C112 3 117 9 117 17 V39 C117 47 111 52 103 52 H23 C18 52 14 51 11 49 C8 52 4 54 1 54 C6 49 8 44 8 39 V17 C8 9 12 3 18 3 Z"
            fill="#f5f5f7"
            stroke="#d2d3d8"
            strokeWidth="1.5"
          />
        </svg>
      );
    case "chat-blue":
      return (
        <svg viewBox="0 0 120 58" preserveAspectRatio="none" style={common}>
          <path
            d="M15 3 H102 C110 3 115 9 115 17 V38 C115 43 117 48 120 52 C115 52 111 50 108 47 C105 50 101 52 96 52 H15 C7 52 3 46 3 38 V17 C3 9 8 3 15 3 Z"
            fill="#168bf2"
            stroke="#0878dd"
            strokeWidth="1.2"
          />
        </svg>
      );
    case "speech": // กรอบคำพูดขาว หางล่างซ้าย
      return (
        <svg viewBox="0 0 100 60" preserveAspectRatio="none" style={common}>
          <path
            d="M8 2 h84 a6 6 0 0 1 6 6 v32 a6 6 0 0 1 -6 6 h-56 l-13 12 3 -12 h-18 a6 6 0 0 1 -6 -6 v-32 a6 6 0 0 1 6 -6 z"
            fill="#ffffff"
            stroke="#c9ced6"
            strokeWidth="1.2"
          />
        </svg>
      );
    case "thought": // ก้อนเมฆความคิด + จุดหาง
      return (
        <svg viewBox="0 0 100 60" preserveAspectRatio="none" style={common}>
          <g fill="#dbeafe" stroke="#60a5fa" strokeWidth="1.2">
            <ellipse cx="26" cy="18" rx="20" ry="13" />
            <ellipse cx="52" cy="13" rx="22" ry="12" />
            <ellipse cx="76" cy="20" rx="19" ry="13" />
            <ellipse cx="64" cy="33" rx="26" ry="14" />
            <ellipse cx="34" cy="34" rx="24" ry="14" />
            <circle cx="20" cy="51" r="4.5" />
            <circle cx="11" cy="57" r="2.5" />
          </g>
        </svg>
      );
    case "burst": // ดาวระเบิดแบบ Wow!
      return (
        <svg viewBox="0 0 100 60" preserveAspectRatio="none" style={common}>
          <polygon
            points="50,0 58,12 72,4 74,17 90,14 84,26 100,30 86,37 94,50 78,46 78,60 64,52 56,60 50,50 42,60 34,50 22,58 24,44 8,48 16,35 0,30 14,24 6,12 22,15 26,2 38,11"
            fill="#fde047"
            stroke="#f59e0b"
            strokeWidth="1.5"
          />
        </svg>
      );
    case "round": // ป้ายมนม่วงอ่อนแบบ Your Words
      return (
        <svg viewBox="0 0 100 60" preserveAspectRatio="none" style={common}>
          <rect x="2" y="4" width="96" height="52" rx="24" fill="#ede9fe" stroke="#7c3aed" strokeWidth="2" />
        </svg>
      );
    case "note": // กล่องแดงขอบประแบบ NOTE
      return (
        <svg viewBox="0 0 100 60" preserveAspectRatio="none" style={common}>
          <rect x="1" y="1" width="98" height="58" rx="6" fill="#dc2626" />
          <rect
            x="6"
            y="6"
            width="88"
            height="48"
            rx="4"
            fill="none"
            stroke="#ffe08a"
            strokeWidth="1.4"
            strokeDasharray="5 4"
          />
        </svg>
      );
    case "paper": // กระดาษโน้ตขาว พับมุม
      return (
        <svg viewBox="0 0 100 60" preserveAspectRatio="none" style={common}>
          <path d="M2 2 h96 v58 h-84 l-12 -12 z" fill="#ffffff" stroke="#c9ced6" strokeWidth="1.2" transform="rotate(180 50 30)" />
          <path d="M2 46 l12 12 v-12 z" fill="#e5e7eb" transform="rotate(180 50 30)" />
        </svg>
      );
    case "tag": // ป้ายห้อยชมพู มีรูร้อยเชือก
      return (
        <svg viewBox="0 0 100 60" preserveAspectRatio="none" style={common}>
          <path d="M18 2 h76 a4 4 0 0 1 4 4 v48 a4 4 0 0 1 -4 4 h-76 l-16 -28 z" fill="#f9a8d4" stroke="#db2777" strokeWidth="1.5" />
          <circle cx="14" cy="30" r="4" fill="#fff" stroke="#db2777" strokeWidth="1.5" />
        </svg>
      );
    case "banner": // แบนเนอร์ปลายเว้าสองข้าง
      return (
        <svg viewBox="0 0 100 60" preserveAspectRatio="none" style={common}>
          <polygon
            points="0,6 100,6 92,30 100,54 0,54 8,30"
            fill="#f3f4f6"
            stroke="#9ca3af"
            strokeWidth="1.2"
          />
        </svg>
      );
    default:
      return null;
  }
}
