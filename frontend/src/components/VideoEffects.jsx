import React from "react";
import ColorGradePanel from "./ColorGradePanel";
import { COLOR_GRADES } from "./looks";
import ratioCityPreview from "../assets/ratio-city-blue-hour-v1.png";

/** เอฟเฟควิดีโอ — เก็บใน clip.transform.videoFx (ใส่ได้ 1 ตัว กดซ้ำ = เอาออก)
 *  ใช้ UI ชุดเดียวกับพาเนลอนิเมชั่นข้อความ (คลาส anim-* ใน styles.css) */
export const VIDEO_FX = [
  {
    group: "Ratio",
    items: [
      {
        id: "fit",
        label: "Letterbox",
        tip: "เห็นวิดีโอเต็มตัวไม่โดนครอป — จอแนวตั้งจะมีขอบดำบน-ล่าง",
      },
      {
        id: "blur-bg",
        label: "พื้นหลังเบลอ",
        tip: "เหมือน Letterbox แต่ขอบบน-ล่างเป็นภาพวิดีโอเบลอๆ แทนสีดำ",
      },
      {
        id: "cinema-bars",
        label: "Cinema 2.39:1",
        tip: "กรอบภาพยนตร์แนวนอน พร้อมแถบดำบน–ล่างแบบจอโรงหนัง",
      },
      {
        id: "crt-screen",
        label: "CRT Screen",
        tip: "กรอบจอโทรทัศน์เก่า ขอบโค้ง มุมมืด และมีเส้นสแกนบาง ๆ",
      },
    ],
  },
  {
    group: "เปิด (In)",
    field: "videoFxIn",
    items: [
      { id: "cinema-open", label: "Cinema Open", tip: "เริ่มจากเส้นกลาง แล้วเปิดภาพขึ้น–ลงแบบม่านหนัง" },
      { id: "iris-open", label: "Iris Open", tip: "วงกลมเล็กค้างชั่วครู่ แล้วขยายเปิดภาพจนเต็มจอ" },
      { id: "tv-on", label: "TV On", tip: "เปิดแบบจอ CRT: เส้นแสงกลางจอ วาบ แล้วขยายภาพในแนวตั้ง" },
      { id: "fade-in", label: "Fade In", tip: "เริ่มจากภาพจาง แล้วค่อย ๆ ชัดขึ้น" },
    ],
  },
  {
    group: "ปิด (Out)",
    field: "videoFxOut",
    items: [
      { id: "cinema-close", label: "Cinema Close", tip: "หุบภาพจากบน–ล่างเข้าหาเส้นกลางจนจอดำ" },
      { id: "iris-close", label: "Iris Close", tip: "หุบภาพเป็นวงกลม ค้างชั่วครู่ แล้วปิดจนดำสนิท" },
      { id: "tv-off", label: "TV Off", tip: "ภาพสั่นและบิดแรงขึ้น ก่อนบีบเป็นเส้นแสงกลางจอแล้วดับ" },
      { id: "fade-out", label: "Fade Out", tip: "ภาพชัดค่อย ๆ จางลงจนเป็นจอดำ" },
    ],
  },
  {
    group: "ปรับสี",
    field: "colorGrade",
    items: COLOR_GRADES,
  },
];

/** ภาพวิวเมืองจริงสำหรับพรีวิว เพื่อให้การ์ดสื่อผลลัพธ์ได้ใกล้งานวิดีโอ */
function DemoScene() {
  return <img src={ratioCityPreview} className="vfx-demo-scene" alt="" draggable="false" />;
}

