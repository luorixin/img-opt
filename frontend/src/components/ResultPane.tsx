/**
 * @module ResultPane
 * @description 展示 AI 处理结果的容器组件。
 * 支持滑动条 (Before/After Slider) 形式以进行原图与效果图的实时分屏像素对比。
 */

import { useState, useRef, useEffect } from "react";

type ResultPaneProps = {
  originalUrl: string | null;
  resultUrl: string | null;
  imageWidth?: number;
  imageHeight?: number;
};

export function canUseComparisonSlider(
  originalWidth?: number,
  originalHeight?: number,
  resultWidth?: number,
  resultHeight?: number,
): boolean {
  return Boolean(
    originalWidth &&
      originalHeight &&
      resultWidth &&
      resultHeight &&
      originalWidth === resultWidth &&
      originalHeight === resultHeight,
  );
}

export function ResultPane({ originalUrl, resultUrl, imageWidth, imageHeight }: ResultPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [sliderX, setSliderX] = useState(50);
  const [isDragging, setIsDragging] = useState(false);
  const [resultSize, setResultSize] = useState<{ width: number; height: number } | null>(null);

  // 如果结果图 URL 改变，重置滑动条至中间 (50%)
  useEffect(() => {
    if (resultUrl) {
      setSliderX(50);
      setResultSize(null);
    }
  }, [resultUrl]);

  const handleResultLoad = (event: React.SyntheticEvent<HTMLImageElement>) => {
    const loaded = event.currentTarget;
    setResultSize({
      width: loaded.naturalWidth,
      height: loaded.naturalHeight,
    });
  };

  if (!resultUrl) {
    return (
      <div className="resultPane">
        <div className="resultEmpty">结果预览</div>
      </div>
    );
  }

  // 若无原图（防御性降级），退回显示单张结果图
  if (!originalUrl) {
    return (
      <div className="resultPane">
        <img src={resultUrl} alt="修复结果" onLoad={handleResultLoad} />
      </div>
    );
  }

  const canCompare = canUseComparisonSlider(
    imageWidth,
    imageHeight,
    resultSize?.width,
    resultSize?.height,
  );

  if (!canCompare) {
    return (
      <div className="resultPane">
        <img src={resultUrl} alt="修复结果" onLoad={handleResultLoad} />
      </div>
    );
  }

  // 指针按下：锁定指针捕捉并开启拖动
  const handlePointerDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsDragging(true);
    updateSliderPosition(e.clientX);
  };

  // 指针移动：更新拖拽中轴线位置
  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return;
    updateSliderPosition(e.clientX);
  };

  // 指针抬起：释放捕捉并结束拖动
  const handlePointerUp = (e: React.PointerEvent) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setIsDragging(false);
  };

  const handlePointerCancel = () => {
    setIsDragging(false);
  };

  // 根据当前容器宽度比例计算滑块的百分比位置
  const updateSliderPosition = (clientX: number) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const percent = Math.max(0, Math.min(100, (x / rect.width) * 100));
    setSliderX(percent);
  };

  // 保持与原图相同的宽高比例，防止两张图缩放对齐错位
  const aspectStyle = imageWidth && imageHeight
    ? { aspectRatio: `${imageWidth} / ${imageHeight}` }
    : undefined;

  return (
    <div className="resultPane">
      <div
        ref={containerRef}
        className="sliderContainer"
        style={aspectStyle}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onLostPointerCapture={handlePointerCancel}
      >
        {/* 底层图片：原始图像 */}
        <img
          src={originalUrl}
          alt="原图"
          className="sliderImageBefore"
          draggable={false}
        />
        <div className="sliderLabel sliderLabelBefore">原图</div>

        {/* 顶层图片：处理结果图像，利用 clip-path 动态进行左侧裁剪 */}
        <img
          src={resultUrl}
          alt="修复结果"
          className="sliderImageAfter"
          style={{ clipPath: `inset(0 0 0 ${sliderX}%)` }}
          draggable={false}
          onLoad={handleResultLoad}
        />
        <div className="sliderLabel sliderLabelAfter">效果图</div>

        {/* 拖动分割线 */}
        <div className="sliderLine" style={{ left: `${sliderX}%` }} />

        {/* 双向滑动手柄 */}
        <div className="sliderHandle" style={{ left: `${sliderX}%` }}>
          <span>↔</span>
        </div>
      </div>
    </div>
  );
}
