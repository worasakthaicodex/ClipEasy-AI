import React from "react";

/**
 * เส้นคั่นพาเนลที่ลากปรับขนาดได้ วางเป็น grid item คั่นระหว่างพาเนล
 * direction: "v" = เส้นตั้ง (ลากซ้าย-ขวา), "h" = เส้นนอน (ลากขึ้น-ลง)
 * onDrag(delta) ได้ระยะที่เมาส์ขยับเป็น px ทุกครั้งที่ลาก
 */
export default function Splitter({ direction, onDrag }) {
  const handleMouseDown = (e) => {
    e.preventDefault();
    document.body.style.cursor = direction === "v" ? "col-resize" : "row-resize";

    const onMove = (ev) => onDrag(direction === "v" ? ev.movementX : ev.movementY);
    const onUp = () => {
      document.body.style.cursor = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return <div className={`splitter ${direction}`} onMouseDown={handleMouseDown} />;
}
