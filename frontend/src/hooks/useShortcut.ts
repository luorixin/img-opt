/**
 * @module useShortcut
 * @description 全局键盘快捷键钩子。
 * 支持撤销/重做、笔刷大小微调以及绘图工具的键盘快捷切换（如画笔、橡皮擦等），
 * 并自动避开输入框焦点以防冲突。
 */

import { useEffect } from "react";
import { useStore } from "../store/useStore";

export function useShortcut() {
  const undo = useStore((state) => state.undo);
  const redo = useStore((state) => state.redo);
  const brushSize = useStore((state) => state.brushSize);
  const setBrushSize = useStore((state) => state.setBrushSize);
  const setTool = useStore((state) => state.setTool);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // 如果当前焦点位于输入框、文本域或可编辑元素中，则屏蔽快捷键，防止打字冲突
      const target = event.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

      // 检测操作系统，适配 Mac 系统的 Cmd 键与 Win/Linux 系统的 Ctrl 键
      const isMac = navigator.userAgent.toUpperCase().indexOf("MAC") >= 0;
      const isCmdOrCtrl = isMac ? event.metaKey : event.ctrlKey;

      // 撤销操作: Ctrl/Cmd + Z
      if (isCmdOrCtrl && event.key.toLowerCase() === "z" && !event.shiftKey) {
        event.preventDefault();
        undo();
      }

      // 重做操作: Ctrl/Cmd + Y 或者 Mac 习惯的 Cmd + Shift + Z
      if (
        (isCmdOrCtrl && event.key.toLowerCase() === "y") ||
        (isCmdOrCtrl && event.shiftKey && event.key.toLowerCase() === "z")
      ) {
        event.preventDefault();
        redo();
      }

      // 调节笔刷大小: [ 键调小笔刷， ] 键调大笔刷
      if (event.key === "[") {
        event.preventDefault();
        setBrushSize(Math.max(4, brushSize - 4));
      }
      if (event.key === "]") {
        event.preventDefault();
        setBrushSize(Math.min(120, brushSize + 4));
      }

      // 工具箱快速切换: B (画笔), E (橡皮擦), R (框选), C (切图)
      if (!event.ctrlKey && !event.metaKey && !event.altKey) {
        if (event.key.toLowerCase() === "b") {
          event.preventDefault();
          setTool("brush");
        } else if (event.key.toLowerCase() === "e") {
          event.preventDefault();
          setTool("eraser");
        } else if (event.key.toLowerCase() === "r") {
          event.preventDefault();
          setTool("rectangle");
        } else if (event.key.toLowerCase() === "c") {
          event.preventDefault();
          setTool("crop");
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [undo, redo, brushSize, setBrushSize, setTool]);
}
