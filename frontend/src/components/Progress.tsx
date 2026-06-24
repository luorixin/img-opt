type ProgressProps = {
  current: number;
  total: number;
  label?: string;
};

export function Progress({ current, total, label }: ProgressProps) {
  const percentage = total > 0 ? Math.round((current / total) * 100) : 0;

  return (
    <div className="progressContainer">
      <div className="progressInfo">
        {label && <span className="progressLabel">{label}</span>}
        <span className="progressPercentage">{percentage}%</span>
      </div>
      <div className="progressBarTrack">
        <div
          className="progressBarFill"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
