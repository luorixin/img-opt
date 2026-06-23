export function ResultPane({ resultUrl }: { resultUrl: string | null }) {
  return (
    <div className="resultPane">
      {resultUrl ? <img src={resultUrl} alt="修复结果" /> : <div className="resultEmpty">结果预览</div>}
    </div>
  );
}