/** พรีวิวเล็กๆ ของแต่ละเอฟเฟคในการ์ด */
function FxDemo({ id }) {
  if (id === "fit")
    return (
      // จอแนวตั้ง + วิดีโอแนวนอนอยู่กลาง = ขอบดำบนล่างเหมือนของจริง
      <span className="vfx-demo-phone">
        <DemoScene />
      </span>
    );
  if (id === "blur-bg")
    return (
      // ฉากเดิมซ้อนสองชั้น: ข้างหลังยืดเต็มจอ+เบลอ / ข้างหน้าคมชัดคาดกลาง
      <span className="vfx-demo-phone">
        <span className="vfx-demo-blurbg">
          <DemoScene />
        </span>
        <DemoScene />
      </span>
    );
  if (id === "cinema-open" || id === "cinema-close")
    return <span className={`vfx-demo-phone vfx-cinema ${id === "cinema-close" ? "closing" : "opening"}`}><DemoScene /><i className="vfx-curtain top" /><i className="vfx-curtain bottom" /></span>;
  if (id === "cinema-bars")
    return <span className="vfx-demo-wide vfx-cinema-bars"><DemoScene /><i className="top" /><i className="bottom" /></span>;
  if (id === "iris-open" || id === "iris-close")
    return <span className={`vfx-demo-wide vfx-iris ${id === "iris-close" ? "closing" : "opening"}`}><DemoScene /></span>;
  if (id === "tv-on")
    return <span className="vfx-demo-wide vfx-tv-on"><DemoScene /><i /></span>;
  if (id === "tv-off")
    return <span className="vfx-demo-wide vfx-tv-on vfx-tv-off"><DemoScene /><i /></span>;
  if (id === "crt-screen")
    return <span className="vfx-demo-wide vfx-crt-screen"><DemoScene /><i /></span>;
  if (id === "fade-in" || id === "fade-out")
    return <span className={`vfx-demo-wide vfx-fade ${id === "fade-out" ? "out" : "in"}`}><DemoScene /></span>;
  return null;
}

export default function VideoFxPanel({ clip, onUpdate }) {
  const [group, setGroup] = React.useState(VIDEO_FX[0].group);
  const [query, setQuery] = React.useState("");
  // ไม่เลือกคลิปก็เปิดดูการ์ดได้ — แค่กดใส่ไม่ได้ (ขึ้นคำใบ้แถวบนแทน)
  const isVideo = clip && clip.type !== "text" && clip.type !== "layout";
  const tf = (isVideo && clip.transform) || {};
  const q = query.trim().toLowerCase();
  const groups = q
    ? VIDEO_FX.map((g) => ({
        ...g,
        items: g.items.filter(
          (a) => a.label.toLowerCase().includes(q) || a.id.includes(q) || g.group.toLowerCase().includes(q)
        ),
      })).filter((g) => g.items.length)
    : VIDEO_FX.filter((g) => g.group === group);
  return (
    <div className="anim-panel split">
      <div className="anim-sidebar">
        {VIDEO_FX.map((g) => {
          const field = g.field || "videoFx";
          const hasSel = g.items.some((a) => a.id === tf[field]);
          return (
            <button
              key={g.group}
              className={`anim-side-item ${!q && group === g.group ? "active" : ""}`}
              onClick={() => {
                setQuery("");
                setGroup(g.group);
              }}
            >
              {g.group}
              {hasSel && <span className="anim-side-dot" />}
            </button>
          );
        })}
      </div>
      <div className="anim-content">
        <input
          className="anim-search"
          type="search"
          placeholder="ค้นหาเอฟเฟค…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {!q && group === "ปรับสี" ? <ColorGradePanel clip={clip} onUpdate={onUpdate} embedded /> : <>
        {groups.length === 0 && <div className="anim-group-title">ไม่พบ "{query}"</div>}
        {groups.map((g) => (
          <div key={g.group}>
            <div className="anim-group-title">{g.group}</div>
            <div className="anim-grid">
              {g.items.map((a) => {
                const field = g.field || "videoFx";
                const sel = tf[field] === a.id;
                return (
                  <button
                    key={a.id}
                    className={`anim-card ${sel ? "selected" : ""}`}
                    title={a.tip || a.label}
                    onClick={() =>
                      isVideo && onUpdate(clip.id, { transform: { ...tf, [field]: sel ? null : a.id, ...(field === "videoFxIn" && !sel ? { videoFxInDuration: a.id === "fade-in" ? 2 : (tf.videoFxInDuration || 1) } : {}), ...(field === "videoFxOut" && !sel ? { videoFxOutDuration: a.id === "fade-out" ? 2 : (tf.videoFxOutDuration || 1) } : {}) } })
                    }
                  >
                    <span className="anim-thumb">
                      <FxDemo id={a.id} />
                      {sel && <span className="anim-check">✓</span>}
                    </span>
                    <span className="anim-card-label">{a.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}</>}
      </div>
    </div>
  );
}
