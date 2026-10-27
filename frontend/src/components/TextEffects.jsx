/** เอฟเฟกต์ตัวอักษรแบบ WordArt — คืน style object ตาม id (ปรับตามขนาดฟอนต์)
 *  ใช้ทั้งบนจอ Program และปุ่มพรีวิวในพาเนล */
export const TEXT_EFFECTS = [
  // also: ค่าที่เซ็ตเพิ่มตอนกดเลือก (เช่นกล่องพื้นหลัง+ตัวหนา) ให้ได้ลุคครบในคลิกเดียว
  { id: "thai-title", label: "หัวข้อคลิปไทย", also: { bg: "#000000", bgOpacity: 80, bold: true } },
  { id: "orange-pop", label: "เหลืองส้มขอบเข้ม", also: { bg: null, bold: true } },
  { id: "neon-blue", label: "นีออนฟ้า" },
  { id: "neon-teal", label: "นีออนเขียว" },
  { id: "grad-blue", label: "ไล่สีน้ำเงิน" },
  { id: "grad-sunset", label: "ไล่สีอาทิตย์ตก" },
  { id: "extrude", label: "ตัวนูน 3D" },
  { id: "sticker", label: "สติกเกอร์" },
  { id: "chrome", label: "โครเมียม" },
  { id: "retro", label: "เรโทร" },
];

export function effectStyle(id, size = 48) {
  const u = size / 48; // สเกลเงา/ขอบตามขนาดฟอนต์
  switch (id) {
    case "thai-title": {
      // ตัวเหลือง ขอบน้ำตาลเข้มหนา + วงแหวนขาวรอบนอก (สไตล์หัวข้อคลิป YouTube ไทย)
      const r = Math.max(2, 5 * u); // รัศมีขอบขาว
      const ring = [];
      for (let a = 0; a < 16; a++) {
        const th = (a * Math.PI) / 8;
        ring.push(`${(Math.cos(th) * r).toFixed(1)}px ${(Math.sin(th) * r).toFixed(1)}px 0 #ffffff`);
      }
      return {
        color: "#ffcf3f",
        WebkitTextStroke: `${Math.max(2, 6 * u)}px #33200e`,
        paintOrder: "stroke fill",
        textShadow: ring.join(", "),
      };
    }
    case "orange-pop": {
      // ฟอนต์เฉยๆ: ส้มทึบ ขอบดำใหญ่ — ใช้วงเงารอบทิศแทน text-stroke (หนาแล้วไม่เบี้ยว)
      const r = Math.max(2, 4.5 * u);
      const ring = [];
      for (let a = 0; a < 16; a++) {
        const th = (a * Math.PI) / 8;
        ring.push(`${(Math.cos(th) * r).toFixed(1)}px ${(Math.sin(th) * r).toFixed(1)}px 0 #1a1208`);
      }
      return {
        color: "#ffa726",
        WebkitTextStroke: `${Math.max(1, 2 * u)}px #1a1208`, // ขอบชิดบางๆ เก็บรายละเอียดใน
        paintOrder: "stroke fill",
        textShadow: ring.join(", "),
      };
    }
    case "neon-blue":
      return {
        color: "#ffffff",
        textShadow: `0 0 ${6 * u}px #38bdf8, 0 0 ${14 * u}px #38bdf8, 0 0 ${28 * u}px #0284c7`,
      };
    case "neon-teal":
      return {
        color: "#ccfff5",
        textShadow: `0 0 ${6 * u}px #2dd4bf, 0 0 ${14 * u}px #14b8a6, 0 0 ${28 * u}px #0d9488`,
      };
    case "grad-blue":
      return {
        backgroundImage: "linear-gradient(180deg, #7dd3fc 0%, #2563eb 100%)",
        WebkitBackgroundClip: "text",
        backgroundClip: "text",
        WebkitTextFillColor: "transparent",
        WebkitTextStroke: "0",
        filter: `drop-shadow(0 ${2 * u}px ${2 * u}px rgba(0,0,0,0.45))`,
      };
    case "grad-sunset":
      return {
        backgroundImage: "linear-gradient(180deg, #fbbf24 0%, #f97316 55%, #ec4899 100%)",
        WebkitBackgroundClip: "text",
        backgroundClip: "text",
        WebkitTextFillColor: "transparent",
        WebkitTextStroke: "0",
        filter: `drop-shadow(0 ${2 * u}px ${2 * u}px rgba(0,0,0,0.45))`,
      };
    case "extrude": {
      // เงาซ้อนชั้นให้ดูนูนแบบ 3D
      const layers = Array.from(
        { length: Math.max(3, Math.round(6 * u)) },
        (_, i) => `${(i + 1) * 1}px ${(i + 1) * 1}px 0 #1e3a8a`
      ).join(", ");
      return { color: "#60a5fa", textShadow: layers };
    }
    case "sticker":
      return {
        color: "#2563eb",
        WebkitTextStroke: `${Math.max(2, 5 * u)}px #ffffff`,
        paintOrder: "stroke fill",
        textShadow: `0 ${4 * u}px 0 rgba(0,0,0,0.35)`,
      };
    case "chrome":
      return {
        backgroundImage:
          "linear-gradient(180deg, #f8fafc 0%, #94a3b8 45%, #334155 50%, #cbd5e1 55%, #64748b 100%)",
        WebkitBackgroundClip: "text",
        backgroundClip: "text",
        WebkitTextFillColor: "transparent",
        WebkitTextStroke: "0",
        filter: `drop-shadow(0 ${2 * u}px ${1 * u}px rgba(0,0,0,0.5))`,
      };
    case "retro":
      return {
        color: "#fde047",
        WebkitTextStroke: `${Math.max(1, 2 * u)}px #92400e`,
        textShadow: `${3 * u}px ${3 * u}px 0 #92400e`,
      };
    default:
      return {};
  }
}
